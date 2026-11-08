import { CodedError } from "../reason.js";
import {
  type CampaignOverview,
  campaignOverview,
  type StepResult,
  writeStepProgress,
} from "./campaign-progress.js";
import type { CampaignStep } from "./plan.js";
import { markTeardownDone, readTeardownSync, type TeardownStatus } from "./teardown.js";

/**
 * Accès du bureau de mission au plan de campagne et au démontage du projet actif (ADR 0041).
 * Lecture synchrone pour `mission_context` ; écritures réservées aux outils `record_step` et
 * `record_teardown`, qui valident d'abord contre le plan approuvé.
 */
export interface CampaignPort {
  overview(): CampaignOverview;
  recordStep(entry: {
    stepId: string;
    result: StepResult;
    runId?: string;
  }): Promise<{ step: CampaignStep; planDigest: string }>;
  teardown(): TeardownStatus;
  markTeardown(entry: {
    itemId: string;
    proof: string;
    runId?: string;
  }): Promise<{ item: { id: string; label: string }; status: TeardownStatus }>;
}

/** Port lié à un dossier de configuration ; `projectId` est relu à chaque appel (projet actif). */
export function createCampaignPort(
  configDir: string,
  projectId: () => string | null,
  now: () => Date = () => new Date(),
): CampaignPort {
  const active = (): string => {
    const id = projectId();
    if (id === null) throw new CodedError("project.absent");
    return id;
  };
  return {
    overview() {
      const id = projectId();
      return id === null
        ? { state: "none", plan: null, steps: [], executedCount: 0, executedPercent: 0 }
        : campaignOverview(configDir, id);
    },
    recordStep: (entry) => writeStepProgress(configDir, active(), entry, now),
    teardown() {
      const id = projectId();
      return id === null
        ? { items: [], remaining: 0, canClose: true }
        : readTeardownSync(configDir, id);
    },
    markTeardown: (entry) => markTeardownDone(configDir, active(), entry, now),
  };
}
