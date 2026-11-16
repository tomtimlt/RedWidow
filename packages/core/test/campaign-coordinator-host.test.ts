import { describe, expect, it } from "vitest";
import {
  CodedError,
  createCampaignCoordinator,
  createRecorder,
  type EngineEvent,
  validateEvent,
} from "../src/index.js";

function setup(budget: { maxUsd?: number; maxTokens?: number } = {}) {
  const events: EngineEvent[] = [];
  const recorder = createRecorder({ redact: false });
  recorder.subscribe((e) => events.push(e));
  const coordinator = createCampaignCoordinator({ recorder, now: () => 1000, budget });
  coordinator.start("auditer");
  return { coordinator, events };
}
const draft = (title: string) => ({ title, rationale: "pourquoi" });
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CodedError) return error.code;
    throw error;
  }
  return undefined;
};

describe("fermeture au nom du worker (ADR 0054)", () => {
  it("closeOnBehalf : done, closedBy host, événement valide", () => {
    const { coordinator, events } = setup();
    coordinator.openIntents(1, [draft("a")]);
    coordinator.claimNext("w1");
    const done = coordinator.closeOnBehalf("i1", "w1", {
      outcome: "needs_follow_up",
      summary: "reprise",
      evidence: [],
    });
    expect(done).toMatchObject({ state: "done", outcome: "needs_follow_up", closedBy: "host" });
    const closed = events.find((e) => e.kind === "campaign.intent.closed");
    expect(closed).toMatchObject({ closedBy: "host", outcome: "needs_follow_up", evidence: [] });
    expect(validateEvent(closed as EngineEvent)).toBeNull();
  });

  it("close normal : pas de closedBy ; closeOnBehalf garde les contrôles de détenteur", () => {
    const { coordinator, events } = setup();
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.claimNext("w1");
    expect(
      code(() =>
        coordinator.closeOnBehalf("i1", "w2", { outcome: "reported", summary: "", evidence: [] }),
      ),
    ).toBe("campaign.notClaimant");
    const done = coordinator.close("i1", "w1", { outcome: "reported", summary: "x", evidence: [] });
    expect(done.closedBy).toBeUndefined();
    expect(events.find((e) => e.kind === "campaign.intent.closed")).not.toHaveProperty("closedBy");
    expect(
      validateEvent({
        kind: "campaign.intent.closed",
        intentId: "i1",
        workerRunId: "w1",
        outcome: "reported",
        evidence: [],
        closedBy: "worker",
      } as never as EngineEvent),
    ).not.toBeNull();
  });
});

describe("plafond de tokens du coordinateur", () => {
  it("cumule, puis plus d'ouverture ni d'attribution une fois atteint", () => {
    const { coordinator } = setup({ maxTokens: 1000 });
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.recordTokens(400);
    expect(coordinator.claimNext("w1")?.id).toBe("i1");
    coordinator.recordTokens(600);
    expect(coordinator.status().tokens).toBe(1000);
    expect(coordinator.status().budget.maxTokens).toBe(1000);
    expect(coordinator.claimNext("w2")).toBeUndefined();
    expect(code(() => coordinator.openIntents(2, [draft("c")]))).toBe("campaign.budgetExhausted");
  });

  it("refuse une valeur invalide, et un plafond invalide", () => {
    const { coordinator } = setup();
    expect(code(() => coordinator.recordTokens(-1))).toBe("campaign.invalidInput");
    expect(code(() => coordinator.recordTokens(Number.NaN))).toBe("campaign.invalidInput");
    expect(() =>
      createCampaignCoordinator({
        recorder: createRecorder({ redact: false }),
        budget: { maxTokens: -5 },
      }),
    ).toThrow();
  });
});
