import { STEP_RESULTS, type StepResult } from "./campaign-progress.js";

/** Entrée du journal d'opérations (« operator log ») remis à la white team : une étape enregistrée. */
export interface CampaignLogEntry {
  /** Horodatage UTC (ISO-8601, suffixe Z). */
  ts: string;
  runId?: string;
  /** Identifiant de l'événement `campaign.step` d'origine. */
  eventId: string;
  stepId: string;
  stepLabel: string;
  objectiveId?: string;
  /** Tactique et technique ATT&CK de l'étape, telles que fixées par le plan approuvé. */
  tactic?: string;
  technique?: string;
  /** Cible visée, si l'agent l'a indiquée. */
  target?: string;
  result: StepResult;
  note: string;
  /** Références de preuve : événements audit du run. */
  evidenceIds: string[];
  planDigest: string;
}

/** Démontage coché, pour la clôture de l'engagement. */
export interface TeardownLogEntry {
  ts: string;
  runId?: string;
  eventId: string;
  itemId: string;
  itemLabel: string;
  proof: string;
  remaining: number;
}

/** Vue d'export du journal de campagne (ajoutée à `AuditView` sous `campaign`). */
export interface CampaignLogView {
  /** Étapes enregistrées, de la plus ancienne à la plus récente. */
  entries: CampaignLogEntry[];
  /** Éléments de démontage cochés, de la plus ancienne à la plus récente. */
  teardown: TeardownLogEntry[];
  /** Avancement du plan approuvé courant ; absent sans plan approuvé. */
  progress?: { total: number; executed: number; percent: number; planDigest: string };
  /** Éléments de démontage restants selon le plan courant ; absent sans liste de clôture. */
  teardownRemaining?: number;
}

interface LogRecord {
  ts: string;
  kind: string;
  runId?: string | undefined;
  data: Record<string, unknown>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Agrège les événements `campaign.step` et `teardown.state` d'un projet en entrées de journal.
 * Fonction pure : l'horodatage est celui de l'événement (UTC), la technique et la tactique
 * celles que le moteur a copiées du plan approuvé au moment de l'enregistrement.
 */
export function campaignLogFromRecords(records: readonly LogRecord[]): CampaignLogView {
  const entries: CampaignLogEntry[] = [];
  const teardown: TeardownLogEntry[] = [];
  for (const record of records) {
    if (record.kind !== "engine") continue;
    const e = record.data;
    const ts = str(e.ts) ?? record.ts;
    const runId = str(e.runId) ?? record.runId;
    const eventId = str(e.id) ?? "";
    if (e.kind === "campaign.step") {
      const stepId = str(e.stepId);
      const result = (STEP_RESULTS as readonly unknown[]).includes(e.result)
        ? (e.result as StepResult)
        : undefined;
      if (stepId === undefined || result === undefined) continue;
      const objectiveId = str(e.objectiveId);
      const tactic = str(e.tactic);
      const technique = str(e.technique);
      const target = str(e.target);
      entries.push({
        ts,
        ...(runId !== undefined && { runId }),
        eventId,
        stepId,
        stepLabel: str(e.stepLabel) ?? stepId,
        ...(objectiveId !== undefined && { objectiveId }),
        ...(tactic !== undefined && { tactic }),
        ...(technique !== undefined && { technique }),
        ...(target !== undefined && { target }),
        result,
        note: str(e.note) ?? "",
        evidenceIds: Array.isArray(e.evidenceIds)
          ? e.evidenceIds.filter((id): id is string => typeof id === "string")
          : [],
        planDigest: str(e.planDigest) ?? "",
      });
    } else if (e.kind === "teardown.state") {
      const itemId = str(e.itemId);
      if (itemId === undefined || e.done !== true) continue;
      teardown.push({
        ts,
        ...(runId !== undefined && { runId }),
        eventId,
        itemId,
        itemLabel: str(e.itemLabel) ?? itemId,
        proof: str(e.proof) ?? "",
        remaining: typeof e.remaining === "number" ? e.remaining : 0,
      });
    }
  }
  const byTs = (a: { ts: string }, b: { ts: string }) => a.ts.localeCompare(b.ts);
  return { entries: entries.sort(byTs), teardown: teardown.sort(byTs) };
}
