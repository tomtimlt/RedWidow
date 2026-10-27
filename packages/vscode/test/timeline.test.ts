import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent } from "@warband/core";
import { afterEach, describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import { createChatState, MAX_ITEMS, monitorChatView } from "../src/logic/chat.js";
import { MAX_JOURNAL_BYTES, MAX_LINE_CHARS } from "../src/logic/history.js";
import { createJournalFiles } from "../src/logic/historyStore.js";
import { readConversationPage } from "../src/logic/timeline.js";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const event = (seq: number, payload: object, runId = RUN): EngineEvent =>
  ({
    v: 1,
    id: `e${seq}`,
    seq,
    ts: "2026-10-27T00:00:00Z",
    runId,
    parentId: null,
    ...payload,
  }) as EngineEvent;
async function journal(events: (EngineEvent | string)[]) {
  const dir = await mkdtemp(join(tmpdir(), "warband-pages-"));
  dirs.push(dir);
  await writeFile(
    join(dir, `${RUN}.jsonl`),
    events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n"),
  );
  return createJournalFiles(dir);
}

describe("pages de conversation", () => {
  it("relit 905 éléments sur plusieurs pages sans trou, doublon ni perte de résultat tardif", async () => {
    const events: EngineEvent[] = [event(0, { kind: "user.message", text: "Début" })];
    for (let i = 1; i <= 904; i++) {
      events.push(
        event(i * 2, {
          kind: "tool.requested",
          toolUseId: `t${i}`,
          tool: "mcp__kali__execute_command",
          input: { command: `commande ${i}` },
        }),
      );
      events.push(
        event(i * 2 + 1, {
          kind: "tool.result",
          toolUseId: `t${i}`,
          output: `résultat ${i}`,
          isError: false,
          truncated: false,
          bytes: 32,
        }),
      );
    }
    const files = await journal(events);
    const seen = new Set<string>();
    let before: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await readConversationPage(files, [RUN], before, () => true);
      expect(page?.invalid).toBe(0);
      expect(page?.missing).toBe(0);
      const items = page?.state.view().items ?? [];
      expect(items.length).toBeLessThanOrEqual(MAX_ITEMS);
      for (const item of items) {
        expect(seen.has(item.source ?? "")).toBe(false);
        seen.add(item.source ?? "");
        if (item.kind === "tool") {
          expect(item.status).toBe("ok");
          expect(item.output).toContain("résultat");
        }
      }
      pages++;
      if (!page?.state.dropped) break;
      before = items[0]?.source;
    }
    expect(pages).toBe(4);
    expect(seen.size).toBe(905);
    expect(seen.has(`${RUN}/e0`)).toBe(true);
  });

  it("garde les résultats arrivés après la borne et ignore les autres runs et lignes invalides", async () => {
    const files = await journal([
      event(1, { kind: "tool.requested", toolUseId: "a", tool: "Read", input: {} }),
      event(2, { kind: "agent.text", text: "borne" }),
      "{illisible",
      event(3, { kind: "agent.text", text: "autre conversation" }, OTHER),
      event(4, {
        kind: "tool.result",
        toolUseId: "a",
        output: "terminé",
        isError: false,
        truncated: false,
        bytes: 32,
      }),
    ]);
    const page = await readConversationPage(files, [RUN], `${RUN}/e2`, () => true);
    expect(page?.state.reached).toBe(true);
    expect(page?.invalid).toBe(2);
    expect(page?.state.view().items).toMatchObject([
      { kind: "tool", status: "ok", output: "terminé" },
    ]);
    expect(await readConversationPage(files, [RUN], undefined, () => false)).toBeNull();
    expect(
      (await readConversationPage(files, [RUN], `${RUN}/absent`, () => true))?.state.reached,
    ).toBe(false);
  });

  it("lit au-delà de 16 Mio, ignore une ligne géante et préserve l’UTF-8 aux frontières de blocs", async () => {
    const padding = Array.from({ length: 19 }, (_, i) =>
      event(i, { kind: "agent.thinking", text: "é".repeat(470_000), redacted: true }),
    );
    const files = await journal([
      ...padding,
      "x".repeat(MAX_LINE_CHARS + 70_000),
      event(20, { kind: "agent.text", text: "Fin été 🐉" }),
    ]);
    expect(await files.size(RUN)).toBeGreaterThan(MAX_JOURNAL_BYTES);
    const page = await readConversationPage(files, [RUN], undefined, () => true);
    expect(page?.truncated).toBe(false);
    expect(page?.state.view().items.at(-1)).toMatchObject({ kind: "agent", text: "Fin été 🐉" });
    expect(page?.invalid).toBe(1);
    const seen: EngineEvent[] = [];
    await files.scan?.(RUN, (e) => {
      seen.push(e);
      return false;
    });
    expect(seen).toHaveLength(1);
    expect(await files.scan?.("../autre", () => true)).toEqual({ invalid: 0, missing: true });
  });

  it("associe le message local à son événement sans afficher le contexte terminal, et allège le Monitor", () => {
    const state = createChatState();
    state.user("premier");
    state.event(event(0, { kind: "user.message", text: "contexte privé non affiché" }));
    state.event(event(1, { kind: "agent.text", text: "Markdown" }));
    state.event(
      event(2, {
        kind: "tool.requested",
        toolUseId: "a",
        tool: "mcp__kali__execute_command",
        input: {},
      }),
    );
    expect(state.view().items[0]).toMatchObject({ source: `${RUN}/e0`, text: "premier" });
    const monitor = monitorChatView(state.view());
    expect(monitor.items).toHaveLength(1);
    expect(monitor.controls).toBeNull();
    expect(monitor.history).toEqual([]);
    expect(monitorChatView(state.view(), "autre").items).toEqual([]);
    for (const direction of ["older", "newer", "latest"])
      expect(parseWebviewMessage({ type: "timelinePage", direction })).toEqual({
        type: "timelinePage",
        direction,
      });
    expect(
      parseWebviewMessage({ type: "timelinePage", direction: "older", path: "/tmp" }),
    ).toBeNull();
  });
});
