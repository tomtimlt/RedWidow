import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  MISSION_CONTEXT_UNCHANGED,
} from "@warband/core";
import { expect, it } from "vitest";
import { createSdkRunner, deskToolset } from "../src/index.js";

/** Joue un run dont les tours sont `turns` et rend le texte exact envoyé pour chacun. */
async function sentTurns(turns: string[], resume?: string): Promise<string[]> {
  const sent: string[] = [];
  const recorder = createRecorder();
  const runner = createSdkRunner({
    processEnv: {},
    toolsets: [deskToolset()],
    query: async function* ({ prompt }) {
      if (typeof prompt === "string") {
        sent.push(prompt);
      } else {
        for await (const message of prompt) sent.push(String(message.message.content));
      }
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
  async function* source() {
    yield* turns;
  }
  await runner.run(
    { prompt: source(), cwd: process.cwd(), ...(resume !== undefined && { resume }) },
    { recorder, gate: createApprovalGate({ recorder, policy: DEFAULT_POLICY }) },
  );
  return sent;
}

it("contexte de mission en delta : complet, marqueur si identique, complet si changé", async () => {
  const [first, second, third] = await sentTurns(["go", "go", "autre"]);
  expect(first).toContain("<mission_context>");
  expect(first).toContain("aucune autorisation supplémentaire");
  // Contexte identique au dernier bloc envoyé : le marqueur seul remplace le bloc.
  expect(second).toBe(`go\n\n${MISSION_CONTEXT_UNCHANGED}`);
  expect(second).not.toContain("<mission_context>");
  // Le contexte a changé (nouvelle consigne) : bloc complet.
  expect(third).toContain("<mission_context>");
  expect(third).not.toContain(MISSION_CONTEXT_UNCHANGED);
});

it("après une reprise de session, le premier tour renvoie le bloc complet", async () => {
  const [first] = await sentTurns(["go"]);
  const [resumed, again] = await sentTurns(["go", "go"], "session-precedente");
  expect(first).toContain("<mission_context>");
  expect(resumed).toContain("<mission_context>");
  expect(again).toContain(MISSION_CONTEXT_UNCHANGED);
});
