import { describe, expect, it } from "vitest";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";
import {
  DEFAULT_SUPERVISION,
  isSupervisionLevel,
  parseSupervision,
  SUPERVISION_LEVELS,
  SUPERVISION_SETTINGS,
  type SupervisionLevel,
} from "../src/supervision.js";

function fixture(level?: SupervisionLevel) {
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({ recorder, ...(level !== undefined && { supervision: level }) });
  let n = 0;
  let lastId = "";
  const call = (
    output: string,
    isError = false,
    tool = "read",
    input: Record<string, unknown> = { n },
  ) => {
    const toolUseId = `c${n++}`;
    recorder.emit({ kind: "tool.requested", toolUseId, tool, input });
    const result = recorder.emit({
      kind: "tool.result",
      toolUseId,
      output,
      isError,
      truncated: false,
      bytes: output.length,
    });
    lastId = result.id;
    return result;
  };
  const test = (conclusion: "finding" | "not-observed") =>
    desk.recordTest({
      objective: "Tester",
      target: "http://cible",
      testContext: "",
      method: "curl",
      observed: "rien",
      conclusion,
      evidenceIds: [lastId],
    });
  const cover = () =>
    desk.recordCoverage([{ surface: "/login", testClass: "sqli", state: "untested" }]);
  return { desk, call, test, cover };
}
const decide = {
  objective: "Cartographier",
  evidenceIds: [] as string[],
  nextAction: "Lister les routes",
  successCriterion: "Routes listées",
};
const guidance = (level?: SupervisionLevel, errors = 0) => {
  const f = fixture(level);
  for (let i = 0; i < errors; i++) f.call("boom", true);
  return f.desk.context().guidance.join("\n");
};

describe("table de réglages", () => {
  it("couvre chaque niveau, standard = seuils historiques", () => {
    expect(Object.keys(SUPERVISION_SETTINGS).sort()).toEqual([...SUPERVISION_LEVELS].sort());
    expect(SUPERVISION_SETTINGS.standard).toEqual({
      repeatThreshold: 2,
      maxTechs: 4,
      checkpointAfterCalls: null,
      coverageEveryTest: false,
    });
    expect(SUPERVISION_SETTINGS.light.repeatThreshold).toBe(3);
    expect(SUPERVISION_SETTINGS.light.checkpointAfterCalls).toBeNull();
    expect(SUPERVISION_SETTINGS.strict.repeatThreshold).toBe(1);
    expect(SUPERVISION_SETTINGS.strict.checkpointAfterCalls).toBe(8);
    expect(DEFAULT_SUPERVISION).toBe("standard");
  });
  it("valeur inconnue : standard", () => {
    expect(isSupervisionLevel("strict")).toBe(true);
    expect(isSupervisionLevel("max")).toBe(false);
    expect(parseSupervision("max")).toBe("standard");
    expect(parseSupervision(undefined)).toBe("standard");
    expect(parseSupervision("light")).toBe("light");
  });
});

describe("seuils de relance par niveau", () => {
  it("sans niveau = standard : relance à 2 erreurs, pas à 1", () => {
    expect(guidance(undefined, 1)).not.toContain("load_skill");
    expect(guidance(undefined, 2)).toContain("load_skill");
    expect(guidance("standard", 2)).toBe(guidance(undefined, 2));
  });
  it("light : relance à 3 erreurs seulement", () => {
    expect(guidance("light", 2)).not.toContain("changer une hypothèse");
    expect(guidance("light", 3)).toContain("changer une hypothèse");
  });
  it("strict : relance dès la première erreur", () => {
    expect(guidance("strict", 1)).toContain("changer une hypothèse");
  });
  it("recherche : erreur répétable dès la première en strict, à 3 en light", () => {
    const triggers = (level: SupervisionLevel, errors: number) => {
      const f = fixture(level);
      for (let i = 0; i < errors; i++) f.call("connexion refusée", true);
      return f.desk.context().research.triggers.map((r) => r.code);
    };
    expect(triggers("strict", 1)).toContain("research.repeatedError");
    expect(triggers("standard", 1)).not.toContain("research.repeatedError");
    expect(triggers("standard", 2)).toContain("research.repeatedError");
    expect(triggers("light", 2)).not.toContain("research.repeatedError");
    expect(triggers("light", 3)).toContain("research.repeatedError");
  });
});

describe("point de contrôle périodique", () => {
  const checkpoint = (reason: unknown) => (reason as { params?: { calls?: number } })?.params;
  it("strict : après 8 appels sans décision, dans mission_context, record_test et record_coverage", () => {
    const f = fixture("strict");
    for (let i = 0; i < 7; i++) f.call("ok");
    expect(f.desk.context().supervision).toEqual({ level: "strict" });
    expect(f.test("finding").supervision).toBeUndefined();
    f.call("ok");
    const ctx = f.desk.context();
    expect(ctx.supervision.level).toBe("strict");
    expect(ctx.supervision.checkpoint?.code).toBe("supervision.checkpoint");
    expect(checkpoint(ctx.supervision.checkpoint)).toEqual({ calls: 8 });
    expect(f.test("finding").supervision?.code).toBe("supervision.checkpoint");
    expect(f.cover().supervision?.code).toBe("supervision.checkpoint");
  });
  it("strict : une décision remet le compteur à zéro", () => {
    const f = fixture("strict");
    for (let i = 0; i < 9; i++) f.call("ok");
    const decided = f.desk.recordDecision(decide);
    expect(decided).not.toHaveProperty("supervision");
    expect(f.desk.context().supervision.checkpoint).toBeUndefined();
    expect(f.test("finding").supervision).toBeUndefined();
    for (let i = 0; i < 8; i++) f.call("ok");
    expect(f.desk.context().supervision.checkpoint).toBeDefined();
  });
  it("standard et light : jamais de point de contrôle", () => {
    for (const level of ["standard", "light"] as const) {
      const f = fixture(level);
      for (let i = 0; i < 20; i++) f.call("ok");
      expect(f.desk.context().supervision).toEqual({ level });
      expect(f.test("finding").supervision).toBeUndefined();
      expect(f.cover().supervision).toBeUndefined();
    }
  });
});

describe("relance de couverture", () => {
  it("strict : aussi dans un record_test positif ; standard : non positifs seulement", () => {
    for (const [level, expected] of [
      ["strict", true],
      ["standard", false],
      ["light", false],
    ] as const) {
      const f = fixture(level);
      f.call("ok");
      f.cover();
      expect(f.test("finding").coverage !== undefined).toBe(expected);
      expect(f.test("not-observed").coverage?.code).toBe("coverage.untested");
    }
  });
  it("aucun outil n'est bloqué : la réponse du test reste complète", () => {
    const f = fixture("strict");
    for (let i = 0; i < 10; i++) f.call("ok");
    expect(f.test("finding")).toMatchObject({ reviewed: false });
  });
});
