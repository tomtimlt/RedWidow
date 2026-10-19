import type { McpSdkServerConfigWithInstance, Options } from "@anthropic-ai/claude-agent-sdk";
import { createApprovalGate, createRecorder, LEARNING_POLICY } from "@warband/core";
import { describe, expect, it } from "vitest";
import { coursToolset, createSdkRunner, type QueryFn } from "../src/index.js";

describe("coursToolset", () => {
  it("restreint le SDK aux deux outils cours, sans outil natif ni shell", async () => {
    const recorder = createRecorder({ runId: "r" });
    const gate = createApprovalGate({
      policy: LEARNING_POLICY,
      recorder,
      workspace: { cwd: "/w", posixShell: true },
    });
    let seen: Options | undefined;
    const query: QueryFn = async function* ({ options }) {
      seen = options;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        result: "",
      } as never;
    };
    const runner = createSdkRunner({ toolsets: [coursToolset()], builtinTools: [], query });
    await runner.run({ prompt: "x", cwd: "/w" }, { recorder, gate });

    expect(seen?.tools).toEqual([]);
    expect(seen?.permissionMode).toBe("default");
    expect(seen?.allowedTools).toEqual([]);
    expect(seen?.disallowedTools).toEqual(expect.arrayContaining(["Bash", "PowerShell"]));
    expect(Object.keys(seen?.mcpServers ?? {})).toEqual(["cours"]);
    const server = seen?.mcpServers?.cours as McpSdkServerConfigWithInstance;
    const registered = Object.keys(
      (server.instance as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools,
    ).sort();
    expect(registered).toEqual(["chercher", "lire"]);
  });
});
