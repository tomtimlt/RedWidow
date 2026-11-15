import { MISSION_CONTEXT_UNCHANGED } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createOpencodeRunner, deskToolset } from "../src/index.js";
import { assistantMessage, fakeOpencode, harness, type Stage, userMessage } from "./helpers.js";

const normalTurn = (s: Stage, i = 0) => {
  s.emit("message.updated", userMessage(`u${i}`));
  s.emit("message.updated", assistantMessage(`a${i}`));
  s.idle();
};

describe("contexte de mission en delta (OpenCode)", () => {
  async function turnsSent(turns: string[], resume?: string) {
    const fake = fakeOpencode(turns.map((_, i) => (s: Stage) => normalTurn(s, i)));
    const runner = createOpencodeRunner({
      processEnv: {},
      toolsets: [deskToolset()],
      createClient: fake.createClient,
    });
    async function* source() {
      yield* turns;
    }
    await harness().run(runner, {
      prompt: source(),
      ...(resume !== undefined && { resume }),
    });
    return fake.prompts.map((p) => p.body.text);
  }

  it("complet au premier tour, marqueur si identique, complet si changé", async () => {
    const [first, second, third] = await turnsSent(["go", "go", "autre"]);
    expect(first).toContain("<mission_context>");
    expect(second).toBe(`go\n\n${MISSION_CONTEXT_UNCHANGED}`);
    expect(third).toContain("<mission_context>");
    expect(third).not.toContain(MISSION_CONTEXT_UNCHANGED);
  });

  it("complet après une reprise de session", async () => {
    const [resumed, again] = await turnsSent(["go", "go"], "ses_1");
    expect(resumed).toContain("<mission_context>");
    expect(again).toContain(MISSION_CONTEXT_UNCHANGED);
  });
});
