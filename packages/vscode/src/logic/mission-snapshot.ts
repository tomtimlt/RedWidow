import { createHash } from "node:crypto";
import type { AuditView, Evidence, Finding } from "@warband/core";

/** Coupe bornée et identifiée des notes et contrôles disponibles au moment de l'export. */
export function missionSnapshot(
  findings: readonly Finding[],
  audit: AuditView | null,
  evidence: readonly Evidence[] | null,
) {
  const known = new Set([
    ...(evidence ?? []).map((entry) => entry.id),
    ...(audit?.records ?? []).flatMap((row) => [
      row.id,
      ...(typeof row.data.id === "string" ? [row.data.id] : []),
    ]),
  ]);
  const controls = (audit?.tests ?? []).map((test) => ({
    id: test.id,
    objective: test.objective,
    execution: test.execution,
    conclusion: test.conclusion,
    reviewed: test.reviewed,
    references: test.evidenceIds.filter((id) => known.has(id)),
    unknown: test.evidenceIds.filter((id) => !known.has(id)),
  }));
  const data = {
    findings: structuredClone([...findings]),
    controls,
    findingReferences: findings.map((finding) => ({
      id: finding.id,
      references: (finding.evidenceIds ?? []).filter((id) => known.has(id)),
      unknown: (finding.evidenceIds ?? []).filter((id) => !known.has(id)),
    })),
    auditAvailable: audit !== null,
    auditIncomplete: audit?.health.incomplete ?? true,
    auditLimited: audit?.viewLimited ?? true,
    evidenceAvailable: evidence !== null,
  };
  return { ...data, id: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
}
export type MissionSnapshot = ReturnType<typeof missionSnapshot>;
