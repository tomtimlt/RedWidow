import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { type EngineEvent, EVENT_SCHEMA_VERSION, validateEvent } from "../events.js";
import { type Reason, reason } from "../reason.js";
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

export interface JournalOptions {
  /**
   * Taille maximale du fichier (octets, tous runs confondus). À la limite, le
   * writer écrit une dernière ligne `journal.truncated` et ignore la suite.
   * Défaut : 100 Mio.
   */
  maxBytes?: number;
}

export const DEFAULT_JOURNAL_MAX_BYTES = 100 * 1024 * 1024;

export async function openJournal(
  path: string,
  { maxBytes = DEFAULT_JOURNAL_MAX_BYTES }: JournalOptions = {},
): Promise<JournalWriter> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  let chain: Promise<unknown> = Promise.resolve();
  let failure: unknown = null;
  // Un journal rouvert en ajout compte déjà ce qu'il contient.
  let written = (await handle.stat()).size;
  let last: EngineEvent | null = null;
  let dropped = 0;
  let closed = false;

  const write = (line: string) => {
    chain = chain
      .then(() => handle.appendFile(line, "utf8"))
      .catch((err: unknown) => {
        failure ??= err;
      });
  };

  /** Ligne de fin synthétique : l'id est aléatoire, runId/seq prolongent le dernier événement. */
  const marker = (): string => {
    const event: EngineEvent = {
      v: EVENT_SCHEMA_VERSION,
      id: randomUUID(),
      seq: (last?.seq ?? -1) + 1,
      ts: new Date().toISOString(),
      runId: last?.runId ?? "journal",
      parentId: null,
      kind: "journal.truncated",
      limitBytes: maxBytes,
      droppedEvents: dropped,
    };
    return `${JSON.stringify(event)}\n`;
  };

  const sink: EventSink = (event) => {
    if (closed) return;
    if (dropped > 0) {
      dropped++;
      return;
    }
    const line = `${JSON.stringify(event)}\n`;
    // On garde la place de la ligne de fin (jusqu'à 1 Kio) avant de refuser.
    if (written + Buffer.byteLength(line) + MARKER_RESERVE > maxBytes) {
      dropped = 1;
      return;
    }
    written += Buffer.byteLength(line);
    last = event;
    write(line);
  };

  return {
    path,
    sink,
    async close() {
      closed = true;
      if (dropped > 0) write(marker());
      await chain;
      await handle.close();
      if (failure) throw failure;
    },
  };
}

/** Octets réservés pour la ligne `journal.truncated`. */
const MARKER_RESERVE = 1024;

export interface JournalIssue {
  line: number;
  error: Reason;
}

export interface JournalContents {
  events: EngineEvent[];
  /** Lignes ignorées (corrompues, tronquées, schéma inconnu). */
  issues: JournalIssue[];
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
    issues.push({
      line: n,
      error: reason("journal.invalidJson", {
        message: err instanceof Error ? err.message : String(err),
      }),
    });
    return;
  }
  value = migrate(value);
  const error = validateEvent(value);
  if (error) {
    issues.push({ line: n, error });
    return;
  }
  const event = value as EngineEvent;
  // `v` absent = schéma 1 (journaux antérieurs au versionnage).
  events.push(event.v === undefined ? { ...event, v: 1 } : event);
}

/** Motif d'un ancien journal (texte libre) : relu sous la forme `legacy`, affiché tel quel. */
const legacy = (text: string): Reason => reason("legacy", { text });

/**
 * Migrations à la lecture des anciens journaux :
 * - `tool.result` avec `summary` : relu comme une sortie complète non tronquée ;
 * - `approval.decided.reason` et `error.message` en texte : relus en motif
 *   `{ code: "legacy", params: { text } }` que `@warband/messages` affiche tel quel.
 */
function migrate(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const v = value as Record<string, unknown>;
  if (v.kind === "approval.decided" && typeof v.reason === "string") {
    return { ...v, reason: legacy(v.reason) };
  }
  if (v.kind === "error" && v.code === undefined && typeof v.message === "string") {
    const { message, ...rest } = v;
    return { ...rest, ...legacy(message as string) };
  }
  if (v.kind === "tool.result" && v.output === undefined && typeof v.summary === "string") {
    const { summary, ...rest } = v;
    return {
      ...rest,
      output: summary,
      truncated: false,
      bytes: Buffer.byteLength(summary as string),
    };
  }
  return value;
}
