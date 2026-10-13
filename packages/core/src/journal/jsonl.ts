import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { type EngineEvent, isEventKind } from "../events.js";
import type { EventSink } from "../recorder.js";

/**
 * Écrit un événement par ligne. Les écritures sont sérialisées dans l'ordre
 * d'émission ; `close()` attend qu'elles soient toutes sur disque.
 */
export interface JournalWriter {
  readonly path: string;
  readonly sink: EventSink;
  close(): Promise<void>;
}

export async function openJournal(path: string): Promise<JournalWriter> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  let chain: Promise<unknown> = Promise.resolve();
  let failure: unknown = null;

  const sink: EventSink = (event) => {
    const line = `${JSON.stringify(event)}\n`;
    chain = chain
      .then(() => handle.appendFile(line, "utf8"))
      .catch((err: unknown) => {
        failure ??= err;
      });
  };

  return {
    path,
    sink,
    async close() {
      await chain;
      await handle.close();
      if (failure) throw failure;
    },
  };
}

export interface JournalIssue {
  line: number;
  error: string;
}

export interface JournalContents {
  events: EngineEvent[];
  /** Lignes ignorées (corrompues, tronquées, schéma inconnu). */
  issues: JournalIssue[];
}

function validate(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "objet attendu";
  const v = value as Record<string, unknown>;
  if (!isEventKind(v.kind)) return `kind inconnu : ${String(v.kind)}`;
  if (typeof v.id !== "string") return "id manquant";
  if (typeof v.seq !== "number") return "seq manquant";
  if (typeof v.ts !== "string") return "ts manquant";
  if (typeof v.runId !== "string") return "runId manquant";
  if (v.parentId !== null && typeof v.parentId !== "string") return "parentId invalide";
  return null;
}

/** Parse un journal en mémoire. Tolère une dernière ligne tronquée. */
export function parseJournal(text: string): JournalContents {
  const events: EngineEvent[] = [];
  const issues: JournalIssue[] = [];
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    pushLine(line, index + 1, events, issues);
  });
  return { events, issues };
}

/** Lecture en flux, pour les journaux volumineux. */
export async function readJournal(path: string): Promise<JournalContents> {
  const events: EngineEvent[] = [];
  const issues: JournalIssue[] = [];
  const rl = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let n = 0;
  for await (const raw of rl) {
    n++;
    const line = raw.trim();
    if (line !== "") pushLine(line, n, events, issues);
  }
  return { events, issues };
}

function pushLine(line: string, n: number, events: EngineEvent[], issues: JournalIssue[]): void {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (err) {
    issues.push({ line: n, error: err instanceof Error ? err.message : "JSON invalide" });
    return;
  }
  const error = validate(value);
  if (error) issues.push({ line: n, error });
  else events.push(value as EngineEvent);
}
