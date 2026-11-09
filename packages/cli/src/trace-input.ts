import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { type EngineEvent, type JournalContents, parseJournal } from "@warband/core";
import { type Entry, open, type ZipFile } from "yauzl";

export interface TraceInput extends JournalContents {
  restoredSequences: number;
}
/** Accepte le journal brut ou une enveloppe d’audit ; aucun fichier n’est extrait sur disque. */
export function parseTraceInput(text: string): TraceInput {
  const lines: string[] = [];
  let restoredSequences = 0;
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      let row = JSON.parse(line);
      if (row.kind === "engine" && row.data && typeof row.data === "object") {
        row = { v: row.v, id: row.id, ts: row.ts, runId: row.runId, parentId: null, ...row.data };
      } else if (row.projectId !== undefined) continue;
      if (row.seq === undefined) {
        row.seq = index;
        restoredSequences++;
      }
      lines.push(JSON.stringify(row));
    } catch {
      lines.push(line);
    }
  }
  return { ...parseJournal(lines.join("\n")), restoredSequences };
}

const MAX_BYTES = 1024 * 1024 * 1024;
export async function readTraceInput(path: string): Promise<TraceInput> {
  if (!path.toLowerCase().endsWith(".zip")) {
    const chunks: string[] = [];
    let bytes = 0;
    for await (const line of createInterface({
      input: createReadStream(path),
      crlfDelay: Infinity,
    })) {
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > MAX_BYTES) throw Error("Journal trop volumineux (maximum 1 Gio).");
      chunks.push(line);
    }
    return parseTraceInput(chunks.join("\n"));
  }
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    open(path, { lazyEntries: true }, (error, zip) =>
      error || !zip ? reject(error) : resolve(zip),
    ),
  );
  const entries: { name: string; text: string }[] = [];
  let bytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        if (!/^journals\/[^/]+\.jsonl$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        bytes += entry.uncompressedSize;
        if (bytes > MAX_BYTES) {
          reject(Error("Audit trop volumineux (maximum 1 Gio)."));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error);
            return;
          }
          const chunks: Buffer[] = [];
          let actual = 0;
          stream.on("error", reject);
          stream.on("data", (chunk: Buffer) => {
            actual += chunk.length;
            if (actual > entry.uncompressedSize || actual > MAX_BYTES)
              stream.destroy(Error("Taille ZIP incohérente."));
            else chunks.push(chunk);
          });
          stream.on("end", () => {
            entries.push({ name: entry.fileName, text: Buffer.concat(chunks).toString("utf8") });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  // Les chunks d’un collecteur suivent le nom de fichier ; les autres collecteurs sont triés ensuite par date.
  const parsed = parseTraceInput(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => e.text)
      .join("\n"),
  );
  parsed.events.sort((a: EngineEvent, b: EngineEvent) => a.ts.localeCompare(b.ts));
  return parsed;
}
