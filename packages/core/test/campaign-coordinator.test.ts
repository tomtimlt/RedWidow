import { describe, expect, it } from "vitest";
import {
  type CampaignCoordinatorOptions,
  CodedError,
  createCampaignCoordinator,
  createRecorder,
  type EngineEvent,
  normalizeIntentKey,
  reason,
  validateEvent,
} from "../src/index.js";

function setup(options: Partial<CampaignCoordinatorOptions> = {}) {
  const events: EngineEvent[] = [];
  const recorder = createRecorder({ redact: false });
  recorder.subscribe((e) => events.push(e));
  const coordinator = createCampaignCoordinator({ recorder, now: () => 1000, ...options });
  coordinator.start("auditer l'application");
  return { coordinator, events };
}

const draft = (title: string) => ({ title, rationale: "pourquoi" });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof CodedError) return error.code;
    throw error;
  }
  return undefined;
}

describe("coordinateur de campagne", () => {
  it("normalise les clés : casse, ponctuation, espaces", () => {
    expect(normalizeIntentKey("  SQL-Injection !!  sur /login ")).toBe("sql injection sur login");
    expect(normalizeIntentKey("Éléments\tCachés")).toBe("éléments cachés");
  });

  it("valide la configuration (workers de 1 à 8, défaut 3)", () => {
    const recorder = createRecorder({ redact: false });
    expect(codeOf(() => createCampaignCoordinator({ recorder, maxWorkers: 0 }))).toBe(
      "campaign.invalidInput",
    );
    expect(codeOf(() => createCampaignCoordinator({ recorder, maxWorkers: 9 }))).toBe(
      "campaign.invalidInput",
    );
    expect(createCampaignCoordinator({ recorder }).status().maxWorkers).toBe(3);
    expect(createCampaignCoordinator({ recorder, maxWorkers: 8 }).status().maxWorkers).toBe(8);
  });

  it("refuse toute opération avant start et un second start", () => {
    const recorder = createRecorder({ redact: false });
    const c = createCampaignCoordinator({ recorder });
    expect(codeOf(() => c.openIntents(1, [draft("a")]))).toBe("campaign.notStarted");
    expect(codeOf(() => c.claimNext("w1"))).toBe("campaign.notStarted");
    c.start("x");
    expect(codeOf(() => c.start("y"))).toBe("campaign.alreadyStarted");
  });

  it("plafonne à 4 intentions ouvertes par tour, tout ou rien", () => {
    const { coordinator } = setup();
    expect(coordinator.openIntents(1, [draft("a"), draft("b"), draft("c")])).toHaveLength(3);
    expect(codeOf(() => coordinator.openIntents(1, [draft("d"), draft("e")]))).toBe(
      "campaign.roundCap",
    );
    // Le lot refusé n'a rien créé ; un autre tour repart à zéro.
    expect(coordinator.status().intents).toHaveLength(3);
    expect(coordinator.openIntents(1, [draft("d")])).toHaveLength(1);
    expect(coordinator.openIntents(2, [draft("e")])).toHaveLength(1);
  });

  it("refuse un doublon exact de clé (casse, ponctuation) parmi open, claimed, done", () => {
    const { coordinator } = setup();
    coordinator.openIntents(1, [draft("SQL injection")]);
    expect(codeOf(() => coordinator.openIntents(2, [draft("sql-INJECTION!")]))).toBe(
      "campaign.duplicateIntent",
    );
    const claimed = coordinator.claimNext("w1");
    expect(codeOf(() => coordinator.openIntents(2, [draft("  Sql   injection ")]))).toBe(
      "campaign.duplicateIntent",
    );
    coordinator.close(claimed?.id ?? "", "w1", {
      outcome: "ruled_out",
      summary: "rien",
      evidence: [],
    });
    expect(codeOf(() => coordinator.openIntents(2, [draft("sql injection")]))).toBe(
      "campaign.duplicateIntent",
    );
    // Doublon à l'intérieur du même lot : refusé, rien n'est créé.
    expect(codeOf(() => coordinator.openIntents(3, [draft("xss"), draft("XSS.")]))).toBe(
      "campaign.duplicateIntent",
    );
    expect(coordinator.status().intents).toHaveLength(1);
  });

  it("accepte à nouveau une direction dont l'intention est blocked", () => {
    const { coordinator } = setup();
    const [first] = coordinator.openIntents(1, [draft("ssrf")]);
    coordinator.claimNext("w1");
    coordinator.abandon(first?.id ?? "", "w1");
    expect(coordinator.openIntents(2, [draft("SSRF")])).toHaveLength(1);
  });

  it("claimNext est atomique, ordonné et respecte maxWorkers", () => {
    const { coordinator } = setup({ maxWorkers: 2 });
    coordinator.openIntents(1, [draft("a"), draft("b"), draft("c")]);
    expect(coordinator.claimNext("w1")?.title).toBe("a");
    expect(coordinator.claimNext("w2")?.title).toBe("b");
    expect(coordinator.claimNext("w3")).toBeUndefined();
    expect(coordinator.status().counts).toMatchObject({ open: 1, claimed: 2 });
    // Une place se libère : la suivante est attribuée.
    coordinator.close("i1", "w1", { outcome: "reported", summary: "ok", evidence: ["e1"] });
    expect(coordinator.claimNext("w3")?.title).toBe("c");
    expect(coordinator.claimNext("w4")).toBeUndefined();
  });

  it("close : seulement par le worker qui a pris l'intention", () => {
    const { coordinator } = setup();
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.claimNext("w1");
    const closure = { outcome: "no_issue_found" as const, summary: "r", evidence: [] };
    expect(codeOf(() => coordinator.close("i1", "w2", closure))).toBe("campaign.notClaimant");
    // Intention encore ouverte : aucun détenteur.
    expect(codeOf(() => coordinator.close("i2", "w1", closure))).toBe("campaign.notClaimant");
    expect(codeOf(() => coordinator.close("zz", "w1", closure))).toBe("campaign.unknownIntent");
    const done = coordinator.close("i1", "w1", { ...closure, evidence: ["e1", "e2"] });
    expect(done).toMatchObject({
      state: "done",
      outcome: "no_issue_found",
      evidence: ["e1", "e2"],
    });
    expect(done.closedAt).toBe(1000);
    // Seconde fermeture : l'état n'est plus claimed.
    expect(codeOf(() => coordinator.close("i1", "w1", closure))).toBe("campaign.invalidTransition");
    expect(
      codeOf(() => coordinator.close("i1", "w1", { ...closure, outcome: "nope" as never })),
    ).toBe("campaign.invalidTransition");
  });

  it("close refuse un verdict ou des preuves mal formés", () => {
    const { coordinator } = setup();
    coordinator.openIntents(1, [draft("a")]);
    coordinator.claimNext("w1");
    expect(
      codeOf(() =>
        coordinator.close("i1", "w1", { outcome: "nope" as never, summary: "", evidence: [] }),
      ),
    ).toBe("campaign.invalidInput");
    expect(
      codeOf(() =>
        coordinator.close("i1", "w1", {
          outcome: "reported",
          summary: "",
          evidence: [3 as never],
        }),
      ),
    ).toBe("campaign.invalidInput");
    expect(coordinator.status().counts.claimed).toBe(1);
  });

  it("abandon : claimed → blocked, libère la place, refusé pour un autre worker", () => {
    const { coordinator } = setup({ maxWorkers: 1 });
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.claimNext("w1");
    expect(coordinator.claimNext("w2")).toBeUndefined();
    expect(codeOf(() => coordinator.abandon("i1", "w2"))).toBe("campaign.notClaimant");
    expect(coordinator.abandon("i1", "w1").state).toBe("blocked");
    expect(coordinator.claimNext("w2")?.id).toBe("i2");
    expect(codeOf(() => coordinator.abandon("i1", "w1"))).toBe("campaign.invalidTransition");
  });

  it("budget d'intentions : refus au-delà du plafond", () => {
    const { coordinator } = setup({ budget: { maxIntents: 2 } });
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    expect(codeOf(() => coordinator.openIntents(2, [draft("c")]))).toBe("campaign.budgetExhausted");
  });

  it("budget en dollars : plus d'ouverture ni d'attribution une fois atteint", () => {
    const { coordinator } = setup({ budget: { maxUsd: 1 } });
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.recordSpend(0.4);
    expect(coordinator.claimNext("w1")?.id).toBe("i1");
    coordinator.recordSpend(0.6);
    expect(coordinator.claimNext("w2")).toBeUndefined();
    expect(codeOf(() => coordinator.openIntents(2, [draft("c")]))).toBe("campaign.budgetExhausted");
    expect(coordinator.status().spentUsd).toBeCloseTo(1);
    expect(codeOf(() => coordinator.recordSpend(-1))).toBe("campaign.invalidInput");
    expect(codeOf(() => coordinator.recordSpend(Number.NaN))).toBe("campaign.invalidInput");
  });

  it("finish : refuse d'ouvrir, n'attribue plus, épuise les intentions ouvertes", () => {
    const { coordinator, events } = setup();
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.claimNext("w1");
    coordinator.finish(reason("campaign.finished"));
    coordinator.finish(reason("campaign.finished")); // idempotent
    expect(codeOf(() => coordinator.openIntents(2, [draft("c")]))).toBe("campaign.finished");
    expect(coordinator.claimNext("w2")).toBeUndefined();
    const status = coordinator.status();
    expect(status.finished).toBe(true);
    expect(status.counts).toMatchObject({ claimed: 1, exhausted: 1, open: 0 });
    expect(events.filter((e) => e.kind === "campaign.finished")).toHaveLength(1);
  });

  it("émet des événements valides, dans l'ordre", () => {
    const { coordinator, events } = setup();
    coordinator.openIntents(1, [draft("a"), draft("b")]);
    coordinator.claimNext("w1");
    coordinator.claimNext("w2");
    coordinator.close("i1", "w1", { outcome: "reported", summary: "trouvé", evidence: ["e1"] });
    coordinator.abandon("i2", "w2");
    coordinator.recordSpend(0.25);
    coordinator.finish(reason("campaign.finished"));
    expect(events.map((e) => e.kind)).toEqual([
      "campaign.started",
      "campaign.intent.opened",
      "campaign.intent.opened",
      "campaign.intent.claimed",
      "campaign.intent.claimed",
      "campaign.intent.closed",
      "campaign.intent.closed",
      "campaign.finished",
    ]);
    for (const e of events) expect(validateEvent(e)).toBeNull();
    expect(events[5]).toMatchObject({ outcome: "reported", evidence: ["e1"] });
    expect(events[6]).toMatchObject({ outcome: "blocked", workerRunId: "w2" });
    expect(events[7]).toMatchObject({ done: 1, blocked: 1, exhausted: 0, spentUsd: 0.25 });
  });

  it("masque les secrets via le recorder", () => {
    const recorder = createRecorder();
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const c = createCampaignCoordinator({ recorder });
    c.start("clé sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(JSON.stringify(events[0])).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("status renvoie un instantané immuable et indépendant de l'état", () => {
    const { coordinator } = setup();
    coordinator.openIntents(1, [draft("a")]);
    const before = coordinator.status();
    coordinator.claimNext("w1");
    expect(before.intents[0]?.state).toBe("open");
    expect(before.counts.open).toBe(1);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.intents)).toBe(true);
    expect(Object.isFrozen(before.intents[0])).toBe(true);
    expect(() => {
      (before.counts as { open: number }).open = 9;
    }).toThrow();
    expect(coordinator.status().counts).toMatchObject({ open: 0, claimed: 1 });
  });
});
