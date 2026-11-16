import { createRecorder } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPAIGN_MAX_TOKENS,
  type CampaignHost,
  type CampaignHostOptions,
  createCampaignHost,
  type EngineHandle,
  type EngineSpec,
} from "../src/logic/campaign-host.js";
import type { FromEngine, ToEngine } from "../src/logic/protocol.js";

/** Reprise au lieu de perte (ADR 0054) et plafond de tokens : moteurs factices. */
interface Fake extends EngineHandle {
  spec: EngineSpec;
  sent: ToEngine[];
  emit(message: FromEngine): void;
  exit(): void;
}

function setup(overrides: Partial<CampaignHostOptions> = {}) {
  const engines: Fake[] = [];
  const events: Record<string, unknown>[] = [];
  const recorder = createRecorder({ redact: false });
  recorder.subscribe((e) => void events.push(e as unknown as Record<string, unknown>));
  const finished: unknown[] = [];
  const host = createCampaignHost({
    objective: "Auditer",
    recorder,
    onFinished: (why) => void finished.push(why),
    spawnEngine: (spec) => {
      let onMessage: (m: FromEngine) => void = () => {};
      let onExit: () => void = () => {};
      const engine: Fake = {
        spec,
        runId: spec.runId,
        sent: [],
        send: (m) => void engine.sent.push(m),
        onMessage: (cb) => {
          onMessage = cb;
        },
        onExit: (cb) => {
          onExit = cb;
        },
        stop: () => engine.exit(),
        emit: (m) => onMessage(m),
        exit: () => onExit(),
      };
      engines.push(engine);
      return engine;
    },
    ...overrides,
  });
  const planner = () => engines.find((e) => e.spec.role === "planner") as Fake;
  const workers = () => engines.filter((e) => e.spec.role === "worker");
  return { host, engines, events, finished, planner, workers };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
let nextId = 0;
async function openIntent(engine: Fake, title: string) {
  engine.emit({
    v: 1,
    type: "campaign",
    id: `r${++nextId}`,
    op: "openIntents",
    args: { drafts: [{ title, rationale: "pourquoi" }] },
  });
  await flush();
}
const text = (t: string): FromEngine => ({
  v: 1,
  type: "event",
  event: { kind: "agent.text", text: t } as never,
});
const ended = (extra: Record<string, unknown> = {}): FromEngine =>
  ({
    v: 1,
    type: "ended",
    summary: { status: "success", turns: 1, costUsd: 0, result: null, ...extra },
  }) as FromEngine;

let host: CampaignHost | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  host?.stop();
  host = undefined;
  vi.useRealTimers();
});

describe("sortie d'un worker sans fermeture : reprise par l'hôte", () => {
  it("needs_follow_up avec le dernier texte (nettoyé, 2000 car. au plus) et closedBy host", async () => {
    const s = setup();
    host = s.host;
    await openIntent(s.planner(), "a");
    const w = s.workers()[0] as Fake;
    w.emit(text("premier texte"));
    w.emit(text(`dernier\u0007texte ${"x".repeat(3000)}`));
    w.emit(ended());
    w.exit();
    const intent = s.host.status().intents[0];
    expect(intent).toMatchObject({
      state: "done",
      outcome: "needs_follow_up",
      closedBy: "host",
      evidence: [],
    });
    expect(intent?.summary?.startsWith("derniertexte xxx")).toBe(true);
    expect((intent?.summary ?? "").length).toBeLessThanOrEqual(2001);
    const closed = s.events.find((e) => e.kind === "campaign.intent.closed");
    expect(closed).toMatchObject({
      intentId: intent?.id,
      outcome: "needs_follow_up",
      closedBy: "host",
      evidence: [],
    });
  });

  it("sortie propre sans aucun texte : « Worker arrêté sans résumé »", async () => {
    const s = setup();
    host = s.host;
    await openIntent(s.planner(), "a");
    const w = s.workers()[0] as Fake;
    w.emit(ended());
    w.exit();
    expect(s.host.status().intents[0]).toMatchObject({
      state: "done",
      outcome: "needs_follow_up",
      summary: "Worker arrêté sans résumé",
      closedBy: "host",
    });
  });

  it("le planificateur réveillé voit l'intention done avec le résumé", async () => {
    const s = setup();
    host = s.host;
    const p1 = s.planner();
    await openIntent(p1, "a");
    p1.exit();
    const w = s.workers()[0] as Fake;
    w.emit(text("piste : endpoint /admin"));
    w.emit(ended());
    w.exit();
    await vi.advanceTimersByTimeAsync(2000);
    const p2 = s.engines.filter((e) => e.spec.role === "planner")[1] as Fake;
    expect(p2.spec.prompt).toContain("needs_follow_up");
    expect(p2.spec.prompt).toContain("piste : endpoint /admin");
  });

  it("un worker qui ferme lui-même n'est pas repris (pas de closedBy)", async () => {
    const s = setup();
    host = s.host;
    await openIntent(s.planner(), "a");
    const w = s.workers()[0] as Fake;
    w.emit({
      v: 1,
      type: "campaign",
      id: "close",
      op: "closeIntent",
      args: { closure: { outcome: "reported", summary: "ok", evidence: ["e1"] } },
    });
    await flush();
    w.emit(text("fin"));
    w.emit(ended());
    w.exit();
    const intent = s.host.status().intents[0];
    expect(intent).toMatchObject({ state: "done", outcome: "reported" });
    expect(intent?.closedBy).toBeUndefined();
  });

  it("arrêt par l'utilisateur ou d'urgence : blocked, même avec du texte", async () => {
    for (const cause of ["user", "emergency"] as const) {
      const s = setup();
      host = s.host;
      await openIntent(s.planner(), "a");
      const w = s.workers()[0] as Fake;
      w.emit(text("travail en cours"));
      s.host.stop(cause);
      expect(s.host.status().intents[0]).toMatchObject({ state: "blocked" });
      expect(s.host.status().intents[0]?.closedBy).toBeUndefined();
      host = undefined;
    }
  });

  it("crash du moteur avant tout texte : blocked", async () => {
    const s = setup();
    host = s.host;
    await openIntent(s.planner(), "a");
    (s.workers()[0] as Fake).exit();
    expect(s.host.status().intents[0]).toMatchObject({ state: "blocked" });
  });
});

describe("plafond de tokens de campagne", () => {
  it("vaut 3 000 000 par défaut", () => {
    const s = setup();
    host = s.host;
    expect(CAMPAIGN_MAX_TOKENS).toBe(3_000_000);
    expect(s.host.status().budget.maxTokens).toBe(3_000_000);
  });

  it("cumule les tokens d'entrée et de sortie de chaque fin de run ; absents : 0", () => {
    const s = setup();
    host = s.host;
    const p = s.planner();
    p.emit(ended({ inputTokens: 1000, outputTokens: 200 }));
    p.emit(ended({ inputTokens: 50 }));
    p.emit(ended());
    p.emit(ended({ inputTokens: Number.NaN, outputTokens: -5 }));
    expect(s.host.status().tokens).toBe(1250);
  });

  it("plafond atteint (coût 0) : plus d'attribution, fin budgetExhausted", async () => {
    const s = setup({ workers: 1, maxTokens: 1000 });
    host = s.host;
    const p = s.planner();
    await openIntent(p, "a");
    await openIntent(p, "b");
    expect(s.workers()).toHaveLength(1);
    p.exit();
    const w1 = s.workers()[0] as Fake;
    w1.emit(ended({ inputTokens: 900, outputTokens: 100, costUsd: 0 }));
    expect(s.host.finished).toBe(false);
    w1.exit(); // repris par l'hôte, mais le plafond bloque toute attribution
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.workers()).toHaveLength(1);
    expect(s.host.finished).toBe(true);
    expect(s.finished[0]).toMatchObject({ code: "campaign.budgetExhausted" });
  });
});
