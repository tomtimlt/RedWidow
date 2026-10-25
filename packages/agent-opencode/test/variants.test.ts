import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createSdkApi } from "../src/api.js";
import { createOpencodeRunner } from "../src/index.js";
import { fakeOpencode, harness, userMessage } from "./helpers.js";

const runtimeModel = {
  id: "runtime",
  capabilities: { reasoning: true },
  variants: { custom: {}, max: {}, xhigh: {} },
};

function client(
  model: Record<string, unknown> = runtimeModel,
  connected = ["provider"],
  effectiveModel?: string,
) {
  const fake = fakeOpencode(
    [
      (stage) => {
        stage.emit("message.updated", userMessage("variant_user"));
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
  const createSession = vi.fn(async () => "ses_1");
  const listProviders = vi.fn(async () => ({
    all: [{ id: "provider", models: { runtime: model } }],
    connected,
    default: { provider: "runtime" },
  }));
  const runner = createOpencodeRunner({
    createClient: (init) => ({ ...fake.createClient(init), createSession, listProviders }),
  });
  return { fake, runner, createSession, listProviders };
}

describe("variantes de raisonnement OpenCode", () => {
  it("expose seulement les clés runtime valides et actives, sans alias", async () => {
    const test = client({
      ...runtimeModel,
      variants: {
        max: {},
        custom_level: { reasoningEffort: "high" },
        "custom.level-2": {},
        "invalide espace": {},
        ["a".repeat(65)]: {},
        disabled: { disabled: true },
        malformed: false,
        null: null,
        array: [],
      },
    });
    expect(await test.runner.listModels?.({ cwd: process.cwd() })).toEqual([
      {
        value: "provider/runtime",
        displayName: "runtime",
        reasoningVariants: ["max", "custom_level", "custom.level-2"],
      },
    ]);
    expect(test.fake.prompts).toEqual([]);
    expect(test.createSession).not.toHaveBeenCalled();
  });

  it.each([
    { ...runtimeModel, capabilities: { reasoning: false } },
    { ...runtimeModel, reasoning: false },
    { id: "runtime", capabilities: { reasoning: true } },
    { id: "runtime" },
  ])("sans variantes disponibles, ne propose aucun niveau : %j", async (model) => {
    const test = client(model);
    expect(
      (await test.runner.listModels?.({ cwd: process.cwd() }))?.[0]?.reasoningVariants,
    ).toEqual([]);
  });

  it("accepte les variantes effectives quand le flag de capacité est absent", async () => {
    const model = { id: "runtime", variants: { runtime_level: {} } };
    const test = client(model);
    expect(
      (await test.runner.listModels?.({ cwd: process.cwd() }))?.[0]?.reasoningVariants,
    ).toEqual(["runtime_level"]);
    expect(
      (
        await harness().run(client(model).runner, {
          model: "provider/runtime",
          variant: "runtime_level",
        })
      ).status,
    ).toBe("success");
  });

  it("borne le catalogue à 64 variantes", async () => {
    const test = client({
      ...runtimeModel,
      variants: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`v${index}`, {}])),
    });
    expect(
      (await test.runner.listModels?.({ cwd: process.cwd() }))?.[0]?.reasoningVariants,
    ).toHaveLength(64);
  });

  it.each(["provider/runtime", undefined])(
    "transmet la variante exacte avec le modèle %s",
    async (model) => {
      const test = client();
      expect(
        (await harness().run(test.runner, { model: model as string, variant: "max" })).status,
      ).toBe("success");
      expect(test.fake.prompts[0]?.body).toMatchObject({
        model: { providerID: "provider", modelID: "runtime" },
        variant: "max",
      });
      expect(test.listProviders).toHaveBeenCalledOnce();
    },
  );

  it("Auto omet le champ variant", async () => {
    const test = client();
    expect((await harness().run(test.runner, { model: undefined as never })).status).toBe(
      "success",
    );
    expect(test.fake.prompts[0]?.body).not.toHaveProperty("variant");
  });

  it.each([
    { effective: "provider/runtime", requested: undefined },
    { effective: "provider/absent", requested: "provider/runtime" },
  ])(
    "valide contre le modèle résolu demandé ou effectif : %j",
    async ({ effective, requested }) => {
      const test = client(runtimeModel, ["provider"], effective);
      expect(
        (await harness().run(test.runner, { model: requested as string, variant: "custom" }))
          .status,
      ).toBe("success");
      expect(test.fake.prompts[0]?.body).toMatchObject({
        model: { providerID: "provider", modelID: "runtime" },
        variant: "custom",
      });
    },
  );

  it("refuse effort Claude sans le convertir en variante", async () => {
    const test = client();
    const h = harness();
    expect((await h.run(test.runner, { model: "provider/runtime", effort: "max" })).status).toBe(
      "error",
    );
    expect(h.events.find((event) => event.kind === "error")).toMatchObject({
      code: "opencode.unsupportedEffort",
    });
    expect(test.fake.prompts).toEqual([]);
    expect(test.createSession).not.toHaveBeenCalled();
  });

  it.each([
    { model: "provider/runtime", variant: "unknown" },
    { model: "provider/missing", variant: "max" },
    { model: "unknown/runtime", variant: "max" },
    { model: undefined, variant: "unknown" },
  ])("refuse une sélection périmée avant session : %j", async (input) => {
    const test = client();
    const h = harness();
    expect((await h.run(test.runner, { ...input, model: input.model as string })).status).toBe(
      "error",
    );
    expect(h.events.find((event) => event.kind === "error")).toMatchObject({
      code: "opencode.invalidVariant",
    });
    expect(test.fake.prompts).toEqual([]);
    expect(test.createSession).not.toHaveBeenCalled();
    expect(test.fake.closed()).toBe(true);
  });

  it("refuse le fournisseur déconnecté et la capacité retirée", async () => {
    for (const test of [
      client(runtimeModel, []),
      client({ ...runtimeModel, capabilities: { reasoning: false } }),
    ]) {
      expect(
        (await harness().run(test.runner, { model: "provider/runtime", variant: "max" })).status,
      ).toBe("error");
      expect(test.createSession).not.toHaveBeenCalled();
      expect(test.fake.prompts).toEqual([]);
    }
  });
});

describe("transport HTTP de la variante OpenCode", () => {
  it.each([undefined, "max"])("envoie le JSON exact pour %s", async (variant) => {
    let received: unknown;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const api = createSdkApi({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        directory: process.cwd(),
      });
      await api.prompt("session", {
        text: "consigne",
        model: { providerID: "provider", modelID: "runtime" },
        tools: { bash: false },
        ...(variant !== undefined && { variant }),
      });
      expect(received).toEqual({
        parts: [{ type: "text", text: "consigne" }],
        model: { providerID: "provider", modelID: "runtime" },
        tools: { bash: false },
        ...(variant !== undefined && { variant }),
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
