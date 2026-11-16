import type { EngineEvent } from "@warband/core";
import { fingerprint } from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCampaignActive } from "../src/logic/campaign-host.js";
import { createCampaignSpawner } from "../src/logic/campaign-spawn.js";
import type { ChatView } from "../src/logic/chat.js";
import {
  buildEngineEnv,
  type EngineController,
  type EngineControllerOptions,
  type EngineHandlers,
} from "../src/logic/controller.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";
import {
  pickVaultChoice,
  ROTATION_RESUME_PROMPT,
  rotateAfterFailure,
} from "../src/logic/vault-launch.js";
import { createVaultStore, type SecretsLike } from "../src/logic/vault-store.js";

const KEYS = [
  "sk-ant-vault-key-one-1111",
  "sk-ant-vault-key-two-2222",
  "sk-ant-vault-key-three-3333",
];
const NOW = new Date("2026-11-16T12:00:00.000Z");

/** Contrôleur factice : le test joue le moteur. */
interface FakeCtl extends EngineController {
  handlers: EngineHandlers;
  options: EngineControllerOptions;
  started?: StartParams;
  calls: unknown[][];
}

function makeFactory() {
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
  return { ctls, create };
}

function memoryStore(keys: string[]) {
  const data = new Map<string, string>();
  const secrets: SecretsLike = {
    get: async (key) => data.get(key),
    store: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
  const store = createVaultStore(secrets, { now: () => NOW });
  const ready = (async () => {
    for (const key of keys) await store.add("claude", key);
  })();
  return { store, ready, data };
}

const ev = (e: Record<string, unknown>) =>
  ({ v: 1, id: "e", seq: 1, ts: "", runId: "r", parentId: null, ...e }) as unknown as EngineEvent;
const sessionStarted = (id = "sess-1") =>
  ev({ kind: "session.started", sessionId: id, model: "m" });
const quotaError = () =>
  ev({
    kind: "error",
    code: "provider.error",
    params: { status: 429, name: "APIError", code: "APIError", message: "Too many requests" },
  });
const turnFailed = () => ev({ kind: "turn.finished", status: "error", turns: 1, costUsd: 0 });
const providerKey = (value: string) =>
  ev({
    kind: "provider.key",
    provider: "claude",
    keyRank: 1,
    fingerprint: fingerprint(value),
    source: "vault",
  });

function chat(f: ReturnType<typeof makeFactory>, keys: string[] = KEYS) {
  const mem = memoryStore(keys);
  let view!: ChatView;
  const observed: (EngineEvent | null)[] = [];
  const store = new Map<string, unknown>();
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: ["/ext"],
    readSettings: () => ({}),
    getToken: async (_provider, hint) => {
      await mem.ready;
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
    onObservedEvent: (e) => void observed.push(e),
    createController: f.create,
    sdkVersion: "1.0.0",
    store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
  });
  return { session, view: () => view, mem, observed };
}

const sessions: { dispose(): void }[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  expect(isCampaignActive()).toBe(false);
});

const noticeTexts = (view: ChatView) =>
  view.items.flatMap((i) => (i.kind === "notice" ? [i.text] : []));
const states = async (mem: ReturnType<typeof memoryStore>) =>
  (await mem.store.get("claude")).keys.map((k) => k.state);

describe("chat : lancement et vérification de la clé effective", () => {
  it("lance le moteur avec la première clé du coffre ; start ne porte ni valeur ni empreinte", async () => {
    const f = makeFactory();
    const { session } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const ctl = f.ctls[0] as FakeCtl;
    expect(ctl.options.auth).toEqual({ name: "ANTHROPIC_API_KEY", value: KEYS[0] });
    expect(ctl.started?.vault).toEqual({ provider: "claude", name: "ANTHROPIC_API_KEY", rank: 1 });
    const start = JSON.stringify(ctl.started);
    for (const key of KEYS) expect(start).not.toContain(key);
    expect(start).not.toContain(fingerprint(KEYS[0] ?? ""));
  });

  it("une empreinte annoncée par le moteur différente de celle attendue : moteur arrêté, vault.keyMismatch, aucune relance", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const ctl = f.ctls[0] as FakeCtl;
    ctl.handlers.onEvent?.(providerKey(KEYS[1] ?? ""));
    expect(ctl.calls).toContainEqual(["kill"]);
    expect(noticeTexts(view()).join("\n")).toContain("ne correspond pas à la clé choisie");
    expect(view().busy).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(f.ctls).toHaveLength(1);
  });

  it("la même empreinte : le run continue", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const ctl = f.ctls[0] as FakeCtl;
    ctl.handlers.onEvent?.(providerKey(KEYS[0] ?? ""));
    expect(ctl.calls).not.toContainEqual(["kill"]);
    expect(view().busy).toBe(true);
  });
});

describe("chat : rotation sur quota ou clé invalide", () => {
  it("quota : clé suivante, NOUVEAU moteur, resume sur la sessionId du run échoué", async () => {
    const f = makeFactory();
    const { session, view, mem, observed } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(providerKey(KEYS[0] ?? ""));
    first.handlers.onEvent?.(sessionStarted("sess-42"));
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(second.calls).toContainEqual(["prompt", ROTATION_RESUME_PROMPT]));
    // Ancien moteur arrêté, nouveau moteur avec la clé 2 et la session reprise.
    expect(first.calls).toContainEqual(["kill"]);
    expect(second.started?.resume).toBe("sess-42");
    expect(second.started?.vault).toMatchObject({ provider: "claude", rank: 2 });
    // La nouvelle valeur est dans l'environnement du nouvel enfant, l'ancienne absente.
    const env = buildEngineEnv(second.options.auth, {});
    expect(env.ANTHROPIC_API_KEY).toBe(KEYS[1]);
    expect(Object.values(env)).not.toContain(KEYS[0]);
    // État persisté, avis lisible sans valeur, événement vault.rotated sans valeur.
    expect(await states(mem)).toEqual(["exhausted", "active", "active"]);
    const notice = noticeTexts(view()).join("\n");
    expect(notice).toContain(`1 · ${fingerprint(KEYS[0] ?? "")}`);
    expect(notice).toContain(`2 · ${fingerprint(KEYS[1] ?? "")}`);
    const rotated = observed.find((e) => e?.kind === "vault.rotated");
    expect(rotated).toMatchObject({
      provider: "claude",
      fromRank: 1,
      fromFingerprint: fingerprint(KEYS[0] ?? ""),
      toRank: 2,
      toFingerprint: fingerprint(KEYS[1] ?? ""),
      cause: "quota",
    });
    expect(view().busy).toBe(true);
  });

  it("session non créée : même consigne, sans resume", async () => {
    const f = makeFactory();
    const { session } = chat(f);
    sessions.push(session);
    await session.send("ma consigne");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    expect(second.started?.resume).toBeUndefined();
    await vi.waitFor(() => expect(second.calls).toContainEqual(["prompt", "ma consigne"]));
  });

  it("clé invalide : la clé passe en invalid, la suivante est utilisée", async () => {
    const f = makeFactory();
    const { session, mem } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(
      ev({ kind: "error", code: "auth.failed", params: { code: "authentication_failed" } }),
    );
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    expect(await states(mem)).toEqual(["invalid", "active", "active"]);
    expect((f.ctls[1] as FakeCtl).options.auth?.value).toBe(KEYS[1]);
  });

  it("l'échec se lit aussi à la fin du run (ended en erreur)", async () => {
    const f = makeFactory();
    const { session, mem } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEnded?.({ status: "error", turns: 1, costUsd: 0, result: null });
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    expect(await states(mem)).toEqual(["exhausted", "active", "active"]);
  });

  it("other : aucune rotation, le coffre est inchangé, l'erreur reste affichée", async () => {
    const f = makeFactory();
    const { session, mem, view } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(
      ev({ kind: "error", code: "provider.error", params: { status: 500, message: "panne" } }),
    );
    first.handlers.onEvent?.(turnFailed());
    await new Promise((r) => setTimeout(r, 30));
    expect(f.ctls).toHaveLength(1);
    expect(first.calls).not.toContainEqual(["kill"]);
    expect(await states(mem)).toEqual(["active", "active", "active"]);
    expect(noticeTexts(view()).some((n) => n.includes("panne"))).toBe(true);
  });

  it("toutes les clés épuisées : vault.allExhausted avec la date de reprise, aucune relance", async () => {
    const f = makeFactory();
    const { session, view, mem } = chat(f, [KEYS[0] ?? ""]);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() =>
      expect(noticeTexts(view()).join("\n")).toContain("toutes les clés du coffre sont épuisées"),
    );
    expect(noticeTexts(view()).join("\n")).toContain("2026-11-16T13:00:00.000Z");
    expect(await states(mem)).toEqual(["exhausted"]);
    expect(f.ctls).toHaveLength(1);
    expect(view().busy).toBe(false);
  });

  it("au plus autant de rotations que de clés, puis allExhausted", async () => {
    const f = makeFactory();
    const { session, view, mem } = chat(f, [KEYS[0] ?? "", KEYS[1] ?? ""]);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(second.started).toBeDefined());
    second.handlers.onEvent?.(quotaError());
    second.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() =>
      expect(noticeTexts(view()).join("\n")).toContain("toutes les clés du coffre sont épuisées"),
    );
    expect(f.ctls).toHaveLength(2);
    expect(await states(mem)).toEqual(["exhausted", "exhausted"]);
  });

  it("rien n'est relancé quand l'utilisateur arrête le chat", async () => {
    const f = makeFactory();
    const { session } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(quotaError());
    session.stop();
    first.handlers.onEvent?.(turnFailed());
    await new Promise((r) => setTimeout(r, 30));
    expect(f.ctls).toHaveLength(1);
  });
});

describe("aucune valeur de clé hors de l'hôte", () => {
  it("ni dans la vue sérialisée envoyée à la webview, ni dans les événements consignés par l'hôte", async () => {
    const f = makeFactory();
    const { session, view, observed } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    const first = f.ctls[0] as FakeCtl;
    first.handlers.onEvent?.(providerKey(KEYS[0] ?? ""));
    first.handlers.onEvent?.(sessionStarted());
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    second.handlers.onEvent?.(providerKey(KEYS[1] ?? ""));
    const webview = JSON.stringify(view());
    const journal = JSON.stringify(observed);
    for (const key of KEYS) {
      expect(webview).not.toContain(key);
      expect(journal).not.toContain(key);
    }
    expect(webview).toContain(fingerprint(KEYS[0] ?? ""));
  });
});

/* --- Campagne --- */

describe("campagne : rotation d'un worker", () => {
  const spec = {
    runId: "11111111-1111-4111-8111-111111111111",
    role: "worker" as const,
    index: 1,
    multiAgent: {
      role: "worker" as const,
      runId: "11111111-1111-4111-8111-111111111111",
      intent: { id: "i1", title: "Injection SQL", rationale: "r" },
    },
    prompt: "fais ceci",
  };

  function spawner(f: ReturnType<typeof makeFactory>, keys: string[] = KEYS) {
    const mem = memoryStore(keys);
    const spawn = createCampaignSpawner({
      make: f.create,
      options: { enginePath: "/e", args: [], cwd: "/w" },
      resolve: async (afterKeyId) => {
        await mem.ready;
        const choice = await pickVaultChoice(mem.store, "claude", NOW, {
          launch: true,
          ...(afterKeyId !== undefined && { afterKeyId }),
        });
        if (!choice) return { params: { cwd: "/w" } };
        return { auth: choice.auth, vault: choice.vault, params: { cwd: "/w" } };
      },
      vault: {
        rotate: (pick, failure) => rotateAfterFailure(mem.store, pick, failure, NOW),
        keyCount: async (provider) => (await mem.store.get(provider)).keys.length,
      },
    });
    return { spawn, mem };
  }

  it("le worker relancé garde son intention et son runId ; l'hôte ne voit ni ended ni sortie", async () => {
    const f = makeFactory();
    const { spawn, mem } = spawner(f);
    const handle = spawn(spec);
    const messages: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => void messages.push(m.type));
    handle.onExit(exit);
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const first = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(first.calls).toContainEqual(["prompt", "fais ceci"]));
    // Bypass actif avant l'échec : le nouveau moteur le reçoit à son tour.
    const bypass = { since: 1, expiresAt: null };
    handle.send({ v: 1, type: "bypass", seq: 1, state: bypass });
    first.handlers.onEvent?.(sessionStarted("sess-w"));
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    first.handlers.onEnded?.({ status: "error", turns: 1, costUsd: 0, result: null });
    first.handlers.onExit?.({ code: 1, signal: null });
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(second.calls).toContainEqual(["prompt", ROTATION_RESUME_PROMPT]));
    expect(second.started?.multiAgent).toEqual(spec.multiAgent);
    expect(second.started?.resume).toBe("sess-w");
    expect(second.started?.vault).toMatchObject({ provider: "claude", rank: 2 });
    expect(buildEngineEnv(second.options.auth, {}).ANTHROPIC_API_KEY).toBe(KEYS[1]);
    expect(second.calls).toContainEqual(["bypass", bypass]);
    expect(first.calls).toContainEqual(["kill"]);
    expect(await states(mem)).toEqual(["exhausted", "active", "active"]);
    // L'hôte de campagne n'a vu ni `ended` ni sortie : l'intention reste prise (aucun closeOnBehalf).
    expect(messages).not.toContain("ended");
    expect(exit).not.toHaveBeenCalled();
    // Le nouveau moteur est le moteur courant : les messages de l'hôte lui parviennent.
    handle.send({ v: 1, type: "prompt", text: "suite" });
    expect(second.calls).toContainEqual(["prompt", "suite"]);
    handle.stop();
    expect(second.calls).toContainEqual(["kill"]);
  });

  it("session non créée : le prompt d'origine est rejoué, sans resume", async () => {
    const f = makeFactory();
    const { spawn } = spawner(f);
    const handle = spawn(spec);
    handle.onMessage(() => {});
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const first = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(first.started).toBeDefined());
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const second = f.ctls[1] as FakeCtl;
    expect(second.started?.resume).toBeUndefined();
    expect(second.started?.multiAgent?.runId).toBe(spec.runId);
    await vi.waitFor(() => expect(second.calls).toContainEqual(["prompt", "fais ceci"]));
    handle.stop();
  });

  it("other : aucune rotation, ended et sortie sont transmis comme avant", async () => {
    const f = makeFactory();
    const { spawn, mem } = spawner(f);
    const handle = spawn(spec);
    const messages: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => void messages.push(m.type));
    handle.onExit(exit);
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const first = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(first.started).toBeDefined());
    first.handlers.onEvent?.(
      ev({ kind: "error", code: "provider.error", params: { status: 500, message: "panne" } }),
    );
    first.handlers.onEnded?.({ status: "error", turns: 1, costUsd: 0, result: null });
    first.handlers.onExit?.({ code: 1, signal: null });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(messages).toContain("ended");
    expect(f.ctls).toHaveLength(1);
    expect(await states(mem)).toEqual(["active", "active", "active"]);
  });

  it("toutes les clés épuisées : erreur vault.allExhausted puis sortie (le worker se termine)", async () => {
    const f = makeFactory();
    const { spawn } = spawner(f, [KEYS[0] ?? ""]);
    const handle = spawn(spec);
    const errors: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => {
      if (m.type === "error") errors.push(m.reason.code);
    });
    handle.onExit(exit);
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const first = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(first.started).toBeDefined());
    first.handlers.onEvent?.(quotaError());
    first.handlers.onEvent?.(turnFailed());
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(errors).toEqual(["vault.allExhausted"]);
    expect(f.ctls).toHaveLength(1);
  });

  it("une empreinte différente de celle attendue arrête le worker avec vault.keyMismatch", async () => {
    const f = makeFactory();
    const { spawn } = spawner(f);
    const handle = spawn(spec);
    const errors: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => {
      if (m.type === "error") errors.push(m.reason.code);
    });
    handle.onExit(exit);
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const first = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(first.started).toBeDefined());
    first.handlers.onEvent?.(providerKey(KEYS[2] ?? ""));
    expect(errors).toEqual(["vault.keyMismatch"]);
    expect(first.calls).toContainEqual(["kill"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(f.ctls).toHaveLength(1);
  });

  it("dans une campagne du chat : le worker relancé garde son intention, qui reste prise", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    session.setMultiAgentWorkers(1);
    await session.send("objectif");
    await vi.waitFor(() => expect(f.ctls).toHaveLength(1));
    const planner = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(planner.started).toBeDefined());
    planner.handlers.onCampaign?.({
      v: 1,
      type: "campaign",
      id: "r1",
      op: "openIntents",
      args: { drafts: [{ title: "Injection SQL", rationale: "Pourquoi" }] },
    });
    await vi.waitFor(() => expect(f.ctls).toHaveLength(2));
    const worker = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(worker.started).toBeDefined());
    worker.handlers.onEvent?.(quotaError());
    worker.handlers.onEvent?.(turnFailed());
    worker.handlers.onEnded?.({ status: "error", turns: 1, costUsd: 0, result: null });
    worker.handlers.onExit?.({ code: 1, signal: null });
    await vi.waitFor(() => expect(f.ctls).toHaveLength(3));
    const relaunched = f.ctls[2] as FakeCtl;
    await vi.waitFor(() => expect(relaunched.started).toBeDefined());
    expect(relaunched.started?.multiAgent).toEqual(worker.started?.multiAgent);
    expect(relaunched.started?.multiAgent?.intent?.title).toBe("Injection SQL");
    expect(relaunched.options.auth?.value).toBe(KEYS[1]);
    // Aucune fermeture au nom du worker : l'intention est toujours prise, la campagne continue.
    expect(view().campaign?.intents[0]).toMatchObject({ state: "claimed", worker: 1 });
    expect(view().campaign?.finished).toBe(false);
    expect(noticeTexts(view()).join("\n")).toContain(`2 · ${fingerprint(KEYS[1] ?? "")}`);
    session.stopCampaign();
  });
});
