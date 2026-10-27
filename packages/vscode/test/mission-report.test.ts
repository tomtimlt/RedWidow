import type { Finding } from "@warband/core";
import { expect, it } from "vitest";
import { missionReport } from "../src/logic/mission-report.js";

it("exporte un brouillon sourcé sans identifiants, loot, fausse gravité ou lien vers un nœud exclu", () => {
  const findings: Finding[] = [
    { id: "a", kind: "host", label: "Serveur", state: "confirmed" },
    {
      id: "b",
      kind: "step",
      label: "<img src=x> **test**",
      state: "hypothesis",
      from: ["a"],
      pathFrom: ["a"],
    },
    { id: "c", kind: "credential", label: "SECRET-PASSWORD", state: "confirmed" },
    {
      id: "d",
      kind: "loot",
      label: "FLAG-SECRET",
      state: "confirmed",
      from: ["b"],
      pathFrom: ["b"],
    },
  ];
  const report = missionReport(
    { id: "project", name: "Mission" },
    findings,
    new Date("2026-10-27T00:00:00Z"),
  );
  expect(report).toContain("Brouillon");
  expect(report).toContain("2026-10-27T00:00:00.000Z");
  expect(report).toContain("Serveur →");
  expect(report).not.toMatch(/SECRET-PASSWORD|FLAG-SECRET|<img|\*\*test\*\*|CVSS: 9/);
  expect(report).toContain("Preuve, chemin d’artefact");
  expect(report).toContain("à évaluer");
});
