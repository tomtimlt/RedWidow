import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig, effectiveServerEnv, serverEnv } from "@warband/agent-opencode";
import { sdkEffectiveEnv } from "@warband/agent-sdk";
import { type AgentRunner, fingerprint } from "@warband/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  effectiveKey,
  opencodeCredentialOptions,
  opencodeProviderConfig,
} from "../src/engine/credentials.js";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import { buildEngineEnv } from "../src/logic/controller.js";
import { type FromEngine, parseToEngine, type StartParams } from "../src/logic/protocol.js";

function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(m),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: () => {},
  };
  return { channel, sent, receive: (raw: unknown) => onMessage(raw) };
}

const idleRunner: AgentRunner = {
  run: ({ prompt }) =>
    new Promise((resolve) => {
      void (async () => {
        for await (const _ of prompt as AsyncIterable<string>) {
          // consignes ignorées
        }
        resolve({ status: "success", turns: 0, costUsd: 0, result: null });
      })();
    }),
};

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "warband-engine-vault-"));
});
afterAll(() => rm(cwd, { recursive: true, force: true }));

// Valeur sans aucun motif de clé usuel : seul le masquage par valeur peut la retirer.
const PLAIN = "zzvault-0123456789-plain";
const VAULT = { provider: "claude", name: "ANTHROPIC_API_KEY", rank: 2 } as const;

const providerKeys = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "event" && m.event.kind === "provider.key" ? [m.event] : []));

describe("protocole : clé du coffre dans le message start", () => {
  const start = (extra: Record<string, unknown>) =>
    parseToEngine({ v: 1, type: "start", cwd, ...extra });

  it("accepte fournisseur, nom de variable cohérent et rang ; rien d'autre", () => {
    expect(start({ vault: VAULT }).ok).toBe(true);
    expect(
      start({
        provider: "opencode",
        vault: { provider: "venator-acme", name: "VENATOR_ACME_API_KEY", rank: 1 },
      }).ok,
    ).toBe(true);
    for (const vault of [
      { ...VAULT, value: PLAIN },
      { ...VAULT, fingerprint: "aaaaaaaa" },
      { ...VAULT, name: "NODE_OPTIONS" },
      { ...VAULT, name: "OPENAI_API_KEY" },
      { ...VAULT, rank: 0 },
      { ...VAULT, rank: 11 },
      { ...VAULT, rank: 1.5 },
      { ...VAULT, provider: "Claude" },
      "ANTHROPIC_API_KEY",
    ])
      expect(start({ vault }).ok, JSON.stringify(vault)).toBe(false);
    // La clé du coffre vaut aussi en apprentissage (même fournisseur, même rotation).
    expect(start({ mode: "learning", vault: VAULT }).ok).toBe(true);
  });
});

describe("clé effective : lue dans l'environnement réellement transmis", () => {
  it("SDK : la valeur de l'environnement final de sdkEffectiveEnv, rien en abonnement", async () => {
    const processEnv = { ANTHROPIC_API_KEY: PLAIN, CLAUDE_CODE_OAUTH_TOKEN: "oauth-xyz-1234" };
    const params: StartParams = { cwd, auth: "api-key", vault: VAULT };
    expect(await effectiveKey(params, processEnv)).toEqual({ provider: "claude", value: PLAIN });
    expect(sdkEffectiveEnv("api-key", processEnv).ANTHROPIC_API_KEY).toBe(PLAIN);
    // Abonnement : le SDK retire la clé, il n'y a donc pas de clé effective.
    expect(await effectiveKey({ cwd, auth: "subscription" }, processEnv)).toBeUndefined();
    expect(sdkEffectiveEnv("subscription", processEnv)).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("le moteur lit la clé de l'enfant tel que l'hôte l'a construit (buildEngineEnv), pas celle qu'il croit avoir envoyée", async () => {
    const env = buildEngineEnv({ name: "ANTHROPIC_API_KEY", value: PLAIN }, {});
    expect(env.ANTHROPIC_API_KEY).toBe(PLAIN);
    expect((await effectiveKey({ cwd, auth: "api-key" }, env))?.value).toBe(PLAIN);
    // Une autre valeur dans l'environnement donne une autre empreinte : l'hôte la verra.
    const other = buildEngineEnv(
      { name: "ANTHROPIC_API_KEY", value: "zzother-9876543210-plain" },
      {},
    );
    expect(
      fingerprint((await effectiveKey({ cwd, auth: "api-key" }, other))?.value ?? ""),
    ).not.toBe(fingerprint(PLAIN));
  });

  it("OpenAI (clé d'API) : OPENAI_API_KEY de l'environnement final du serveur", async () => {
    const processEnv = { PATH: "/bin", OPENAI_API_KEY: PLAIN };
    expect(
      await effectiveKey(
        {
          cwd,
          provider: "openai",
          auth: "api-key",
          vault: { provider: "openai", name: "OPENAI_API_KEY", rank: 1 },
        },
        processEnv,
      ),
    ).toEqual({ provider: "openai", value: PLAIN });
    // Abonnement : la clé est écartée de l'environnement du serveur (aucun cache OAuth ici : refus du runner).
    const env = await effectiveServerEnv(
      { ...opencodeCredentialOptions("openai", undefined), processEnv },
      "api-key",
    );
    expect(env.OPENAI_API_KEY).toBe(PLAIN);
  });

  describe("fournisseur OpenCode configuré", () => {
    const providers = {
      "venator-acme": {
        npm: "@ai-sdk/openai-compatible" as const,
        options: { baseURL: "https://llm.example.test/v1" },
        models: { m: {} },
      },
      "venator-autre": {
        npm: "@ai-sdk/openai-compatible" as const,
        options: { baseURL: "https://autre.example.test/v1" },
        models: { m: {} },
      },
    };
    const vault = { provider: "venator-acme", name: "VENATOR_ACME_API_KEY", rank: 1 };
    const processEnv = {
      PATH: "/bin",
      VENATOR_ACME_API_KEY: PLAIN,
      VENATOR_AUTRE_API_KEY: "zzautre-0123456789-plain",
      ANTHROPIC_API_KEY: "zzclaude-0123456789-plain",
    };

    it("la variable est passée à l'enfant (passEnv) et présente dans l'environnement final, seule", async () => {
      const options = opencodeCredentialOptions("opencode", vault);
      expect(options.passEnv).toEqual(["VENATOR_ACME_API_KEY"]);
      const env = await effectiveServerEnv({ ...options, processEnv }, "auto");
      expect(env.VENATOR_ACME_API_KEY).toBe(PLAIN);
      // `safeEnv` n'est pas élargi : aucune autre clé n'atteint le serveur.
      expect(env).not.toHaveProperty("VENATOR_AUTRE_API_KEY");
      expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(
        await effectiveKey({ cwd, provider: "opencode", auth: "auto", vault }, processEnv),
      ).toEqual({
        provider: "venator-acme",
        value: PLAIN,
      });
    });

    it("sans clé du coffre : aucune variable ne passe, aucune clé effective", async () => {
      expect(opencodeCredentialOptions("opencode", undefined)).not.toHaveProperty("passEnv");
      const env = await effectiveServerEnv(
        { ...opencodeCredentialOptions("opencode", undefined), processEnv },
        "auto",
      );
      expect(env).not.toHaveProperty("VENATOR_ACME_API_KEY");
      expect(
        await effectiveKey({ cwd, provider: "opencode", auth: "auto" }, processEnv),
      ).toBeUndefined();
    });

    it("la valeur n'est jamais écrite dans la configuration générée : seul le NOM de la variable", () => {
      const config = opencodeProviderConfig(providers, vault);
      expect(JSON.stringify(config)).not.toContain(PLAIN);
      expect((config["venator-acme"] as { env: string[] }).env).toEqual(["VENATOR_ACME_API_KEY"]);
      expect(config["venator-autre"]).toEqual(providers["venator-autre"]);
      // Configuration transmise au serveur (OPENCODE_CONFIG_CONTENT) : sans valeur, alors que la variable la porte.
      const generated = buildConfig({
        user: { provider: config },
        enabledTools: new Set(),
        mcp: {},
        maxTurns: undefined,
      });
      const final = serverEnv({
        processEnv,
        passEnv: ["VENATOR_ACME_API_KEY"],
        config: generated,
        password: "pw",
      });
      expect(final.OPENCODE_CONFIG_CONTENT).not.toContain(PLAIN);
      expect(final.OPENCODE_CONFIG_CONTENT).toContain("VENATOR_ACME_API_KEY");
      expect(final.VENATOR_ACME_API_KEY).toBe(PLAIN);
    });

    it("un fournisseur absent de la configuration laisse celle-ci inchangée", () => {
      const absent = { provider: "venator-absent", name: "VENATOR_ABSENT_API_KEY", rank: 1 };
      expect(opencodeProviderConfig(providers, absent)).toBe(providers);
      expect(opencodeProviderConfig(providers, undefined)).toBe(providers);
    });
  });
});

describe("moteur : provider.key et masquage", () => {
  it("émet l'empreinte de la valeur réellement transmise, jamais la valeur, avec rang et source", async () => {
    const t = fakeChannel();
    const effective = vi.fn(async () => ({ provider: "claude", value: PLAIN }));
    const done = runEngine({
      channel: t.channel,
      createRunner: () => idleRunner,
      effectiveKey: effective,
    });
    t.receive({ v: 1, type: "start", cwd, auth: "api-key", vault: VAULT });
    await vi.waitFor(() => expect(providerKeys(t.sent)).toHaveLength(1));
    expect(providerKeys(t.sent)[0]).toMatchObject({
      kind: "provider.key",
      provider: "claude",
      keyRank: 2,
      fingerprint: fingerprint(PLAIN),
      source: "vault",
    });
    expect(effective).toHaveBeenCalledWith(expect.objectContaining({ vault: VAULT }));
    expect(JSON.stringify(t.sent)).not.toContain(PLAIN);
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  });

  it("sans coffre : source legacy, rang 0", async () => {
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: () => idleRunner,
      effectiveKey: async () => ({ provider: "claude", value: PLAIN }),
    });
    t.receive({ v: 1, type: "start", cwd, auth: "api-key" });
    await vi.waitFor(() => expect(providerKeys(t.sent)).toHaveLength(1));
    expect(providerKeys(t.sent)[0]).toMatchObject({ keyRank: 0, source: "legacy" });
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("aucune clé effective alors qu'une clé du coffre était annoncée : échec fermé, runner jamais construit", async () => {
    const t = fakeChannel();
    const createRunner = vi.fn(() => idleRunner);
    const done = runEngine({
      channel: t.channel,
      createRunner,
      effectiveKey: async () => undefined,
    });
    t.receive({ v: 1, type: "start", cwd, auth: "api-key", vault: VAULT });
    expect(await done).toBe(1);
    expect(t.sent.find((m) => m.type === "error")).toMatchObject({
      reason: { code: "vault.keyMismatch" },
    });
    expect(createRunner).not.toHaveBeenCalled();
  });

  it("le moteur ne reçoit jamais l'empreinte attendue (champ refusé par le protocole)", () => {
    expect(
      parseToEngine({ v: 1, type: "start", cwd, vault: { ...VAULT, fingerprint: "aaaaaaaa" } }).ok,
    ).toBe(false);
  });

  it("masque la clé de son environnement, même sans motif de clé usuel (secretsFromEnv)", async () => {
    const t = fakeChannel();
    const runner: AgentRunner = {
      run: async (_input, ctx) => {
        ctx.recorder.emit({ kind: "agent.text", text: `ma clé est ${PLAIN}` });
        ctx.recorder.emit({
          kind: "error",
          code: "error.unknown",
          message: `refus pour ${PLAIN}`,
        });
        return { status: "success", turns: 1, costUsd: 0, result: `fin ${PLAIN}` };
      },
    };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => runner,
      env: { ANTHROPIC_API_KEY: PLAIN },
    });
    t.receive({ v: 1, type: "start", cwd });
    expect(await done).toBe(0);
    const text = JSON.stringify(t.sent);
    expect(text).not.toContain(PLAIN);
    expect(text).toContain("[REDACTED]");
    expect(t.sent.some((m) => m.type === "ended")).toBe(true);
  });

  it("masque aussi la variable d'un fournisseur OpenCode du coffre", async () => {
    const t = fakeChannel();
    const runner: AgentRunner = {
      run: async (_input, ctx) => {
        ctx.recorder.emit({ kind: "agent.text", text: `clé ${PLAIN}` });
        return { status: "success", turns: 1, costUsd: 0, result: null };
      },
    };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => runner,
      env: { VENATOR_ACME_API_KEY: PLAIN },
    });
    t.receive({ v: 1, type: "start", cwd });
    await done;
    expect(JSON.stringify(t.sent)).not.toContain(PLAIN);
  });
});
