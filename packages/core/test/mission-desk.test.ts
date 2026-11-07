import { describe, expect, it } from "vitest";
import { deskToolSpecs } from "../src/agent-desk.js";
import { DEFAULT_POLICY, evaluatePolicy } from "../src/approval/policy.js";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";

function fixture() {
  let clock = 0;
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({ recorder, now: () => new Date(clock) });
  let n = 0;
  function result(output: string, isError = false, input = { query: "service" }, tool = "read") {
    const toolUseId = `call-${n++}`;
    recorder.emit({ kind: "tool.requested", toolUseId, tool, input });
    return recorder.emit({
      kind: "tool.result",
      toolUseId,
      output,
      isError,
      truncated: false,
      bytes: Buffer.byteLength(output),
    });
  }
  return {
    recorder,
    desk,
    result,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
const decision = {
  objective: "Vérifier le service",
  evidenceIds: [] as string[],
  nextAction: "Lire la version",
  successCriterion: "Version confirmée par une deuxième source",
};

describe("bureau de mission", () => {
  it("isole les runs, refuse les références étrangères et cesse d'observer après dispose", () => {
    const a = fixture();
    const b = fixture();
    const event = a.result("version 1");
    expect(b.desk.context().observations).toEqual([]);
    expect(() => b.desk.recordDecision({ ...decision, evidenceIds: [event.id] })).toThrow(
      "Référence inconnue",
    );
    a.desk.dispose();
    a.result("version 2");
    expect(() => a.desk.context()).toThrow("fermé");
  });
  it("masque avant rétention le prompt, les décisions et les observations", () => {
    const f = fixture();
    f.desk.beginTurn("password=topsecret");
    f.result("token=abcdefghi");
    f.desk.recordDecision({ ...decision, objective: "password=othersecret" });
    const packet = JSON.stringify(f.desk.context({ evidenceIds: ["token=abcdefghi"] }));
    expect(packet).not.toMatch(/topsecret|abcdefghi|othersecret/);
    expect(packet).toContain("[REDACTED]");
  });
  it("journalise uniquement une décision validée et masquée avec ses références", () => {
    const f = fixture();
    const events: import("../src/events.js").EngineEvent[] = [];
    f.recorder.subscribe((event) => events.push(event));
    const observed = f.result("preuve");
    f.desk.recordDecision({
      ...decision,
      objective: "password=othersecret",
      evidenceIds: [observed.id],
    });
    const saved = events.find((event) => event.kind === "mission.decision");
    expect(saved).toMatchObject({
      kind: "mission.decision",
      decision: { evidenceIds: [observed.id] },
    });
    expect(JSON.stringify(saved)).not.toContain("othersecret");
    expect(() => f.desk.recordDecision({ ...decision, evidenceIds: ["inconnu"] })).toThrow();
    expect(events.filter((event) => event.kind === "mission.decision")).toHaveLength(1);
  });
  it("comptabilise les budgets sans bloquer ni déduire une réussite", () => {
    const f = fixture();
    f.desk.recordDecision({ ...decision, maxCalls: 1, maxDurationSeconds: 2 });
    f.result("success");
    f.advance(3000);
    const packet = f.desk.context();
    expect(packet.budgets).toMatchObject({ calls: 1, exhausted: true, elapsedSeconds: 3 });
    expect(packet.guidance.join(" ")).toContain("ne bloque aucun outil");
    expect(packet.guidance.join(" ")).toContain("jamais une preuve automatique");
    expect(packet.currentDecision?.successCriterion).toBe(decision.successCriterion);
    f.desk.recordDecision(decision);
    expect(f.desk.context().budgets.exhausted).toBe(false);
  });
  it("détecte les répétitions et diminue l'aide après une sortie nouvelle", () => {
    const f = fixture();
    f.result("missing", true);
    f.result("missing", true);
    f.result("missing", true);
    expect(f.desk.context().metrics).toMatchObject({ stagnation: 2, repeatedErrors: 3 });
    expect(f.desk.context().guidance.join(" ")).toContain("changer une hypothèse");
    f.result("found");
    expect(f.desk.context().metrics).toMatchObject({ stagnation: 0, repeatedErrors: 0 });
    expect(f.desk.context().guidance.join(" ")).not.toContain("changer une hypothèse");
  });
  it("conserve les contradictions et explique la sélection lexicale", () => {
    const f = fixture();
    const a = f.result("service ouvert");
    f.result("service fermé");
    f.desk.recordDecision({ ...decision, evidenceIds: [a.id] });
    const packet = f.desk.context({ query: "service" });
    expect(packet.observations).toHaveLength(2);
    expect(packet.observations.some((o) => o.selectionReason?.includes("Termes communs"))).toBe(
      true,
    );
    expect(packet.currentDecision?.evidenceIds).toEqual([a.id]);
  });
  it("borne la rétention et les paquets sans casser les caractères Unicode", () => {
    const f = fixture();
    for (let i = 0; i < 140; i++) f.result(`${i} ${"😀".repeat(5000)}`);
    const packet = f.desk.context({ maxChars: 4000 });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(4000);
    expect(packet.omissions.evicted).toBe(12);
    expect(packet.observations.length).toBeGreaterThan(0);
    expect(packet.observations[0]?.truncated).toBe(true);
    expect(packet.observations[0]?.excerpt).not.toContain("�");
  });
  it("actualise les tâches et protège les snapshots contre les mutations", () => {
    const f = fixture();
    f.recorder.emit({
      kind: "task.updated",
      taskId: "t",
      phase: "started",
      description: "Lecture",
    });
    f.desk.recordDecision(decision);
    const snapshot = f.desk.context();
    expect(snapshot.activeTasks).toEqual([{ taskId: "t", status: "Lecture" }]);
    if (snapshot.currentDecision) snapshot.currentDecision.objective = "Mutation";
    expect(f.desk.context().currentDecision?.objective).toBe(decision.objective);
    f.recorder.emit({ kind: "task.updated", taskId: "t", phase: "finished" });
    expect(f.desk.context().activeTasks).toEqual([]);
  });
  it("sélectionne la consigne originale au moment du tour malgré un préfixe technique volumineux", () => {
    const f = fixture();
    f.recorder.emit({ kind: "user.message", text: "Vérifier uniquement ce service courant" });
    f.desk.beginTurn("métadonnées anciennes ".repeat(1000));
    expect(f.desk.context().prompt).toBe("Vérifier uniquement ce service courant");
    f.desk.beginTurn("Nouvelle consigne directe sans enveloppe moteur");
    expect(f.desk.context().prompt).toBe("Nouvelle consigne directe sans enveloppe moteur");
  });
  it("autorise uniquement les opérations locales exactes du bureau", () => {
    for (const tool of [
      "mcp__desk__mission_context",
      "mcp__desk__record_decision",
      "mcp__desk__record_test",
    ])
      expect(evaluatePolicy(DEFAULT_POLICY, tool, {}).decision).toBe("allow");
    expect(evaluatePolicy(DEFAULT_POLICY, "mcp__desk__exec", {}).decision).toBe("ask");
    expect(
      evaluatePolicy({ default: "deny", rules: [] }, "mcp__desk__mission_context", {}).decision,
    ).toBe("deny");
  });
  it("ne confond pas suivi répété d’une tâche avec stagnation et indique un registre incomplet", () => {
    const f = fixture();
    for (let n = 0; n < 4; n++)
      f.result("running", false, { query: "service" }, "mcp__kali__task_status_json");
    expect(f.desk.context().metrics.stagnation).toBe(0);
    expect(f.desk.context().taskRegistry.incomplete).toBe(true);
  });
  it("préserve load_skill et exclut les requêtes du bureau des métriques", async () => {
    const f = fixture();
    expect(deskToolSpecs().map((s) => s.name)).toEqual(["load_skill"]);
    const specs = deskToolSpecs(f.desk);
    expect(specs.map((s) => s.name)).toEqual([
      "load_skill",
      "record_test",
      "record_coverage",
      "program_draft",
      "mission_context",
      "record_decision",
    ]);
    f.result("context", false, { query: "service" }, "mcp__desk__mission_context");
    expect(f.desk.context().metrics.toolCalls).toBe(0);
    const load = specs[0];
    if (!load) throw new Error("load_skill absent");
    const loaded = JSON.parse(
      await load.run(
        { profile: "htb", section: "verification" },
        { parentId: null, correlation: undefined, signal: undefined },
      ),
    );
    expect(loaded.upstream).toHaveProperty("text");
  });
});

it("record_test exige des preuves de ce run, masque les annotations et ne donne aucun statut humain", () => {
  const f = fixture(),
    other = fixture(),
    e = f.result("HTTP 403");
  const claim = {
    objective: "Test accès",
    target: "lab",
    testContext: "anonyme",
    method: "HTTP GET",
    observed: "token=private1234",
    conclusion: "not-observed" as const,
    evidenceIds: [e.id],
  };
  expect(() => other.desk.recordTest(claim)).toThrow("Référence inconnue");
  const events: unknown[] = [];
  f.recorder.subscribe((e) => events.push(e));
  expect(f.desk.recordTest(claim)).toMatchObject({ runId: "run", reviewed: false });
  expect(JSON.stringify(events)).not.toContain("private1234");
  const forged = { ...claim, reviewed: true };
  expect(() => f.desk.recordTest(forged)).toThrow();
  expect(
    evaluatePolicy({ default: "deny", rules: [] }, "mcp__desk__record_test", {}).decision,
  ).toBe("deny");
  expect(evaluatePolicy(DEFAULT_POLICY, "mcp__desk__record_test_exec", {}).decision).toBe("ask");
});

describe("matrice de couverture", () => {
  function setup() {
    const f = fixture();
    const e = f.result("HTTP 403");
    const claim = {
      objective: "Test IDOR",
      target: "lab",
      testContext: "anonyme",
      method: "HTTP GET",
      observed: "403",
      conclusion: "finding" as const,
      evidenceIds: [e.id],
    };
    const test = f.desk.recordTest(claim);
    return { ...f, evidence: e, claim, test };
  }
  const cell = { surface: "/api/users", parameter: "id", testClass: "IDOR" };

  it("upsert par clé normalisée (casse et espaces) et événement audit.coverage", () => {
    const f = fixture();
    const events: { kind: string }[] = [];
    f.recorder.subscribe((e) => events.push(e));
    f.desk.recordCoverage([{ ...cell, state: "untested" }]);
    const out = f.desk.recordCoverage([
      {
        surface: "  /API/users ",
        parameter: "ID",
        testClass: "idor",
        state: "blocked",
        note: "WAF",
      },
    ]);
    expect(out.written).toBe(1);
    expect(out.coverage).toMatchObject({
      total: 1,
      coveredPercent: 100,
      counts: { blocked: 1, untested: 0 },
    });
    expect(events.filter((e) => e.kind === "audit.coverage")).toHaveLength(2);
  });

  it("refuse un testRef inconnu, un négatif ou un confirmé sans testRef, sans rien écrire", () => {
    const f = setup();
    expect(() =>
      f.desk.recordCoverage([{ ...cell, state: "negative", testRefs: ["inconnu"] }]),
    ).toThrow(expect.objectContaining({ code: "coverage.testRefUnknown" }));
    // Un événement du run qui n'est pas un audit.test n'est pas citable.
    expect(() =>
      f.desk.recordCoverage([{ ...cell, state: "confirmed", testRefs: [f.evidence.id] }]),
    ).toThrow(expect.objectContaining({ code: "coverage.testRefUnknown" }));
    for (const state of ["negative", "confirmed"] as const)
      expect(() => f.desk.recordCoverage([{ ...cell, state }])).toThrow(
        expect.objectContaining({ code: "coverage.testRefRequired" }),
      );
    // Lot atomique : une case valide suivie d'une invalide n'écrit rien.
    expect(() =>
      f.desk.recordCoverage([
        { surface: "a", testClass: "x", state: "untested" },
        { ...cell, state: "negative" },
      ]),
    ).toThrow();
    expect(f.desk.context().coverage.total).toBe(0);
    expect(() => f.desk.recordCoverage([])).toThrow();
    expect(() => f.desk.recordCoverage([{ ...cell, state: "bogus" } as never])).toThrow();
  });

  it("accepte un testRef issu de record_test et refuse celui d'un autre run", () => {
    const f = setup();
    const other = setup();
    expect(
      f.desk.recordCoverage([{ ...cell, state: "negative", testRefs: [f.test.eventId] }]).coverage
        .counts.negative,
    ).toBe(1);
    expect(() =>
      f.desk.recordCoverage([{ ...cell, state: "negative", testRefs: [other.test.eventId] }]),
    ).toThrow(expect.objectContaining({ code: "coverage.testRefUnknown" }));
  });

  it("expose le résumé dans mission_context (≤ 20 non testées listées)", () => {
    const f = fixture();
    f.desk.recordCoverage(
      Array.from({ length: 25 }, (_, n) => ({
        surface: `/s${n}`,
        testClass: "XSS",
        state: "untested" as const,
      })),
    );
    f.desk.recordCoverage([{ surface: "/ok", testClass: "XSS", state: "blocked" }]);
    const { coverage } = f.desk.context();
    expect(coverage).toMatchObject({
      total: 26,
      coveredPercent: 4,
      counts: { untested: 25, blocked: 1, negative: 0, prerequisite: 0, confirmed: 0 },
      untestedOmitted: 5,
    });
    expect(coverage.untested).toHaveLength(20);
    expect(f.desk.context({ maxChars: 2048 }).coverage.untested.length).toBeLessThanOrEqual(20);
  });

  it("relance coverage.untested à la clôture et sur un test non positif, sans bloquer", () => {
    const f = setup();
    f.desk.recordCoverage([{ ...cell, state: "untested" }]);
    const closing = {
      ...decision,
      objective: "Conclure la mission",
      nextAction: "Rédiger le rapport final et terminer",
    };
    const reply = f.desk.recordDecision(closing);
    expect(reply.coverage).toMatchObject({
      code: "coverage.untested",
      params: { count: 1, examples: "/api/users / id / IDOR" },
    });
    // Décision ordinaire : aucune relance.
    expect(f.desk.recordDecision(decision).coverage).toBeUndefined();
    // Test non positif : relance ; test positif : aucune.
    expect(f.desk.recordTest({ ...f.claim, conclusion: "inconclusive" }).coverage?.code).toBe(
      "coverage.untested",
    );
    expect(f.desk.recordTest(f.claim).coverage).toBeUndefined();
  });

  it("aucune relance quand tout est couvert ou sans matrice", () => {
    const f = setup();
    expect(
      f.desk.recordDecision({ ...decision, nextAction: "Terminer la mission" }).coverage,
    ).toBeUndefined();
    f.desk.recordCoverage([{ ...cell, state: "untested" }]);
    f.desk.recordCoverage([{ ...cell, state: "confirmed", testRefs: [f.test.eventId] }]);
    expect(
      f.desk.recordDecision({ ...decision, nextAction: "Terminer la mission" }).coverage,
    ).toBeUndefined();
    expect(f.desk.recordTest({ ...f.claim, conclusion: "not-observed" }).coverage).toBeUndefined();
  });

  it("outil desk record_coverage : politique allow, aucune demande bloquée", async () => {
    const f = fixture();
    const spec = deskToolSpecs(f.desk).find((s) => s.name === "record_coverage");
    expect(spec?.readOnly).toBe(false);
    const out = JSON.parse(
      (await spec?.run({ cells: [{ ...cell, state: "untested" }] }, {} as never)) as string,
    );
    expect(out.coverage.total).toBe(1);
    expect(evaluatePolicy(DEFAULT_POLICY, "mcp__desk__record_coverage", {}).decision).toBe("allow");
    expect(evaluatePolicy(DEFAULT_POLICY, "mcp__desk__record_coverage_exec", {}).decision).toBe(
      "ask",
    );
  });
});
