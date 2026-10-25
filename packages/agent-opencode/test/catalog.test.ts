import { createExegolTargets, createRecorder } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import {
  coursToolset,
  createOpencodeRunner,
  exegolToolset,
  kaliToolset,
  type OpencodeApi,
} from "../src/index.js";
import { fakeOpencode, harness, userMessage } from "./helpers.js";

function catalogClient(overrides: Partial<OpencodeApi> = {}) {
  const fake = fakeOpencode([]);
  const listProviders = vi.fn(async () => ({
    all: [
      { id: "openai", models: { runtime: { id: "runtime", name: "Modèle runtime" } } },
      { id: "other", models: { m: { id: "m", name: "Autre" } } },
      { id: "offline", models: { m: { id: "m" } } },
    ],
    connected: ["openai", "other"],
  }));
  return {
    fake,
    listProviders,
    createClient: (init: Parameters<typeof fake.createClient>[0]) => ({
      ...fake.createClient(init),
      listProviders,
      ...overrides,
    }),
  };
}

describe("catalogue OpenCode", () => {
  it("lit les modèles connectés du fournisseur sans prompt ni session", async () => {
    const client = catalogClient();
    const runner = createOpencodeRunner({ createClient: client.createClient, provider: "openai" });
    expect(await runner.listModels?.({ cwd: process.cwd() })).toEqual([
      { value: "openai/runtime", displayName: "Modèle runtime", reasoningVariants: [] },
    ]);
    expect(client.fake.init().config.enabled_providers).toEqual(["openai"]);
    expect(client.fake.prompts).toEqual([]);
    expect(client.fake.closed()).toBe(true);
  });

  it("ferme le client si le catalogue échoue", async () => {
    const client = catalogClient({
      listProviders: async () => {
        throw new Error("catalogue indisponible");
      },
    });
    await expect(
      createOpencodeRunner({ createClient: client.createClient }).listModels?.({
        cwd: process.cwd(),
      }),
    ).rejects.toThrow("catalogue indisponible");
    expect(client.fake.closed()).toBe(true);
  });

  it.each([
    {
      provider: undefined,
      connected: ["openai", "other"],
      defaults: { openai: "preferred", other: "m" },
      expected: ["openai/preferred", "openai/first", "other/m"],
    },
    {
      provider: undefined,
      connected: ["other", "openai"],
      defaults: { openai: "preferred", other: "m" },
      expected: ["other/m", "openai/first", "openai/preferred"],
    },
    {
      provider: "openai",
      connected: ["other", "openai"],
      defaults: { openai: "preferred", other: "m" },
      expected: ["openai/preferred", "openai/first"],
    },
    {
      provider: undefined,
      connected: ["other", "openai"],
      defaults: { openai: "absent", other: "absent" },
      expected: ["openai/first", "openai/preferred", "other/m"],
    },
    {
      provider: undefined,
      connected: ["openai", "other"],
      defaults: {},
      expected: ["openai/first", "openai/preferred", "other/m"],
    },
    {
      provider: "openai",
      connected: ["other", "openai"],
      defaults: { other: "m" },
      expected: ["openai/first", "openai/preferred"],
    },
  ])(
    "place le défaut Auto réel en premier sans réordonner les autres : %j",
    async ({ provider, connected, defaults, expected }) => {
      const client = catalogClient({
        listProviders: async () => ({
          all: [
            { id: "openai", models: { first: { id: "first" }, preferred: { id: "preferred" } } },
            { id: "other", models: { m: { id: "m" } } },
          ],
          connected,
          default: defaults,
        }),
      });
      const runner = createOpencodeRunner({
        createClient: client.createClient,
        ...(provider !== undefined && { provider }),
      });
      expect(
        (await runner.listModels?.({ cwd: process.cwd() }))?.map((model) => model.value),
      ).toEqual(expected);
      expect(client.fake.prompts).toEqual([]);
      expect(client.fake.closed()).toBe(true);
    },
  );

  it("refuse la configuration dangereuse avant de lire le catalogue", async () => {
    const client = catalogClient({ getConfig: async () => ({ permission: { "*": "allow" } }) });
    await expect(
      createOpencodeRunner({ createClient: client.createClient }).listModels?.({
        cwd: process.cwd(),
      }),
    ).rejects.toThrow();
    expect(client.listProviders).not.toHaveBeenCalled();
    expect(client.fake.closed()).toBe(true);
  });

  it.each([
    { provider: undefined, configured: "openai/m2", expected: "openai/m2", variants: ["second"] },
    { provider: "openai", configured: "m2", expected: "openai/m2", variants: ["second"] },
    { provider: "openai", configured: "other/m", expected: "openai/m1", variants: ["first"] },
    { provider: undefined, configured: "offline/m", expected: "openai/m1", variants: ["first"] },
    {
      provider: undefined,
      configured: "openai/absent",
      expected: "openai/m1",
      variants: ["first"],
    },
    { provider: undefined, configured: "invalide", expected: "openai/m1", variants: ["first"] },
  ])(
    "Auto expose les variantes du modèle effectif valide avant le défaut : %j",
    async ({ provider, configured, expected, variants }) => {
      const fake = fakeOpencode([], {
        effective: (config) => ({ ...config, model: configured }),
      });
      const runner = createOpencodeRunner({
        ...(provider !== undefined && { provider }),
        createClient: (init) => ({
          ...fake.createClient(init),
          listProviders: async () => ({
            all: [
              {
                id: "openai",
                models: {
                  m1: { id: "m1", variants: { first: {} } },
                  m2: { id: "m2", variants: { second: {} } },
                },
              },
              { id: "other", models: { m: { id: "m" } } },
              { id: "offline", models: { m: { id: "m" } } },
            ],
            connected: ["openai", "other"],
            default: { openai: "m1", other: "m" },
          }),
        }),
      });
      const models = await runner.listModels?.({ cwd: process.cwd() });
      expect(models?.[0]).toMatchObject({ value: expected, reasoningVariants: variants });
      if (configured === "openai/m2")
        expect(models?.map((model) => model.value)).toEqual(["openai/m2", "openai/m1", "other/m"]);
      if (provider === "openai")
        expect(models?.every((model) => model.value.startsWith("openai/"))).toBe(true);
      expect(fake.prompts).toEqual([]);
      expect(fake.closed()).toBe(true);
    },
  );

  it.each([
    { options: { apiKey: "secret-non-journalisable" } },
    { options: { baseURL: "https://autre.invalid" } },
    { npm: "plugin-personnalise" },
    { models: { runtime: { provider: { npm: "module-personnalise" } } } },
    { models: { runtime: { provider: { api: "https://autre.invalid" } } } },
    { models: { runtime: { headers: { authorization: "secret-non-journalisable" } } } },
    { api: "https://autre.invalid" },
    { env: ["SECRET_PERSONNALISE"] },
    { headers: { authorization: "secret-non-journalisable" } },
    { options: { inconnu: true } },
    { inconnu: true },
    { options: null },
    null,
    "invalide",
    { options: { headers: { authorization: "secret-non-journalisable" } } },
  ])("refuse une surcharge OpenAI effective sans exposer sa valeur", async (openai) => {
    const client = catalogClient();
    const createClient = (init: Parameters<typeof client.createClient>[0]) => ({
      ...client.createClient(init),
      getConfig: async () => ({ ...init.config, provider: { openai } }),
    });
    const runner = createOpencodeRunner({ provider: "openai", createClient });
    await expect(runner.listModels?.({ cwd: process.cwd() })).rejects.toThrow(
      "Configuration OpenAI personnalisée incompatible",
    );
    expect(client.listProviders).not.toHaveBeenCalled();
    expect(client.fake.closed()).toBe(true);
    const h = harness();
    const result = await h.run(runner);
    expect(result.status).toBe("error");
    expect(client.fake.prompts).toEqual([]);
    expect(JSON.stringify(h.events)).not.toContain("secret-non-journalisable");
  });

  it.each([
    {},
    { name: "OpenAI" },
    { npm: "@ai-sdk/openai", options: { baseURL: "https://api.openai.com/v1" } },
  ])("accepte les seuls réglages officiels explicites", async (openai) => {
    const client = catalogClient();
    const createClient = (init: Parameters<typeof client.createClient>[0]) => ({
      ...client.createClient(init),
      getConfig: async () => ({ ...init.config, provider: { openai } }),
    });
    await expect(
      createOpencodeRunner({ provider: "openai", createClient }).listModels?.({
        cwd: process.cwd(),
      }),
    ).resolves.toHaveLength(1);
  });

  it("exige une clé API avant le lancement et respecte une annulation préalable", async () => {
    const client = catalogClient();
    const runner = createOpencodeRunner({
      provider: "openai",
      processEnv: {},
      createClient: client.createClient,
    });
    await expect(runner.listModels?.({ cwd: process.cwd(), auth: "api-key" })).rejects.toThrow();
    await expect(
      runner.listModels?.({ cwd: process.cwd(), signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(client.listProviders).not.toHaveBeenCalled();
  });

  it("impose aussi le fournisseur dans les runs", async () => {
    const fake = fakeOpencode([], {
      effective: (config) => ({ ...config, permission: { "*": "allow" } }),
    });
    await harness().run(
      createOpencodeRunner({ createClient: fake.createClient, provider: "openai" }),
      {},
    );
    expect(fake.init().config.enabled_providers).toEqual(["openai"]);
  });
});

describe("modèle Auto OpenCode", () => {
  const all = [
    { id: "openai", models: { runtime: { id: "runtime" } } },
    { id: "other", models: { m: { id: "m" } } },
    { id: "offline", models: { m: { id: "m" } } },
  ];

  function autoClient(catalog: unknown, provider?: string, effectiveModel?: string) {
    const fake = fakeOpencode(
      [
        (stage) => {
          stage.emit("message.updated", userMessage("user_auto"));
          stage.idle();
        },
      ],
      {
        effective: (config) => ({
          ...config,
          ...(effectiveModel !== undefined && { model: effectiveModel }),
        }),
      },
    );
    const listProviders = vi.fn(async () => catalog);
    const runner = createOpencodeRunner({
      ...(provider !== undefined && { provider }),
      createClient: (init) => ({ ...fake.createClient(init), listProviders }),
    });
    return { fake, listProviders, runner };
  }

  it("lance le premier run OpenAI Auto avec son défaut runtime sans configuration modèle", async () => {
    const client = autoClient(
      { all, default: { openai: "runtime", other: "m" }, connected: ["other", "openai"] },
      "openai",
    );
    const h = harness();
    const result = await h.run(client.runner, { model: undefined as never });
    expect(result.status).toBe("success");
    expect(client.fake.init().config.model).toBeUndefined();
    expect(client.listProviders).toHaveBeenCalledOnce();
    expect(client.fake.prompts[0]?.body.model).toEqual({
      providerID: "openai",
      modelID: "runtime",
    });
    expect(h.events.find((event) => event.kind === "session.started")).toMatchObject({
      model: "openai/runtime",
    });
    expect(client.fake.closed()).toBe(true);
  });

  it.each([
    { default: { other: "m" }, connected: ["other", "openai"] },
    { default: { openai: "runtime", other: "m" }, connected: ["other"] },
    { default: { openai: "absent", other: "m" }, connected: ["openai", "other"] },
    { default: { offline: "m" }, connected: ["openai", "other"] },
    { connected: ["openai", "other"] },
    { default: { openai: "" }, connected: ["openai"] },
  ])("refuse Auto OpenAI sans vrai défaut OpenAI connecté et présent : %j", async (catalog) => {
    const client = autoClient({ all, ...catalog }, "openai");
    const h = harness();
    expect((await h.run(client.runner, { model: undefined as never })).status).toBe("error");
    expect(h.events.find((event) => event.kind === "error")).toMatchObject({
      code: "opencode.noModel",
    });
    expect(client.fake.prompts).toEqual([]);
    expect(h.events.some((event) => event.kind === "session.started")).toBe(false);
    expect(client.fake.closed()).toBe(true);
  });

  it("choisit le premier vrai défaut connecté dans le mode générique", async () => {
    const client = autoClient({
      all,
      default: { offline: "m", openai: "absent", other: "m" },
      connected: ["openai", "other"],
    });
    expect((await harness().run(client.runner, { model: undefined as never })).status).toBe(
      "success",
    );
    expect(client.fake.prompts[0]?.body.model).toEqual({ providerID: "other", modelID: "m" });
  });

  it("respecte l'ordre connecté entre plusieurs défauts génériques valides", async () => {
    const client = autoClient({
      all,
      default: { openai: "runtime", other: "m" },
      connected: ["other", "openai"],
    });
    expect((await harness().run(client.runner, { model: undefined as never })).status).toBe(
      "success",
    );
    expect(client.fake.prompts[0]?.body.model).toEqual({ providerID: "other", modelID: "m" });
  });

  it("refuse aussi Auto générique sans défaut connecté valide", async () => {
    const client = autoClient({ all, default: { offline: "m" }, connected: ["openai"] });
    expect((await harness().run(client.runner, { model: undefined as never })).status).toBe(
      "error",
    );
    expect(client.fake.prompts).toEqual([]);
  });

  it.each([
    { requested: "other/explicit", effective: "openai/runtime", expected: "explicit" },
    { requested: undefined, effective: "other/configured", expected: "configured" },
  ])("conserve la priorité du modèle demandé puis effectif sans catalogue", async (test) => {
    const client = autoClient({}, undefined, test.effective);
    expect((await harness().run(client.runner, { model: test.requested as string })).status).toBe(
      "success",
    );
    expect(client.fake.prompts[0]?.body.model).toEqual({
      providerID: "other",
      modelID: test.expected,
    });
    expect(client.listProviders).not.toHaveBeenCalled();
  });

  it("valide le modèle effectif avant tout accès au catalogue", async () => {
    const client = autoClient({}, undefined, "invalide");
    const h = harness();
    expect((await h.run(client.runner, { model: undefined as never })).status).toBe("error");
    expect(h.events.find((event) => event.kind === "error")).toMatchObject({
      code: "opencode.invalidModel",
    });
    expect(client.listProviders).not.toHaveBeenCalled();
    expect(client.fake.prompts).toEqual([]);
  });
});

describe("toolsets OpenCode", () => {
  it.each([exegolToolset, kaliToolset])(
    "conserve les notes et retire seulement remember",
    (factory) => {
      const set = factory({ targets: createExegolTargets(), includeMemory: false });
      const names = set
        .create({ recorder: createRecorder({ runId: "tools" }) })
        .map((spec) => spec.name);
      if (factory === exegolToolset) {
        expect(names).toContain("list_notes");
        expect(names).toContain("update_note");
      }
      expect(names).not.toContain("remember");
    },
  );

  it("expose les outils cours neutres", () => {
    expect(
      coursToolset()
        .create({ recorder: createRecorder({ runId: "cours" }) })
        .map((spec) => spec.name),
    ).toEqual(["chercher", "lire"]);
  });
});
