import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TERMINAL_CONTEXT_MARK } from "@warband/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";
import {
  applyRetention,
  type ConversationMeta,
  cleanTitle,
  isRunId,
  MAX_JOURNAL_LINES,
  MAX_LINE_CHARS,
  parseIndex,
  parseUntrustedJournal,
  replayEvents,
  titleFrom,
} from "../src/logic/history.js";
import { createJournalFiles } from "../src/logic/historyStore.js";
import { parseToEngine } from "../src/logic/protocol.js";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let seq = 0;
const line = (payload: Record<string, unknown>, runId = RUN) =>
  JSON.stringify({
    v: 1,
    id: `e${seq}`,
    seq: seq++,
    ts: "2026-10-15T10:00:00.000Z",
    runId,
    parentId: null,
    ...payload,
  });

const meta = (over: Partial<ConversationMeta>): ConversationMeta => ({
  id: ID,
  title: "t",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  provider: "claude",
  model: null,
  effort: null,
  sessionId: null,
  runIds: [],
  tools: 0,
  ...over,
});

describe("identifiants et titres", () => {
  it("runId : seul un UUID passe (traversée refusée)", () => {
    expect(isRunId(RUN)).toBe(true);
    for (const bad of ["../x", "..\\x", `${RUN}/../..`, `${RUN}.jsonl`, "", 12, null, "C:\\x"]) {
      expect(isRunId(bad), String(bad)).toBe(false);
    }
  });
  it("titre : contrôles et bidi retirés, tronqué, jamais vide", () => {
    expect(cleanTitle("a\u202Eb\u0000c   d")).toBe("abc d");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle(12)).toBeNull();
    expect(cleanTitle("x".repeat(500))?.length).toBe(120);
    expect(titleFrom("y".repeat(500)).length).toBe(80);
    expect(titleFrom("\n")).toBe("Conversation");
  });
});

describe("index stocké (non fiable)", () => {
  it("écarte les entrées mal formées, revalide les champs", () => {
    const ok = meta({ runIds: [RUN, "../evil", 3 as never], model: "bad model", tools: -1 });
    const list = parseIndex([
      ok,
      ok, // doublon
      { ...ok, id: "../x" },
      { ...ok, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "   " },
      { ...ok, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", updatedAt: "pas une date" },
      "chaine",
      null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ runIds: [RUN], model: null, tools: 0 });
    expect(parseIndex("x")).toEqual([]);
    expect(parseIndex({ length: 5 })).toEqual([]);
  });
});

describe("rétention", () => {
  const mk = (n: number, day: number) =>
    meta({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      updatedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    });
  it("au-delà du plafond de nombre : les plus anciennes sont purgées", () => {
    const list = Array.from({ length: 105 }, (_, i) => mk(i, 1 + (i % 28)));
    const { keep, drop } = applyRetention(list, new Map());
    expect(keep).toHaveLength(100);
    expect(drop).toHaveLength(5);
    expect(Math.max(...drop.map((c) => Date.parse(c.updatedAt)))).toBeLessThanOrEqual(
      Math.min(...keep.map((c) => Date.parse(c.updatedAt))),
    );
  });
  it("au-delà du plafond de taille ; la conversation protégée reste", () => {
    const a = mk(1, 1);
    const b = mk(2, 2);
    const c = mk(3, 3);
    const sizes = new Map([
      [a.id, 60],
      [b.id, 60],
      [c.id, 60],
    ]);
    const r = applyRetention([a, b, c], sizes, { maxBytes: 100 });
    expect(r.keep.map((x) => x.id)).toEqual([c.id]);
    const p = applyRetention([a, b, c], sizes, { maxBytes: 100, protect: a.id });
    expect(p.keep.map((x) => x.id)).toContain(a.id);
  });
});

describe("relecture d'un journal hostile", () => {
  it("lignes invalides, événements inconnus et autres runs ignorés et comptés", () => {
    const text = [
      line({ kind: "user.message", text: "bonjour" }),
      "{pas du json",
      "",
      line({ kind: "kind.inconnu", x: 1 }),
      line({ kind: "agent.text", text: 42 }),
      line({ kind: "agent.text", text: "réponse" }, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      line({ kind: "agent.text", text: "réponse" }),
    ].join("\n");
    const r = parseUntrustedJournal(text, RUN);
    expect(r.events.map((e) => e.kind)).toEqual(["user.message", "agent.text"]);
    expect(r.invalid).toBe(4);
    expect(r.truncated).toBe(false);
  });
  it("ligne énorme ignorée, nombre de lignes plafonné", () => {
    const huge = line({ kind: "agent.text", text: "x".repeat(MAX_LINE_CHARS + 1) });
    const ok = line({ kind: "agent.text", text: "ok" });
    const r = parseUntrustedJournal([ok, huge, ok].join("\n"), RUN);
    expect(r.events).toHaveLength(2);
    expect(r.invalid).toBe(1);
    const many = parseUntrustedJournal(
      Array.from({ length: MAX_JOURNAL_LINES + 10 }, () => ok).join("\n"),
      RUN,
    );
    expect(many.events.length).toBeLessThanOrEqual(MAX_JOURNAL_LINES);
    expect(many.truncated).toBe(true);
  });
  it("<img onerror> et U+202E rendus inertes ; approval.requested ne crée aucune carte", () => {
    const text = [
      line({ kind: "run.started", prompt: "", cwd: "/w" }),
      line({ kind: "user.message", text: "<img src=x onerror=alert(1)> \u202Efdp.exe" }),
      line({ kind: "agent.text", text: "ok <script>x</script>\u202E" }),
      line({ kind: "tool.requested", toolUseId: "t1", tool: "Bash", input: { command: "ls" } }),
      line({
        kind: "approval.requested",
        toolUseId: "t1",
        tool: "Bash",
        input: { command: "ls" },
        verdict: { code: "bash.noRule" },
      }),
    ].join("\n");
    const { events } = parseUntrustedJournal(text, RUN);
    expect(events.some((e) => e.kind === "approval.requested")).toBe(true);
    const state = createChatState();
    replayEvents(state, events);
    const view = state.view();
    expect(view.approvals).toEqual([]);
    expect(view.busy).toBe(false);
    const dump = JSON.stringify(view.items);
    expect(dump).not.toContain("\u202E");
    // Le texte reste du texte : la webview l'insère par textContent (voir preview.test.ts).
    expect(view.items.map((i) => i.kind)).toEqual(["user", "agent", "tool"]);
  });
  it("journal de la CLI sans user.message : la consigne de run.started est affichée une fois", () => {
    const { events } = parseUntrustedJournal(
      [
        line({ kind: "run.started", prompt: "fais X", cwd: "/w" }),
        line({ kind: "agent.text", text: "fait" }),
      ].join("\n"),
      RUN,
    );
    const state = createChatState();
    replayEvents(state, events);
    expect(state.view().items.map((i) => i.kind)).toEqual(["user", "agent"]);
  });
  it("la sortie citée par # ne revient pas dans la bulle", () => {
    const { events } = parseUntrustedJournal(
      line({
        kind: "user.message",
        text: `vois #htb1${TERMINAL_CONTEXT_MARK}@evil\n80/tcp`,
      }),
      RUN,
    );
    const state = createChatState();
    replayEvents(state, events);
    expect(state.view().items).toEqual([
      expect.objectContaining({ kind: "user", text: "vois #htb1" }),
    ]);
  });
});

describe("accès disque aux journaux", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "warband-hist-"));
    await mkdir(join(dir, "runs"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("lit, mesure et supprime ; refuse tout nom qui n'est pas un UUID", async () => {
    const files = createJournalFiles(join(dir, "runs"));
    await writeFile(join(dir, "runs", `${RUN}.jsonl`), "abc\n");
    await writeFile(join(dir, "secret.jsonl"), "secret");
    expect(await files.read(RUN)).toBe("abc\n");
    expect(await files.size(RUN)).toBe(4);
    expect(await files.read("../secret")).toBeNull();
    expect(await files.size("../secret")).toBe(0);
    await files.remove(["../secret", RUN]);
    expect(await files.read(RUN)).toBeNull();
    expect(await readFile(join(dir, "secret.jsonl"), "utf8")).toBe("secret");
    await writeFile(join(dir, "runs", `${ID}.jsonl`), "x");
    await files.removeAll();
    expect(await files.read(ID)).toBeNull();
  });
});

describe("protocole : journalDir", () => {
  it("absolu seulement", () => {
    const base = { v: 1, type: "start", cwd: process.cwd() };
    expect(parseToEngine({ ...base, journalDir: join(process.cwd(), "j") }).ok).toBe(true);
    expect(parseToEngine({ ...base, journalDir: "relatif/j" }).ok).toBe(false);
    expect(parseToEngine({ ...base, journalDir: 3 }).ok).toBe(false);
  });
});
