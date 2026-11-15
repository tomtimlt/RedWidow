import { isValidScopePattern } from "../program/cited.js";
import { CodedError, type Reason } from "../reason.js";
import type { Recorder } from "../recorder.js";
import {
  type CampaignBudget,
  type CampaignRunStatus,
  COVERAGE_OUTCOMES,
  INTENT_STATES,
  type Intent,
  type IntentClosure,
  type IntentDraft,
  type IntentState,
} from "./types.js";

export const DEFAULT_MAX_WORKERS = 3;
export const MAX_WORKERS_LIMIT = 8;
export const DEFAULT_MAX_OPEN_PER_ROUND = 4;
/** Bornes de taille des textes venus des agents (le recorder masque déjà les secrets). */
const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const EVIDENCE_MAX = 64;

export interface CampaignCoordinatorOptions {
  /** Workers simultanés (intentions `claimed`), de 1 à 8 ; 3 par défaut. */
  maxWorkers?: number;
  /** Intentions ouvertes au plus par tour du planificateur ; 4 par défaut. */
  maxOpenPerRound?: number;
  budget?: CampaignBudget;
  /** Horloge en ms epoch (par défaut `Date.now`). */
  now?: () => number;
  /** Recorder du journal de campagne (masque les secrets avant tout sink). */
  recorder: Recorder;
  /**
   * Périmètre approuvé (ADR 0055), fourni par l'hôte : vrai si la cible est couverte. Absent :
   * aucune fiche approuvée, les cibles ne sont contrôlées que sur leur forme.
   */
  inScope?: (target: string) => boolean;
}

/**
 * Coordinateur de campagne : un seul fil JS, donc chaque méthode est atomique.
 * L'état vit dans l'hôte ; le jugement « déjà couvert sur le fond » reste au
 * planificateur, ici seul le doublon exact de clé est refusé.
 */
export interface CampaignCoordinator {
  start(objective: string): void;
  /** Ouvre un lot d'intentions pour un tour ; tout ou rien. Renvoie les intentions créées. */
  openIntents(round: number, drafts: readonly IntentDraft[]): readonly Intent[];
  /** Attribue la première intention ouverte au worker, ou `undefined` (rien à prendre, workers pleins, budget, fin). */
  claimNext(workerRunId: string): Intent | undefined;
  /** Verdict du worker qui détient l'intention (`claimed` → `done`). */
  close(intentId: string, workerRunId: string, closure: IntentClosure): Intent;
  /** Run fini sans fermeture : `claimed` → `blocked`. */
  abandon(intentId: string, workerRunId: string): Intent;
  recordSpend(usd: number): void;
  /** Termine la campagne ; les intentions encore `open` passent à `exhausted`. */
  finish(reason: Reason): void;
  status(): CampaignRunStatus;
}

/** Clé de comparaison : minuscules, ponctuation et symboles → espace, espaces compactés. */
export function normalizeIntentKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Clé de doublon d'une intention : même direction sur deux cibles n'est pas un doublon. */
const intentKey = (title: string, target: string | undefined): string =>
  `${normalizeIntentKey(title)}|${target ?? ""}`;

function invalid(field: string): CodedError {
  return new CodedError("campaign.invalidInput", { field });
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < min || v > max) throw invalid(field);
  return v;
}

export function createCampaignCoordinator(
  options: CampaignCoordinatorOptions,
): CampaignCoordinator {
  const maxWorkers = boundedInt(
    options.maxWorkers,
    DEFAULT_MAX_WORKERS,
    1,
    MAX_WORKERS_LIMIT,
    "maxWorkers",
  );
  const maxOpenPerRound = boundedInt(
    options.maxOpenPerRound,
    DEFAULT_MAX_OPEN_PER_ROUND,
    1,
    1000,
    "maxOpenPerRound",
  );
  const budget: CampaignBudget = { ...options.budget };
  if (budget.maxIntents !== undefined) boundedInt(budget.maxIntents, 0, 0, 1_000_000, "maxIntents");
  if (budget.maxUsd !== undefined && !(Number.isFinite(budget.maxUsd) && budget.maxUsd >= 0))
    throw invalid("maxUsd");
  const now = options.now ?? Date.now;
  const recorder = options.recorder;

  const intents: Intent[] = [];
  let objective: string | undefined;
  let started = false;
  let finished = false;
  let spentUsd = 0;
  let seq = 0;

  const budgetReached = (extraIntents: number): boolean =>
    (budget.maxUsd !== undefined && spentUsd >= budget.maxUsd) ||
    (budget.maxIntents !== undefined && intents.length + extraIntents > budget.maxIntents);

  const find = (id: string): Intent => {
    const intent = intents.find((i) => i.id === id);
    if (!intent) throw new CodedError("campaign.unknownIntent", { intentId: String(id) });
    return intent;
  };
  const replace = (next: Intent): Intent => {
    const index = intents.findIndex((i) => i.id === next.id);
    intents[index] = next;
    return next;
  };
  const requireStarted = (): void => {
    if (!started) throw new CodedError("campaign.notStarted");
  };
  const text = (value: unknown, field: string, max: number, allowEmpty = false): string => {
    if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) throw invalid(field);
    return value.slice(0, max);
  };
  const ownedClaim = (intentId: string, workerRunId: string): Intent => {
    const intent = find(intentId);
    if (intent.workerRunId !== workerRunId)
      throw new CodedError("campaign.notClaimant", { intentId });
    if (intent.state !== "claimed")
      throw new CodedError("campaign.invalidTransition", { intentId, state: intent.state });
    return intent;
  };

  return {
    start(goal) {
      if (started) throw new CodedError("campaign.alreadyStarted");
      objective = text(goal, "objective", TEXT_MAX);
      started = true;
      recorder.emit({ kind: "campaign.started", objective, maxWorkers });
    },

    openIntents(round, drafts) {
      requireStarted();
      if (finished) throw new CodedError("campaign.finished");
      if (!Number.isInteger(round) || round < 0) throw invalid("round");
      if (!Array.isArray(drafts) || drafts.length === 0) throw invalid("drafts");
      if (budgetReached(drafts.length)) throw new CodedError("campaign.budgetExhausted");
      const inRound = intents.filter((i) => i.round === round).length;
      if (inRound + drafts.length > maxOpenPerRound)
        throw new CodedError("campaign.roundCap", { round, max: maxOpenPerRound });
      // Validation et doublons avant toute écriture : le lot est refusé en entier.
      const live = new Set(
        intents
          .filter((i) => i.state === "open" || i.state === "claimed" || i.state === "done")
          .map((i) => i.key),
      );
      const prepared = drafts.map((draft) => {
        const title = text(draft?.title, "title", TITLE_MAX);
        const rationale = text(draft?.rationale, "rationale", TEXT_MAX, true);
        if (normalizeIntentKey(title) === "") throw invalid("title");
        const raw: unknown = draft?.target;
        let target: string | undefined;
        if (raw !== undefined) {
          if (typeof raw !== "string" || !isValidScopePattern(raw)) throw invalid("target");
          if (options.inScope && !options.inScope(raw))
            throw new CodedError("campaign.targetOutOfScope", { target: raw });
          target = raw;
        }
        const key = intentKey(title, target);
        if (live.has(key)) throw new CodedError("campaign.duplicateIntent", { key });
        live.add(key);
        return { title, rationale, ...(target !== undefined && { target }), key };
      });
      const created: Intent[] = [];
      for (const p of prepared) {
        seq += 1;
        const intent: Intent = {
          id: `i${seq}`,
          ...p,
          state: "open",
          round,
          evidence: [],
          openedAt: now(),
        };
        intents.push(intent);
        created.push({ ...intent });
        recorder.emit({
          kind: "campaign.intent.opened",
          intentId: intent.id,
          title: intent.title,
          rationale: intent.rationale,
          ...(intent.target !== undefined && { target: intent.target }),
          key: intent.key,
          round,
        });
      }
      return created;
    },

    claimNext(workerRunId) {
      requireStarted();
      if (typeof workerRunId !== "string" || workerRunId === "") throw invalid("workerRunId");
      if (finished || budgetReached(0)) return undefined;
      if (intents.filter((i) => i.state === "claimed").length >= maxWorkers) return undefined;
      const next = intents.find((i) => i.state === "open");
      if (!next) return undefined;
      const claimed = replace({ ...next, state: "claimed", workerRunId });
      recorder.emit({ kind: "campaign.intent.claimed", intentId: claimed.id, workerRunId });
      return { ...claimed };
    },

    close(intentId, workerRunId, closure) {
      requireStarted();
      const intent = ownedClaim(intentId, workerRunId);
      if (!(COVERAGE_OUTCOMES as readonly string[]).includes(closure?.outcome))
        throw invalid("outcome");
      const summary = text(closure.summary, "summary", TEXT_MAX, true);
      if (
        !Array.isArray(closure.evidence) ||
        closure.evidence.length > EVIDENCE_MAX ||
        closure.evidence.some((e) => typeof e !== "string" || e === "")
      )
        throw invalid("evidence");
      const evidence = [...closure.evidence];
      const done = replace({
        ...intent,
        state: "done",
        outcome: closure.outcome,
        summary,
        evidence,
        closedAt: now(),
      });
      recorder.emit({
        kind: "campaign.intent.closed",
        intentId,
        workerRunId,
        outcome: closure.outcome,
        summary,
        evidence,
      });
      return { ...done };
    },

    abandon(intentId, workerRunId) {
      requireStarted();
      const intent = ownedClaim(intentId, workerRunId);
      // `workerRunId` reste consigné (quel run a échoué) ; l'état seul libère la place d'un worker.
      const blocked = replace({ ...intent, state: "blocked", closedAt: now() });
      recorder.emit({
        kind: "campaign.intent.closed",
        intentId,
        workerRunId,
        outcome: "blocked",
        evidence: [],
      });
      return { ...blocked };
    },

    recordSpend(usd) {
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) throw invalid("usd");
      spentUsd += usd;
    },

    finish(reason) {
      requireStarted();
      if (finished) return;
      finished = true;
      const closedAt = now();
      for (const i of intents)
        if (i.state === "open") replace({ ...i, state: "exhausted", closedAt });
      const count = (s: IntentState): number => intents.filter((i) => i.state === s).length;
      recorder.emit({
        kind: "campaign.finished",
        reason,
        intents: intents.length,
        done: count("done"),
        blocked: count("blocked"),
        exhausted: count("exhausted"),
        spentUsd,
      });
    },

    status() {
      const counts = Object.fromEntries(
        INTENT_STATES.map((s) => [s, intents.filter((i) => i.state === s).length]),
      ) as Record<IntentState, number>;
      const snapshot: CampaignRunStatus = {
        started,
        finished,
        ...(objective !== undefined && { objective }),
        maxWorkers,
        maxOpenPerRound,
        budget: Object.freeze({ ...budget }),
        spentUsd,
        counts: Object.freeze(counts),
        intents: Object.freeze(
          intents.map((i) => Object.freeze({ ...i, evidence: Object.freeze([...i.evidence]) })),
        ),
      };
      return Object.freeze(snapshot);
    },
  };
}
