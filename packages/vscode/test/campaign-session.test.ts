import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BypassState, PendingApproval } from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCampaignActive } from "../src/logic/campaign-host.js";
import { createCampaignSpawner } from "../src/logic/campaign-spawn.js";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import { DEFAULT_PREFS, parsePrefs } from "../src/logic/controls.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";

/** Contrôleur factice d'un moteur de campagne : le test joue le processus. */
interface FakeCtl extends EngineController {
  handlers: EngineHandlers;
  options: EngineControllerOptions;
  started?: StartParams;
  calls: unknown[][];
  releaseStart(): void;
}

function makeFactory(opts: { deferStart?: boolean } = {}) {
  const ctls: FakeCtl[] = [];
  const create = (options: EngineControllerOptions): EngineController => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls: unknown[][] = [];
    const ctl: FakeCtl = {
      handlers: options.handlers ?? {},
      options,
      calls,
      releaseStart: release,
      start: async (params) => {
        ctl.started = params;
        calls.push(["start"]);
        if (opts.deferStart) await gate;
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

function chat(
  factory: ReturnType<typeof makeFactory>,
  over: Partial<Parameters<typeof createChatSession>[0]> = {},
) {
  let view!: ChatView;
  const store = new Map<string, unknown>();
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: ["/ext"],
    readSettings: () => ({}),
    getToken: async () => ({
      auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-secret" },
      mode: "subscription",
    }),
    confirmAlways: async () => false,
    onView: (v) => {
      view = v;
    },
    createController: factory.create,
    sdkVersion: "1.0.0",
    store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
    ...over,
  });
  return { session, view: () => view };
}

const approval = (id: string): PendingApproval =>
  ({
    toolUseId: id,
    tool: "Bash",
    input: { command: "ls" },
    verdict: { decision: "ask", reason: { code: "bash.noRule" }, rule: null },
  }) as unknown as PendingApproval;

const drafts = (...titles: string[]) => ({
  drafts: titles.map((title) => ({ title, rationale: `Pourquoi ${title}` })),
});

const sessions: { dispose(): void }[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  expect(isCampaignActive()).toBe(false);
});

const waitCtls = (f: ReturnType<typeof makeFactory>, n: number) =>
  vi.waitFor(() => expect(f.ctls.length).toBeGreaterThanOrEqual(n));

describe("préférences multi-agents (lot 3b)", () => {
  it("défauts : éteint, 3 workers", () => {
    expect(DEFAULT_PREFS.multiAgent).toBe(false);
    expect(DEFAULT_PREFS.multiAgentWorkers).toBe(3);
    expect(parsePrefs(undefined)).toMatchObject({ multiAgent: false, multiAgentWorkers: 3 });
  });

  it("bornes à la lecture : 1 à 8, sinon le défaut ; booléen strict", () => {
    expect(parsePrefs({ multiAgentWorkers: 1 }).multiAgentWorkers).toBe(1);
    expect(parsePrefs({ multiAgentWorkers: 8 }).multiAgentWorkers).toBe(8);
    for (const bad of [0, 9, -1, 2.5, "4", null, Number.NaN, Number.POSITIVE_INFINITY])
      expect(parsePrefs({ multiAgentWorkers: bad }).multiAgentWorkers, String(bad)).toBe(3);
    expect(parsePrefs({ multiAgent: true }).multiAgent).toBe(true);
    for (const bad of ["true", 1, null, {}])
      expect(parsePrefs({ multiAgent: bad }).multiAgent, String(bad)).toBe(false);
  });

  it("l'hôte valide les demandes de la webview", () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent("oui");
    expect(view()?.controls?.multiAgent?.enabled ?? false).toBe(false);
    session.setMultiAgent(true);
    expect(view().controls?.multiAgent?.enabled).toBe(true);
    session.setMultiAgentWorkers(99);
    expect(view().controls?.multiAgent?.workers).toBe(3);
    session.setMultiAgentWorkers(5);
    expect(view().controls?.multiAgent?.workers).toBe(5);
  });
});

describe("envoi de prompt et campagne (lot 3b)", () => {
  it("mode éteint : un run simple, aucun moteur de campagne", async () => {
    const f = makeFactory();
    const { session } = chat(f);
    sessions.push(session);
    await session.send("bonjour");
    expect(f.ctls).toHaveLength(1);
    expect(f.ctls[0]?.started?.multiAgent).toBeUndefined();
    expect(f.ctls[0]?.calls).toContainEqual(["prompt", "bonjour"]);
    expect(isCampaignActive()).toBe(false);
  });

  it("mode actif : une campagne, planificateur avec multiAgent et runId, puis le prompt", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    session.setMultiAgentWorkers(2);
    expect(await session.send("Audite le site")).toBe(true);
    expect(isCampaignActive()).toBe(true);
    await waitCtls(f, 1);
    await vi.waitFor(() => expect(f.ctls[0]?.calls).toContainEqual(["prompt", expect.any(String)]));
    const planner = f.ctls[0] as FakeCtl;
    expect(planner.started?.multiAgent?.role).toBe("planner");
    expect(planner.started?.multiAgent?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(planner.started?.cwd).toBe("/w");
    expect(planner.options.auth?.value).toBe("sk-secret");
    expect(planner.started?.resume).toBeUndefined();
    const prompt = planner.calls.find((c) => c[0] === "prompt");
    expect(String(prompt?.[1])).toContain("Audite le site");
    expect(view().busy).toBe(true);
  });

  it("un seul run simple : le mode actif avec apprentissage n'emprunte pas la campagne", async () => {
    const f = makeFactory();
    const { session } = chat(f, { learningKey: "warband.learning.x" });
    sessions.push(session);
    session.setMultiAgent(true);
    session.setLearning(true);
    await session.send("cours");
    expect(isCampaignActive()).toBe(false);
    expect(f.ctls[0]?.started?.multiAgent).toBeUndefined();
  });

  it("une deuxième campagne est refusée avec son message codé, rien n'est lancé", async () => {
    const f = makeFactory();
    const first = chat(f);
    const second = chat(f);
    sessions.push(first.session, second.session);
    first.session.setMultiAgent(true);
    second.session.setMultiAgent(true);
    await first.session.send("un");
    await waitCtls(f, 1);
    const before = f.ctls.length;
    expect(await second.session.send("deux")).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(f.ctls).toHaveLength(before);
    const notices = second.view().items.filter((i) => i.kind === "notice");
    expect(notices.some((n) => n.kind === "notice" && n.level === "error")).toBe(true);
    expect(second.view().busy).toBe(false);
  });

  it("le planificateur ouvre une intention : le worker est lancé, ses éléments portent l'agent", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("objectif");
    await waitCtls(f, 1);
    const planner = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(planner.started).toBeDefined());
    planner.handlers.onCampaign?.({
      v: 1,
      type: "campaign",
      id: "r1",
      op: "openIntents",
      args: drafts("Injection SQL"),
    });
    await waitCtls(f, 2);
    const worker = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(worker.started).toBeDefined());
    expect(worker.started?.multiAgent?.role).toBe("worker");
    expect(worker.started?.multiAgent?.intent?.title).toBe("Injection SQL");
    worker.handlers.onEvent?.({
      v: 1,
      id: "e1",
      seq: 1,
      ts: "",
      runId: "r",
      parentId: null,
      kind: "agent.text",
      text: "Je commence",
    } as never);
    const item = view().items.find((i) => i.kind === "agent");
    expect(item?.agent).toMatchObject({ role: "worker", index: 1, intent: "Injection SQL" });
    // Le texte du modèle n'est pas préfixé : l'étiquette est une donnée.
    expect(item?.kind === "agent" && item.text).toBe("Je commence");
    // La fin d'un run ne libère pas le chat : la campagne décide.
    worker.handlers.onEvent?.({
      v: 1,
      id: "e2",
      seq: 2,
      ts: "",
      runId: "r",
      parentId: null,
      kind: "turn.finished",
      status: "success",
    } as never);
    expect(view().busy).toBe(true);
  });
});

describe("routage des approbations (lot 3b)", () => {
  it("la carte d'un moteur de campagne porte l'agent ; approve va au bon moteur", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("objectif");
    await waitCtls(f, 1);
    const planner = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(planner.started).toBeDefined());
    planner.handlers.onApproval?.(approval("tu1"));
    const card = view().approvals.find((c) => c.toolUseId === "tu1");
    expect(card?.agent).toMatchObject({ role: "planner", index: 0 });
    await session.approve("tu1", "once");
    expect(planner.calls).toContainEqual(["answer", "tu1", "allow", undefined]);
    expect(view().approvals).toHaveLength(0);
  });

  it("un toolUseId inconnu de la campagne retombe sur le chemin normal (moteur simple)", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    await session.send("simple");
    const ctl = f.ctls[0] as FakeCtl;
    ctl.handlers.onApproval?.(approval("tu9"));
    await session.approve("tu9", "deny");
    expect(ctl.calls).toContainEqual(["answer", "tu9", "deny", undefined]);
    expect(view().approvals).toHaveLength(0);
  });

  it("une carte inconnue de l'hôte de campagne n'est pas répondue à un autre moteur", async () => {
    const f = makeFactory();
    const { session } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("objectif");
    await waitCtls(f, 1);
    await session.approve("inconnu", "once");
    expect(f.ctls[0]?.calls.some((c) => c[0] === "answer")).toBe(false);
  });
});

describe("Bypass et arrêt (lot 3b)", () => {
  it("le Bypass du chat est diffusé aux moteurs de la campagne, et aux workers suivants", async () => {
    const f = makeFactory();
    let send: ((s: BypassState | null) => number) | undefined;
    const link = { acked: vi.fn(), release: vi.fn() };
    const { session } = chat(f, {
      bypass: {
        attach: (s) => {
          send = s;
          return link;
        },
      },
    });
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("objectif");
    await waitCtls(f, 1);
    const planner = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(planner.started).toBeDefined());
    const state = { since: 1000, expiresAt: 61_000 };
    expect(send?.(state)).toBe(1);
    expect(planner.calls).toContainEqual(["bypass", state]);
    // Un accusé conforme d'un moteur confirme l'état ; un état périmé est ignoré.
    planner.handlers.onBypassAck?.({ seq: 1, state: { since: 5, expiresAt: 6 } });
    expect(link.acked).not.toHaveBeenCalled();
    planner.handlers.onBypassAck?.({ seq: 1, state });
    expect(link.acked).toHaveBeenCalledWith(1, state);
    planner.handlers.onCampaign?.({
      v: 1,
      type: "campaign",
      id: "r1",
      op: "openIntents",
      args: drafts("a"),
    });
    await waitCtls(f, 2);
    const worker = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(worker.calls).toContainEqual(["bypass", state]));
    // Bypass avant le prompt du worker.
    const kinds = worker.calls.map((c) => c[0]);
    expect(kinds.indexOf("bypass")).toBeLessThan(kinds.indexOf("prompt"));
  });

  it("l'arrêt du chat arrête tous les moteurs et libère le Bypass", async () => {
    const f = makeFactory();
    const link = { acked: vi.fn(), release: vi.fn() };
    const reset = vi.fn();
    const { session, view } = chat(f, { bypass: { attach: () => link, reset } });
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("objectif");
    await waitCtls(f, 1);
    const planner = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(planner.started).toBeDefined());
    planner.handlers.onCampaign?.({
      v: 1,
      type: "campaign",
      id: "r1",
      op: "openIntents",
      args: drafts("a"),
    });
    await waitCtls(f, 2);
    const worker = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(worker.started).toBeDefined());
    session.stop();
    expect(planner.calls).toContainEqual(["kill"]);
    expect(worker.calls).toContainEqual(["kill"]);
    expect(isCampaignActive()).toBe(false);
    expect(link.release).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalled();
    expect(view().busy).toBe(false);
  });

  it("l'arrêt d'urgence et la fermeture du chat arrêtent aussi la campagne", async () => {
    const f = makeFactory();
    const a = chat(f);
    sessions.push(a.session);
    a.session.setMultiAgent(true);
    await a.session.send("objectif");
    await waitCtls(f, 1);
    await vi.waitFor(() => expect(f.ctls[0]?.started).toBeDefined());
    a.session.emergencyStop();
    expect(f.ctls[0]?.calls).toContainEqual(["kill"]);
    expect(isCampaignActive()).toBe(false);

    const b = chat(f);
    b.session.setMultiAgent(true);
    await b.session.send("objectif");
    await waitCtls(f, 2);
    b.session.dispose();
    expect(isCampaignActive()).toBe(false);
    expect(f.ctls[1]?.calls).toContainEqual(["kill"]);
  });
});

describe("lancement d'un moteur de campagne (lot 3b)", () => {
  const spec = {
    runId: "11111111-1111-4111-8111-111111111111",
    role: "worker" as const,
    index: 1,
    multiAgent: {
      role: "worker" as const,
      runId: "11111111-1111-4111-8111-111111111111",
      intent: { id: "i1", title: "t", rationale: "r" },
    },
    prompt: "fais ceci",
  };

  it("send est mis en file jusqu'au start, puis start précède le prompt", async () => {
    const f = makeFactory({ deferStart: true });
    const spawn = createCampaignSpawner({
      make: f.create,
      options: { enginePath: "/e", args: [], cwd: "/w" },
      resolve: async () => ({ params: { cwd: "/w" } }),
    });
    const handle = spawn(spec);
    handle.send({ v: 1, type: "bypass", seq: 1, state: null });
    handle.send({ v: 1, type: "campaignResult", id: "x", ok: true, value: 1 });
    await waitCtls(f, 1);
    const ctl = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(ctl.calls).toEqual([["start"]]));
    expect(ctl.started?.multiAgent).toEqual(spec.multiAgent);
    ctl.releaseStart();
    await vi.waitFor(() =>
      expect(ctl.calls.map((c) => c[0])).toEqual(["start", "bypass", "campaignResult", "prompt"]),
    );
    // Après le démarrage, send passe directement.
    handle.send({ v: 1, type: "answer", toolUseId: "t", decision: "deny" });
    expect(ctl.calls.at(-1)).toEqual(["answer", "t", "deny", undefined]);
  });

  it("relaie la sortie et les messages du moteur ; stop passe par kill", async () => {
    const f = makeFactory();
    const spawn = createCampaignSpawner({
      make: f.create,
      options: { enginePath: "/e", args: [], cwd: "/w" },
      resolve: async () => ({ params: { cwd: "/w" } }),
    });
    const handle = spawn(spec);
    const messages: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => void messages.push(m.type));
    handle.onExit(exit);
    await waitCtls(f, 1);
    const ctl = f.ctls[0] as FakeCtl;
    await vi.waitFor(() => expect(ctl.started).toBeDefined());
    ctl.handlers.onApproval?.(approval("a"));
    ctl.handlers.onCampaign?.({ v: 1, type: "campaign", id: "1", op: "status", args: {} });
    expect(messages).toEqual(["approval", "campaign"]);
    handle.stop();
    expect(ctl.calls).toContainEqual(["kill"]);
    ctl.handlers.onExit?.({ code: 0, signal: null });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("un échec de démarrage devient une erreur relayée puis une sortie", async () => {
    const spawn = createCampaignSpawner({
      make: () => {
        throw new Error("fork impossible");
      },
      options: { enginePath: "/e", args: [], cwd: "/w" },
      resolve: async () => ({ params: { cwd: "/w" } }),
    });
    const handle = spawn(spec);
    const messages: string[] = [];
    const exit = vi.fn();
    handle.onMessage((m) => void messages.push(m.type));
    handle.onExit(exit);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(messages).toEqual(["error"]);
  });
});

const planner0 = async (f: ReturnType<typeof makeFactory>) => {
  await waitCtls(f, 1);
  const planner = f.ctls[0] as FakeCtl;
  await vi.waitFor(() => expect(planner.started).toBeDefined());
  return planner;
};
const openIntents = (ctl: FakeCtl, ...titles: string[]) =>
  ctl.handlers.onCampaign?.({
    v: 1,
    type: "campaign",
    id: "r1",
    op: "openIntents",
    args: drafts(...titles),
  });

describe("branchement webview et vue de campagne (lot 4b)", () => {
  it("mode éteint : ni campaign dans la vue, contrôles disponibles", () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(false);
    expect(view().campaign).toBeUndefined();
    expect(view().controls?.multiAgent?.available).toBe(true);
    expect(view().controls?.multiAgent?.unavailableReason).toBeUndefined();
  });

  it("setMultiAgent puis workers (ordre de l'extension) : valeur invalide refusée", () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    session.setMultiAgentWorkers(4);
    expect(view().controls?.multiAgent).toMatchObject({ enabled: true, workers: 4 });
    session.setMultiAgent("oui");
    session.setMultiAgentWorkers(42);
    expect(view().controls?.multiAgent).toMatchObject({ enabled: true, workers: 4 });
  });

  it("stopCampaign arrête tous les moteurs ; sans campagne, sans effet", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.stopCampaign();
    session.setMultiAgent(true);
    await session.send("objectif");
    const planner = await planner0(f);
    openIntents(planner, "A");
    await waitCtls(f, 2);
    session.stopCampaign();
    expect(f.ctls.every((c) => c.calls.some((x) => x[0] === "kill"))).toBe(true);
    expect(isCampaignActive()).toBe(false);
    expect(view().campaign?.finished).toBe(true);
  });

  it("available:false dans un autre chat pendant la campagne, true après la fin", async () => {
    const f = makeFactory();
    const a = chat(f);
    const b = chat(f);
    sessions.push(a.session, b.session);
    a.session.setMultiAgent(true);
    await a.session.send("objectif");
    await planner0(f);
    await vi.waitFor(() => expect(b.view().controls?.multiAgent?.available).toBe(false));
    expect(b.view().controls?.multiAgent?.unavailableReason).toBe(
      "Une campagne est déjà en cours dans un autre chat",
    );
    // Le chat de la campagne reste disponible (ses contrôles sont gelés par `locked`).
    expect(a.view().controls?.multiAgent?.available).toBe(true);
    expect(a.view().controls?.locked).toBe(true);
    a.session.stopCampaign();
    await vi.waitFor(() => expect(b.view().controls?.multiAgent?.available).toBe(true));
    expect(b.view().controls?.multiAgent?.unavailableReason).toBeUndefined();
  });

  it("view.campaign : compteurs, intentions, numéro de worker, textes neutralisés et tronqués", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    session.setMultiAgentWorkers(1);
    await session.send(`Objectif\u001b[31m${"x".repeat(400)}`);
    const planner = await planner0(f);
    expect(view().campaign?.objective.length).toBeLessThanOrEqual(301);
    expect(view().campaign?.objective).not.toContain("\u001b");
    expect(view().campaign).toMatchObject({ finished: false, workersMax: 1 });
    openIntents(planner, `Titre\u001b[1m${"y".repeat(300)}`, "Deuxième");
    await waitCtls(f, 2);
    const worker = f.ctls[1] as FakeCtl;
    await vi.waitFor(() => expect(worker.started).toBeDefined());
    const c = view().campaign;
    expect(c?.counts).toMatchObject({ claimed: 1, open: 1, done: 0 });
    expect(c?.intents).toHaveLength(2);
    expect(c?.intents[0]?.title.length).toBeLessThanOrEqual(201);
    expect(c?.intents[0]?.title).not.toContain("\u001b");
    expect(c?.intents[0]).toMatchObject({ state: "claimed", worker: 1 });
    expect(c?.intents[1]?.worker).toBeUndefined();
    worker.handlers.onCampaign?.({
      v: 1,
      type: "campaign",
      id: "w1",
      op: "closeIntent",
      args: { closure: { outcome: "reported", summary: "fait", evidence: [] } },
    });
    await vi.waitFor(() => expect(view().campaign?.counts.done).toBe(1));
    expect(view().campaign?.intents[0]).toMatchObject({
      state: "done",
      outcome: "reported",
      worker: 1,
    });
    session.stopCampaign();
  });

  it("plafonds du worker : 40 tours et 2 $ par défaut, le plus bas gagne face au chat", async () => {
    for (const [settings, turns] of [
      [{}, 40],
      [{ maxTurns: 10 }, 10],
      [{ maxTurns: 100 }, 40],
    ] as const) {
      const f = makeFactory();
      const { session } = chat(f, { readSettings: () => settings });
      sessions.push(session);
      session.setMultiAgent(true);
      await session.send("Objectif");
      const planner = await planner0(f);
      expect(planner.started?.maxBudgetUsd).toBeUndefined();
      openIntents(planner, "Un");
      await waitCtls(f, 2);
      const worker = f.ctls[1] as FakeCtl;
      await vi.waitFor(() => expect(worker.started).toBeDefined());
      expect(worker.started?.maxTurns).toBe(turns);
      expect(worker.started?.maxBudgetUsd).toBe(2);
      session.stopCampaign();
      session.dispose();
      sessions.pop();
    }
  });

  it("view.campaign : spentUsd (2 décimales) et budgetUsd, coût absent compté 0", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("Objectif");
    const planner = await planner0(f);
    expect(view().campaign).toMatchObject({ spentUsd: 0, budgetUsd: 20 });
    planner.handlers.onEnded?.({ status: "success", turns: 1, costUsd: 3.2049, result: null });
    expect(view().campaign).toMatchObject({ spentUsd: 3.2, budgetUsd: 20 });
    planner.handlers.onEnded?.({ status: "success", turns: 1, result: null } as never);
    expect(view().campaign?.spentUsd).toBe(3.2);
    session.stopCampaign();
  });

  it("finished conservé jusqu'au prochain envoi", async () => {
    const f = makeFactory();
    const { session, view } = chat(f);
    sessions.push(session);
    session.setMultiAgent(true);
    await session.send("un");
    await planner0(f);
    session.stopCampaign();
    expect(view().campaign).toMatchObject({ finished: true, objective: expect.any(String) });
    expect(view().busy).toBe(false);
    session.setMultiAgent(false);
    expect(view().campaign?.finished).toBe(true);
    await session.send("deux");
    expect(view().campaign).toBeUndefined();
  });

  it("le runId du journal de campagne est ajouté aux runIds de la conversation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-camp-"));
    try {
      const f = makeFactory();
      const stored = new Map<string, unknown>();
      const session = createChatSession({
        cwd: "/w",
        enginePath: "/e.mjs",
        engineArgs: [],
        readSettings: () => ({}),
        getToken: async () => undefined,
        confirmAlways: async () => false,
        onView: () => undefined,
        createController: f.create,
        history: {
          key: "warband.history",
          index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
          files: {
            dir,
            read: async () => null,
            size: async () => 0,
            remove: async () => undefined,
            removeAll: async () => undefined,
          },
          confirmDelete: async () => true,
        },
      });
      sessions.push(session);
      session.setMultiAgent(true);
      await session.send("objectif");
      await planner0(f);
      const journals = (await readdir(dir)).map((name) => name.replace(/\.jsonl$/, ""));
      expect(journals).toHaveLength(1);
      const rows = stored.get("warband.history") as { runIds: string[] }[];
      expect(rows[0]?.runIds).toContain(journals[0]);
      session.stopCampaign();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
