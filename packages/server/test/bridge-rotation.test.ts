import type { PendingApproval } from "@warband/core";
import type { EngineController, EngineControllerOptions } from "@warband/vscode/logic/controller";
import { describe, expect, it, vi } from "vitest";
import { buildChatDeps } from "../src/bridge/deps.js";
import { RESUME_TEXT } from "../src/bridge/rotation.js";
import { parseShellControl } from "../src/bridge/shell-messages.js";
import { approval, type Msg, setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();
const K1 = "ocz-valeur-cle-un-AAAA1111";
const K2 = "ocz-valeur-cle-deux-BBBB2222";
const K3 = "ocz-valeur-cle-trois-CCCC3333";
const VALUES = [K1, K2, K3];

const quota = { kind: "error", code: "provider.error", params: { name: "QuotaExceeded" } };
const authFailed = { kind: "error", code: "provider.authFailed", params: { provider: "opencode" } };

/** Moteur factice dont `abort` termine le processus, comme le vrai moteur. */
function engineFactory() {
  const engines: {
    options: EngineControllerOptions;
    start?: Record<string, unknown>;
    prompts: unknown[][];
    answers: unknown[][];
    emit(e: Record<string, unknown>): void;
  }[] = [];
  const createController = (options: EngineControllerOptions): EngineController => {
    const e = {
      options,
      prompts: [] as unknown[][],
      answers: [] as unknown[][],
      emit: (ev: Record<string, unknown>) => options.handlers?.onEvent?.(ev as never),
    } as (typeof engines)[number];
    return {
      start: async (p) => {
        e.start = p as unknown as Record<string, unknown>;
        engines.push(e);
      },
      models: async () => [{ value: "opencode/modele", displayName: "Modèle" }],
      prompt: (...a) => void e.prompts.push(a),
      answer: (...a) => void e.answers.push(a),
      abort: () => void setTimeout(() => options.handlers?.onExit?.({ code: 0, signal: null }), 0),
      dispose: () => undefined,
      kill: () => undefined,
      bypass: () => 1,
      exited: Promise.resolve(),
    };
  };
  return { engines, createController };
}

async function scene(keys: string[]) {
  ctx.storage.state.set("prefs.chat.f1", { provider: "opencode" });
  const { engines, createController } = engineFactory();
  const t = setup(ctx, { createController });
  const shell = shellOf(t);
  const chat = t.connect();
  for (const [i, value] of keys.entries())
    shell.say("shell", "shell", {
      type: "poolAdd",
      provider: "opencode",
      label: `gratuit-${i + 1}`,
      value,
    });
  await vi.waitFor(() => expect(shell.of("shell", "pool")).toHaveLength(keys.length));
  chat.say("chat", "f1", { type: "ready" });
  chat.say("chat", "f1", { type: "send", text: "bonjour" });
  await vi.waitFor(() => expect(engines[0]?.prompts).toHaveLength(1));
  engines[0]?.emit({ kind: "session.started", sessionId: "S1", model: "m", tools: [] });
  const events = () =>
    shell.of("shell", "poolEvent").map((e) => `${e.msg.phase}:${e.msg.from}>${e.msg.to}`);
  return { t, shell, chat, engines, events };
}

/** Tout ce qui est émis (sockets, audit, paramètres de démarrage) ne contient aucune valeur de clé. */
function expectNoKeyValue(s: Awaited<ReturnType<typeof scene>>) {
  const out = JSON.stringify([
    s.shell.sent,
    s.chat.sent,
    s.t.audit,
    s.engines.map((e) => [e.start, e.prompts, e.answers]),
  ]);
  for (const v of VALUES) expect(out).not.toContain(v);
}

describe("bascule de clé (OpenCode, réserve)", () => {
  it("le moteur démarre avec la clé active, par l'environnement seulement", async () => {
    const s = await scene([K1, K2]);
    expect(s.engines[0]?.options.auth).toEqual({ name: "OPENCODE_API_KEY", value: K1 });
    expect(s.engines[0]?.start?.provider).toBe("opencode");
    expect(JSON.stringify(s.engines[0]?.start)).not.toContain(K1);
    expectNoKeyValue(s);
  });

  it("quota atteint : clé 1 épuisée, relance avec la clé 2 sur la même session, reprise envoyée une fois, puis confirmée", async () => {
    const s = await scene([K1, K2, K3]);
    s.engines[0]?.emit(quota);
    await vi.waitFor(() => expect(s.engines).toHaveLength(2));
    await vi.waitFor(() => expect(s.engines[1]?.prompts).toHaveLength(1));
    const second = s.engines[1];
    expect(second?.options.auth).toEqual({ name: "OPENCODE_API_KEY", value: K2 });
    expect(second?.start?.resume).toBe("S1");
    expect(second?.prompts[0]?.[0]).toBe(RESUME_TEXT);
    const pool = s.shell.of("shell", "pool").at(-1)?.msg as Msg;
    expect((pool.keys as Msg[])[0]).toMatchObject({ label: "gratuit-1", state: "exhausted" });
    expect(s.events()).toEqual(["switched:gratuit-1>gratuit-2"]);

    second?.emit({ kind: "session.started", sessionId: "S1", model: "m", tools: [] });
    second?.emit({ kind: "agent.text", text: "je reprends" });
    await vi.waitFor(() => expect(s.events()).toContain("confirmed:gratuit-1>gratuit-2"));
    expect(s.t.audit.filter((a) => a.kind === "provider.rotated").map((a) => a.phase)).toEqual([
      "switched",
      "confirmed",
    ]);
    // Une erreur ultérieure du moteur 2 n'est plus une bascule en cours : nouvelle passe normale.
    expect(second?.prompts).toHaveLength(1);
    expectNoKeyValue(s);
  });

  it("authentification échouée sur la clé 2 pendant la vérification : échec puis clé 3", async () => {
    const s = await scene([K1, K2, K3]);
    s.engines[0]?.emit(quota);
    await vi.waitFor(() => expect(s.engines[1]?.prompts).toHaveLength(1));
    s.engines[1]?.emit({ kind: "session.started", sessionId: "S1", model: "m", tools: [] });
    s.engines[1]?.emit(authFailed);
    await vi.waitFor(() => expect(s.engines[2]?.prompts).toHaveLength(1));
    expect(s.engines[2]?.options.auth).toEqual({ name: "OPENCODE_API_KEY", value: K3 });
    expect(s.engines[2]?.start?.resume).toBe("S1");
    expect(s.events()).toEqual([
      "switched:gratuit-1>gratuit-2",
      "failed:gratuit-1>gratuit-2",
      "switched:gratuit-2>gratuit-3",
    ]);
    const pool = s.shell.of("shell", "pool").at(-1)?.msg as Msg;
    expect((pool.keys as Msg[])[1]).toMatchObject({ state: "invalid", retryAt: null });
    expectNoKeyValue(s);
  });

  it("tout épuisé : poolExhausted, mission arrêtée, aucune quatrième relance", async () => {
    const s = await scene([K1, K2]);
    s.engines[0]?.emit(quota);
    await vi.waitFor(() => expect(s.engines[1]?.prompts).toHaveLength(1));
    s.engines[1]?.emit(quota);
    await vi.waitFor(() => expect(s.shell.of("shell", "poolExhausted")).toHaveLength(1));
    const msg = s.shell.of("shell", "poolExhausted")[0]?.msg as Msg;
    expect(msg.provider).toBe("opencode");
    expect(msg.nextRetryAt).toEqual(expect.any(Number));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.engines).toHaveLength(2);
    expect(s.events().at(-1)).toBe("exhausted:gratuit-2>null");
    expect(s.t.audit.at(-1)).toMatchObject({ kind: "provider.rotated", phase: "exhausted" });
    expectNoKeyValue(s);
  });

  it("approbation en attente pendant la bascule : refusée avant l'arrêt, jamais approuvée", async () => {
    const s = await scene([K1, K2]);
    s.engines[0]?.options.handlers?.onApproval?.(approval("t1") as PendingApproval);
    s.engines[0]?.emit(quota);
    await vi.waitFor(() => expect(s.engines[1]?.prompts).toHaveLength(1));
    expect(s.engines[0]?.answers).toEqual([["t1", "deny", undefined]]);
    expect(s.engines[1]?.answers).toEqual([]);
    expect(s.t.hub.approvals()).toEqual([]);
  });

  it("sans réserve : aucune bascule, comportement inchangé", async () => {
    ctx.storage.state.set("prefs.chat.f1", { provider: "opencode" });
    const { engines, createController } = engineFactory();
    const t = setup(ctx, { createController });
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "send", text: "bonjour" });
    await vi.waitFor(() => expect(engines[0]?.prompts).toHaveLength(1));
    expect(engines[0]?.options.auth).toBeUndefined();
    engines[0]?.emit(quota);
    await new Promise((r) => setTimeout(r, 50));
    expect(engines).toHaveLength(1);
  });
});

describe("gestion de la réserve", () => {
  it("poolList ne renvoie jamais de valeur ; réordonner, activer, retirer", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "poolAdd", provider: "opencode", label: "un", value: K1 });
    shell.say("shell", "shell", {
      type: "poolAdd",
      provider: "opencode",
      label: "deux",
      value: K2,
    });
    await vi.waitFor(() => expect(shell.of("shell", "pool")).toHaveLength(2));
    const last = () =>
      shell.of("shell", "pool").at(-1)?.msg as {
        active: string;
        keys: { id: string; label: string }[];
      };
    const [a, b] = last().keys.map((k) => k.id) as [string, string];
    expect(last().active).toBe(a);

    shell.say("shell", "shell", { type: "poolReorder", provider: "opencode", order: [b, a] });
    await vi.waitFor(() => expect(last().keys.map((k) => k.label)).toEqual(["deux", "un"]));
    shell.say("shell", "shell", { type: "poolActivate", provider: "opencode", id: b });
    await vi.waitFor(() => expect(last().active).toBe(b));
    shell.say("shell", "shell", { type: "poolReorder", provider: "opencode", order: [a] });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
    shell.say("shell", "shell", { type: "poolList" });
    await vi.waitFor(() => expect(shell.of("shell", "pool").length).toBeGreaterThan(3));
    expect(JSON.stringify([shell.sent, t.audit])).not.toMatch(/ocz-valeur/);
    shell.say("shell", "shell", { type: "poolRemove", provider: "opencode", id: b });
    await vi.waitFor(() => expect(last().keys.map((k) => k.id)).toEqual([a]));
    expect(last().active).toBe(a);
    expect(await ctx.storage.secrets.get(`pool.opencode.${b}`)).toBeUndefined();
  });

  it("messages invalides refusés", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const bad = (m: Msg) => expect(parseShellControl(m)).toBeNull();
    bad({ type: "poolAdd", provider: "x", label: "a", value: "v" });
    bad({ type: "poolAdd", provider: "opencode", label: "a", value: "v w" });
    bad({ type: "poolAdd", provider: "opencode", label: " a", value: "v" });
    bad({ type: "poolAdd", provider: "opencode", label: "a", value: "v", extra: 1 });
    bad({ type: "poolRemove", provider: "opencode", id: "pas-un-uuid" });
    bad({ type: "poolReorder", provider: "opencode", order: [id, 3] });
    expect(parseShellControl({ type: "poolActivate", provider: "claude", id })).toEqual({
      type: "poolActivate",
      provider: "claude",
      id,
    });
  });

  it("getToken : clé de réserve par fournisseur ; hors réserve, comportement habituel", async () => {
    const mk = (pooled?: string) =>
      buildChatDeps({
        storage: ctx.storage,
        frame: "f1",
        cwd: ctx.dir,
        enginePath: "x",
        engineArgs: [],
        ask: async () => false,
        onView: () => undefined,
        poolKey: async () => (pooled ? { id: "i", value: pooled } : undefined),
      });
    expect(await mk(K1).getToken("opencode")).toEqual({
      auth: { name: "OPENCODE_API_KEY", value: K1 },
      mode: "auto",
    });
    expect(await mk(K1).getToken("openai")).toEqual({
      auth: { name: "OPENAI_API_KEY", value: K1 },
      mode: "api-key",
    });
    expect(await mk(K1).getToken("claude")).toMatchObject({ auth: { name: "ANTHROPIC_API_KEY" } });
    expect(await mk().getToken("opencode")).toEqual({ mode: "auto" });
  });
});
