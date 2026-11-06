import type { EngineEvent } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createResearchTracker } from "../src/engine/research.js";
import { parseToEngine } from "../src/logic/protocol.js";

const event = (value: object) => value as EngineEvent;
describe("recherche demandée pour un tour", () => {
  it("requiert une réponse Web non vide et rapporte les erreurs ou l’absence de recherche", () => {
    const tracker = createResearchTracker();
    tracker.begin(true);
    tracker.observe(
      event({ kind: "tool.requested", tool: "mcp__web__search_web", toolUseId: "a" }),
    );
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "a", output: "source", isError: false }),
    );
    expect(tracker.observe(event({ kind: "turn.finished", status: "success" }))).toBe("failed");
    tracker.begin(true);
    tracker.observe(
      event({ kind: "tool.requested", tool: "mcp__web__search_web", toolUseId: "a" }),
    );
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "a", output: "source", isError: false }),
    );
    tracker.observe(event({ kind: "tool.requested", tool: "mcp__web__read_url", toolUseId: "b" }));
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "b", output: "contenu", isError: false }),
    );
    expect(tracker.observe(event({ kind: "turn.finished", status: "success" }))).toBe("completed");
    tracker.begin(true);
    tracker.observe(event({ kind: "tool.requested", tool: "mcp__web__read_url", toolUseId: "b" }));
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "b", output: "erreur", isError: true }),
    );
    expect(tracker.observe(event({ kind: "turn.finished", status: "success" }))).toBe("failed");
    tracker.begin(true);
    expect(tracker.observe(event({ kind: "turn.finished", status: "success" }))).toBe("failed");
    tracker.begin(true);
    expect(tracker.cancel()).toBe("cancelled");
  });
  it("refuse une lecture Web au contenu JSON vide", () => {
    const tracker = createResearchTracker();
    tracker.begin(true);
    tracker.observe(
      event({ kind: "tool.requested", tool: "mcp__web__search_web", toolUseId: "a" }),
    );
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "a", output: '{"text":"source"}', isError: false }),
    );
    tracker.observe(event({ kind: "tool.requested", tool: "mcp__web__read_url", toolUseId: "b" }));
    tracker.observe(
      event({ kind: "tool.result", toolUseId: "b", output: '{"text":"  "}', isError: false }),
    );
    expect(tracker.observe(event({ kind: "turn.finished", status: "success" }))).toBe("failed");
  });
  it("refuse les indicateurs IPC qui ne sont pas des booléens", () => {
    expect(parseToEngine({ v: 1, type: "prompt", text: "x", research: true }).ok).toBe(true);
    expect(parseToEngine({ v: 1, type: "prompt", text: "x", research: "true" }).ok).toBe(false);
  });
});
