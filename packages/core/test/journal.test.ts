import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRecorder,
  type EngineEvent,
  EVENT_SCHEMA_VERSION,
  openJournal,
  parseJournal,
  readJournal,
} from "../src/index.js";

const tmp = () => mkdtemp(join(tmpdir(), "john-journal-"));

describe("journal JSONL", () => {
  it("écrit puis relit les événements dans l'ordre", async () => {
    const path = join(await tmp(), "nested", "run.jsonl");
    const journal = await openJournal(path);
    const recorder = createRecorder({ runId: "r1" });
    recorder.subscribe(journal.sink);
    const root = recorder.emit({ kind: "run.started", prompt: "p", cwd: "/" });
    for (let i = 0; i < 50; i++) recorder.emit({ kind: "agent.text", text: `t${i}` }, root.id);
    await journal.close();

    const text = await readFile(path, "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(51);

    const { events, issues } = await readJournal(path);
    expect(issues).toEqual([]);
    expect(events.map((e) => e.seq)).toEqual([...Array(51).keys()]);
    expect(events[1]).toMatchObject({
      kind: "agent.text",
      text: "t0",
      parentId: root.id,
      runId: "r1",
    });
  });

  it("ajoute à un journal existant", async () => {
    const path = join(await tmp(), "run.jsonl");
    for (const prompt of ["a", "b"]) {
      const j = await openJournal(path);
      const r = createRecorder();
      r.subscribe(j.sink);
      r.emit({ kind: "run.started", prompt, cwd: "/" });
      await j.close();
    }
    expect((await readJournal(path)).events).toHaveLength(2);
  });

  it("signale les lignes corrompues sans échouer", async () => {
    const good = JSON.stringify({
      id: "a",
      seq: 0,
      ts: "2026-01-01T00:00:00.000Z",
      runId: "r",
      parentId: null,
      kind: "error",
      message: "x",
    });
    const text = [good, "{pas du json", JSON.stringify({ kind: "inconnu" }), '{"id":"tronq'].join(
      "\n",
    );
    const { events, issues } = parseJournal(text);
    expect(events).toHaveLength(1);
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4]);

    const path = join(await tmp(), "bad.jsonl");
    await writeFile(path, `${text.replace(/\n/g, "\r\n")}\r\n`);
    const streamed = await readJournal(path);
    expect(streamed.events).toHaveLength(1);
    expect(streamed.issues).toHaveLength(3);
  });

  it("écrit v dans chaque ligne", async () => {
    const path = join(await tmp(), "v.jsonl");
    const journal = await openJournal(path);
    const recorder = createRecorder();
    recorder.subscribe(journal.sink);
    recorder.emit({ kind: "error", code: "error.unknown", message: "x" });
    await journal.close();
    const [line] = (await readFile(path, "utf8")).trim().split("\n");
    expect(JSON.parse(line as string)).toMatchObject({ v: EVENT_SCHEMA_VERSION });
  });

  describe("taille maximale", () => {
    const fill = async (maxBytes: number, count: number) => {
      const path = join(await tmp(), "big.jsonl");
      const journal = await openJournal(path, { maxBytes });
      const recorder = createRecorder({ runId: "r1" });
      recorder.subscribe(journal.sink);
      for (let i = 0; i < count; i++) recorder.emit({ kind: "agent.text", text: `t${i}` });
      await journal.close();
      return { path, text: await readFile(path, "utf8") };
    };

    it("écrit une dernière ligne journal.truncated et ignore la suite", async () => {
      const { path, text } = await fill(2000, 40);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2000);
      const { events, issues } = await readJournal(path);
      expect(issues).toEqual([]);
      const last = events.at(-1) as EngineEvent;
      expect(last).toMatchObject({ kind: "journal.truncated", limitBytes: 2000, runId: "r1" });
      const kept = events.length - 1;
      expect(kept).toBeGreaterThan(0);
      expect(kept).toBeLessThan(40);
      expect(last.kind === "journal.truncated" && last.droppedEvents).toBe(40 - kept);
      // seq prolonge le dernier événement écrit, id distinct de tous les autres.
      expect(last.seq).toBe((events[kept - 1] as EngineEvent).seq + 1);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    });

    it("n'ajoute aucune ligne de fin quand tout tient", async () => {
      const { text } = await fill(100_000, 5);
      expect(text).not.toContain("journal.truncated");
      expect(text.trim().split("\n")).toHaveLength(5);
    });

    it("compte le contenu d'un journal rouvert en ajout", async () => {
      const first = await fill(2000, 40);
      const j = await openJournal(first.path, { maxBytes: 2000 });
      const r = createRecorder({ runId: "r2" });
      r.subscribe(j.sink);
      r.emit({ kind: "error", code: "error.unknown", message: "trop tard" });
      await j.close();
      const text = await readFile(first.path, "utf8");
      expect(text).not.toContain("trop tard");
    });
  });
});
