import { createRecorder } from "@warband/core";
import { describe, expect, it } from "vitest";
import { exportChat } from "../src/logic/chat-export.js";

describe("export du fil masqué", () => {
  it("conserve l’ordre et les appels, limite les sorties, exclut les pensées par défaut", () => {
    const r = createRecorder();
    const events = [
      r.emit({ kind: "user.message", text: "demande" }),
      r.emit({ kind: "agent.thinking", text: "pensée privée", redacted: false }),
      r.emit({ kind: "tool.requested", toolUseId: "a", tool: "read", input: {} }),
      r.emit({
        kind: "tool.result",
        toolUseId: "a",
        output: "é".repeat(4000),
        bytes: 8000,
        truncated: false,
        isError: false,
      }),
      r.emit({ kind: "agent.text", text: "réponse" }),
    ];
    const result = exportChat(events);
    expect(result.markdown.indexOf("demande")).toBeLessThan(result.markdown.indexOf("réponse"));
    expect(result.markdown).toContain("appel 1");
    expect(result.markdown).toContain("Sortie tronquée");
    expect(result.jsonl).not.toContain("pensée privée");
    const rows = result.jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(Buffer.byteLength(rows[2].output)).toBeLessThanOrEqual(4096);
    expect(exportChat(events, { thinking: true }).markdown).toContain("pensée privée");
  });
});
