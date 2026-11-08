import { z } from "zod";
import { STEP_RESULTS } from "./campaign-progress.js";

/** Entrée de l'outil `record_step` : l'exécution d'une étape du plan de campagne approuvé. */
export const recordStepSchema = z
  .object({
    /** Doit exister dans le plan approuvé du projet. */
    stepId: z.string().min(1).max(64),
    result: z.enum(STEP_RESULTS),
    /** Ce qui a été fait et observé (court ; pas de sortie complète). */
    note: z.string().min(1).max(4000),
    target: z.string().max(500).optional(),
    /** Événements du run qui étayent le résultat ; au moins un pour `success` et `partial`. */
    evidenceIds: z.array(z.string().min(1).max(200)).max(32).optional(),
  })
  .strict();
export type RecordStepInput = z.infer<typeof recordStepSchema>;

/** Entrée de l'outil `record_teardown` : un élément de démontage fait, avec sa preuve. */
export const recordTeardownSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    /** Ce qui a été nettoyé et comment on l'a constaté. */
    proof: z.string().min(1).max(2000),
    evidenceIds: z.array(z.string().min(1).max(200)).max(32).optional(),
  })
  .strict();
export type RecordTeardownInput = z.infer<typeof recordTeardownSchema>;
