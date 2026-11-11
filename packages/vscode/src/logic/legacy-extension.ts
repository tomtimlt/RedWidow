import { lstat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ConversationMeta, isRunId, parseIndex, titleFrom } from "./history.js";
import { createJournalFiles } from "./historyStore.js";

/**
 * Reprise de l'historique de l'ancien identifiant d'extension (ADR 0051). Tout est en LECTURE SEULE :
 * rien n'est écrit, déplacé ni supprimé sous l'ancien identifiant, et seules les clés d'historique de
 * `workspaceState` sont lues (jamais `SecretStorage`).
 */

/** Dossier de l'ancien identifiant (`warband.warband`) à côté de ceux de l'extension actuelle. */
export const LEGACY_EXTENSION_ID = "warband.warband";
const STATE_DB = "state.vscdb";
/** Clés d'historique de l'ancien `workspaceState` (mêmes noms que `shared-history.ts`). */
const SHARED_KEY = "warband.history.shared.v1";
const OLD_PREFIX = "warband.history.";
const OLD_SIDEBAR_KEY = "warband.history";
const CHAT = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const MAX_ENTRIES = 2000;
const MAX_WORKSPACES = 2000;
const MAX_JOURNALS_PER_WORKSPACE = 500;

export interface LegacyWorkspace {
  /** `state.vscdb` de la fenêtre, s'il existe. */
  db: string | null;
  /** `<hash>/warband.warband/runs`, s'il existe. */
  runs: string | null;
}
export interface LegacyStores {
  /** Tous les dossiers `runs` existants (global puis par fenêtre) : sources de lecture des journaux. */
  runDirs: string[];
  /** Une entrée par fenêtre ayant une base ou un dossier `runs`. */
  workspaces: LegacyWorkspace[];
}

/** Dossiers parents où VS Code range les données d'extension (`storageUri` absent : déduit du global). */
export function legacyStorageRoots(globalStorageUri: string, storageUri?: string) {
  const globalStorage = dirname(globalStorageUri);
  const workspaceStorage =
    storageUri !== undefined
      ? dirname(dirname(storageUri))
      : join(dirname(globalStorage), "workspaceStorage");
  return { globalStorage, workspaceStorage };
}

const isRealDir = async (path: string): Promise<boolean> => {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};
const isRealFile = async (path: string): Promise<boolean> => {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};

/** Cherche les dossiers et bases de l'ancien identifiant. Jamais d'exception ; aucun lien symbolique suivi. */
export async function findLegacyStores(roots: {
  globalStorage: string;
  workspaceStorage: string;
}): Promise<LegacyStores> {
  const stores: LegacyStores = { runDirs: [], workspaces: [] };
  try {
    const legacyDir = join(roots.globalStorage, LEGACY_EXTENSION_ID);
    const globalRuns = join(legacyDir, "runs");
    if ((await isRealDir(legacyDir)) && (await isRealDir(globalRuns)))
      stores.runDirs.push(globalRuns);
  } catch {}
  let hashes: string[] = [];
  try {
    hashes = (await readdir(roots.workspaceStorage, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_WORKSPACES);
  } catch {}
  for (const hash of hashes) {
    try {
      const base = join(roots.workspaceStorage, hash);
      const db = join(base, STATE_DB);
      const legacyDir = join(base, LEGACY_EXTENSION_ID);
      const runs = join(legacyDir, "runs");
      const found: LegacyWorkspace = {
        db: (await isRealFile(db)) ? db : null,
        runs: (await isRealDir(legacyDir)) && (await isRealDir(runs)) ? runs : null,
      };
      if (found.runs !== null) stores.runDirs.push(found.runs);
      if (found.db !== null || found.runs !== null) stores.workspaces.push(found);
    } catch {}
  }
  return stores;
}

/** Lit la valeur d'une clé de `ItemTable` (texte), ou `null` si absente. Peut lever (module ou base illisible). */
export type ItemReader = (dbPath: string, key: string) => Promise<string | null>;

interface SqliteModule {
  DatabaseSync?: new (
    path: string,
    options: { readOnly: boolean },
  ) => {
    prepare(sql: string): { get(...params: string[]): unknown };
    close(): void;
  };
}
/** Lecteur par défaut : `node:sqlite` (s'il existe dans l'hôte), base ouverte en lecture seule puis fermée. */
export const readSqliteItem: ItemReader = async (dbPath, key) => {
  const specifier = "node:sqlite";
  const sqlite = (await import(specifier)) as SqliteModule;
  if (typeof sqlite.DatabaseSync !== "function") throw Error("node:sqlite indisponible.");
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as
      | { value?: unknown }
      | undefined;
    const value = row?.value;
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
    return null;
  } finally {
    db.close();
  }
};

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Index d'un ancien `workspaceState` : `shared.v1` s'il existe, sinon fusion des anciennes clés par chat. */
export function indexFromLegacyState(state: Record<string, unknown>): ConversationMeta[] {
  const shared = state[SHARED_KEY];
  if (shared !== undefined) return parseIndex(shared, MAX_ENTRIES);
  const merged = new Map<string, ConversationMeta>();
  for (const key of Object.keys(state)) {
    const chat = key === OLD_SIDEBAR_KEY ? "sidebar" : key.slice(OLD_PREFIX.length);
    if (key !== OLD_SIDEBAR_KEY && !(key.startsWith(OLD_PREFIX) && CHAT.test(chat))) continue;
    for (const item of parseIndex(state[key])) {
      const old = merged.get(item.id);
      if (!old || Date.parse(item.updatedAt) > Date.parse(old.updatedAt))
        merged.set(item.id, { ...item, historyOwner: chat });
    }
  }
  return [...merged.values()];
}

/**
 * Index conservé dans l'ancienne base d'une fenêtre. `null` si la base ou le module est illisible ;
 * `[]` si la base est lisible mais sans historique.
 */
export async function readLegacyIndex(
  dbPath: string,
  read: ItemReader = readSqliteItem,
): Promise<ConversationMeta[] | null> {
  try {
    const text = await read(dbPath, LEGACY_EXTENSION_ID);
    if (text === null) return [];
    const state: unknown = JSON.parse(text);
    return isObj(state) ? indexFromLegacyState(state) : [];
  } catch {
    return null;
  }
}

/**
 * Repli : une conversation par journal `<uuid>.jsonl` (titre = première consigne, date = celle du fichier,
 * sans projet). Les noms de fichier invalides sont ignorés ; la lecture s'arrête à la première consigne.
 */
export async function reconstructFromJournals(runsDir: string): Promise<ConversationMeta[]> {
  const files = createJournalFiles(runsDir);
  let names: string[] = [];
  try {
    names = (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name.slice(0, -".jsonl".length))
      .filter(isRunId)
      .sort()
      .slice(0, MAX_JOURNALS_PER_WORKSPACE);
  } catch {
    return [];
  }
  const rows: unknown[] = [];
  for (const id of names) {
    try {
      const info = await lstat(join(runsDir, `${id}.jsonl`));
      if (!info.isFile()) continue;
      let prompt = "";
      await files.scan?.(id, (event) => {
        if (event.kind === "user.message") prompt = event.text;
        else if (event.kind === "run.started") prompt = event.prompt;
        return prompt === "";
      });
      const date = info.mtime.toISOString();
      rows.push({
        id,
        title: titleFrom(prompt),
        createdAt: date,
        updatedAt: date,
        provider: "claude",
        model: null,
        effort: null,
        sessionId: null,
        runIds: [id],
        tools: 0,
      });
    } catch {}
  }
  return parseIndex(rows, MAX_ENTRIES);
}

export interface LegacyImportDeps {
  read?: ItemReader;
}
/** Toutes les conversations retrouvées : index des bases, sinon reconstruction depuis les journaux. */
export async function collectLegacyConversations(
  stores: LegacyStores,
  deps: LegacyImportDeps = {},
): Promise<ConversationMeta[]> {
  const out: ConversationMeta[] = [];
  for (const workspace of stores.workspaces) {
    const indexed = workspace.db === null ? null : await readLegacyIndex(workspace.db, deps.read);
    if (indexed !== null) out.push(...indexed);
    else if (workspace.runs !== null) out.push(...(await reconstructFromJournals(workspace.runs)));
  }
  return out;
}
