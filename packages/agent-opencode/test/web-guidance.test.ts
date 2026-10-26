import { WEB_RESEARCH_GUIDANCE } from "@warband/core";
import { expect, it } from "vitest";
import { createOpencodeRunner, webToolset } from "../src/index.js";
import { fakeOpencode, harness, userMessage } from "./helpers.js";

it.each([
  { provider: undefined, enabled: true },
  { provider: undefined, enabled: false },
  { provider: "openai" as const, enabled: true },
  { provider: "openai" as const, enabled: false },
])(
  "OpenCode/OpenAI transmettent la consigne sur chaque tour : $provider, web $enabled",
  async ({ provider, enabled }) => {
    const fake = fakeOpencode(
      [1, 2].map((index) => (stage) => {
        stage.emit("message.updated", userMessage(`u${index}`));
        stage.idle();
      }),
    );
    const h = harness();
    const runner = createOpencodeRunner({
      createClient: fake.createClient,
      processEnv: {},
      ...(provider && { provider }),
      toolsets: enabled ? [webToolset()] : [],
    });
    async function* prompts() {
      yield "premier";
      yield "second";
    }
    const result = await h.run(runner, {
      prompt: prompts(),
      model: provider === "openai" ? "openai/test" : "fake/m",
      systemPrompt: "Consigne du projet.",
    });
    expect(result.status).toBe("success");
    expect(fake.prompts).toHaveLength(2);
    for (const prompt of fake.prompts)
      expect(prompt.body.system).toBe(
        enabled ? `${WEB_RESEARCH_GUIDANCE}\n\nConsigne du projet.` : "Consigne du projet.",
      );
  },
);
