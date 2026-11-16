import { describe, expect, it } from "vitest";
import {
  CodedError,
  createCampaignCoordinator,
  createRecorder,
  type EngineEvent,
  reason,
  restoreCampaignCoordinator,
  validateEvent,
} from "../src/index.js";

/** Joue une campagne et renvoie son journal (événements) pour la restaurer. */
function played() {
  const events: EngineEvent[] = [];
  const recorder = createRecorder({ redact: false });
  recorder.subscribe((e) => events.push(e));
  const c = createCampaignCoordinator({ recorder, maxWorkers: 4, now: () => 1000 });
  c.start("auditer");
  c.openIntents(1, [
    { title: "A fait", rationale: "r" },
    { title: "B bloquée", rationale: "r" },
    { title: "C prise", rationale: "r" },
    { title: "D ouverte", rationale: "r" },
  ]);
  const a = c.claimNext("w1");
  const b = c.claimNext("w2");
  c.claimNext("w3");
  c.close(a?.id as string, "w1", {
    outcome: "needs_follow_up",
    summary: "à creuser",
    evidence: ["e1"],
  });
  c.abandon(b?.id as string, "w2");
  return { events, runId: recorder.runId, c };
}

function restore(events: readonly EngineEvent[], maxWorkers = 2) {
  const out: EngineEvent[] = [];
  const recorder = createRecorder({ redact: false });
  recorder.subscribe((e) => out.push(e));
  const c = restoreCampaignCoordinator(events, { recorder, maxWorkers });
  return { c, out, runId: recorder.runId };
}

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CodedError) return error.code;
    throw error;
  }
  return undefined;
};

describe("restauration d'un coordinateur de campagne", () => {
  it("claimed sans fermeture -> open ; done, résumé et blocked conservés", () => {
    const { events } = played();
    const { c } = restore(events);
    const s = c.status();
    const by = (id: string) => s.intents.find((i) => i.id === id);
    expect(s.started).toBe(true);
    expect(s.finished).toBe(false);
    expect(s.objective).toBe("auditer");
    expect(by("i1")).toMatchObject({
      state: "done",
      outcome: "needs_follow_up",
      summary: "à creuser",
      evidence: ["e1"],
    });
    expect(by("i2")?.state).toBe("blocked");
    expect(by("i3")).toMatchObject({ state: "open" });
    expect(by("i3")?.workerRunId).toBeUndefined();
    expect(by("i4")?.state).toBe("open");
    expect(s.maxWorkers).toBe(2);
    expect(s.spentUsd).toBe(0);
    expect(s.tokens).toBe(0);
  });

  it("une campagne finie : les intentions ouvertes (exhausted) redeviennent open", () => {
    const { events, c } = played();
    c.finish(reason("campaign.stopped", { cause: "user" }));
    const { c: restored } = restore(events);
    expect(restored.status().counts.open).toBe(2);
    expect(restored.status().counts.exhausted).toBe(0);
    expect(restored.status().finished).toBe(false);
  });

  it("le campaign.started restauré porte resumedFrom ; le nouveau journal se rejoue", () => {
    const { events, runId } = played();
    const { c, out } = restore(events);
    const started = out.find((e) => e.kind === "campaign.started");
    expect(started).toMatchObject({ kind: "campaign.started", resumedFrom: runId });
    expect(out.every((e) => validateEvent(e) === null)).toBe(true);
    // Reprise de la reprise : même état.
    const again = restore(out);
    expect(again.c.status().intents.map((i) => [i.id, i.state])).toEqual(
      c.status().intents.map((i) => [i.id, i.state]),
    );
  });

  it("les intentions open sont attribuables, les identifiants continuent, le budget repart à zéro", () => {
    const { events } = played();
    const { c } = restore(events, 3);
    expect(c.claimNext("n1")?.id).toBe("i3");
    expect(c.claimNext("n2")?.id).toBe("i4");
    expect(c.claimNext("n3")).toBeUndefined();
    const created = c.openIntents(2, [{ title: "E neuve", rationale: "r" }]);
    expect(created[0]?.id).toBe("i5");
    expect(code(() => c.openIntents(2, [{ title: "a  FAIT", rationale: "r" }]))).toBe(
      "campaign.duplicateIntent",
    );
  });

  it("refuse un journal incohérent", () => {
    const { events } = played();
    expect(code(() => restore([]))).toBe("campaign.restoreInvalid");
    const noStart = events.filter((e) => e.kind !== "campaign.started");
    expect(code(() => restore(noStart))).toBe("campaign.restoreInvalid");
    const unknown = events.map((e) =>
      e.kind === "campaign.intent.closed" ? { ...e, intentId: "i99" } : e,
    );
    expect(code(() => restore(unknown))).toBe("campaign.restoreInvalid");
    const claimUnknown = events.map((e) =>
      e.kind === "campaign.intent.claimed" ? { ...e, intentId: "zz" } : e,
    );
    expect(code(() => restore(claimUnknown))).toBe("campaign.restoreInvalid");
  });
});
