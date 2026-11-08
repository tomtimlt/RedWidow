import {
  approveCampaign,
  approveEngagement,
  type CampaignLogView,
  type CampaignObjective,
  type CampaignOverview,
  type CampaignState,
  type CampaignStatus,
  type Cited,
  campaignLog,
  campaignOverview,
  clearHalt,
  type EngagementAuthorization,
  type EngagementHalt,
  type EngagementState,
  type EngagementStatus,
  type EngagementWhiteTeam,
  type EngagementWindow,
  type EventPayload,
  importCampaignDraft,
  importEngagementDraft,
  readCampaignSync,
  readEngagementSync,
  readHalt,
  readTeardownSync,
  type StepResult,
  setHalt,
  suspendCampaign,
  suspendEngagement,
  type TeardownItemView,
  type TeardownStatus,
} from "@warband/core";

/**
 * Contrôles de la page « Engagement » (ADR 0041) côté hôte de l'extension. Seul module de
 * l'extension autorisé à appeler `approveEngagement`, `suspendEngagement`, `setHalt`, `clearHalt`,
 * `approveCampaign`, `suspendCampaign` et les imports de brouillon : jamais importé par
 * `engine/` ni exposé à un outil d'agent. L'engagement, le plan et le journal sont des données
 * non fiables : la vue ne contient que des valeurs brutes, le rendu se fait par `textContent`.
 */

/** Citation prête à afficher. `verified:false` : citation non recoupée par le moteur. */
export interface EngagementCitationView {
  quote: string;
  url: string;
  retrievedAt: string;
  verified: boolean;
}

export interface EngagementSection<T> {
  value: T;
  citation: EngagementCitationView;
}

export type EngagementSheetField =
  | "authorization"
  | "window"
  | "inScope"
  | "infrastructure"
  | "outOfScope"
  | "rulesOfEngagement"
  | "whiteTeam"
  | "osintPolicy";

/** Champs citables de la page : ceux de la fiche d'engagement et la synthèse de menace du plan. */
export type EngagementCitationField = EngagementSheetField | "threatSummary";

export interface EngagementSheetView {
  authorization: EngagementSection<EngagementAuthorization>;
  window: EngagementSection<EngagementWindow>;
  inScope: EngagementSection<string[]>;
  infrastructure: EngagementSection<string[]>;
  outOfScope: EngagementSection<string[]>;
  rulesOfEngagement: EngagementSection<string>;
  whiteTeam: EngagementSection<EngagementWhiteTeam>;
  osintPolicy: EngagementSection<string>;
}

export interface CampaignStepRow {
  id: string;
  label: string;
  tactic?: string;
  technique?: string;
  objectiveId?: string;
  /** Exécutée sous l'empreinte du plan approuvé courant (jamais pour un plan non appliqué). */
  executed: boolean;
  result?: StepResult;
}

export interface CampaignView {
  state: CampaignState;
  digest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  threatSummary: EngagementSection<string> | null;
  objectives: CampaignObjective[];
  steps: CampaignStepRow[];
  executed: number;
  total: number;
  /** Pourcentage entier d'étapes exécutées ; 0 sans plan appliqué. */
  percent: number;
  canValidate: boolean;
  canSuspend: boolean;
}

export interface JournalRow {
  ts: string;
  stepId: string;
  stepLabel: string;
  technique?: string;
  tactic?: string;
  target?: string;
  result: StepResult;
}

export interface ClosureView {
  items: TeardownItemView[];
  remaining: number;
  canClose: boolean;
}

/** Nombre maximal de lignes de journal envoyées à la page (les plus récentes). */
export const JOURNAL_VIEW_MAX = 200;

export interface EngagementPageView {
  state: EngagementState;
  digest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  sheet: EngagementSheetView | null;
  /** Arrêt d'urgence : `since` est vide si le fichier est illisible (arrêt actif, fail-closed). */
  halt: { active: boolean; since?: string };
  campaign: CampaignView;
  journal: { rows: JournalRow[]; total: number };
  closure: ClosureView | null;
  canValidate: boolean;
  canSuspend: boolean;
}

const citation = (c: Cited<unknown>): EngagementCitationView => ({
  quote: c.quote,
  url: c.url,
  retrievedAt: c.retrievedAt,
  verified: c.verified,
});

function section<T>(c: Cited<T>, copy: (value: T) => T): EngagementSection<T> {
  return { value: copy(c.value), citation: citation(c) };
}

/** Données lues, déjà prêtes pour la construction de la vue (pure). */
export interface EngagementInputs {
  engagement: EngagementStatus;
  campaign: CampaignStatus;
  overview: CampaignOverview;
  log: CampaignLogView;
  teardown: TeardownStatus;
  halt: EngagementHalt | null;
}

const canValidateState = (state: EngagementState | CampaignState, digest: string | undefined) =>
  digest !== undefined && (state === "draft" || state === "invalidated" || state === "suspended");

/** Vue du plan de campagne : le brouillon lisible, avancement seulement s'il est appliqué. */
export function buildCampaignView(
  status: CampaignStatus,
  overview: CampaignOverview,
): CampaignView {
  const plan = status.draft;
  const applied = overview.plan !== null;
  const progress = new Map(overview.steps.map((s) => [s.id, s]));
  const steps = (plan?.steps ?? []).map((step): CampaignStepRow => {
    const done = applied ? progress.get(step.id) : undefined;
    return {
      id: step.id,
      label: step.label,
      ...(step.tactic !== undefined && { tactic: step.tactic }),
      ...(step.technique !== undefined && { technique: step.technique }),
      ...(step.objectiveId !== undefined && { objectiveId: step.objectiveId }),
      executed: done?.executed ?? false,
      ...(done?.result !== undefined && { result: done.result }),
    };
  });
  const view: CampaignView = {
    state: status.state,
    threatSummary: plan ? section(plan.threatSummary, (v) => v) : null,
    objectives: plan ? plan.objectives.map((o) => ({ ...o })) : [],
    steps,
    executed: applied ? overview.executedCount : 0,
    total: steps.length,
    percent: applied ? overview.executedPercent : 0,
    canValidate: canValidateState(status.state, status.digest),
    canSuspend: status.state === "approved",
  };
  if (status.digest !== undefined) view.digest = status.digest;
  if (status.approvedAt !== undefined) view.approvedAt = status.approvedAt;
  if (status.suspendedAt !== undefined) view.suspendedAt = status.suspendedAt;
  return view;
}

/** Construit la vue complète (pure) depuis les états lus. */
export function buildEngagementView(input: EngagementInputs): EngagementPageView {
  const { engagement: status, halt } = input;
  const sheet = status.draft;
  const view: EngagementPageView = {
    state: status.state,
    sheet: sheet
      ? {
          authorization: section(sheet.authorization, (v) => ({ ...v })),
          window: section(sheet.window, (v) => ({ ...v })),
          inScope: section(sheet.inScope, (v) => [...v]),
          infrastructure: section(sheet.infrastructure, (v) => [...v]),
          outOfScope: section(sheet.outOfScope, (v) => [...v]),
          rulesOfEngagement: section(sheet.rulesOfEngagement, (v) => v),
          whiteTeam: section(sheet.whiteTeam, (v) => ({ ...v })),
          osintPolicy: section(sheet.osintPolicy, (v) => v),
        }
      : null,
    halt: halt === null ? { active: false } : { active: true, since: halt.haltedAt },
    campaign: buildCampaignView(input.campaign, input.overview),
    journal: {
      rows: input.log.entries.slice(-JOURNAL_VIEW_MAX).map(
        (e): JournalRow => ({
          ts: e.ts,
          stepId: e.stepId,
          stepLabel: e.stepLabel,
          ...(e.technique !== undefined && { technique: e.technique }),
          ...(e.tactic !== undefined && { tactic: e.tactic }),
          ...(e.target !== undefined && { target: e.target }),
          result: e.result,
        }),
      ),
      total: input.log.entries.length,
    },
    closure:
      input.teardown.items.length === 0
        ? null
        : {
            items: input.teardown.items.map((i) => ({ ...i })),
            remaining: input.teardown.remaining,
            canClose: input.teardown.canClose,
          },
    canValidate: canValidateState(status.state, status.digest),
    canSuspend: status.state === "approved",
  };
  if (status.digest !== undefined) view.digest = status.digest;
  if (status.approvedAt !== undefined) view.approvedAt = status.approvedAt;
  if (status.suspendedAt !== undefined) view.suspendedAt = status.suspendedAt;
  return view;
}

export interface EngagementControls {
  view(): Promise<EngagementPageView>;
  /** Approuve l'engagement dont l'empreinte a été affichée ; empreinte périmée → rejet, rien n'est écrit. */
  validateEngagement(displayedDigest: string): Promise<EngagementPageView>;
  suspendEngagement(): Promise<EngagementPageView>;
  /** Pose l'arrêt d'urgence (idempotent). */
  halt(): Promise<EngagementPageView>;
  /** Lève l'arrêt d'urgence. */
  resume(): Promise<EngagementPageView>;
  validateCampaign(displayedDigest: string): Promise<EngagementPageView>;
  suspendCampaign(): Promise<EngagementPageView>;
  /** Importe un brouillon d'engagement (texte JSON) : n'approuve jamais. */
  importEngagement(text: string): Promise<EngagementPageView>;
  /** Importe un brouillon de plan (texte JSON) : n'approuve jamais. */
  importCampaign(text: string): Promise<EngagementPageView>;
}

export interface EngagementControlsOptions {
  /**
   * Journal de la session, quand l'hôte en a un : reçoit `engagement.state`, `campaign.state` et
   * `engagement.halt` après chaque geste humain. Absent, ou qui échoue : le geste n'est pas bloqué.
   */
  emit?: (payload: EventPayload) => void;
}

export function createEngagementControls(
  configDir: string,
  projectId: string,
  options: EngagementControlsOptions = {},
): EngagementControls {
  const emit = (payload: EventPayload) => {
    try {
      options.emit?.(payload);
    } catch {
      // Le journal ne doit jamais bloquer un geste humain déjà appliqué.
    }
  };
  const view = async (): Promise<EngagementPageView> => {
    const campaign = readCampaignSync(configDir, projectId);
    const log = await campaignLog(configDir, projectId).catch(
      (): CampaignLogView => ({ entries: [], teardown: [] }),
    );
    return buildEngagementView({
      engagement: readEngagementSync(configDir, projectId),
      campaign,
      overview: campaignOverview(configDir, projectId),
      log,
      teardown: readTeardownSync(configDir, projectId),
      halt: readHalt(configDir, projectId),
    });
  };
  const emitState = (
    kind: "engagement.state" | "campaign.state",
    status: EngagementStatus | CampaignStatus,
  ) => {
    if (
      status.digest !== undefined &&
      (status.state === "approved" ||
        status.state === "suspended" ||
        status.state === "invalidated")
    )
      emit({ kind, projectId, state: status.state, digest: status.digest });
  };
  return {
    view,
    async validateEngagement(displayedDigest) {
      emitState("engagement.state", await approveEngagement(configDir, projectId, displayedDigest));
      return view();
    },
    async suspendEngagement() {
      emitState("engagement.state", await suspendEngagement(configDir, projectId));
      return view();
    },
    async halt() {
      await setHalt(configDir, projectId);
      emit({ kind: "engagement.halt", projectId, state: "on" });
      return view();
    },
    async resume() {
      if (await clearHalt(configDir, projectId))
        emit({ kind: "engagement.halt", projectId, state: "off" });
      return view();
    },
    async validateCampaign(displayedDigest) {
      emitState("campaign.state", await approveCampaign(configDir, projectId, displayedDigest));
      return view();
    },
    async suspendCampaign() {
      emitState("campaign.state", await suspendCampaign(configDir, projectId));
      return view();
    },
    async importEngagement(text) {
      const before = readEngagementSync(configDir, projectId);
      const after = await importEngagementDraft(configDir, projectId, text);
      // Un engagement approuvé dont le contenu change devient « modifié » : à journaliser.
      if (before.state === "approved" && after.state === "invalidated")
        emitState("engagement.state", after);
      return view();
    },
    async importCampaign(text) {
      const before = readCampaignSync(configDir, projectId);
      const after = await importCampaignDraft(configDir, projectId, text);
      if (before.state === "approved" && after.state === "invalidated")
        emitState("campaign.state", after);
      return view();
    },
  };
}

/** Messages acceptés depuis la webview (non fiables) : aucun champ de donnée, jamais l'empreinte. */
export type EngagementMessage =
  | {
      type:
        | "ready"
        | "refresh"
        | "validateEngagement"
        | "suspendEngagement"
        | "halt"
        | "resume"
        | "validateCampaign"
        | "suspendCampaign"
        | "importEngagement"
        | "importCampaign";
    }
  | { type: "openCitation"; field: EngagementCitationField };

const SIMPLE_TYPES: readonly string[] = [
  "ready",
  "refresh",
  "validateEngagement",
  "suspendEngagement",
  "halt",
  "resume",
  "validateCampaign",
  "suspendCampaign",
  "importEngagement",
  "importCampaign",
];

const CITATION_FIELDS: readonly string[] = [
  "authorization",
  "window",
  "inScope",
  "infrastructure",
  "outOfScope",
  "rulesOfEngagement",
  "whiteTeam",
  "osintPolicy",
  "threatSummary",
];

export function parseEngagementMessage(raw: unknown): EngagementMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (typeof m.type === "string" && SIMPLE_TYPES.includes(m.type) && keys.length === 1)
    return { type: m.type } as EngagementMessage;
  if (
    m.type === "openCitation" &&
    keys.length === 2 &&
    typeof m.field === "string" &&
    CITATION_FIELDS.includes(m.field)
  )
    return { type: "openCitation", field: m.field as EngagementCitationField };
  return null;
}

/** URL de citation de la vue affichée, seulement en http(s) ; la webview n'en fournit jamais. */
export function engagementCitationUrl(
  view: EngagementPageView,
  field: EngagementCitationField,
): string | null {
  const url =
    field === "threatSummary"
      ? view.campaign.threatSummary?.citation.url
      : view.sheet?.[field].citation.url;
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Taille maximale d'un fichier importé (octets) : un engagement ou un plan est un petit JSON. */
export const ENGAGEMENT_IMPORT_MAX_BYTES = 256 * 1024;
