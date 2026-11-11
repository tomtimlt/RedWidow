import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationMeta } from "../src/logic/history.js";
import {
  collectLegacyConversations,
  findLegacyStores,
  LEGACY_EXTENSION_ID,
  legacyStorageRoots,
  readLegacyIndex,
  readSqliteItem,
} from "../src/logic/legacy-extension.js";
import {
  createSharedHistoryIndex,
  createSharedJournalFiles,
  GLOBAL_HISTORY_KEY,
  importLegacyExtensionHistory,
  LEGACY_EXTENSION_IMPORTED_KEY,
} from "../src/logic/shared-history.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const tmp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "legacy-ext-"));
  roots.push(dir);
  return dir;
};
const row = (over: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id: randomUUID(),
  title: "Lab",
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
  provider: "claude",
  model: null,
  effort: null,
  sessionId: null,
  runIds: [randomUUID()],
  tools: 0,
  ...over,
});
function host(values: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(values));
  return {
    data,
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    keys: () => [...data.keys()],
  };
}
const journal = (runId: string, prompt: string) =>
  `${JSON.stringify({ v: 1, id: randomUUID(), parentId: null, runId, seq: 0, ts: "2026-11-03T10:00:00Z", kind: "user.message", text: prompt })}\n`;

/** Disposition VS Code factice : User/globalStorage et User/workspaceStorage/<hash>. */
async function layout(hashes: string[] = ["aaa"]) {
  const base = await tmp();
  const globalStorage = join(base, "User", "globalStorage");
  const workspaceStorage = join(base, "User", "workspaceStorage");
  await mkdir(join(globalStorage, "tomtimlt.redwidow"), { recursive: true });
  for (const hash of hashes)
    await mkdir(join(workspaceStorage, hash, "tomtimlt.redwidow"), { recursive: true });
  return { base, globalStorage, workspaceStorage };
}

interface Sqlite {
  DatabaseSync: new (
    path: string,
  ) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: string[]): unknown };
    close(): void;
  };
}
let sqlite: Sqlite | null = null;
try {
  const specifier = "node:sqlite";
  sqlite = (await import(specifier)) as Sqlite;
} catch {}

async function makeDb(path: string, state: unknown, raw = false) {
  const { DatabaseSync } = sqlite as Sqlite;
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    LEGACY_EXTENSION_ID,
    raw ? (state as string) : JSON.stringify(state),
  );
  db.close();
}

describe("findLegacyStores", () => {
  it("ne lève rien et ne trouve rien quand aucun dossier n'existe", async () => {
    const base = await tmp();
    const found = await findLegacyStores({
      globalStorage: join(base, "absent", "g"),
      workspaceStorage: join(base, "absent", "w"),
    });
    expect(found).toEqual({ runDirs: [], workspaces: [] });
  });
  it("liste les dossiers runs et les bases, sans suivre de lien symbolique", async () => {
    const { base, globalStorage, workspaceStorage } = await layout(["aaa", "bbb", "ccc"]);
    await mkdir(join(globalStorage, LEGACY_EXTENSION_ID, "runs"), { recursive: true });
    await mkdir(join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs"), { recursive: true });
    await writeFile(join(workspaceStorage, "bbb", "state.vscdb"), "x");
    const { symlink } = await import("node:fs/promises");
    await mkdir(join(base, "ailleurs", "runs"), { recursive: true });
    await symlink(
      join(base, "ailleurs"),
      join(workspaceStorage, "ccc", LEGACY_EXTENSION_ID),
      "junction",
    );
    const found = await findLegacyStores({ globalStorage, workspaceStorage });
    expect(found.runDirs).toEqual([
      join(globalStorage, LEGACY_EXTENSION_ID, "runs"),
      join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs"),
    ]);
    expect(found.workspaces).toEqual([
      { db: null, runs: join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs") },
      { db: join(workspaceStorage, "bbb", "state.vscdb"), runs: null },
    ]);
  });
  it("déduit les racines depuis les URI de stockage", () => {
    const g = join("a", "User", "globalStorage", "tomtimlt.redwidow");
    const w = join("a", "User", "workspaceStorage", "h", "tomtimlt.redwidow");
    expect(legacyStorageRoots(g, w)).toEqual({
      globalStorage: join("a", "User", "globalStorage"),
      workspaceStorage: join("a", "User", "workspaceStorage"),
    });
    expect(legacyStorageRoots(g).workspaceStorage).toBe(join("a", "User", "workspaceStorage"));
  });
});

describe("readLegacyIndex (lecteur injecté)", () => {
  const rowA = row({ title: "A" });
  it("lit shared.v1 en priorité", async () => {
    const read = async () => JSON.stringify({ "warband.history.shared.v1": [rowA] });
    expect((await readLegacyIndex("x", read))?.map((r) => r.id)).toEqual([rowA.id]);
  });
  it("fusionne les anciennes clés sans shared.v1, avec leur propriétaire", async () => {
    const rowB = row({ title: "B" });
    const read = async () =>
      JSON.stringify({ "warband.history": [rowA], "warband.history.chat-2": [rowB] });
    const result = await readLegacyIndex("x", read);
    expect(result?.map((r) => [r.id, r.historyOwner])).toEqual([
      [rowA.id, "sidebar"],
      [rowB.id, "chat-2"],
    ]);
  });
  it("renvoie [] sans ligne et null sur erreur ou JSON corrompu", async () => {
    expect(await readLegacyIndex("x", async () => null)).toEqual([]);
    expect(await readLegacyIndex("x", async () => "{pas du json")).toBeNull();
    expect(
      await readLegacyIndex("x", async () => {
        throw Error("illisible");
      }),
    ).toBeNull();
  });
});

describe.skipIf(sqlite === null)("readLegacyIndex (base node:sqlite)", () => {
  it("lit l'index d'une vraie base en lecture seule", async () => {
    const dir = await tmp();
    const a = row();
    await makeDb(join(dir, "state.vscdb"), { "warband.history.shared.v1": [a], autre: 1 });
    expect((await readLegacyIndex(join(dir, "state.vscdb")))?.map((r) => r.id)).toEqual([a.id]);
    expect(await readSqliteItem(join(dir, "state.vscdb"), "absente")).toBeNull();
  });
  it("null pour une base corrompue ou absente", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "state.vscdb"), "ceci n'est pas une base SQLite");
    expect(await readLegacyIndex(join(dir, "state.vscdb"))).toBeNull();
    expect(await readLegacyIndex(join(dir, "absente.vscdb"))).toBeNull();
  });
});

describe("repli sur les journaux", () => {
  it("reconstruit une conversation par journal quand la base est illisible", async () => {
    const { globalStorage, workspaceStorage } = await layout();
    const runs = join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs");
    await mkdir(runs, { recursive: true });
    const id = randomUUID();
    await writeFile(join(runs, `${id}.jsonl`), journal(id, "Scanner le   réseau"));
    await writeFile(join(runs, "pas-un-uuid.jsonl"), "x");
    await writeFile(join(workspaceStorage, "aaa", "state.vscdb"), "corrompu");
    const stores = await findLegacyStores({ globalStorage, workspaceStorage });
    const found = await collectLegacyConversations(stores);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id, title: "Scanner le réseau", runIds: [id] });
    expect(found[0]?.projectId).toBeUndefined();
  });
});

describe("importLegacyExtensionHistory", () => {
  const setup = async () => {
    const l = await layout();
    const global = host();
    const shared = createSharedHistoryIndex(global);
    const files = createSharedJournalFiles(join(l.globalStorage, "tomtimlt.redwidow", "runs"), []);
    return { ...l, global, shared, files };
  };
  it("fusionne sans doublon et ne se refait pas (marqueur)", async () => {
    const { globalStorage, workspaceStorage, global, shared, files } = await setup();
    const a = row({ title: "Ancienne" });
    await mkdir(join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs"), { recursive: true });
    await writeFile(join(workspaceStorage, "aaa", "state.vscdb"), "base");
    let reads = 0;
    const deps = {
      read: async () => {
        reads++;
        return JSON.stringify({ "warband.history.shared.v1": [a] });
      },
    };
    const options = {
      host: global,
      index: shared.index,
      files,
      roots: { globalStorage, workspaceStorage },
      deps,
    };
    await importLegacyExtensionHistory(options);
    await importLegacyExtensionHistory(options);
    const index = shared.index.get(GLOBAL_HISTORY_KEY) as ConversationMeta[];
    expect(index.filter((r) => r.id === a.id)).toHaveLength(1);
    expect(global.get(LEGACY_EXTENSION_IMPORTED_KEY)).toBe(true);
    expect(reads).toBe(1);
    // Supprimée après la reprise, l'entrée ne revient pas.
    shared.index.update(GLOBAL_HISTORY_KEY, () => []);
    await importLegacyExtensionHistory(options);
    expect(shared.index.get(GLOBAL_HISTORY_KEY)).toEqual([]);
  });
  it("aucun dossier : aucune erreur, marqueur posé", async () => {
    const { base, global, shared, files } = await setup();
    const errors: unknown[] = [];
    await importLegacyExtensionHistory({
      host: global,
      index: shared.index,
      files,
      roots: { globalStorage: join(base, "x"), workspaceStorage: join(base, "y") },
      onError: (e) => errors.push(e),
    });
    expect(errors).toEqual([]);
    expect(global.get(LEGACY_EXTENSION_IMPORTED_KEY)).toBe(true);
  });
  it("une erreur va à onError et laisse la reprise à refaire", async () => {
    const { globalStorage, workspaceStorage, global, shared, files } = await setup();
    const errors: unknown[] = [];
    await importLegacyExtensionHistory({
      host: global,
      index: shared.index,
      files,
      roots: { globalStorage, workspaceStorage },
      find: async () => {
        throw Error("boum");
      },
      onError: (e) => errors.push(e),
    });
    expect(errors).toHaveLength(1);
    expect(global.get(LEGACY_EXTENSION_IMPORTED_KEY)).toBeUndefined();
  });
  it("lit un journal de l'ancien dossier sans jamais l'effacer", async () => {
    const { globalStorage, workspaceStorage, global, shared, files } = await setup();
    const runs = join(workspaceStorage, "aaa", LEGACY_EXTENSION_ID, "runs");
    await mkdir(runs, { recursive: true });
    const id = randomUUID();
    const text = journal(id, "Ancien");
    await writeFile(join(runs, `${id}.jsonl`), text);
    expect(await files.read(id)).toBeNull();
    await importLegacyExtensionHistory({
      host: global,
      index: shared.index,
      files,
      roots: { globalStorage, workspaceStorage },
    });
    expect(await files.read(id)).toBe(text);
    expect(await files.size(id)).toBe(Buffer.byteLength(text));
    const events: string[] = [];
    await files.scan?.(id, (e) => {
      events.push(e.kind);
      return true;
    });
    expect(events).toEqual(["user.message"]);
    await files.remove([id]);
    await files.removeAll();
    expect(await readdir(runs)).toEqual([`${id}.jsonl`]);
    expect(await readFile(join(runs, `${id}.jsonl`), "utf8")).toBe(text);
  });
});
