/**
 * Types du coordinateur de campagne multi-agents (ADR 0054). Aucun texte
 * d'affichage : les refus passent par des codes `Reason`.
 */

/** États d'une intention : `exhausted` = jamais attribuée avant la fin de la campagne. */
export const INTENT_STATES = ["open", "claimed", "done", "blocked", "exhausted"] as const;
export type IntentState = (typeof INTENT_STATES)[number];

/** Verdicts de couverture rendus par un worker en fermant son intention. */
export const COVERAGE_OUTCOMES = [
  "reported",
  "no_issue_found",
  "ruled_out",
  "not_applicable",
  "needs_follow_up",
] as const;
export type CoverageOutcome = (typeof COVERAGE_OUTCOMES)[number];

/** Une direction d'exploration : proposée par le planificateur, prise par un seul worker. */
export interface Intent {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  /** Cible facultative (motif de périmètre : hôte, `*.domaine`, IP, CIDR). */
  readonly target?: string;
  /** Clé de doublon : titre normalisé (minuscules, ponctuation retirée, espaces compactés), `|`, cible. */
  readonly key: string;
  readonly state: IntentState;
  /** Tour du planificateur qui l'a ouverte. */
  readonly round: number;
  readonly workerRunId?: string;
  readonly outcome?: CoverageOutcome;
  readonly summary?: string;
  /** Identifiants d'événements cités en preuve. */
  readonly evidence: readonly string[];
  readonly openedAt: number;
  readonly closedAt?: number;
  /** Fermée par l'hôte au nom du worker (sortie sans `campaign_close_intent`). */
  readonly closedBy?: "host";
}

/** Brouillon d'intention proposé par le planificateur. */
export interface IntentDraft {
  title: string;
  rationale: string;
  /** Cible facultative : motif de périmètre valide, dans le périmètre approuvé s'il y en a un. */
  target?: string | undefined;
}

/** Verdict déposé par un worker. */
export interface IntentClosure {
  outcome: CoverageOutcome;
  summary: string;
  evidence: readonly string[];
}

export interface CampaignBudget {
  /** Nombre total d'intentions qui peuvent être ouvertes. */
  maxIntents?: number;
  /** Dépense totale (USD) au-delà de laquelle plus rien n'est ouvert ni attribué. */
  maxUsd?: number;
  /** Tokens totaux (entrée + sortie) au-delà desquels plus rien n'est ouvert ni attribué. */
  maxTokens?: number;
}

/** Instantané immuable de la campagne. */
export interface CampaignRunStatus {
  readonly started: boolean;
  readonly finished: boolean;
  readonly objective?: string;
  readonly maxWorkers: number;
  readonly maxOpenPerRound: number;
  readonly budget: Readonly<CampaignBudget>;
  readonly spentUsd: number;
  /** Tokens cumulés (entrée + sortie) des runs terminés. */
  readonly tokens: number;
  readonly counts: Readonly<Record<IntentState, number>>;
  readonly intents: readonly Intent[];
}
