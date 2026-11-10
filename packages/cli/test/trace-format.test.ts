import { analyzeTrace, type EngineEvent } from "@warband/core";
import { describe, expect, it } from "vitest";
import { formatTraceReport } from "../src/trace-format.js";

const ev = (seq: number, p: Record<string, unknown>): EngineEvent =>
  ({
    v: 1,
    id: `e${seq}`,
    seq,
    ts: new Date(Date.parse("2026-01-01T00:00:00Z") + seq * 1000).toISOString(),
    runId: "r",
    parentId: null,
    ...p,
  }) as EngineEvent;

const events = [
  ev(0, {
    kind: "tool.requested",
    toolUseId: "a",
    tool: "Bash",
    input: { command: "cat big\u001b[31m" },
  }),
  ev(1, {
    kind: "tool.result",
    toolUseId: "a",
    isError: false,
    output: "x",
    truncated: true,
    bytes: 70000,
  }),
  ev(2, { kind: "turn.finished", turns: 1, costUsd: 0, status: "success", result: null }),
];

describe("formatTraceReport", () => {
  const report = analyzeTrace(events);

  it("rend les six sections en français", () => {
    const text = formatTraceReport(report, "fr").join("\n");
    for (const n of [
      "1. Volume",
      "2. Fin du run",
      "3. Troncatures",
      "4. Répétition",
      "5. Recherches",
      "6. Classe",
    ])
      expect(text).toContain(n);
    expect(text).toContain("70000 o");
    expect(text).toContain("A : sorties tronquées");
  });

  it("rend en anglais", () => {
    const text = formatTraceReport(report, "en").join("\n");
    expect(text).toContain("End of run");
    expect(text).toContain("A: truncated outputs");
  });

  it("affiche le compteur de négatifs à une sonde dans les deux langues", () => {
    const coverage = ev(3, {
      kind: "audit.coverage",
      cells: [{ surface: "/a", testClass: "idor", state: "negative", testRefs: ["t1"] }],
    });
    const withCoverage = analyzeTrace([...events, coverage]);
    expect(formatTraceReport(withCoverage, "fr").join("\n")).toContain(
      "négatifs avec une seule sonde : 1",
    );
    expect(formatTraceReport(withCoverage, "en").join("\n")).toContain(
      "negative cells with one probe : 1",
    );
  });

  it("neutralise les caractères de contrôle d'une commande du journal", () => {
    expect(formatTraceReport(report, "fr").join("\n")).not.toContain("\u001b");
  });
});
