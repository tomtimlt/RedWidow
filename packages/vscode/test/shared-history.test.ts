import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import { applyRetention, type ConversationMeta, parseIndex } from "../src/logic/history.js";
import { createChatSession } from "../src/logic/session.js";
import {
  createSharedHistoryIndex,
  createSharedJournalFiles,
  SHARED_HISTORY_KEY,
  SHARED_HISTORY_MAX_ENTRIES,
} from "../src/logic/shared-history.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
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
function session(
  shared: ReturnType<typeof createSharedHistoryIndex>,
  owner: string,
  options: { protectedIds?: () => string[]; canRemove?: (ids: readonly string[]) => boolean } = {},
) {
  let handlers: EngineHandlers = {};
  const calls: string[] = [];
  const engine: EngineController = {
    start: async () => {},
    models: async () => [],
    prompt: () => {
      calls.push("prompt");
    },
    answer: () => {},
    abort: () => {},
    dispose: () => {},
    kill: () => {},
    bypass: () => 0,
    exited: Promise.resolve(),
  };
  const view = createChatSession({
    cwd: "/workspace",
    enginePath: "/engine",
    engineArgs: [],
    readSettings: () => ({}),
    getToken: async () => undefined,
    confirmAlways: async () => false,
    onView: () => {},
    createController: (opts: EngineControllerOptions) => {
      handlers = opts.handlers ?? {};
      return engine;
    },
    history: {
      key: SHARED_HISTORY_KEY,
      owner,
      maxEntries: SHARED_HISTORY_MAX_ENTRIES,
      index: shared.index,
      files: {
        dir: "/runs",
        read: async () => null,
        size: async () => 0,
        remove: async () => {},
        removeAll: async () => {},
      },
      confirmDelete: async () => true,
      ...options,
    },
  });
  return {
    view,
    calls,
    get handlers() {
      return handlers;
    },
  };
}
describe("historique commun aux chats", () => {
  it("rassemble les index anciens sans mutation des sources et ne ressuscite pas les suppressions", async () => {
    const a = row(),
      b = row(),
      h = host({
        "warband.history": [a],
        "warband.history.sidebar": [a],
        "warband.history.chat2": [b],
      });
    const shared = createSharedHistoryIndex(h);
    expect(
      shared.index
        .get(SHARED_HISTORY_KEY)
        .map((row) => row.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(shared.legacyChats).toEqual(["chat2"]);
    expect(h.get("warband.history")).toEqual([a]);
    await shared.index.set(SHARED_HISTORY_KEY, []);
    await shared.flush();
    expect(createSharedHistoryIndex(h).index.get(SHARED_HISTORY_KEY)).toEqual([]);
  });
  it("fusionne les runs d’une conversation multi-fournisseurs, jamais ceux d’un autre projet", async () => {
    const a = row({ projectId: randomUUID() }),
      run = randomUUID(),
      b = { ...a, provider: "opencode", updatedAt: "2026-11-03T11:00:00Z", runIds: [run] };
    const shared = createSharedHistoryIndex(
      host({ "warband.history": [a], "warband.history.chat2": [b] }),
    );
    expect(shared.index.get(SHARED_HISTORY_KEY)[0]).toMatchObject({
      provider: "opencode",
      runIds: [...a.runIds, run],
    });
    const foreign = createSharedHistoryIndex(
      host({
        "warband.history": [a],
        "warband.history.chat2": [{ ...b, projectId: randomUUID() }],
      }),
    );
    expect(foreign.index.get(SHARED_HISTORY_KEY)[0]?.runIds).toEqual(a.runIds);
    await shared.flush();
    await foreign.flush();
  });
  it("deux sessions voient leurs conversations, renommages et suppressions sans perdre une mise à jour", async () => {
    const shared = createSharedHistoryIndex(host()),
      a = session(shared, "sidebar"),
      b = session(shared, "chat2");
    await a.view.send("Première conversation");
    a.handlers.onStarted?.({ runId: randomUUID(), policySource: null });
    a.handlers.onEnded?.({ sessionId: "one" } as never);
    await b.view.send("Deuxième conversation");
    b.handlers.onStarted?.({ runId: randomUUID(), policySource: null });
    b.handlers.onEnded?.({ sessionId: "two" } as never);
    expect(a.view.view().history).toHaveLength(2);
    expect(b.view.view().history).toHaveLength(2);
    const id = a.view.view().history.find((row) => row.current)?.id as string;
    b.view.renameConversation(id, "Renommé depuis Chat 2");
    expect(a.view.view().history.find((row) => row.current)?.title).toBe("Renommé depuis Chat 2");
    await b.view.deleteConversation(id);
    expect(a.view.view().history).toHaveLength(1);
    expect(a.view.view().items).toEqual([]);
    expect(b.calls).toEqual(["prompt"]);
    expect(a.calls).toEqual(["prompt"]);
    a.view.dispose();
    b.view.dispose();
    await shared.flush();
  });
  it("respecte le filtre de projet et ne charge aucun ancien message au simple partage de l’index", () => {
    const one = randomUUID(),
      two = randomUUID(),
      shared = createSharedHistoryIndex(
        host({
          "warband.history.sidebar": [row({ projectId: one })],
          "warband.history.chat2": [row({ projectId: two })],
        }),
      );
    const a = session(shared, "sidebar");
    expect(
      a.view
        .view()
        .history.map((row) => row.projectKey)
        .sort(),
    ).toEqual([one, two].sort());
    expect(a.view.view().items).toEqual([]);
    expect(a.calls).toEqual([]);
    a.view.dispose();
  });
  it("la confirmation ne supprime pas une conversation devenue active dans un autre chat", async () => {
    const entry = row(),
      shared = createSharedHistoryIndex(host({ "warband.history.sidebar": [entry] }));
    let canRemove = false;
    const a = session(shared, "sidebar", { canRemove: () => canRemove });
    await a.view.deleteConversation(entry.id);
    expect(a.view.view().history).toHaveLength(1);
    canRemove = true;
    await a.view.deleteConversation(entry.id);
    expect(a.view.view().history).toEqual([]);
    a.view.dispose();
    await shared.flush();
  });
  it("la rétention protège toutes les conversations ouvertes", () => {
    const a = row(),
      b = row(),
      c = row();
    const result = applyRetention([a, b, c], new Map(), { maxCount: 0, protectIds: [a.id, b.id] });
    expect(result.keep.map((row) => row.id)).toEqual([a.id, b.id]);
    expect(result.drop.map((row) => row.id)).toEqual([c.id]);
  });
  it("revalide les UUID et retrouve les anciens journaux des chats, même fermés", async () => {
    const root = await mkdtemp(join(tmpdir(), "redwidow-shared-"));
    roots.push(root);
    await mkdir(join(root, "chat2"));
    const run = randomUUID();
    const text =
      JSON.stringify({
        v: 1,
        id: "event",
        runId: run,
        parentId: null,
        seq: 0,
        ts: new Date().toISOString(),
        kind: "user.message",
        text: "EXPLICIT-HISTORY",
      }) + "\n";
    await writeFile(join(root, "chat2", `${run}.jsonl`), text);
    const files = createSharedJournalFiles(root, ["chat2", "../outside"]);
    expect(files.dir).toBe(root);
    expect(await files.read(run)).toBe(text);
    expect(await files.read("../outside")).toBeNull();
    const seen: string[] = [];
    expect(
      await files.scan?.(run, (event) => {
        seen.push(event.kind);
        return true;
      }),
    ).toEqual({ invalid: 0, missing: false });
    expect(seen).toEqual(["user.message"]);
    expect(await files.size(run)).toBe(Buffer.byteLength(text));
    await files.remove([run]);
    await expect(readFile(join(root, "chat2", `${run}.jsonl`))).rejects.toThrow();
  });
  it("valide la borne élargie sans changer le budget de chaque chat", () => {
    const list = Array.from({ length: 250 }, () => row());
    expect(parseIndex(list)).toHaveLength(200);
    expect(parseIndex(list, SHARED_HISTORY_MAX_ENTRIES)).toHaveLength(250);
  });
});
