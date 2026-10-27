import type { HookCallback, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_METHODOLOGY,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  LEARNING_SYSTEM_PROMPT,
} from "@warband/core";
import { expect, it } from "vitest";
import { createSdkRunner } from "../src/index.js";

it.each([undefined, "reprise"])(
  "la méthode couvre le mode lecture seule et la reprise : %s",
  async (resume) => {
    let seen: Options | undefined;
    const custom: HookCallback = async () => ({});
    const recorder = createRecorder();
    const runner = createSdkRunner({
      processEnv: {},
      builtinTools: [],
      hooks: { SubagentStart: [{ hooks: [custom] }] },
      query: async function* ({ options }) {
        seen = options;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0,
          result: "ok",
        } as SDKMessage;
      },
    });
    await runner.run(
      {
        prompt: "Explique",
        cwd: process.cwd(),
        systemPrompt: LEARNING_SYSTEM_PROMPT,
        ...(resume && { resume }),
      },
      { recorder, gate: createApprovalGate({ policy: DEFAULT_POLICY, recorder }) },
    );
    expect(seen?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: `${AGENT_METHODOLOGY}\n\n${LEARNING_SYSTEM_PROMPT}`,
    });
    expect(seen?.tools).toEqual([]);
    expect(seen?.allowedTools).toEqual([]);
    expect(seen?.settings).toEqual({ autoMemoryEnabled: false });
    const hooks = seen?.hooks?.SubagentStart;
    expect(hooks).toHaveLength(2);
    expect(hooks?.[1]?.hooks).toEqual([custom]);
    const output = await hooks?.[0]?.hooks[0]?.(
      {
        hook_event_name: "SubagentStart",
        agent_id: "a",
        agent_type: "explore",
        session_id: "s",
        transcript_path: "t",
        cwd: process.cwd(),
      },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: AGENT_METHODOLOGY },
    });
  },
);
