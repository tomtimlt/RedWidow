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

it("rapproche notes et contrôles du même instantané en signalant les références absentes", async () => {
  const { missionSnapshot } = await import("../src/logic/mission-snapshot.js");
  const { killchainImage } = await import("../src/logic/killchain-image.js");
  const findings: Finding[] = [
    {
      id: "a",
      kind: "step",
      label: "Vérification",
      state: "confirmed",
      evidenceIds: ["e1", "missing"],
    },
  ];
  const audit = {
    enabled: true,
    records: [],
    bytes: 0,
    health: { incomplete: true, failedEntries: 1 },
    viewLimited: true,
    tests: [
      {
        id: "test",
        objective: "Contrôle",
        target: "test",
        method: "lecture",
        observed: "fait",
        testContext: "",
        execution: "returned" as const,
        conclusion: "unreviewed" as const,
        author: "agent" as const,
        reviewed: false,
        evidenceIds: ["e1", "unknown"],
        ts: "2026-10-01T00:00:00Z",
        startedAt: "2026-10-01T00:00:00Z",
      },
    ],
  };
  const evidence = [
    {
      id: "e1",
      label: "preuve",
      text: "",
      sha256: "x",
      capturedAt: "2026-10-01T00:00:00Z",
      source: { kind: "tool" as const, reference: "r" },
    },
  ];
  const snapshot = missionSnapshot(findings, audit, evidence);
  const report = missionReport(
    { id: "p", name: "Mission" },
    snapshot.findings,
    new Date("2026-10-01T00:00:00Z"),
    "fr",
    snapshot,
  );
  expect(report).toContain(snapshot.id);
  expect(killchainImage({ name: "Mission" }, snapshot.findings, "fr", snapshot.id)).toContain(
    snapshot.id,
  );
  expect(report).toContain("Références connues : e1");
  expect(report).toContain("Références absentes de cette coupe : missing");
  expect(report).toContain("Références absentes de cette coupe : unknown");
  expect(report).toContain("Collecte Audit incomplète");
  expect(report).toContain("non revu");
});
