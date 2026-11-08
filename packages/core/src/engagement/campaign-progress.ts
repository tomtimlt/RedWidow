import { projectCampaignStepsPath } from "../project.js";
import { CodedError } from "../reason.js";
import { readCampaignSync } from "./campaign-store.js";
import type { CampaignPlan, CampaignStep } from "./plan.js";
import { readIfExists, readIfExistsSync, serialized, writePrivate } from "./private-file.js";

/** Résultat d'exécution d'une étape. `blocked` : tentée mais non exécutée (elle ne compte pas comme exécutée). */
export const STEP_RESULTS = ["success", "partial", "failed", "blocked"] as const;
export type StepResult = (typeof STEP_RESULTS)[number];

/** Dernier enregistrement d'une étape, rattaché à l'empreinte du plan approuvé alors en vigueur. */
export interface StepProgress {
  result: StepResult;
  ts: string;
  planDigest: string;
  runId?: string;
}

interface StepsFile {
  version: 1;
  steps: Record<string, StepProgress>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseSteps(text: string | null): StepsFile {
  if (text === null) return { version: 1, steps: {} };
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.steps))
    throw new CodedError("campaign.unreadable", { part: "steps" });
  const steps: Record<string, StepProgress> = {};
  for (const [id, value] of Object.entries(raw.steps)) {
    if (
      !isRecord(value) ||
      !(STEP_RESULTS as readonly unknown[]).includes(value.result) ||
      typeof value.ts !== "string" ||
      typeof value.planDigest !== "string"
    )
      throw new CodedError("campaign.unreadable", { part: "steps" });
    steps[id] = {
      result: value.result as StepResult,
      ts: value.ts,
      planDigest: value.planDigest,
      ...(typeof value.runId === "string" && { runId: value.runId }),
    };
  }
  return { version: 1, steps };
}

/** Étape du plan et son état d'exécution (`executed` : au moins un enregistrement ≠ `blocked` sous l'empreinte courante). */
export interface CampaignStepView extends CampaignStep {
  executed: boolean;
  result?: StepResult;
  ts?: string;
}

/** Plan approuvé et avancement (vue pour `mission_context`, la CLI et l'interface). */
export interface CampaignOverview {
  state: import("./campaign-store.js").CampaignState;
  digest?: string;
  /** Plan appliqué (état `approved` seulement). */
  plan: CampaignPlan | null;
  steps: CampaignStepView[];
  executedCount: number;
  /** Étapes exécutées / étapes du plan, en pourcentage entier ; 0 sans plan. */
  executedPercent: number;
}

/**
 * Avancement des étapes d'un projet. Fichier absent : rien d'exécuté ; fichier illisible :
 * rien n'est considéré comme exécuté (fail-closed côté information).
 */
export function readStepProgressSync(
  configDir: string,
  projectId: string,
): Record<string, StepProgress> {
  try {
    return parseSteps(readIfExistsSync(projectCampaignStepsPath(configDir, projectId))).steps;
  } catch (err) {
    if (err instanceof CodedError && err.code === "project.invalid") throw err;
    return {};
  }
}

/** Vue d'ensemble du plan approuvé du projet et de son avancement. Lecture seule, synchrone. */
export function campaignOverview(configDir: string, projectId: string): CampaignOverview {
  const status = readCampaignSync(configDir, projectId);
  const plan = status.state === "approved" && status.applied ? status.applied : null;
  if (plan === null || status.approvedDigest === undefined)
    return {
      state: status.state,
      ...(status.approvedDigest !== undefined && { digest: status.approvedDigest }),
      plan: null,
      steps: [],
      executedCount: 0,
      executedPercent: 0,
    };
  const progress = readStepProgressSync(configDir, projectId);
  const steps = plan.steps.map((step): CampaignStepView => {
    const entry = progress[step.id];
    const current = entry !== undefined && entry.planDigest === status.approvedDigest;
    return {
      ...step,
      executed: current && entry.result !== "blocked",
      ...(current && { result: entry.result, ts: entry.ts }),
    };
  });
  const executedCount = steps.filter((s) => s.executed).length;
  return {
    state: status.state,
    digest: status.approvedDigest,
    plan,
    steps,
    executedCount,
    executedPercent: Math.round((executedCount / steps.length) * 100),
  };
}

/**
 * Enregistre l'exécution d'une étape du plan **approuvé** : `stepId` absent du plan →
 * `campaign.stepUnknown`, aucun plan approuvé → `campaign.notApproved`. Réservé au moteur
 * (outil `record_step`) : le fichier est un chemin sensible pour les outils de l'agent.
 */
export async function writeStepProgress(
  configDir: string,
  projectId: string,
  entry: { stepId: string; result: StepResult; runId?: string },
  now: () => Date = () => new Date(),
): Promise<{ step: CampaignStep; planDigest: string }> {
  const status = readCampaignSync(configDir, projectId);
  if (status.state !== "approved" || !status.applied || status.approvedDigest === undefined)
    throw new CodedError("campaign.notApproved", { state: status.state });
  const step = status.applied.steps.find((s) => s.id === entry.stepId);
  if (step === undefined) throw new CodedError("campaign.stepUnknown", { stepId: entry.stepId });
  const planDigest = status.approvedDigest;
  const path = projectCampaignStepsPath(configDir, projectId);
  await serialized(path, async () => {
    let file: StepsFile;
    try {
      file = parseSteps(await readIfExists(path));
    } catch {
      // Fichier illisible : réécrit proprement (rien n'était considéré comme exécuté).
      file = { version: 1, steps: {} };
    }
    file.steps[entry.stepId] = {
      result: entry.result,
      ts: now().toISOString(),
      planDigest,
      ...(entry.runId !== undefined && { runId: entry.runId }),
    };
    await writePrivate(path, `${JSON.stringify(file, null, 2)}\n`);
  });
  return { step, planDigest };
}
