import type { EngineEvent } from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCampaignActive } from "../src/logic/campaign-host.js";
import { createCampaignSpawner } from "../src/logic/campaign-spawn.js";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import { createChatSession, type TokenChoice } from "../src/logic/session.js";
import {
  pickVaultChoice,
  type RotationAdviceContext,
  rotateAfterFailure,
  rotationAdvice,
} from "../src/logic/vault-launch.js";
import { createVaultStore, type SecretsLike } from "../src/logic/vault-store.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const KEYS = ["sk-ant-advice-key-one-1111", "sk-ant-advice-key-two-2222"];

interface FakeCtl extends EngineController {
  handlers: EngineHandlers;
  calls: unknown[][];
}

function makeFactory() {
  const ctls: FakeCtl[] = [];
  const create = (options: EngineControllerOptions): EngineController => {
    const calls: unknown[][] = [];
    const ctl: FakeCtl = {
      handlers: options.handlers ?? {},
      calls,
      start: async () => void calls.push(["start"]),
      models: async () => [],
      prompt: (text) => void calls.push(["prompt", text]),
      answer: () => {},
      abort: () => {},
      dispose: () => {},
      kill: () => void calls.push(["kill"]),
      bypass: () => 0,
      campaignResult: () => {},
      exited: Promise.resolve(),
    };
    ctls.push(ctl);
    return ctl;
  };
  return { ctls, create };
}

function memoryStore(keys: string[], provider = "claude") {
  const data = new Map<string, string>();
  const secrets: SecretsLike = {
    get: async (key) => data.get(key),
    store: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
  const store = createVaultStore(secrets, { now: () => NOW });
  const ready = (async () => {
    for (const key of keys) await store.add(provider, key);
  })();
  return { store, ready };
}

const ev = (e: Record<string, unknown>) =>
  ({ v: 1, id: "e", seq: 1, ts: "", runId: "r", parentId: null, ...e }) as unknown as EngineEvent;
const quotaError = (message = "Too many requests") =>
  ev({
    kind: "error",
    code: "provider.error",
    params: { status: 429, name: "APIError", code: "APIError", message },
  });
const turnFailed = () => ev({ kind: "turn.finished", status: "error", turns: 1, costUsd: 0 });

const ADVICE_EMPTY = "Aucune clé dans le coffre Claude : la rotation n'est pas possible.";
const ADVICE_ONE = "Une seule clé dans le coffre Claude : aucune autre clé vers laquelle basculer.";
const ADVICE_SUB = "Jeton d'abonnement : pas de rotation possible.";
const ADVICE_FREE = "Le quota des modèles gratuits peut être commun";

function chat(
  f: ReturnType<typeof makeFactory>,
  keys: string[],
  opts: { subscription?: boolean; model?: string } = {},
) {
  const mem = memoryStore(keys);
  let view!: ChatView;
  const store = new Map<string, unknown>();
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: ["/ext"],
    readSettings: () => (opts.model !== undefined ? { model: opts.model } : {}),
    getToken: async (_provider, hint): Promise<TokenChoice | undefined> => {
      await mem.ready;
      if (opts.subscription)
        return { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "oauth-token-x" }, mode: "auto" };
      return (
        (await pickVaultChoice(mem.store, "claude", NOW, {
          launch: hint?.launch === true,
          ...(hint?.afterKeyId !== undefined && { afterKeyId: hint.afterKeyId }),
        })) ?? undefined
      );
    },
    vault: { store: mem.store, now: () => NOW },
    confirmAlways: async () => false,
    onView: (v) => {
      view = v;
    },
    createController: f.create,
    sdkVersion: "1.0.0",
    store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
  });
  return { session, view: () => view };
}

const sessions: { dispose(): void }[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  expect(isCampaignActive()).toBe(false);
});

const notices = (view: ChatView) => view.items.flatMap((i) => (i.kind === "notice" ? [i] : []));
const adviceTexts = (view: ChatView) =>
  notices(view)
    .filter((n) => n.action === "openKeys")
    .map((n) => n.text);

async function failTurn(f: ReturnType<typeof makeFactory>, message?: string) {
  const ctl = f.ctls[0] as FakeCtl;
  ctl.handlers.onEvent?.(quotaError(message));
  ctl.handlers.onEvent?.(turnFailed());
}

describe("rotationAdvice (pur)", () => {
  const ctx = (c: Partial<RotationAdviceContext> = {}): RotationAdviceContext => ({
    subscription: false,
    provider: "opencode",
    ...c,
  });
  const quota = { status: 429 };

  it("aucun avis pour un échec « other »", () => {
    expect(rotationAdvice(ctx(), { status: 500 }, 0)).toBeUndefined();
  });

  it("coffre vide, libellé lisible du fournisseur", () => {
    const text = rotationAdvice(ctx(), quota, 0);
    expect(text).toContain("Aucune clé dans le coffre OpenCode");
    expect(text).toContain("Réglages › Fournisseurs › OpenCode › Clés.");
  });

  it("une clé, deux clés (aucun avis)", () => {
    expect(rotationAdvice(ctx({ provider: "openai" }), quota, 1)).toContain(
      "Une seule clé dans le coffre OpenAI",
    );
    expect(rotationAdvice(ctx(), quota, 2)).toBeUndefined();
  });

  it("abonnement et fournisseur sans coffre", () => {
    expect(rotationAdvice(ctx({ subscription: true, provider: "claude" }), quota, 0)).toBe(
      ADVICE_SUB,
    );
    const { provider: _p, ...none } = ctx();
    expect(rotationAdvice(none, quota, 0)).toBe(ADVICE_SUB);
  });

  it("modèle gratuit : identifiant avec « free » (insensible à la casse) ou message Free usage exceeded", () => {
    expect(rotationAdvice(ctx({ model: "opencode/Big-FREE" }), quota, 0)).toContain(ADVICE_FREE);
    expect(
      rotationAdvice(ctx(), { status: 429, message: "Free usage exceeded, subscribe" }, 0),
    ).toContain(ADVICE_FREE);
    expect(rotationAdvice(ctx({ model: "opencode/gpt" }), quota, 0)).not.toContain(ADVICE_FREE);
  });
});

describe("chat : avis quand la rotation est impossible", () => {
  it("coffre vide : avis « Aucune clé… » avec bouton, après l'erreur", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, []);
    sessions.push(session);
    await session.send("bonjour");
    await failTurn(f);
    await vi.waitFor(() => expect(adviceTexts(view())).toHaveLength(1));
    expect(adviceTexts(view())[0]).toContain(ADVICE_EMPTY);
    expect(adviceTexts(view())[0]).not.toContain(ADVICE_FREE);
    expect(f.ctls).toHaveLength(1);
  });

  it("une seule clé : avis « Une seule clé… »", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, [KEYS[0] ?? ""]);
    sessions.push(session);
    await session.send("bonjour");
    await failTurn(f);
    await vi.waitFor(() => expect(adviceTexts(view())).toHaveLength(1));
    expect(adviceTexts(view())[0]).toContain(ADVICE_ONE);
    for (const key of KEYS) expect(JSON.stringify(view())).not.toContain(key);
  });

  it("abonnement : avis dédié", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, [], { subscription: true });
    sessions.push(session);
    await session.send("bonjour");
    await failTurn(f);
    await vi.waitFor(() => expect(adviceTexts(view())).toEqual([ADVICE_SUB]));
  });

  it("modèle gratuit : phrase ajoutée (identifiant et message)", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, [], { model: "opencode/some-FREE-model" });
    sessions.push(session);
    await session.send("bonjour");
    await failTurn(f);
    await vi.waitFor(() => expect(adviceTexts(view())).toHaveLength(1));
    expect(adviceTexts(view())[0]).toContain(ADVICE_EMPTY);
    expect(adviceTexts(view())[0]).toContain(ADVICE_FREE);

    const g = makeFactory();
    const other = chat(g, []);
    sessions.push(other.session);
    await other.session.send("bonjour");
    await failTurn(g, "Free usage exceeded");
    await vi.waitFor(() => expect(adviceTexts(other.view())).toHaveLength(1));
    expect(adviceTexts(other.view())[0]).toContain(ADVICE_FREE);
  });

  it("deux clés : rotation normale, aucun de ces avis", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, KEYS);
    sessions.push(session);
    await session.send("bonjour");
    await failTurn(f);
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    expect(adviceTexts(view())).toEqual([]);
  });

  it("échec hors quota ou clé : aucun avis", async () => {
    const f = makeFactory();
    const { session, view } = chat(f, []);
    sessions.push(session);
    await session.send("bonjour");
    const ctl = f.ctls[0] as FakeCtl;
    ctl.handlers.onEvent?.(
      ev({ kind: "error", code: "provider.error", params: { status: 500, message: "boom" } }),
    );
    ctl.handlers.onEvent?.(turnFailed());
    await new Promise((r) => setTimeout(r, 20));
    expect(adviceTexts(view())).toEqual([]);
  });
});

describe("chat : puce « sans clé du coffre »", () => {
  it("vaultEmpty vrai quand le coffre du fournisseur est vide, absent avec une clé", async () => {
    const f = makeFactory();
    const empty = chat(f, []);
    sessions.push(empty.session);
    await empty.session.send("bonjour");
    await vi.waitFor(() => expect(empty.view().vaultEmpty).toBe(true));

    const g = makeFactory();
    const keyed = chat(g, [KEYS[0] ?? ""]);
    sessions.push(keyed.session);
    await keyed.session.send("bonjour");
    await new Promise((r) => setTimeout(r, 20));
    expect(keyed.view().vaultEmpty).toBeUndefined();
  });
});

describe("campagne : avis unique par fournisseur", () => {
  const spec = (index: number) => ({
    runId: "11111111-1111-4111-8111-111111111111",
    role: "worker" as const,
    index,
    multiAgent: {
      role: "worker" as const,
      runId: "11111111-1111-4111-8111-111111111111",
      intent: { id: `i${index}`, title: "Injection SQL", rationale: "r" },
    },
    prompt: "fais ceci",
  });

  it("deux workers en échec sur un coffre vide : un seul avis", async () => {
    const f = makeFactory();
    const mem = memoryStore([]);
    const advised: string[] = [];
    const seen = new Set<string>();
    const spawn = createCampaignSpawner({
      make: f.create,
      options: { enginePath: "/e", args: [], cwd: "/w" },
      resolve: async () => ({
        params: { cwd: "/w" },
        advice: { subscription: false, provider: "claude" },
      }),
      vault: {
        rotate: (pick, failure) => rotateAfterFailure(mem.store, pick, failure, NOW),
        keyCount: async (provider) => (await mem.store.get(provider)).keys.length,
        advise: async (context, failure) => {
          const text = rotationAdvice(context, failure, 0);
          if (text === undefined || seen.has(context.provider ?? "")) return;
          seen.add(context.provider ?? "");
          advised.push(text);
        },
      },
    });
    for (const index of [1, 2]) {
      const handle = spawn(spec(index));
      handle.onMessage(() => {});
      await vi.waitFor(() => expect(f.ctls).toHaveLength(index));
      const ctl = f.ctls[index - 1] as FakeCtl;
      ctl.handlers.onEvent?.(quotaError());
      ctl.handlers.onEvent?.(turnFailed());
      ctl.handlers.onEnded?.({ status: "error", turns: 1, costUsd: 0, result: null });
      await vi.waitFor(() => expect(advised.length).toBeGreaterThan(0));
      handle.stop();
    }
    expect(advised).toHaveLength(1);
    expect(advised[0]).toContain(ADVICE_EMPTY);
  });
});
