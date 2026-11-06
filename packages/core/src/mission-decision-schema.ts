import { z } from "zod";

/** Décision descriptive : aucune autorisation ni exécution implicite. */
export const missionDecisionSchema = z
  .object({
    objective: z.string().min(1).max(2000),
    evidenceIds: z.array(z.string().max(200)).max(32),
    nextAction: z.string().min(1).max(2000),
    successCriterion: z.string().min(1).max(2000),
    maxCalls: z.number().int().min(1).max(1000).optional(),
    maxDurationSeconds: z.number().positive().max(86400).optional(),
  })
  .strict();
export type MissionDecision = z.infer<typeof missionDecisionSchema>;
