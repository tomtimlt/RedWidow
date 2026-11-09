import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deskToolSpecs } from "../src/agent-desk.js";
import { DEFAULT_POLICY, evaluatePolicy } from "../src/approval/policy.js";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";

function fixture() {
  let clock = 0;
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({
    recorder,
    now: () => new Date(clock),
    mission: { profile: "bug-bounty", containers: ["laboratoire"] },
  });
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
      "record_step",
      "record_teardown",
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
  expect(() => other.desk.recordTest(claim)).toThrow();
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

describe("continuationPrompt", () => {
  const cell = { surface: "/api/users", parameter: "id", testClass: "IDOR" };
  it("null sans piste ouverte (matrice vide ou tout couvert)", () => {
    const f = fixture();
    expect(f.desk.continuationPrompt()).toBeNull();
    const e = f.result("HTTP 403");
    const t = f.desk.recordTest({
      objective: "Test IDOR",
      target: "lab",
      testContext: "",
      method: "GET",
      observed: "403",
      conclusion: "not-observed",
      evidenceIds: [e.id],
    });
    f.desk.recordCoverage([{ ...cell, state: "negative", testRefs: [t.eventId] }]);
    expect(f.desk.continuationPrompt()).toBeNull();
  });
  it("ne relance que les cases untested ou blocked avançables", () => {
    const f = fixture();
    const e = f.result("HTTP 403");
    const t = f.desk.recordTest({
      objective: "Test IDOR",
      target: "lab",
      testContext: "",
      method: "GET",
      observed: "403",
      conclusion: "not-observed",
      evidenceIds: [e.id],
    });
    f.desk.recordCoverage([
      { ...cell, state: "untested" },
      { surface: "/admin", testClass: "authz", state: "blocked", note: "WAF" },
      {
        surface: "/upload",
        testClass: "rce",
        state: "negative",
        testRefs: [t.eventId],
        note: "Variante à explorer",
      },
    ]);
    const out = f.desk.continuationPrompt();
    expect(out?.openLeads).toBe(2);
    expect(out?.prompt).toContain("sans conclure");
    expect(out?.prompt).toContain("/api/users");
    expect(out?.prompt).toContain("/admin");
    expect(out?.prompt).not.toContain("/upload");
  });
  it("attend les blocages externes uniquement quand aucune piste avançable ne subsiste", () => {
    const f = fixture();
    f.desk.recordCoverage([
      { ...cell, state: "prerequisite", note: "Compte requis" },
      { surface: "/site", testClass: "authz", state: "blocked", note: "Domaine mort" },
      { surface: "/autre", testClass: "authz", state: "untested" },
    ]);
    expect(f.desk.continuationPrompt()?.openLeads).toBe(1);
    expect(f.desk.waitingHuman()).toBeNull();
    f.desk.recordCoverage([
      { surface: "/autre", testClass: "authz", state: "blocked", note: "Action humaine requise" },
    ]);
    expect(f.desk.continuationPrompt()).toBeNull();
    expect(f.desk.waitingHuman()).toMatchObject({
      openLeads: 3,
      reasons: expect.arrayContaining([expect.stringContaining("Domaine mort")]),
    });
  });
  it("attend un compte pour une case non testée et ignore la recherche web générique", () => {
    const f = fixture();
    f.recorder.emit({
      kind: "session.started",
      sessionId: "s",
      model: "m",
      tools: ["mcp__web__search_web"],
    });
    f.desk.recordCoverage([{ ...cell, state: "untested", note: "Compte requis" }]);
    expect(f.desk.continuationPrompt()).toBeNull();
    expect(f.desk.waitingHuman()).toMatchObject({ openLeads: 1 });
    f.desk.recordCoverage([{ ...cell, state: "prerequisite", note: "Compte requis" }]);
    expect(f.desk.continuationPrompt()).toBeNull();
    expect(f.desk.waitingHuman()).toMatchObject({ openLeads: 1 });
  });
  it("continue une case lorsque le compte est fourni", () => {
    const f = fixture();
    f.desk.recordCoverage([{ ...cell, state: "untested", note: "Compte fourni, test à faire" }]);
    expect(f.desk.continuationPrompt()?.openLeads).toBe(1);
    expect(f.desk.waitingHuman()).toBeNull();
  });
  it("plafonne la liste à 5 pistes mais compte toutes les pistes ouvertes", () => {
    const f = fixture();
    f.desk.recordCoverage(
      Array.from({ length: 8 }, (_, i) => ({
        surface: `/route-${i}`,
        testClass: "sqli",
        state: "untested" as const,
      })),
    );
    const out = f.desk.continuationPrompt();
    expect(out?.openLeads).toBe(8);
    expect(out?.prompt.split("\n").filter((l) => l.startsWith("- /route-"))).toHaveLength(5);
    expect(out?.prompt).toContain("3 autre(s)");
  });
  it("signale l'absence de recherche web quand les outils web sont exposés", () => {
    const f = fixture();
    f.recorder.emit({
      kind: "session.started",
      sessionId: "s",
      model: "m",
      tools: ["mcp__web__search_web"],
    });
    expect(f.desk.continuationPrompt()).toMatchObject({ openLeads: 1 });
    expect(f.desk.continuationPrompt()?.prompt).toContain("recherche web");
    f.result("{}", false, { query: "x" }, "mcp__web__search_web");
    expect(f.desk.continuationPrompt()).toBeNull();
  });
  it("null sous arrêt d'urgence, y compris illisible (fail-closed)", () => {
    const unreadable = () => {
      throw new Error("illisible");
    };
    for (const halted of [() => true, unreadable]) {
      const recorder = createRecorder({ runId: "run", redact: false });
      const desk = createMissionDesk({ recorder, halted });
      desk.recordCoverage([{ ...cell, state: "untested" }]);
      expect(desk.continuationPrompt()).toBeNull();
    }
  });
});

describe("stagnation d'approche", () => {
  it("détectée quand seul un paramètre change et que le résultat reste quasi identique", () => {
    const f = fixture();
    const body = "<html>404 not found</html>";
    f.result(body, false, { command: "curl http://cible/a" } as never, "execute_command");
    f.result(`${body}.`, false, { command: "curl http://cible/b?x=2" } as never, "execute_command");
    f.result(`${body}..`, false, { command: "curl -s http://cible/c" } as never, "execute_command");
    expect(f.desk.context().metrics).toMatchObject({ stagnation: 0, approachStagnation: 2 });
    const guidance = f.desk.context().guidance.join(" ");
    expect(guidance).toContain("changer une hypothèse");
    expect(guidance).toContain("execute_command curl");
  });
  it("même hôte+chemin d'URL, requête variable ; une sortie différente remet à zéro", () => {
    const f = fixture();
    const page = "x".repeat(400);
    const tool = "mcp__web__http_request";
    for (const q of ["1", "2", "3"])
      f.result(page, false, { url: `http://cible/login?id=${q}` } as never, tool);
    expect(f.desk.context().metrics.approachStagnation).toBe(2);
    expect(f.desk.context().guidance.join(" ")).toContain("cible/login");
    f.result("y".repeat(40), false, { url: "http://cible/login?id=4" } as never, tool);
    expect(f.desk.context().metrics.approachStagnation).toBe(0);
  });
  it("ignore les appels sans commande ni URL", () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) f.result("même sortie", false, { n: i } as never, "read");
    expect(f.desk.context().metrics.approachStagnation).toBe(0);
  });
});

describe("réduction du paquet", () => {
  it("garde les relances et sacrifie les consignes de fond puis les observations", () => {
    const f = fixture();
    f.desk.recordCoverage(
      Array.from({ length: 15 }, (_, i) => ({
        surface: `/s${i}-${"p".repeat(150)}`,
        testClass: "sqli",
        state: "untested" as const,
      })),
    );
    for (let i = 0; i < 40; i++) f.result(`observation ancienne ${i} ${"z".repeat(300)}`);
    f.result("missing", true);
    f.result("missing", true);
    const packet = f.desk.context({ maxChars: 2048 });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(2048);
    expect(packet.guidance.join(" ")).toContain("changer une hypothèse");
    expect(packet.guidance.join(" ")).not.toContain("jamais une preuve automatique");
    expect(packet.coverage.counts.untested).toBe(15);
  });
});

it("relance dès la première technologie observée et ne répète pas sa note", () => {
  const f = fixture();
  f.result(
    JSON.stringify({ headers: { server: "nginx/1.2.3" } }),
    false,
    { query: "service" },
    "mcp__web__http_request",
  );
  const first = f.desk.pendingNudge();
  expect(first).toContain("nginx");
  expect(first?.length).toBeLessThanOrEqual(300);
  expect(f.desk.pendingNudge()).toBeNull();
  for (let i = 0; i < 8; i++) f.result("résultat nouveau");
  expect(f.desk.pendingNudge()).toBeNull();
  f.desk.dispose();
});

describe("preuves du contrôle", () => {
  const claim = {
    objective: "Contrôle",
    target: "lab",
    testContext: "test",
    method: "lecture",
    observed: "résultat",
    conclusion: "inconclusive" as const,
    evidenceIds: ["inconnu"],
  };
  it("accepte les identifiants d'appels terminés du run seulement", () => {
    const f = fixture();
    for (const tool of [
      "mcp__docker__exec",
      "mcp__docker__task_status",
      "mcp__web__http_request",
      "mcp__docker__read_output",
    ]) {
      const event = f.result("ok", false, { query: "test" }, tool);
      if (event.kind !== "tool.result") throw new Error("Résultat attendu");
      f.desk.recordTest({ ...claim, evidenceIds: [event.toolUseId], sources: [event.toolUseId] });
    }
    f.recorder.emit({ kind: "tool.requested", tool: "exec", toolUseId: "pending", input: {} });
    expect(() => f.desk.recordTest({ ...claim, evidenceIds: ["pending"] })).toThrow();
    expect(() => fixture().desk.recordTest({ ...claim, evidenceIds: ["call-0"] })).toThrow();
  });
  it("journalise l'empreinte des seuls fichiers admissibles produits pendant le run", () => {
    const workspace = mkdtempSync(join(tmpdir(), "mission-evidence-"));
    try {
      mkdirSync(join(workspace, "scans"));
      mkdirSync(join(workspace, "autre"));
      writeFileSync(join(workspace, "scans", "ancien"), "ancien");
      utimesSync(join(workspace, "scans", "ancien"), new Date(0), new Date(0));
      const recorder = createRecorder({ runId: "run", redact: false });
      const desk = createMissionDesk({
        recorder,
        workspace,
        now: () => new Date(Date.now() - 1000),
      });
      const events: import("../src/events.js").EngineEvent[] = [];
      recorder.subscribe((e) => events.push(e));
      writeFileSync(join(workspace, "scans", "resultat"), "preuve");
      writeFileSync(join(workspace, "autre", "resultat"), "preuve");
      symlinkSync("resultat", join(workspace, "scans", "lien"));
      desk.recordDecision(decision);
      desk.recordTest({ ...claim, evidenceIds: ["scans/resultat"], sources: ["scans/resultat"] });
      expect(events.find((e) => e.kind === "audit.test")).toMatchObject({
        files: [
          { path: "scans/resultat", sha256: createHash("sha256").update("preuve").digest("hex") },
        ],
      });
      for (const path of [
        "scans/ancien",
        "autre/resultat",
        "scans/../autre/resultat",
        join(workspace, "scans", "resultat"),
        "scans/lien",
        "scans",
        "scans/absent",
      ]) {
        expect(() => desk.recordTest({ ...claim, evidenceIds: [path] })).toThrow();
      }
      expect(events.filter((e) => e.kind === "audit.test")).toHaveLength(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

it("refuse une preuve ancienne retouchée et une racine remplacée", () => {
  const parent = mkdtempSync(join(tmpdir(), "mission-root-"));
  try {
    const workspace = join(parent, "projet");
    mkdirSync(workspace);
    mkdirSync(join(workspace, "scans"));
    const ancien = join(workspace, "scans", "ancien");
    writeFileSync(ancien, "ancien");
    const runStart = Math.floor(statSync(ancien).birthtimeMs) + 1;
    const recorder = createRecorder({ runId: "run", redact: false });
    const desk = createMissionDesk({ recorder, workspace, now: () => new Date(runStart) });
    utimesSync(ancien, new Date(runStart + 10000), new Date(runStart + 10000));
    const claim = {
      objective: "Contrôle",
      target: "lab",
      testContext: "test",
      method: "lecture",
      observed: "résultat",
      conclusion: "inconclusive" as const,
      evidenceIds: ["scans/ancien"],
    };
    expect(() => desk.recordTest(claim)).toThrow();
    renameSync(workspace, join(parent, "ancien-projet"));
    mkdirSync(workspace);
    mkdirSync(join(workspace, "scans"));
    writeFileSync(join(workspace, "scans", "ancien"), "remplacé");
    expect(() => desk.recordTest(claim)).toThrow();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
