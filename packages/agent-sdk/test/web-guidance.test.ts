import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENT_METHODOLOGY,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  WEB_RESEARCH_GUIDANCE,
} from "@warband/core";
import { expect, it } from "vitest";
import { createSdkRunner, webToolset } from "../src/index.js";

it.each([true, false])(
  "Claude reçoit la consigne web seulement avec les outils exposés : %s",
  async (enabled) => {
    let seen: Options | undefined;
    const recorder = createRecorder();
    const runner = createSdkRunner({
      processEnv: {},
      toolsets: enabled ? [webToolset()] : [],
      query: async function* ({ options }) {
        seen = options;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0,
          result: "ok",
        } as unknown as SDKMessage;
      },
    });
    await runner.run(
      { prompt: "question", cwd: process.cwd(), systemPrompt: "Consigne du projet." },
      {
        recorder,
        gate: createApprovalGate({ policy: DEFAULT_POLICY, recorder }),
      },
    );
    expect(seen?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: [
        AGENT_METHODOLOGY,
        ...(enabled ? [WEB_RESEARCH_GUIDANCE] : []),
        "Consigne du projet.",
      ].join("\n\n"),
    });
  },
);
