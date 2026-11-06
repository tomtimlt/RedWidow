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
