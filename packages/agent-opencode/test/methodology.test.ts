import { access, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { AGENT_METHODOLOGY, LEARNING_SYSTEM_PROMPT } from "@warband/core";
import { expect, it, vi } from "vitest";
import * as apiModule from "../src/api.js";
import { createOpencodeRunner } from "../src/index.js";
import { fakeOpencode, harness, userMessage } from "./helpers.js";

it.each([
  { provider: undefined, resume: undefined, systemPrompt: undefined },
  { provider: undefined, resume: "ses_1", systemPrompt: "Contexte privé du projet A." },
  { provider: "openai" as const, resume: undefined, systemPrompt: LEARNING_SYSTEM_PROMPT },
  { provider: "openai" as const, resume: "ses_1", systemPrompt: undefined },
])(
  "méthode commune sans web, reprise $resume, fournisseur $provider",
  async ({ provider, resume, systemPrompt }) => {
    const fake = fakeOpencode(
      [1, 2].map((i) => (s) => {
        s.emit("message.updated", userMessage(`u${i}`));
        s.idle();
      }),
    );
    let path = "";
    const runner = createOpencodeRunner({
      processEnv: {},
      ...(provider && { provider }),
      builtinTools: [],
      config: {
        instructions: ["regles.md"],
        agent: { general: { prompt: "Rôle existant." }, personnel: { prompt: "Rôle personnel." } },
      },
      createClient: async (init) => {
        const instructions = init.config.instructions as string[];
        expect(instructions[0]).toBe("regles.md");
        expect(instructions).toHaveLength(2);
        path = instructions[1] as string;
        expect(await readFile(path, "utf8")).toBe(AGENT_METHODOLOGY);
        if (process.platform !== "win32") {
          expect((await stat(path)).mode & 0o777).toBe(0o600);
          expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
        }
        expect(init.config.agent).toMatchObject({
          general: { prompt: "Rôle existant." },
          personnel: { prompt: "Rôle personnel." },
        });
        expect(JSON.stringify(init.config)).not.toContain('"allow"');
        return fake.createClient(init);
      },
    });
    async function* prompts() {
      yield "premier";
      yield "second";
    }
    const result = await harness().run(runner, {
      prompt: prompts(),
      model: provider ? "openai/test" : "fake/m",
      ...(resume && { resume }),
      ...(systemPrompt && { systemPrompt }),
    });
    expect(result.status).toBe("success");
    expect(fake.prompts).toHaveLength(2);
    for (const prompt of fake.prompts) {
      expect(prompt.body.system).toBe(systemPrompt);
      expect(prompt.body.tools?.bash).toBe(false);
      expect(prompt.body.tools?.task).toBe(false);
    }
    await expect(access(dirname(path))).rejects.toThrow();
  },
);

it("retire le skill temporaire même si le client échoue au démarrage", async () => {
  let path = "";
  const result = await harness().run(
    createOpencodeRunner({
      processEnv: {},
      createClient: async (init) => {
        path = (init.config.instructions as string[])[0] as string;
        expect(await readFile(path, "utf8")).toBe(AGENT_METHODOLOGY);
        throw new Error("client indisponible");
      },
    }),
  );
  expect(result.status).toBe("error");
  await expect(access(dirname(path))).rejects.toThrow();
});

it("un serveur externe reçoit la méthode dans notre session sans modification globale", async () => {
  const fake = fakeOpencode([
    (s) => {
      s.emit("message.updated", userMessage("u"));
      s.idle();
    },
  ]);
  const externalConfig = { permission: { "*": "ask" }, model: "fake/m" };
  const externalAbort = new AbortController();
  const api = fake.createClient({
    directory: process.cwd(),
    config: externalConfig,
    signal: externalAbort.signal,
  });
  const subscribe = api.subscribe;
  api.subscribe = (signal) => {
    // Le vrai client ferme le flux SSE à l'annulation du run, même sur serveur externe.
    signal.addEventListener("abort", () => externalAbort.abort(), { once: true });
    return subscribe(signal);
  };
  const client = vi.spyOn(apiModule, "createSdkApi").mockReturnValue(api);
  try {
    const result = await harness().run(
      createOpencodeRunner({ processEnv: {}, baseUrl: "http://127.0.0.1:1234" }),
      { systemPrompt: "Contexte local." },
    );
    expect(result.status).toBe("success");
    expect(fake.prompts[0]?.body.system).toBe(`${AGENT_METHODOLOGY}\n\nContexte local.`);
    expect(externalConfig).toEqual({ permission: { "*": "ask" }, model: "fake/m" });
    expect(fake.init().config).not.toHaveProperty("instructions");
  } finally {
    client.mockRestore();
  }
});
