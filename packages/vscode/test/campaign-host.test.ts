import { createRecorder, type PendingApproval } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPAIGN_MAX_BUDGET_USD,
  type CampaignHost,
  type CampaignHostOptions,
  createCampaignHost,
  type EngineHandle,
  type EngineSpec,
  isCampaignActive,
  WORKER_MAX_BUDGET_USD,
  WORKER_MAX_TURNS,
} from "../src/logic/campaign-host.js";
import type { FromEngine, ToEngine } from "../src/logic/protocol.js";

/** Moteur factice : le test joue le rôle du processus (messages, sortie). */
interface FakeEngine extends EngineHandle {
  spec: EngineSpec;
  sent: ToEngine[];
  stopped: boolean;
  exited: boolean;
  emit(message: FromEngine): void;
  exit(): void;
}

function setup(overrides: Partial<CampaignHostOptions> = {}) {
  const engines: FakeEngine[] = [];
  let live = 0;
  const maxLive = { workers: 0 };
  const behaviour = { failWorker: false };
  const spawnEngine = vi.fn((spec: EngineSpec): FakeEngine => {
    if (spec.role === "worker" && behaviour.failWorker) throw new Error("fork impossible");
    let onMessage: (m: FromEngine) => void = () => {};
    let onExit: () => void = () => {};
    const engine: FakeEngine = {
      spec,
      runId: spec.runId,
      sent: [],
      stopped: false,
      exited: false,
      send: (m) => void engine.sent.push(m),
      onMessage: (cb) => {
        onMessage = cb;
      },
      onExit: (cb) => {
        onExit = cb;
      },
      stop: () => {
        engine.stopped = true;
        engine.exit();
      },
      emit: (m) => onMessage(m),
      exit: () => {
        if (engine.exited) return;
        engine.exited = true;
        if (spec.role === "worker") live -= 1;
        onExit();
      },
    };
    if (spec.role === "worker") {
      live += 1;
      maxLive.workers = Math.max(maxLive.workers, live);
    }
    engines.push(engine);
    return engine;
  });
  const approvals: unknown[] = [];
  const finished: unknown[] = [];
  const host = createCampaignHost({
    objective: "Auditer l'application",
    spawnEngine,
    recorder: createRecorder({ redact: false }),
    onApproval: (card) => void approvals.push(card),
    onFinished: (why) => void finished.push(why),
    ...overrides,
  });
  const planners = () => engines.filter((e) => e.spec.role === "planner");
  const workers = () => engines.filter((e) => e.spec.role === "worker");
  return { host, engines, planners, workers, spawnEngine, approvals, finished, maxLive, behaviour };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

let nextId = 0;
/** Requête de campagne d'un moteur ; renvoie le `campaignResult` reçu en réponse. */
async function ask(engine: FakeEngine, op: "openIntents" | "status" | "closeIntent", args = {}) {
  const id = `req${++nextId}`;
  engine.emit({ v: 1, type: "campaign", id, op, args });
  await flush();
  return engine.sent.find(
    (m): m is Extract<ToEngine, { type: "campaignResult" }> =>
      m.type === "campaignResult" && m.id === id,
  );
}
const drafts = (...titles: string[]) => ({
  drafts: titles.map((title) => ({ title, rationale: `Pourquoi ${title}` })),
});
const closure = {
  closure: { outcome: "reported", summary: "fait", evidence: ["ev1"] },
};
const approvalOf = (toolUseId: string): PendingApproval => ({
  toolUseId,
  tool: "Read",
  input: { file_path: "/tmp/x" },
  verdict: { decision: "ask", reason: { code: "policy.default" }, rule: null },
});

let host: CampaignHost | undefined;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  host?.stop();
  host = undefined;
  vi.useRealTimers();
});

describe("hôte de campagne : cycle de vie", () => {
  it("lance le planificateur d'abord, avec l'objectif", () => {
    const s = setup();
    host = s.host;
    expect(s.engines).toHaveLength(1);
    const [planner] = s.engines;
    expect(planner?.spec).toMatchObject({
      role: "planner",
      index: 0,
      multiAgent: { role: "planner", runId: planner?.spec.runId },
    });
    expect(planner?.spec.prompt).toContain("Auditer l'application");
    expect(isCampaignActive()).toBe(true);
  });

  it("5 intentions sur 2 tours, jamais plus de 3 workers simultanés, fin automatique", async () => {
    const s = setup();
    host = s.host;
    const [planner1] = s.planners();
    const opened = await ask(planner1 as FakeEngine, "openIntents", drafts("a", "b", "c", "d"));
    expect(opened?.ok).toBe(true);
    // 4 ouvertes, 3 workers lancés, 1 en attente.
    expect(s.workers()).toHaveLength(3);
    expect(s.workers()[0]?.spec.multiAgent.intent).toMatchObject({ id: "i1", title: "a" });
    expect(s.workers()[0]?.spec.prompt).toContain("a");
    (planner1 as FakeEngine).exit();
    expect(s.host.status().counts).toMatchObject({ open: 1, claimed: 3 });

    // Un worker ferme puis sort : sa place est reprise, le planificateur est réveillé après 2 s.
    const [w1, w2, w3] = s.workers() as [FakeEngine, FakeEngine, FakeEngine];
    expect((await ask(w1, "closeIntent", closure))?.ok).toBe(true);
    w1.exit();
    expect(s.workers()).toHaveLength(4);
    expect(s.planners()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(s.planners()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.planners()).toHaveLength(2);
    // Tour 2 : instantané de la campagne dans la consigne, une 5e intention.
    const planner2 = s.planners()[1] as FakeEngine;
    expect(planner2.spec.prompt).toContain('"intents"');
    expect((await ask(planner2, "openIntents", drafts("e")))?.ok).toBe(true);
    expect(s.workers()).toHaveLength(4); // 3 workers déjà vivants : la 5e attend
    planner2.exit();
    expect(s.host.finished).toBe(false);

    const w4 = s.workers()[3] as FakeEngine;
    await ask(w2, "closeIntent", closure);
    w2.exit();
    expect(s.workers()).toHaveLength(5);
    const w5 = s.workers()[4] as FakeEngine;
    for (const w of [w3, w4, w5]) {
      await ask(w, "closeIntent", closure);
      w.exit();
    }
    expect(s.maxLive.workers).toBe(3);
    // Dernier tour : rien à ouvrir, rien d'ouvert ni de pris -> fin.
    await vi.advanceTimersByTimeAsync(2000);
    const planner3 = s.planners()[2] as FakeEngine;
    expect(planner3).toBeDefined();
    planner3.exit();
    expect(s.host.finished).toBe(true);
    expect(s.host.status().counts).toMatchObject({ done: 5, open: 0, claimed: 0 });
    expect(s.finished).toHaveLength(1);
    expect(s.finished[0]).toMatchObject({ code: "campaign.completed" });
    expect(isCampaignActive()).toBe(false);
  });

  it("un tour sans intention ni travail en cours termine la campagne", () => {
    const s = setup();
    host = s.host;
    (s.planners()[0] as FakeEngine).exit();
    expect(s.host.finished).toBe(true);
    expect(s.finished[0]).toMatchObject({ code: "campaign.completed" });
    expect(isCampaignActive()).toBe(false);
  });

  it("un worker qui sort sans fermer : intention blocked, planificateur réveillé", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    planner.exit();
    const w = s.workers()[0] as FakeEngine;
    w.exit();
    expect(s.host.status().intents[0]).toMatchObject({ state: "blocked", workerRunId: w.runId });
    expect(s.planners()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.planners()).toHaveLength(2);
  });

  it("anti-rebond : des fermetures rapprochées ne réveillent le planificateur qu'une fois", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a", "b"));
    planner.exit();
    const [w1, w2] = s.workers() as [FakeEngine, FakeEngine];
    await ask(w1, "closeIntent", closure);
    await vi.advanceTimersByTimeAsync(1500);
    await ask(w2, "closeIntent", closure);
    // Le délai repart à la 2e fermeture : rien à 1999 ms de celle-ci.
    await vi.advanceTimersByTimeAsync(1999);
    expect(s.planners()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.planners()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.planners()).toHaveLength(2);
  });

  it("stop() arrête tous les moteurs, consigne les intentions prises et libère la garde", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a", "b"));
    expect(s.workers()).toHaveLength(2);
    s.host.stop();
    for (const e of s.engines) expect(e.stopped).toBe(true);
    expect(s.host.finished).toBe(true);
    expect(s.host.status().counts).toMatchObject({ blocked: 2, claimed: 0 });
    expect(s.finished[0]).toMatchObject({ code: "campaign.stopped", params: { cause: "user" } });
    expect(isCampaignActive()).toBe(false);
    s.host.stop("emergency"); // idempotent
    expect(s.finished).toHaveLength(1);
    // Plus aucun lancement après l'arrêt.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.engines).toHaveLength(3);
  });

  it("l'arrêt d'urgence est consigné comme tel", () => {
    const s = setup();
    host = s.host;
    s.host.stop("emergency");
    expect(s.finished[0]).toMatchObject({ params: { cause: "emergency" } });
  });

  it("refuse une deuxième campagne tant que la première est active", () => {
    const first = setup();
    host = first.host;
    expect(() => setup()).toThrowError(expect.objectContaining({ code: "campaign.alreadyActive" }));
    first.host.stop();
    const second = setup();
    host = second.host;
    expect(isCampaignActive()).toBe(true);
  });

  it("refuse un nombre de workers hors de 1..8 sans prendre la garde", () => {
    for (const workers of [0, 9, 1.5]) {
      expect(() => setup({ workers })).toThrowError(
        expect.objectContaining({ code: "campaign.invalidInput" }),
      );
    }
    expect(isCampaignActive()).toBe(false);
  });

  it("un lancement du planificateur en échec libère la garde et remonte l'erreur", () => {
    expect(() =>
      setup({
        spawnEngine: () => {
          throw new Error("fork impossible");
        },
      }),
    ).toThrow("fork impossible");
    expect(isCampaignActive()).toBe(false);
  });

  it("un échec de lancement d'un worker bloque l'intention et réveille le planificateur", async () => {
    const s = setup();
    host = s.host;
    s.behaviour.failWorker = true;
    await ask(s.planners()[0] as FakeEngine, "openIntents", drafts("a"));
    expect(s.workers()).toHaveLength(0);
    expect(s.host.status().counts).toMatchObject({ open: 0, blocked: 1 });
    (s.planners()[0] as FakeEngine).exit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.planners()).toHaveLength(2);
  });
});

describe("hôte de campagne : IPC et rôles", () => {
  it("refuse openIntents à un worker, closeIntent au planificateur", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    const worker = s.workers()[0] as FakeEngine;
    const denied = await ask(worker, "openIntents", drafts("b"));
    expect(denied).toMatchObject({ ok: false, reason: { code: "campaign.roleForbidden" } });
    expect(s.host.status().intents).toHaveLength(1);
    const deniedClose = await ask(planner, "closeIntent", closure);
    expect(deniedClose).toMatchObject({ ok: false, reason: { code: "campaign.roleForbidden" } });
  });

  it("status est ouvert aux deux rôles ; un refus du coordinateur remonte codé", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    expect(await ask(planner, "status")).toMatchObject({ ok: true });
    const dup = await ask(planner, "openIntents", drafts("a"));
    expect(dup?.ok).toBe(true);
    const again = await ask(planner, "openIntents", drafts("A"));
    expect(again).toMatchObject({ ok: false, reason: { code: "campaign.duplicateIntent" } });
    const worker = s.workers()[0] as FakeEngine;
    expect(await ask(worker, "status")).toMatchObject({ ok: true });
  });

  it("le worker ne ferme que sa propre intention (verdict et preuves consignés)", async () => {
    const s = setup();
    host = s.host;
    await ask(s.planners()[0] as FakeEngine, "openIntents", drafts("a", "b"));
    const [w1] = s.workers() as [FakeEngine];
    const closed = await ask(w1, "closeIntent", closure);
    expect(closed).toMatchObject({
      ok: true,
      value: { id: "i1", state: "done", outcome: "reported" },
    });
    // Déjà fermée : plus rien à fermer pour ce worker.
    expect(await ask(w1, "closeIntent", closure)).toMatchObject({
      ok: false,
      reason: { code: "campaign.notClaimant" },
    });
  });

  it("ignore les messages d'un moteur déjà sorti", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    planner.exit();
    const before = planner.sent.length;
    planner.emit({ v: 1, type: "campaign", id: "late", op: "status", args: {} });
    await flush();
    expect(planner.sent).toHaveLength(before);
  });
});

describe("hôte de campagne : approbations", () => {
  it("estampille la carte et route la réponse vers le bon moteur", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a", "b"));
    const [w1, w2] = s.workers() as [FakeEngine, FakeEngine];
    planner.emit({ v: 1, type: "approval", approval: approvalOf("tp") });
    w1.emit({ v: 1, type: "approval", approval: approvalOf("t1") });
    w2.emit({ v: 1, type: "approval", approval: approvalOf("t2") });
    expect(s.approvals).toMatchObject([
      { toolUseId: "tp", agent: { role: "planner", index: 0 } },
      { toolUseId: "t1", agent: { role: "worker", index: 1, intent: "a" } },
      { toolUseId: "t2", agent: { role: "worker", index: 2, intent: "b" } },
    ]);
    expect(s.host.answer("t2", "once")).toBe(true);
    expect(w2.sent.at(-1)).toEqual({
      v: 1,
      type: "answer",
      toolUseId: "t2",
      decision: "allow",
    });
    expect(w1.sent.some((m) => m.type === "answer")).toBe(false);
    expect(s.host.answer("tp", "deny")).toBe(true);
    expect(planner.sent.at(-1)).toMatchObject({
      type: "answer",
      toolUseId: "tp",
      decision: "deny",
    });
    expect(s.host.answer("t1", "always")).toBe(true);
    expect(w1.sent.at(-1)).toMatchObject({ decision: "allow", remember: "always" });
  });

  it("refuse un toolUseId inconnu ou déjà répondu, sans effet", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    planner.emit({ v: 1, type: "approval", approval: approvalOf("t1") });
    const sentBefore = planner.sent.length;
    expect(s.host.answer("inconnu", "once")).toBe(false);
    expect(planner.sent).toHaveLength(sentBefore);
    expect(s.host.answer("t1", "once")).toBe(true);
    expect(s.host.answer("t1", "once")).toBe(false);
  });

  it("une demande d'un moteur sorti n'est plus routable", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    const w = s.workers()[0] as FakeEngine;
    w.emit({ v: 1, type: "approval", approval: approvalOf("t1") });
    w.exit();
    expect(s.host.answer("t1", "once")).toBe(false);
  });

  it("un identifiant déjà pris par un autre moteur est refusé (échec fermé)", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    const w = s.workers()[0] as FakeEngine;
    planner.emit({ v: 1, type: "approval", approval: approvalOf("dup") });
    w.emit({ v: 1, type: "approval", approval: approvalOf("dup") });
    expect(s.approvals).toHaveLength(1);
    expect(w.sent.at(-1)).toMatchObject({ type: "answer", toolUseId: "dup", decision: "deny" });
    // La demande d'origine reste routée vers son propriétaire.
    expect(s.host.answer("dup", "once")).toBe(true);
    expect(planner.sent.at(-1)).toMatchObject({ type: "answer", toolUseId: "dup" });
  });
});

describe("hôte de campagne : Bypass", () => {
  const state = { since: 1_000, expiresAt: 1_000 + 3_600_000 };
  const bypasses = (e: FakeEngine) =>
    e.sent.filter((m): m is Extract<ToEngine, { type: "bypass" }> => m.type === "bypass");

  it("diffuse l'état à tous les moteurs vivants, puis à un worker lancé plus tard", async () => {
    const s = setup({ workers: 1 });
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    // Rien n'est envoyé au démarrage tant que le Bypass est éteint.
    expect(bypasses(planner)).toHaveLength(0);
    await ask(planner, "openIntents", drafts("a", "b"));
    const w1 = s.workers()[0] as FakeEngine;
    expect(bypasses(w1)).toHaveLength(0);

    s.host.setBypass(state);
    expect(bypasses(planner)).toMatchObject([{ state }]);
    expect(bypasses(w1)).toMatchObject([{ state }]);

    // Le worker suivant reçoit l'état courant dès son démarrage.
    await ask(w1, "closeIntent", closure);
    w1.exit();
    const w2 = s.workers()[1] as FakeEngine;
    expect(w2).toBeDefined();
    expect(bypasses(w2)).toMatchObject([{ state }]);

    s.host.setBypass(null);
    for (const e of [planner, w2]) expect(bypasses(e).at(-1)).toMatchObject({ state: null });
  });

  it("numérote chaque message de façon strictement croissante par moteur", () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    s.host.setBypass(state);
    s.host.setBypass(null);
    s.host.setBypass(state);
    const seqs = bypasses(planner).map((m) => m.seq);
    expect(seqs).toHaveLength(3);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(3);
    expect(seqs[0]).toBeGreaterThanOrEqual(1);
  });

  it("n'envoie plus rien une fois la campagne terminée", () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    s.host.stop();
    const before = planner.sent.length;
    s.host.setBypass(state);
    expect(planner.sent).toHaveLength(before);
  });
});

const ended = (costUsd?: number): FromEngine =>
  ({
    v: 1,
    type: "ended",
    summary: {
      status: "success",
      turns: 1,
      result: null,
      ...(costUsd !== undefined && { costUsd }),
    },
  }) as FromEngine;

describe("hôte de campagne : budget (ADR 0054, point 9)", () => {
  it("le worker est lancé avec ses plafonds ; le planificateur sans", async () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    expect(planner.spec.maxTurns).toBeUndefined();
    expect(planner.spec.maxBudgetUsd).toBeUndefined();
    await ask(planner, "openIntents", drafts("a"));
    expect(s.workers()[0]?.spec).toMatchObject({
      maxTurns: WORKER_MAX_TURNS,
      maxBudgetUsd: WORKER_MAX_BUDGET_USD,
    });
    expect(WORKER_MAX_TURNS).toBe(40);
    expect(WORKER_MAX_BUDGET_USD).toBe(2);
  });

  it("le budget par défaut de campagne est 20 $", () => {
    const s = setup();
    host = s.host;
    expect(CAMPAIGN_MAX_BUDGET_USD).toBe(20);
    expect(s.host.status().budget.maxUsd).toBe(20);
  });

  it("le coût de chaque fin de run (planificateur et worker) est ajouté ; message relayé", async () => {
    const onMessage = vi.fn();
    const s = setup({ onMessage });
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a"));
    planner.emit(ended(0.5));
    expect(s.host.status().spentUsd).toBe(0.5);
    (s.workers()[0] as FakeEngine).emit(ended(1.25));
    expect(s.host.status().spentUsd).toBe(1.75);
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("coût absent ou invalide : 0, sans planter", () => {
    const s = setup();
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    planner.emit(ended());
    planner.emit(ended(Number.NaN));
    planner.emit(ended(-3));
    planner.emit({ v: 1, type: "ended" } as unknown as FromEngine);
    expect(s.host.status().spentUsd).toBe(0);
    expect(s.host.finished).toBe(false);
  });

  it("budget atteint : plus d'attribution, workers en cours finis, fin budgetExhausted", async () => {
    const s = setup({ workers: 1, maxBudgetUsd: 3 });
    host = s.host;
    const planner = s.planners()[0] as FakeEngine;
    await ask(planner, "openIntents", drafts("a", "b"));
    expect(s.workers()).toHaveLength(1);
    planner.exit();
    const w1 = s.workers()[0] as FakeEngine;
    w1.emit(ended(3));
    // Le worker en cours finit son tour : la campagne n'est pas coupée.
    expect(s.host.finished).toBe(false);
    expect(w1.stopped).toBe(false);
    await ask(w1, "closeIntent", closure);
    w1.exit();
    // Rien n'est attribué à la place, aucun nouveau tour de planificateur.
    expect(s.workers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.planners()).toHaveLength(1);
    expect(s.host.finished).toBe(true);
    expect(s.finished[0]).toMatchObject({ code: "campaign.budgetExhausted" });
    expect(s.host.status().counts).toMatchObject({ done: 1, exhausted: 1 });
  });
});
