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
  })
  .strict();
export type AuditTestClaim = z.infer<typeof auditTestSchema>;
export const auditReviewSchema = auditTestSchema.omit({ evidenceIds: true });
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
  bytes: number;
  health: AuditHealth;
  viewLimited: boolean;
}
