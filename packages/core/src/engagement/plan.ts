import { createHash } from "node:crypto";
import { z } from "zod";
import { MITRE_TACTICS, TECHNIQUE_PATTERN } from "../exegol/findings.js";
import { type Cited, canonicalCited, cited } from "../program/cited.js";
import { CodedError } from "../reason.js";

/** Objectif de campagne (« drapeau ») : ce qu'il faut atteindre et à quoi l'on reconnaît la réussite. */
export interface CampaignObjective {
  id: string;
  label: string;
  successCriterion: string;
}

/** Nature d'un élément de démontage : artefact déposé, compte créé, infrastructure mise en place. */
export const TEARDOWN_KINDS = ["artifact", "account", "infrastructure"] as const;
export type TeardownKind = (typeof TEARDOWN_KINDS)[number];

/** Élément de la liste de clôture (ADR 0041, décision 5) : à nettoyer avant de clore l'engagement. */
export interface TeardownItem {
  id: string;
  label: string;
  kind: TeardownKind;
}

/** Étape ordonnée du déroulé, rattachée si possible à une tactique et une technique ATT&CK. */
export interface CampaignStep {
  id: string;
  label: string;
  tactic?: (typeof MITRE_TACTICS)[number];
  technique?: string;
  precondition?: string;
  decisionPoint?: string;
  stopCriterion?: string;
  /** Objectif visé par l'étape (doit exister dans `objectives`). */
  objectiveId?: string;
}

/**
 * Plan de campagne d'un projet (ADR 0041, décision 3) : synthèse de menace citée, objectifs,
 * étapes ordonnées et liste de démontage. Donnée, jamais une autorisation : il ne s'applique
 * qu'après approbation de son empreinte.
 */
export interface CampaignPlan {
  version: 1;
  threatSummary: Cited<string>;
  objectives: CampaignObjective[];
  steps: CampaignStep[];
  teardown: TeardownItem[];
}

const MAX_SHORT = 500;
const MAX_TEXT = 4000;

const ident = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const short = z.string().trim().min(1).max(MAX_SHORT);
const text = z.string().trim().min(1).max(MAX_TEXT);

const objective = z.object({ id: ident, label: short, successCriterion: text }).strict();

const step = z
  .object({
    id: ident,
    label: short,
    tactic: z.enum(MITRE_TACTICS).optional(),
    technique: z.string().regex(TECHNIQUE_PATTERN).optional(),
    precondition: text.optional(),
    decisionPoint: text.optional(),
    stopCriterion: text.optional(),
    objectiveId: ident.optional(),
  })
  .strict();

const teardownItem = z.object({ id: ident, label: short, kind: z.enum(TEARDOWN_KINDS) }).strict();

const duplicates = (ids: string[]) => new Set(ids).size !== ids.length;

export const campaignPlanSchema = z
  .object({
    version: z.literal(1),
    threatSummary: cited(text),
    objectives: z.array(objective).min(1).max(50),
    steps: z.array(step).min(1).max(200),
    teardown: z.array(teardownItem).max(100).default([]),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (duplicates(plan.objectives.map((o) => o.id)))
      ctx.addIssue({ code: "custom", path: ["objectives"] });
    if (duplicates(plan.steps.map((s) => s.id))) ctx.addIssue({ code: "custom", path: ["steps"] });
    if (duplicates(plan.teardown.map((t) => t.id)))
      ctx.addIssue({ code: "custom", path: ["teardown"] });
    const known = new Set(plan.objectives.map((o) => o.id));
    plan.steps.forEach((s, index) => {
      if (s.objectiveId !== undefined && !known.has(s.objectiveId))
        ctx.addIssue({ code: "custom", path: ["steps", index, "objectiveId"] });
    });
  });

/**
 * Valide un plan brut (JSON déjà analysé). Plan invalide → `campaign.invalid` (chemin du
 * premier champ fautif en paramètre).
 */
export function parseCampaignPlan(raw: unknown): CampaignPlan {
  const parsed = campaignPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new CodedError("campaign.invalid", { field: path });
  }
  return parsed.data as CampaignPlan;
}

/**
 * Forme canonique : ordre des clés fixe, sans mise en forme. L'ordre des étapes est celui du
 * déroulé et fait partie du sens ; deux plans de même sens ont la même empreinte.
 */
export function canonicalCampaign(plan: CampaignPlan): string {
  return JSON.stringify({
    version: 1,
    threatSummary: canonicalCited(plan.threatSummary, plan.threatSummary.value),
    objectives: plan.objectives.map((o) => ({
      id: o.id,
      label: o.label,
      successCriterion: o.successCriterion,
    })),
    steps: plan.steps.map((s) => ({
      id: s.id,
      label: s.label,
      ...(s.tactic !== undefined && { tactic: s.tactic }),
      ...(s.technique !== undefined && { technique: s.technique }),
      ...(s.precondition !== undefined && { precondition: s.precondition }),
      ...(s.decisionPoint !== undefined && { decisionPoint: s.decisionPoint }),
      ...(s.stopCriterion !== undefined && { stopCriterion: s.stopCriterion }),
      ...(s.objectiveId !== undefined && { objectiveId: s.objectiveId }),
    })),
    teardown: plan.teardown.map((t) => ({ id: t.id, label: t.label, kind: t.kind })),
  });
}

/** Empreinte SHA-256 (hexadécimal) de la forme canonique. */
export function campaignDigest(plan: CampaignPlan): string {
  return createHash("sha256").update(canonicalCampaign(plan)).digest("hex");
}
