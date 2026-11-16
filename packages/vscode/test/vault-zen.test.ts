import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveServerEnv, zenAuthContent } from "@warband/agent-opencode";
import { type AgentRunner, type EngineEvent, fingerprint } from "@warband/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  effectiveKey,
  opencodeCredentialOptions,
  opencodeProviderConfig,
} from "../src/engine/credentials.js";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import { isCampaignActive } from "../src/logic/campaign-host.js";
import type { ChatView } from "../src/logic/chat.js";
import {
  buildEngineEnv,
  type EngineController,
  type EngineControllerOptions,
  type EngineHandlers,
} from "../src/logic/controller.js";
import { type FromEngine, parseToEngine, type StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";
import { parseStudioMessage } from "../src/logic/studio.js";
import { importOpencodeKey } from "../src/logic/vault-import.js";
import { createKeyGuard, pickVaultChoice } from "../src/logic/vault-launch.js";
import { createVaultStore, type SecretsLike } from "../src/logic/vault-store.js";
import { vaultView } from "../src/logic/vault-view.js";

// Valeurs sans motif de clé usuel : seul le masquage par valeur peut les retirer.
const ONE = "zzzen-key-one-0123456789";
const TWO = "zzzen-key-two-9876543210";
const VAULT = { provider: "opencode", name: "OPENCODE_API_KEY", rank: 1 } as const;
const NOW = new Date("2026-11-16T12:00:00.000Z");

function memorySecrets() {
  const data = new Map<string, string>();
  const secrets: SecretsLike = {
    get: async (key) => data.get(key),
    store: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
  return { secrets, data };
}

function zenStore(enabled = true) {
  const mem = memorySecrets();
  const store = createVaultStore(mem.secrets, { now: () => NOW, zenEnabled: () => enabled });
  return { ...mem, store };
}

describe("coffre : OpenCode Zen éligible dès que OpenCode est activé", () => {
  it("supports(opencode) vrai avec OpenCode actif, faux sinon ; les autres fournisseurs inchangés", () => {
    expect(zenStore(true).store.supports("opencode")).toBe(true);
    expect(zenStore(false).store.supports("opencode")).toBe(false);
    expect(createVaultStore(memorySecrets().secrets).supports("opencode")).toBe(false);
    const off = zenStore(false).store;
    expect(off.supports("claude")).toBe(true);
    expect(off.supports("autre")).toBe(false);
  });

  it("désactivé : le coffre reste accessible au masquage (allValues), jamais à l'usage", async () => {
    let enabled = true;
    const mem = memorySecrets();
    const store = createVaultStore(mem.secrets, { zenEnabled: () => enabled });
    await store.add("opencode", ONE);
    enabled = false;
    await expect(store.get("opencode")).rejects.toThrow();
    expect(await store.allValues()).toContain(ONE);
  });
});

describe("transmission par OPENCODE_AUTH_CONTENT", () => {
  const processEnv = { PATH: "/bin", OPENCODE_API_KEY: ONE, VENATOR_X_API_KEY: TWO };

  it("la clé du coffre devient OPENCODE_AUTH_CONTENT ; aucune variable *_API_KEY ne passe", async () => {
    const options = opencodeCredentialOptions("opencode", VAULT);
    expect(options).toMatchObject({ isolateConfig: true, zenKeyEnv: "OPENCODE_API_KEY" });
    expect(options).not.toHaveProperty("passEnv");
    const env = await effectiveServerEnv({ ...options, processEnv }, "auto");
    expect(env.OPENCODE_AUTH_CONTENT).toBe(zenAuthContent(ONE));
    expect(JSON.parse(env.OPENCODE_AUTH_CONTENT ?? "")).toEqual({
      opencode: { type: "api", key: ONE },
    });
    expect(env).not.toHaveProperty("OPENCODE_API_KEY");
    expect(env).not.toHaveProperty("VENATOR_X_API_KEY");
  });

  it("un OPENCODE_AUTH_CONTENT de l'environnement source est écarté au profit de la clé du coffre", async () => {
    const env = await effectiveServerEnv(
      {
        ...opencodeCredentialOptions("opencode", VAULT),
        passEnv: ["OPENCODE_AUTH_CONTENT"],
        processEnv: {
          ...processEnv,
          OPENCODE_AUTH_CONTENT: '{"opencode":{"type":"api","key":"x"}}',
        },
      },
      "auto",
    );
    expect(env.OPENCODE_AUTH_CONTENT).toBe(zenAuthContent(ONE));
  });

  it("la clé effective est extraite de l'environnement FINAL", async () => {
    const params: StartParams = { cwd: "/w", provider: "opencode", auth: "auto", vault: VAULT };
    expect(await effectiveKey(params, processEnv)).toEqual({ provider: "opencode", value: ONE });
    // Environnement de l'enfant tel que l'hôte le construit : la valeur n'y est que sous son nom de coffre.
    const child = buildEngineEnv({ name: "OPENCODE_API_KEY", value: ONE }, {});
    expect(child.OPENCODE_API_KEY).toBe(ONE);
    expect((await effectiveKey(params, child))?.value).toBe(ONE);
  });

  it("clé du coffre annoncée mais absente de l'environnement : aucune clé effective (échec fermé côté moteur)", async () => {
    const params: StartParams = { cwd: "/w", provider: "opencode", auth: "auto", vault: VAULT };
    expect(await effectiveKey(params, { PATH: "/bin" })).toBeUndefined();
  });

  it("sans coffre, rien ne change : ni zenKeyEnv, ni OPENCODE_AUTH_CONTENT, ni clé effective", async () => {
    const options = opencodeCredentialOptions("opencode", undefined);
    expect(options).not.toHaveProperty("zenKeyEnv");
    expect(options).not.toHaveProperty("passEnv");
    const env = await effectiveServerEnv({ ...options, processEnv }, "auto");
    expect(env).not.toHaveProperty("OPENCODE_AUTH_CONTENT");
    expect(
      await effectiveKey({ cwd: "/w", provider: "opencode", auth: "auto" }, processEnv),
    ).toBeUndefined();
  });

  it("un fournisseur OpenCode configuré garde le chemin passEnv", () => {
    const vault = { provider: "venator-acme", name: "VENATOR_ACME_API_KEY", rank: 1 };
    expect(opencodeCredentialOptions("opencode", vault)).toMatchObject({
      passEnv: ["VENATOR_ACME_API_KEY"],
    });
    expect(opencodeProviderConfig({}, VAULT)).toEqual({});
  });

  it("le protocole accepte une clé de coffre Zen dans start, sans valeur ni empreinte", () => {
    const start = (vault: unknown) => parseToEngine({ v: 1, type: "start", cwd: "/w", vault });
    expect(start(VAULT).ok).toBe(true);
    expect(start({ ...VAULT, value: ONE }).ok).toBe(false);
  });
});

describe("garde de l'hôte (échec fermé)", () => {
  const providerKey = (fp: string) =>
    ({
      kind: "provider.key",
      provider: "opencode",
      keyRank: 1,
      fingerprint: fp,
      source: "vault",
    }) as unknown as EngineEvent;
  const action = { kind: "agent.text", text: "x" } as unknown as EngineEvent;

  it("empreinte identique : le run continue", () => {
    const guard = createKeyGuard(fingerprint(ONE));
    expect(guard.observe(providerKey(fingerprint(ONE)))).toBe(false);
    expect(guard.observe(action)).toBe(false);
  });

  it("empreinte différente : arrêt", () => {
    const guard = createKeyGuard(fingerprint(ONE));
    expect(guard.observe(providerKey(fingerprint(TWO)))).toBe(true);
  });

  it("aucune empreinte annoncée avant d'agir : arrêt", () => {
    expect(createKeyGuard(fingerprint(ONE)).observe(action)).toBe(true);
  });
});

describe("masquage de la valeur nue dans le journal du moteur", () => {
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
  let cwd: string;
  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "warband-zen-"));
  });
  afterAll(() => rm(cwd, { recursive: true, force: true }));

  it("la clé effective est masquée seule et dans le JSON d'OPENCODE_AUTH_CONTENT, sans l'avoir dans l'environnement", async () => {
    const t = fakeChannel();
    const runner: AgentRunner = {
      run: async (_input, ctx) => {
        ctx.recorder.emit({ kind: "agent.text", text: `clé nue ${ONE}` });
        ctx.recorder.emit({ kind: "agent.text", text: `json ${zenAuthContent(ONE)}` });
        return { status: "success", turns: 1, costUsd: 0, result: `fin ${ONE}` };
      },
    };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => runner,
      env: {},
      effectiveKey: async () => ({ provider: "opencode", value: ONE }),
    });
    t.receive({ v: 1, type: "start", cwd, provider: "opencode", vault: VAULT });
    expect(await done).toBe(0);
    const text = JSON.stringify(t.sent);
    expect(text).not.toContain(ONE);
    expect(text).toContain("[REDACTED]");
    expect(t.sent.some((m) => m.type === "ended")).toBe(true);
  });
});

describe("import explicite depuis auth.json", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });
  async function authFile(content?: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "warband-import-"));
    roots.push(root);
    await mkdir(join(root, "opencode"));
    const file = join(root, "opencode", "auth.json");
    if (content !== undefined) await writeFile(file, content);
    return file;
  }
  const OTHER = "zzother-provider-secret-555";

  it("ajoute l'entrée opencode de type api ; les autres entrées ne sont jamais retenues", async () => {
    const { store, data } = zenStore();
    const file = await authFile(
      JSON.stringify({
        opencode: { type: "api", key: ONE },
        openai: { type: "api", key: OTHER },
        anthropic: { type: "oauth", refresh: OTHER, access: OTHER },
      }),
    );
    const outcome = await importOpencodeKey(store, file);
    expect(outcome).toEqual({ kind: "added" });
    const vault = await store.get("opencode");
    expect(vault.keys.map((k) => k.value)).toEqual([ONE]);
    // Rien d'autre dans le coffre ni dans le stockage, et aucune valeur dans le résultat.
    expect(JSON.stringify([...data.values()])).not.toContain(OTHER);
    expect(JSON.stringify(outcome)).not.toContain(ONE);
    expect(JSON.stringify(vaultView(vault))).not.toContain(ONE);
  });

  it("doublon : déjà dans le coffre, rien n'est ajouté", async () => {
    const { store } = zenStore();
    await store.add("opencode", ONE);
    const file = await authFile(JSON.stringify({ opencode: { type: "api", key: ONE } }));
    expect(await importOpencodeKey(store, file)).toEqual({ kind: "duplicate" });
    expect((await store.get("opencode")).keys).toHaveLength(1);
  });

  it("fichier absent : missingFile", async () => {
    const { store } = zenStore();
    const file = await authFile();
    expect(await importOpencodeKey(store, file)).toEqual({ kind: "missingFile" });
    expect((await store.get("opencode")).keys).toEqual([]);
  });

  it.each([
    ["entrée absente", JSON.stringify({ openai: { type: "api", key: OTHER } })],
    ["entrée oauth", JSON.stringify({ opencode: { type: "oauth", access: OTHER } })],
    ["JSON invalide", "pas du json"],
    ["clé vide", JSON.stringify({ opencode: { type: "api", key: "" } })],
  ])("%s : missingEntry, coffre inchangé", async (_name, content) => {
    const { store } = zenStore();
    const file = await authFile(content);
    expect(await importOpencodeKey(store, file)).toEqual({ kind: "missingEntry" });
    expect((await store.get("opencode")).keys).toEqual([]);
  });

  it("fichier illisible : missingEntry", async () => {
    if (process.getuid?.() === 0) return; // root lit tout
    const { store } = zenStore();
    const file = await authFile(JSON.stringify({ opencode: { type: "api", key: ONE } }));
    await chmod(file, 0o000);
    expect(await importOpencodeKey(store, file)).toEqual({ kind: "missingEntry" });
  });

  it("message de la webview : un seul champ, aucune valeur acceptée", () => {
    expect(parseStudioMessage({ type: "vaultImportOpencode" })).toEqual({
      type: "vaultImportOpencode",
    });
    for (const extra of [{ value: ONE }, { key: ONE }, { provider: "opencode" }, { path: "/x" }])
      expect(parseStudioMessage({ type: "vaultImportOpencode", ...extra })).toBeNull();
  });
});

describe("rotation sur « Free usage exceeded »", () => {
  interface FakeCtl extends EngineController {
    handlers: EngineHandlers;
    options: EngineControllerOptions;
    started?: StartParams;
    calls: unknown[][];
  }
  const ctls: FakeCtl[] = [];
  const create = (options: EngineControllerOptions): EngineController => {
    const calls: unknown[][] = [];
    const ctl: FakeCtl = {
      handlers: options.handlers ?? {},
      options,
      calls,
      start: async (params) => {
        ctl.started = params;
        calls.push(["start"]);
      },
      models: async () => [],
      prompt: (text) => void calls.push(["prompt", text]),
      answer: (...a) => void calls.push(["answer", ...a]),
      abort: () => void calls.push(["abort"]),
      dispose: () => void calls.push(["dispose"]),
      kill: () => void calls.push(["kill"]),
      bypass: (state) => {
        calls.push(["bypass", state]);
        return calls.filter((c) => c[0] === "bypass").length;
      },
      campaignResult: (r) => void calls.push(["campaignResult", r]),
      exited: Promise.resolve(),
    };
    ctls.push(ctl);
    return ctl;
  };
  const ev = (e: Record<string, unknown>) =>
    ({ v: 1, id: "e", seq: 1, ts: "", runId: "r", parentId: null, ...e }) as unknown as EngineEvent;
  const sessions: { dispose(): void }[] = [];
  afterEach(() => {
    ctls.length = 0;
    for (const s of sessions.splice(0)) s.dispose();
    expect(isCampaignActive()).toBe(false);
  });

  it("le quota Zen fait tourner vers la clé 2 : nouvel environnement avec la clé 2 seule, clé 1 épuisée", async () => {
    const { store } = zenStore();
    await store.add("opencode", ONE);
    await store.add("opencode", TWO);
    let view!: ChatView;
    const prefs = new Map<string, unknown>([
      ["warband.prefs.chat.default", { provider: "opencode", model: "opencode/big-pickle" }],
    ]);
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: ["/ext"],
      readSettings: () =>
        ({
          capabilities: {
            providers: ["oc-opencode"],
            skills: [],
            integrations: [],
            webSearch: false,
          },
          providerCatalog: [{ id: "opencode", name: "OpenCode Zen", connected: true }],
        }) as never,
      getToken: async (_provider, hint) =>
        hint?.vaultProvider === "opencode"
          ? ((await pickVaultChoice(store, "opencode", NOW, {
              launch: hint.launch === true,
              ...(hint.afterKeyId !== undefined && { afterKeyId: hint.afterKeyId }),
            })) ?? { mode: "auto" })
          : { mode: "auto" },
      vault: { store, now: () => NOW },
      confirmAlways: async () => false,
      onView: (v) => {
        view = v;
      },
      createController: create,
      sdkVersion: "1.0.0",
      store: { get: (k) => prefs.get(k), set: (k, v) => prefs.set(k, v) },
    });
    sessions.push(session);
    await session.send("bonjour");
    const first = ctls[0] as FakeCtl;
    expect(first.started?.vault).toEqual({
      provider: "opencode",
      name: "OPENCODE_API_KEY",
      rank: 1,
    });
    first.handlers.onEvent?.(
      ev({
        kind: "provider.key",
        provider: "opencode",
        keyRank: 1,
        fingerprint: fingerprint(ONE),
        source: "vault",
      }),
    );
    first.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "s-1", model: "m" }));
    // Forme exacte émise par l'adaptateur pour « Free usage exceeded ».
    first.handlers.onEvent?.(
      ev({
        kind: "error",
        code: "provider.error",
        params: {
          name: "QuotaExceeded",
          code: "QuotaExceeded",
          message: "Le quota gratuit OpenCode Zen est épuisé.",
        },
      }),
    );
    first.handlers.onEvent?.(ev({ kind: "turn.finished", status: "error", turns: 1, costUsd: 0 }));
    await vi.waitFor(() => expect(ctls).toHaveLength(2));
    const second = ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(second.started).toBeDefined());
    expect(second.started?.vault).toMatchObject({ provider: "opencode", rank: 2 });
    const env = buildEngineEnv(second.options.auth, {});
    expect(env.OPENCODE_API_KEY).toBe(TWO);
    expect(Object.values(env)).not.toContain(ONE);
    // Environnement final du serveur : seule la clé 2, dans OPENCODE_AUTH_CONTENT.
    const server = await effectiveServerEnv(
      { ...opencodeCredentialOptions("opencode", second.started?.vault), processEnv: env },
      "auto",
    );
    expect(server.OPENCODE_AUTH_CONTENT).toBe(zenAuthContent(TWO));
    expect(JSON.stringify(server)).not.toContain(ONE);
    expect((await store.get("opencode")).keys.map((k) => k.state)).toEqual(["exhausted", "active"]);
    // Aucune valeur dans la vue sérialisée.
    expect(JSON.stringify(view)).not.toContain(ONE);
    expect(JSON.stringify(view)).not.toContain(TWO);
    expect(JSON.stringify(vaultView(await store.get("opencode")))).not.toMatch(/zzzen/);
  });
});
