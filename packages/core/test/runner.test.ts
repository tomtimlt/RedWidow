import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AgentRunner,
  buildGraph,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type RunSummary,
} from "../src/index.js";

describe("AgentRunner", () => {
  it("le cœur s'utilise seul, avec un runner factice sans SDK", async () => {
    const recorder = createRecorder({ runId: "run-1" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: { cwd: "/w", posixShell: true },
    });

    const runner: AgentRunner = {
      async run(input, ctx) {
        const root = ctx.recorder.emit({
          kind: "run.started",
          prompt: typeof input.prompt === "string" ? input.prompt : "",
          cwd: input.cwd,
        });
        const requested = ctx.recorder.emit(
          {
            kind: "tool.requested",
            toolUseId: "t1",
            tool: "Bash",
            input: { command: "docker ps" },
          },
          root.id,
        );
        const outcome = await ctx.gate.decide(
          { toolUseId: "t1", tool: "Bash", input: { command: "docker ps" } },
          new AbortController().signal,
          requested.id,
        );
        const summary: RunSummary = {
          status: outcome.decision === "allow" ? "success" : "error",
          turns: 1,
          costUsd: 0,
          result: "ok",
        };
        ctx.recorder.emit({ kind: "run.finished", ...summary }, root.id);
        return summary;
      },
    };

    const summary = await runner.run({ prompt: "état ?", cwd: "/w" }, { recorder, gate });
    expect(summary).toEqual({ status: "success", turns: 1, costUsd: 0, result: "ok" });
    expect(events.map((e) => e.kind)).toEqual([
      "run.started",
      "tool.requested",
      "approval.decided",
      "run.finished",
    ]);
    expect(buildGraph(events).runId).toBe("run-1");
  });

  it("le paquet du cœur ne dépend d'aucun paquet @anthropic-ai/*", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const names = Object.keys(pkg[field] ?? {});
      expect(
        names.filter(
          (n) => n.startsWith("@anthropic-ai/") || n.startsWith("@modelcontextprotocol/"),
        ),
      ).toEqual([]);
    }
  });
});
