import { z } from "zod";
export const auditProjectIdSchema = z.string().uuid();
export const auditTestSchema = z
  .object({
    objective: z.string().min(1).max(500),
    target: z.string().max(500),
    testContext: z.string().max(1000),
    method: z.string().min(1).max(1000),
    observed: z.string().min(1).max(8000),
    conclusion: z.enum(["finding", "not-observed", "inconclusive"]),
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(32),
    /** Événements web (search_web, read_url) du run qui étayent le contrôle ; validés par le bureau. */
    sources: z.array(z.string().min(1).max(200)).max(32).optional(),
  })
  .strict();
export type AuditTestClaim = z.infer<typeof auditTestSchema>;
/** États d'une case de la matrice de couverture (surface × paramètre × classe). */
export const COVERAGE_STATES = [
  "untested",
  "negative",
  "blocked",
  "prerequisite",
  "confirmed",
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];
export const coverageCellSchema = z
  .object({
    surface: z.string().min(1).max(300),
    parameter: z.string().max(200).optional(),
    testClass: z.string().min(1).max(100),
    state: z.enum(COVERAGE_STATES),
    note: z.string().max(1000).optional(),
    /** Événements `audit.test` du run qui étayent l'état ; validés par le bureau. */
    testRefs: z.array(z.string().min(1).max(200)).max(16).optional(),
  })
  .strict();
export type CoverageCell = z.infer<typeof coverageCellSchema>;
export const coverageCellsSchema = z.array(coverageCellSchema).min(1).max(100);
export const coverageWriteSchema = z.object({ cells: coverageCellsSchema }).strict();
/** Clé d'une case : surface, paramètre et classe normalisés (NFKC, espaces repliés, casse ignorée). */
export function coverageKey(
  cell: Pick<CoverageCell, "surface" | "parameter" | "testClass">,
): string {
  const norm = (text: string | undefined) =>
    (text ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
  return JSON.stringify([norm(cell.surface), norm(cell.parameter), norm(cell.testClass)]);
}
/** Case telle qu'exposée par la vue agrégée. */
export interface CoverageCellView extends CoverageCell {
  key: string;
  ts: string;
  runId?: string;
}
export interface CoverageView {
  cells: CoverageCellView[];
  total: number;
  counts: Record<CoverageState, number>;
  /** (cases dont l'état ≠ untested) / total, en pourcentage entier ; 0 sans case. */
  coveredPercent: number;
}
export const auditReviewSchema = auditTestSchema.omit({ evidenceIds: true, sources: true });
export type AuditReview = z.infer<typeof auditReviewSchema>;
export const auditRecordSchema = z
  .object({
    v: z.literal(1),
    id: auditProjectIdSchema,
    projectId: auditProjectIdSchema,
    ts: z.string().datetime(),
    actor: z.enum(["agent", "operator", "system"]),
    kind: z.enum([
      "engine",
      "terminal.snapshot",
      "terminal.closed",
      "capture.gap",
      "recording.paused",
      "recording.resumed",
      "test.review",
    ]),
    runId: z.string().min(1).max(200).optional(),
    source: z.string().max(500).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AuditRecord = z.infer<typeof auditRecordSchema>;
export interface AuditTest {
  id: string;
  objective: string;
  target: string;
  method: string;
  observed: string;
  testContext: string;
  execution: "requested" | "returned" | "error" | "denied" | "captured" | "annotated";
  conclusion: "unreviewed" | AuditTestClaim["conclusion"];
  author: "agent" | "operator" | "automatic";
  reviewed: boolean;
  evidenceIds: string[];
  ts: string;
  startedAt: string;
}
export interface AuditHealth {
  incomplete: boolean;
  failedEntries: number;
  error?: string;
  firstErrorAt?: string;
}
export interface AuditView {
  enabled: boolean;
  records: AuditRecord[];
  tests: AuditTest[];
  /** Matrice de couverture agrégée, toujours fournie par `AuditStore.view`. */
  coverage: CoverageView;
  bytes: number;
  health: AuditHealth;
  viewLimited: boolean;
}
