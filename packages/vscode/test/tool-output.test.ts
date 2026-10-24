import { createRequire } from "node:module";
import { type EngineEvent, EXEGOL_EXEC_TOOL, KALI_TOOL_PREFIX } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createChatState, MAX_OUTPUT_CHARS } from "../src/logic/chat.js";
import { replayEvents } from "../src/logic/history.js";
import { displayToolOutput } from "../src/logic/tool-output.js";

const tool = `${KALI_TOOL_PREFIX}execute_command`;
const result = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ stdout: "", stderr: "", success: true, return_code: 0, ...fields });
const event = (fields: Record<string, unknown>): EngineEvent =>
  ({
    v: 1,
    id: "event",
    seq: 1,
    ts: "2026-10-24T00:00:00Z",
    runId: "run",
    parentId: null,
    ...fields,
  }) as EngineEvent;

describe("présentation des sorties Kali", () => {
  it("décode stdout avant de neutraliser les couleurs, OSC et contrôles bidi", () => {
    const raw = result({
      stdout: "https://example.test [\u001b[32m200\u001b[0m]\n\u001b]0;titre\u0007bonjour\u202e\n",
    });
    const display = displayToolOutput(tool, raw, 1000);
    expect(display).toEqual({
      output: "https://example.test [200]\nbonjour\n",
      truncated: false,
      failed: false,
    });
    expect(raw).toContain('"stdout"');
    expect(raw).toContain("\\u001b");
  });

  it("distingue stderr, code de sortie, délai et résultats partiels", () => {
    const display = displayToolOutput(
      tool,
      result({
        stdout: "début",
        stderr: "échec",
        return_code: 7,
        success: false,
        timed_out: true,
        partial_results: true,
      }),
      1000,
    );
    expect(display.failed).toBe(true);
    expect(display.output).toContain("Code de sortie : 7");
    expect(display.output).toContain("Délai d’exécution dépassé.");
    expect(display.output).toContain("Résultats partiels.");
    expect(display.output).toContain("début\n\nSortie d’erreur :\néchec");
  });

  it("ne transforme pas une sortie stderr d'une commande réussie en échec", () => {
    const display = displayToolOutput(tool, result({ stderr: "avertissement" }), 1000);
    expect(display.failed).toBe(false);
    expect(display.output).toBe("Sortie d’erreur :\navertissement");
  });

  it("plafonne le texte utile après décodage plutôt que l'enveloppe JSON", () => {
    expect(displayToolOutput(tool, result({ stdout: "bonjour" }), 7)).toMatchObject({
      output: "bonjour",
      truncated: false,
    });
    expect(displayToolOutput(tool, result({ stdout: "abcdefgh" }), 7)).toMatchObject({
      output: "abcdefg…",
      truncated: true,
    });
  });

  it("conserve les réponses non exécutables et les transports incomplets", () => {
    const health = { status: "healthy", tools_status: { nmap: false } };
    expect(
      displayToolOutput(`${KALI_TOOL_PREFIX}server_health`, JSON.stringify(health), 1000).output,
    ).toBe(JSON.stringify(health, null, 2));
    const incomplete = '{"stdout":"incomplet';
    expect(displayToolOutput(tool, incomplete, 1000, true)).toEqual({
      output: incomplete,
      truncated: true,
      failed: false,
    });
    expect(displayToolOutput(EXEGOL_EXEC_TOOL, '{"a":1}', 1000).output).toBe('{"a":1}');
  });

  it("le chat, le Monitor et la relecture partagent le résultat lisible et le statut réel", () => {
    const raw = result({
      stdout: "texte ".repeat(600),
      stderr: "commande interrompue",
      return_code: 2,
      success: false,
    });
    const events = [
      event({
        id: "request",
        kind: "tool.requested",
        toolUseId: "command",
        tool,
        input: { container: "kali-box", command: "test" },
      }),
      event({
        kind: "approval.decided",
        toolUseId: "command",
        decision: "allow",
        reason: { code: "approval.bypassed" },
        source: "bypass",
      }),
      event({
        kind: "tool.result",
        toolUseId: "command",
        output: raw,
        isError: false,
        truncated: false,
      }),
    ];
    const live = createChatState();
    for (const e of events) live.event(e);
    const replay = createChatState();
    replayEvents(replay, events);
    expect(replay.view().items).toEqual(live.view().items);
    const item = live.view().items.find((i) => i.kind === "tool");
    expect(item).toMatchObject({ status: "error", truncated: false });
    if (item?.kind !== "tool") throw new Error("outil absent");
    expect(item.output?.length).toBeGreaterThan(MAX_OUTPUT_CHARS);
    expect(item.output).not.toContain('"stdout"');
    const require = createRequire(import.meta.url);
    require("../media/ui.js");
    const ui = (
      globalThis as unknown as {
        WarbandUI: {
          monitorRows(view: unknown): { output: string; status: string; tone: string }[];
        };
      }
    ).WarbandUI;
    const [row] = ui.monitorRows(live.view());
    expect(row).toMatchObject({ output: item.output, status: "erreur", tone: "err" });
    expect(events[2]).toHaveProperty("output", raw);
  });
});
