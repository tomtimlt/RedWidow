import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AuthMode,
  BypassState,
  Effort,
  EngineEvent,
  ModelOption,
  PromptImage,
  ProviderFailureInput,
  ProviderOption,
  Reason,
  SupervisionLevel,
} from "@warband/core";
import {
  AGENT_PROFILES,
  type CampaignRunStatus,
  CodedError,
  createRecorder,
  DEFAULT_AGENT_PROFILE,
  fingerprint,
  hasPastedCredentials,
  type JournalWriter,
  openJournal,
  parseSupervision,
  reason,
  restoreCampaignCoordinator,
  soonestCooldown,
} from "@warband/core";
import { formatReason, getUiLocale, t } from "@warband/messages";
import { alwaysConfirmText, answerFor, type Choice, cleanText, toCard } from "./approval.js";
import { PRODUCT_NAME } from "./brand.js";
import type { BypassEngineLink, BypassSend } from "./bypass.js";
import {
  type CampaignAgentInfo,
  type CampaignHost,
  createCampaignHost,
  isCampaignActive,
  onCampaignActivity,
} from "./campaign-host.js";
import {
  type CampaignEngineSetup,
  type CampaignVaultAccess,
  createCampaignSpawner,
} from "./campaign-spawn.js";
import {
  type CampaignView,
  type ChatState,
  type ChatView,
  createChatState,
  type HistoryEntry,
  type ItemAgent,
  isAbortError,
} from "./chat.js";
import {
  allowedSelection,
  type ChatSelection,
  emptySelection,
  parseChatSelection,
  providerChoices,
  selectedSettings,
} from "./chat-capabilities.js";
import {
  createEngineController,
  type EngineAuth,
  type EngineController,
  type EngineControllerOptions,
} from "./controller.js";
import {
  buildControls,
  effectiveModel,
  type ModelsStatus,
  type Prefs,
  parseMultiAgentWorkers,
  parsePrefs,
} from "./controls.js";
import {
  buildConversationContext,
  mergeConversationTail,
  readConversationContext,
} from "./conversation-context.js";
import {
  clampEffort,
  EFFORT_LEVELS,
  type EffortChoice,
  isProvider,
  type Provider,
  parseEffortChoice,
  resolveEffort,
  type UltracodeLimits,
} from "./effort.js";
import {
  applyRetention,
  type ConversationAgentRole,
  type ConversationMeta,
  cleanTitle,
  type HistoryProjects,
  historyProject,
  isConversationId,
  isRunId,
  parseIndex,
  sortRecent,
  titleFrom,
} from "./history.js";
import type { JournalFiles } from "./historyStore.js";
import { modelLoadFailure } from "./model-load-error.js";
import { isModelId, parseModelCache, usableModels, validateModelChoice } from "./models.js";
import type { FromEngine } from "./protocol.js";
import type { ChatSettings } from "./settings.js";
import { findAdjacentExchange, readCampaignJournal, readConversationPage } from "./timeline.js";
import {
  createFailureTracker,
  createKeyGuard,
  type FailureTracker,
  ROTATION_RESUME_PROMPT,
  type RotationAdviceContext,
  rotateAfterFailure,
  rotationAdvice,
  type VaultPick,
  type VaultRotatedPayload,
} from "./vault-launch.js";
import type { VaultStore } from "./vault-store.js";

const PREFS_KEY = "warband.prefs";
const MODELS_KEY = "warband.models";
const DEFAULT_HISTORY_KEY = "warband.history";
/** Budget global : lecture de la connexion et sondage du moteur compris. */
export const MODEL_LOAD_TIMEOUT_MS = 45_000;
const labelOf = (e: EffortChoice) => EFFORT_LEVELS.find((l) => l.value === e)?.label ?? e;

/** Jeton choisi par l'utilisateur : le mode d'authentification qui lui correspond. */
export interface TokenChoice {
  auth?: EngineAuth;
  mode: AuthMode;
  /** Clé du coffre retenue (ADR 0056) ; absent : clé unique ou abonnement (`legacy`), aucune rotation. */
  vault?: VaultPick;
}

/** Précisions pour `getToken` : fournisseur du coffre (le fournisseur OpenCode actif), clé fautive, lancement. */
export interface TokenHint {
  vaultProvider?: string;
  /** Clé qui vient d'échouer : la suivante est choisie après elle. */
  afterKeyId?: string;
  /** Lancement d'un moteur : un coffre non vide sans clé active échoue en `vault.allExhausted`. */
  launch?: boolean;
}

export interface ChatSessionDeps {
  cwd: string;
  enginePath: string;
  engineArgs: string[];
  /** Réglages machine validés (lève `CodedError`). */
  readSettings(): ChatSettings;
  /** Jeton (SecretStorage) ; `undefined` → authentification `auto` du binaire. */
  getToken(provider?: Provider, hint?: TokenHint): Promise<TokenChoice | undefined>;
  /** Coffre à clés (ADR 0056) : rotation après quota ou clé invalide. Absent : aucune rotation. */
  vault?: { store: VaultStore; now?: () => Date };
  /** Valeurs secrètes de tous les coffres, pour masquer les événements consignés par l'hôte. */
  extraSecrets?: () => readonly string[];
  getTestAccounts?(): Promise<import("@warband/core").TestAccount[]>;
  /**
   * Contrôle de cible sur le périmètre approuvé (programme, engagement) du projet donné (ADR 0055) ;
   * `undefined` sans fiche approuvée. Absent : les cibles de campagne ne sont contrôlées que sur leur forme.
   */
  campaignScope?(projectId: string): ((target: string) => boolean) | undefined;
  /**
   * Sans jeton, le chat est grisé (`noProvider`) et aucun message ne part. Absent : le binaire garde
   * son authentification `auto` (comportement historique, et celui des tests).
   */
  requireProvider?: boolean;
  /** Confirmation modale native (hors webview) pour « Toujours ». */
  confirmAlways(text: string): Promise<boolean>;
  onView(view: ChatView): void;
  /** Sortie d'erreur du moteur, déjà masquée. */
  onLog?(text: string): void;
  onProviders?(providers: ProviderOption[]): void;
  /** Événements déjà masqués reçus du moteur courant, jamais l’historique. */
  onObservedEvent?(event: EngineEvent | null): void;
  onMissionContext?(snapshot: { runId: string; text: string }): void;
  /** Dossier du projet hors du partage du conteneur : l'hôte mémorise l'incohérence et ouvre le cockpit. */
  onMountIssue?(issue: {
    container: string;
    mounted: string;
    projectId: string;
    projectName: string;
  }): void;
  createController?(options: EngineControllerOptions): EngineController;
  /** Bypass (ADR 0006) : lien vers le moteur courant, pour pousser l'état et recevoir l'accusé. */
  bypass?: { attach(send: BypassSend): BypassEngineLink; reset?(): void };
  /** Clé de stockage du mode apprentissage de ce chat (`warband.learning.<id>`), distincte de `warband.prefs`. Absente : mémoire. */
  learningKey?: string;
  /** Préférences propres au chat ; l’ancienne clé partagée sert seulement à la migration. */
  prefsKey?: string;
  /** Stockage persistant (globalState) : préférences et cache des modèles. Défaut : mémoire. */
  store?: { get(key: string): unknown; set(key: string, value: unknown): unknown };
  /** Version du SDK embarqué : clé du cache de la liste des modèles. */
  sdkVersion?: string;
  /** Historique (F4) : index dans `workspaceState`, journaux hors du dépôt. Absent : pas d'historique. */
  readHistoryProjects?(): Promise<HistoryProjects>;
  history?: {
    /** Clé d'index de ce chat. Défaut : `warband.history` (un seul chat). */
    key?: string;
    index: {
      get(key: string): unknown;
      set(key: string, value: unknown): unknown;
      update?(key: string, change: (current: unknown) => unknown): unknown;
      subscribe?(listener: () => void): () => void;
    };
    owner?: string;
    maxEntries?: number;
    protectedIds?(): readonly string[];
    canRemove?(ids: readonly string[]): boolean;
    files: JournalFiles;
    /** Confirmation modale native avant suppression. */
    confirmDelete(text: string): Promise<boolean>;
  };
}

/**
 * Conversation : pilote le contrôleur du moteur et l'état du chat. Pas d'import de `vscode`.
 * `stop` termine le run (le moteur sort) ; le message suivant relance un moteur en reprenant la session.
 * Modèle et effort s'appliquent au message suivant : s'ils ont changé, le moteur inactif est remplacé
 * par un nouveau qui reprend la même session (`resume`).
 */
export function createChatSession(deps: ChatSessionDeps) {
  const make = deps.createController ?? createEngineController;
  let state: ChatState = createChatState();
  let controller: EngineController | null = null;
  let sessionId: string | undefined;
  let transferContext = false;
  let confirming = false;
  let researchPending = false;
  let stopping = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;

  const sdkVersion = deps.sdkVersion ?? "unknown";
  const memory = new Map<string, unknown>();
  const store = deps.store ?? {
    get: (key: string) => memory.get(key),
    set: (key: string, value: unknown) => memory.set(key, value),
  };
  const prefsKey = deps.prefsKey ?? "warband.prefs.chat.default";
  let prefs: Prefs = parsePrefs(store.get(prefsKey) ?? store.get(PREFS_KEY));
  let selection: ChatSelection = emptySelection();
  let providerChoiceId: string | undefined;
  const rawSettings = () => deps.readSettings();
  const readSettings = () => selectedSettings(rawSettings(), selection);
  const displaySettings = (): ChatSettings => {
    try {
      return rawSettings();
    } catch {
      return {};
    }
  };
  const providerChoice = () => {
    const list = providerChoices(displaySettings());
    if (providerChoiceId)
      return list.find((p) => p.id === providerChoiceId && p.backend === prefs.provider);
    return (
      list.find((p) => p.id === providerChoiceId && p.backend === prefs.provider) ??
      list.find(
        (p) => p.backend === prefs.provider && (!p.prefix || prefs.model?.startsWith(p.prefix)),
      ) ??
      list.find((p) => p.backend === prefs.provider)
    );
  };
  const routeModels = (list: ModelOption[]) => {
    const prefix = providerChoice()?.prefix;
    return prefix ? list.filter((m) => m.value.startsWith(prefix)) : list;
  };
  const modelsKey = () =>
    prefs.provider === "claude"
      ? MODELS_KEY
      : `${MODELS_KEY}.${prefs.provider}${providerChoice()?.prefix ? `.${providerChoice()?.id}` : ""}`;
  let models: ModelOption[] | null = parseModelCache(store.get(modelsKey()), sdkVersion);
  let modelsRev = 0;
  let modelsStatus: ModelsStatus = models ? "ready" : "idle";
  let modelsMessage: string | undefined;
  let lastModelsNotice: string | undefined;
  let disposed = false;
  let modelLoad: {
    cancel(): void;
  } | null = null;
  /** Mode apprentissage de ce chat (ADR 0010) : relu en booléen strict, jamais depuis `warband.prefs`. */
  let learning = deps.learningKey !== undefined && store.get(deps.learningKey) === true;
  /** Choix avec lequel le moteur courant a démarré : un changement impose de reprendre la session. */
  let applied: {
    model: string | undefined;
    effort: Effort | undefined;
    variant: string | undefined;
    supervision: SupervisionLevel;
    learning: boolean;
  } | null = null;
  /** Révision de l'authentification : incrémentée à chaque jeton défini ou effacé ; le moteur démarré avec une autre est remplacé. */
  let authRev = 0;
  let appliedBurp = "";
  let appliedAuth = 0;
  /** Moteurs écartés (changement de modèle ou d'effort) : leurs derniers messages sont ignorés. */
  const detached = new WeakSet<EngineController>();
  /**
   * Moteurs annulés par l'UI (stop, reset, nouvelle conversation) : l'`AbortError` qui suit
   * ne devient pas une bulle. Une autre erreur (réseau, exception) reste affichée.
   */
  const userAbort = new WeakSet<EngineController>();
  /** Liens du Bypass, un par moteur démarré : libérés à la sortie du moteur. */
  const bypassLinks = new WeakMap<EngineController, BypassEngineLink>();
  // --- Coffre à clés (ADR 0056) : par moteur, la clé retenue, l'empreinte attendue et le relevé des échecs.
  const picks = new WeakMap<EngineController, VaultPick>();
  const keyGuards = new WeakMap<EngineController, ReturnType<typeof createKeyGuard>>();
  const trackers = new WeakMap<EngineController, FailureTracker>();
  /** Contexte de l'avis « pas de rotation » par moteur (fournisseur du coffre, abonnement, modèle). */
  const adviceContexts = new WeakMap<EngineController, RotationAdviceContext>();
  /** Fournisseurs déjà avertis pendant la campagne courante (un seul avis par fournisseur). */
  const campaignAdvised = new Set<string>();
  /** Coffre du fournisseur courant vide ? (puce « sans clé du coffre ») ; `provider` = dernier relevé demandé. */
  let vaultEmptyState: { provider: string; empty: boolean } | undefined;
  /** Rotations déjà faites pour l'envoi courant (au plus autant que de clés). */
  let rotations = 0;
  /** Dernière consigne envoyée à un moteur : rejouée si une rotation survient avant la création de la session. */
  let lastSent: { prompt: string; research?: true; images?: PromptImage[] } | undefined;
  /**
   * Arrêt d'un moteur (ADR 0006, lot 2c) : le lien du Bypass est libéré tout de suite (l'affichage ne
   * voit plus ce moteur), puis `kill` envoie d'abord l'état nul, avant l'annulation du run.
   */
  const stopEngine = (ctl: EngineController | null): void => {
    if (ctl === null) return;
    userAbort.add(ctl);
    bypassLinks.get(ctl)?.release();
    bypassLinks.delete(ctl);
    ctl.kill();
  };
  /** Abandon demandé par l'UI : pas de bulle pour ce motif, le reste du fil est inchangé. */
  const skipAbortBubble = (ctl: EngineController, error: unknown): boolean =>
    userAbort.has(ctl) && isAbortError(error);

  const persist = (key: string, value: unknown) =>
    void Promise.resolve(store.set(key, value)).catch(() => undefined);
  const machineModel = (): string | undefined => {
    try {
      return prefs.provider === "claude" ? readSettings().model : undefined;
    } catch {
      return undefined;
    }
  };
  const supportedNow = (fallback = machineModel()) =>
    effectiveModel(models, prefs.model, fallback)?.supportedEffortLevels;
  const ultracodeLimits = (): UltracodeLimits | undefined => {
    try {
      return readSettings().ultracode;
    } catch {
      return undefined;
    }
  };
  // Campagne de ce chat (lot 3b) et sa vue (lot 4b), déclarées avant `sync`/`view`/`refresh`.
  let campaign: CampaignHost | null = null;
  /** Reste affichée (`finished: true`) jusqu'au prochain envoi ou à la remise à zéro. */
  let campaignView: CampaignView | undefined;
  const buildCampaignView = (host: CampaignHost): CampaignView =>
    campaignViewOf(host.status(), (runId) => host.workerIndex(runId));
  const campaignViewOf = (
    status: CampaignRunStatus,
    workerIndex: (runId: string) => number | undefined,
  ): CampaignView => {
    return {
      objective: cleanText(status.objective ?? "", 300),
      finished: status.finished,
      counts: { ...status.counts },
      workersMax: status.maxWorkers,
      spentUsd: Math.round(status.spentUsd * 100) / 100,
      ...(status.budget.maxUsd !== undefined && { budgetUsd: status.budget.maxUsd }),
      tokens: Math.round(status.tokens),
      ...(status.budget.maxTokens !== undefined && { tokensMax: status.budget.maxTokens }),
      intents: status.intents.slice(0, 50).map((intent) => {
        const worker =
          intent.workerRunId === undefined ? undefined : workerIndex(intent.workerRunId);
        return {
          id: intent.id,
          title: cleanText(intent.title, 200),
          state: intent.state,
          ...(intent.outcome !== undefined && { outcome: intent.outcome }),
          ...(worker !== undefined && { worker }),
        };
      }),
    };
  };
  const sync = () => {
    const ultracode = ultracodeLimits();
    state.setControls(
      buildControls({
        prefs,
        models,
        status: modelsStatus,
        ...(modelsMessage && { modelsMessage }),
        defaultModel: machineModel(),
        busy: state.busy,
        learning,
        campaignElsewhere: isCampaignActive() && campaign === null,
        ...(ultracode && { ultracode }),
      }),
    );
    state.setHistory(historyEntries());
  };
  let conversationGeneration = 0;
  let outputTimer: ReturnType<typeof setTimeout> | undefined;
  let archive: ChatState | null = null;
  let pageBefore: string[] = [];
  let pageLoading = false;
  let pageError: string | undefined;
  let pageRevision = 0;
  let exchangeRevision = 0;
  let exchangeTarget: ChatView["exchangeTarget"];
  const latestPage = () => {
    pageRevision++;
    archive = null;
    pageBefore = [];
    pageLoading = false;
    pageError = undefined;
    exchangeTarget = undefined;
  };
  const view = (): ChatView => {
    const settings = displaySettings();
    const live = state.view();
    const shown = archive ?? state;
    if (vaultEmptyState?.provider !== vaultProvider()) refreshVaultEmpty();
    return {
      ...live,
      ...(vaultEmptyState?.empty === true &&
        vaultEmptyState.provider === vaultProvider() && { vaultEmpty: true }),
      stopping: stopping && controller !== null,
      ...(campaignView && { campaign: campaignView }),
      ...(settings.capabilities && {
        capabilities: {
          settings: settings.capabilities,
          selection: allowedSelection(settings, selection),
          providers: providerChoices(settings).map(({ id, label }) => ({ id, label })),
          provider: providerChoice()?.id ?? null,
          skills: settings.capabilities?.skills ?? [],
          integrations: (settings.integrations ?? [])
            .filter((m) => settings.capabilities?.integrations.includes(m.id))
            .map((m) => m.id),
          burp: !!settings.burp && settings.capabilities?.integrations.includes("burp") === true,
          // Méthodes connues et services configurés : les disponibilités machine restent distinctes.
          available: {
            skills: Object.keys(AGENT_PROFILES),
            integrations: (settings.integrations ?? []).map((m) => m.id),
            burp: !!settings.burp,
          },
        },
        noProvider: live.noProvider || !providerChoice(),
      }),
      conversation: current?.id ?? state.readonly?.id ?? `new:${conversationGeneration}`,
      items: shown.view().items,
      ...(exchangeTarget && { exchangeTarget }),
      ...(history && {
        paging: {
          earlier: shown.dropped > 0,
          archived: archive !== null,
          before: pageBefore.at(-1) ?? null,
          loading: pageLoading,
          ...(pageError && { error: pageError }),
        },
      }),
    };
  };
  const refresh = () => {
    clearTimeout(outputTimer);
    outputTimer = undefined;
    if (campaign !== null) campaignView = buildCampaignView(campaign);
    sync();
    deps.onView(view());
  };
  const warn = (reason: Reason) => state.notice(formatReason(reason, getUiLocale()), "error");
  const clampNotice = (wanted: EffortChoice, got: Effort) =>
    state.notice(
      t`Niveau d'effort ramené à « ${labelOf(got)} » : « ${labelOf(wanted)} » n'est pas pris en charge par ce modèle.`,
    );

  /** Une variante ne vaut que pour le modèle courant et son catalogue runtime. */
  const validVariant = (): string | undefined => {
    if (prefs.provider === "claude" || prefs.variant === null) return undefined;
    const selected = effectiveModel(models, prefs.model, machineModel());
    return selected?.reasoningVariants?.includes(prefs.variant) ? prefs.variant : undefined;
  };
  const clampVariant = () => {
    if (prefs.variant !== null && validVariant() === undefined) {
      prefs = { ...prefs, variant: null };
      persist(prefsKey, prefs);
    }
  };

  /** Fournisseur du coffre pour ce chat : `claude`, `openai`, ou le fournisseur OpenCode du modèle choisi. */
  const vaultProvider = (): string | undefined => {
    if (prefs.provider === "claude" || prefs.provider === "openai") return prefs.provider;
    const choice = providerChoice();
    if (choice?.runtimeId !== undefined) return choice.runtimeId;
    // Ligne « OpenCode » générique avec un modèle Zen (`opencode/…`) : coffre de Zen (ADR 0056).
    return choice?.id === "opencode" && prefs.model?.startsWith("opencode/")
      ? "opencode"
      : undefined;
  };
  const tokenHint = (launch: boolean, afterKeyId?: string): TokenHint => {
    const vaultProviderId = vaultProvider();
    return {
      launch,
      ...(vaultProviderId !== undefined && { vaultProvider: vaultProviderId }),
      ...(afterKeyId !== undefined && { afterKeyId }),
    };
  };

  /** Contexte de l'avis « pas de rotation » : jamais de valeur de clé. */
  const adviceFor = (token: TokenChoice | undefined, model: string | undefined) => {
    const provider = vaultProvider();
    const context: RotationAdviceContext = {
      subscription: token?.auth?.name === "CLAUDE_CODE_OAUTH_TOKEN",
      ...(provider !== undefined && { provider }),
      ...(model !== undefined && { model }),
    };
    return context;
  };
  /**
   * Avis neutre sous l'erreur quand un quota ou une clé invalide n'a pas de rotation possible (coffre vide,
   * une seule clé, abonnement). `once` : un seul avis par fournisseur pour la campagne courante.
   */
  const adviseNoRotation = async (
    context: RotationAdviceContext,
    failure: ProviderFailureInput,
    once: boolean,
  ): Promise<void> => {
    try {
      const keyed = context.provider !== undefined && !context.subscription;
      if (keyed && deps.vault === undefined) return;
      const count =
        keyed && deps.vault && context.provider !== undefined
          ? (await deps.vault.store.get(context.provider)).keys.length
          : 0;
      const text = rotationAdvice(context, failure, count);
      if (text === undefined || disposed) return;
      if (once) {
        const slot = keyed ? (context.provider ?? "") : "abonnement";
        if (campaignAdvised.has(slot)) return;
        campaignAdvised.add(slot);
      }
      state.notice(text, "info", 2000, "openKeys");
      refresh();
    } catch {
      // Un avis manqué ne doit jamais gêner l'erreur déjà affichée.
    }
  };
  /** Relève (asynchrone) si le coffre du fournisseur courant est vide ; rafraîchit la vue au changement. */
  const refreshVaultEmpty = (): void => {
    const provider = vaultProvider();
    const store = deps.vault?.store;
    if (provider === undefined || store === undefined) {
      vaultEmptyState = undefined;
      return;
    }
    vaultEmptyState = {
      provider,
      empty: vaultEmptyState?.provider === provider && vaultEmptyState.empty,
    };
    void store
      .get(provider)
      .then((vault) => {
        if (disposed || vaultProvider() !== provider) return;
        const empty = vault.keys.length === 0;
        if (vaultEmptyState?.provider === provider && vaultEmptyState.empty === empty) return;
        vaultEmptyState = { provider, empty };
        deps.onView(view());
      })
      .catch(() => undefined);
  };

  /** Modèle et effort du prochain message : préférence, sinon réglage machine ; effort ramené s'il n'est pas permis. */
  const choice = (settings: ChatSettings) => {
    const prefix = providerChoice()?.prefix;
    const model = prefix
      ? prefs.model?.startsWith(prefix)
        ? prefs.model
        : models?.find((m) => m.value.startsWith(prefix))?.value
      : (prefs.model ?? (prefs.provider === "claude" ? settings.model : undefined));
    // « Auto » : aucun effort transmis, le modèle garde son défaut.
    if (prefs.provider !== "claude" || prefs.effort === null) {
      return {
        model,
        effort: undefined,
        variant: prefs.provider === "claude" ? undefined : validVariant(),
        key: null,
        clampedTo: undefined,
        ultra: undefined,
      };
    }
    const r = resolveEffort(prefs.effort, settings.ultracode);
    const c = clampEffort(r.effort, supportedNow(settings.model));
    return {
      model,
      variant: undefined,
      effort: c.effort ?? undefined,
      key: prefs.effort,
      clampedTo: c.clamped && c.effort !== null ? c.effort : undefined,
      // Les plafonds d'Ultracode ne valent que si `max` est bien appliqué.
      ultra: c.clamped ? undefined : r.limits,
    };
  };

  // --- Historique (F4) ---
  const history = deps.history;
  const historyKey = history?.key ?? DEFAULT_HISTORY_KEY;
  const parseHistory = (raw: unknown) => parseIndex(raw, history?.maxEntries);
  let index: ConversationMeta[] = history ? parseHistory(history.index.get(historyKey)) : [];
  let current: ConversationMeta | null = null;
  // Invalide les lectures de projet/navigation en attente après arrêt ou nouvelle action.
  let navigationRev = 0;
  let historyProjects: HistoryProjects = { activeId: null, projects: [] };
  const reloadHistoryProjects = async (revision = navigationRev) => {
    try {
      const projects = (await deps.readHistoryProjects?.()) ?? { activeId: null, projects: [] };
      if (revision !== navigationRev) return false;
      historyProjects = projects;
      return true;
    } catch {
      if (revision !== navigationRev) return false;
      historyProjects = { activeId: null, projects: [] };
      state.notice(
        t(
          "Liste des projets indisponible : envoi suspendu, réessayez après vérification du projet actif.",
        ),
        "error",
      );
      return false;
    }
  };
  const historyEntries = (): HistoryEntry[] =>
    sortRecent(index)
      .filter((c) => c.runIds.length > 0 || c.id === current?.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        tools: c.tools,
        provider: { claude: "Claude", openai: "OpenAI", opencode: "OpenCode" }[c.provider],
        model: c.model ?? t("défaut"),
        current: c.id === current?.id,
        projectKey: historyProject(c, historyProjects.projects).key,
        projectLabel: historyProject(c, historyProjects.projects).label,
      }));
  const saveIndex = (change: { upsert?: ConversationMeta[]; remove?: string[] } = {}) => {
    if (!history) return;
    const saved = history.index.update
      ? history.index.update(historyKey, (raw) => {
          const rows = new Map(
            parseHistory(raw)
              .filter((row) => !change.remove?.includes(row.id))
              .map((row) => [row.id, row]),
          );
          for (const row of change.upsert ?? []) rows.set(row.id, structuredClone(row));
          return sortRecent([...rows.values()]);
        })
      : history.index.set(historyKey, index);
    void Promise.resolve(saved).catch(() =>
      state.notice(t("Impossible d’enregistrer l’historique partagé."), "error"),
    );
  };
  /** Rétention : plus anciennes conversations purgées (journaux compris), la conversation en cours exceptée. */
  const enforceRetention = async () => {
    if (!history) return;
    const sizes = new Map<string, number>();
    for (const c of index) {
      let total = 0;
      for (const id of c.runIds) total += await history.files.size(id);
      sizes.set(c.id, total);
    }
    const owned =
      history.owner === undefined
        ? index
        : index.filter((row) => row.historyOwner === history.owner);
    const { drop } = applyRetention(owned, sizes, {
      protect: current?.id,
      protectIds: history.protectedIds?.() ?? [],
    });
    if (drop.length === 0) return;
    const dropped = drop.map((row) => row.id);
    index = index.filter((row) => !dropped.includes(row.id));
    saveIndex({ remove: dropped });
    await history.files.remove(drop.flatMap((c) => c.runIds));
    refresh();
  };
  const ensureConversation = (firstPrompt: string) => {
    if (!history || current !== null) return;
    const now = new Date().toISOString();
    current = {
      id: randomUUID(),
      ...(history.owner && { historyOwner: history.owner }),
      ...(isRunId(historyProjects.activeId) && { projectId: historyProjects.activeId }),
      title: titleFrom(firstPrompt),
      createdAt: now,
      updatedAt: now,
      provider: prefs.provider,
      model: prefs.model,
      effort: prefs.effort,
      variant: prefs.variant,
      sessionId: sessionId ?? null,
      runIds: [],
      tools: 0,
    };
    index = [current, ...index];
  };
  /**
   * Campagne (ADR 0054) : le run (journal de campagne, planificateur ou worker) rejoint les `runIds`
   * de la conversation, avec son rôle dans la table `agents` (relecture et reprise).
   */
  const registerAgentRun = (runId: string, role: ConversationAgentRole, index: number) => {
    if (!current || !isRunId(runId)) return;
    const listed = current.runIds.includes(runId);
    if (listed && current.agents?.[runId] !== undefined) return;
    if (!listed) current.runIds.push(runId);
    current.agents = { ...current.agents, [runId]: { role, index } };
    touch();
  };
  const touch = () => {
    if (!current) return;
    current.updatedAt = new Date().toISOString();
    // Une session SDK partielle ne devient reprenable qu’après confirmation du transfert.
    if (sessionId !== undefined && !transferContext) current.sessionId = sessionId;
    saveIndex({ upsert: [current] });
  };

  /** Paramètres de démarrage communs à un chat et à un moteur de campagne (sans reprise ni contexte). */
  const commonStartParams = (
    settings: ChatSettings,
    picked: ReturnType<typeof choice>,
    token: TokenChoice | undefined,
    testAccounts: Awaited<ReturnType<NonNullable<ChatSessionDeps["getTestAccounts"]>>> | undefined,
  ): CampaignEngineSetup["params"] => {
    const maxTurns = picked.ultra ? picked.ultra.maxTurns : settings.maxTurns;
    return {
      ...(testAccounts && { testAccounts }),
      cwd: deps.cwd,
      auth: token?.mode ?? "auto",
      provider: prefs.provider,
      ...(prefs.provider === "opencode" &&
        settings.opencodeProviders && { opencodeProviders: settings.opencodeProviders }),
      ...(picked.model !== undefined && { model: picked.model }),
      ...(picked.effort !== undefined && { effort: picked.effort }),
      ...(picked.variant !== undefined && { variant: picked.variant }),
      ...(!learning && { supervision: prefs.supervision }),
      ...(maxTurns !== undefined && { maxTurns }),
      ...(picked.ultra?.maxBudgetUsd !== undefined && { maxBudgetUsd: picked.ultra.maxBudgetUsd }),
      ...(history && { journalDir: history.files.dir }),
      ...(!learning && settings.burp && { burp: settings.burp }),
      ...(!learning && settings.integrations && { integrations: settings.integrations }),
      ...(!learning && { profile: settings.profile ?? DEFAULT_AGENT_PROFILE }),
      ...(settings.webSearch !== undefined && { webSearch: !learning && settings.webSearch }),
      // Le mode exclut `systemPrompt` (ADR 0010) : la consigne vient du moteur, jamais de l'UI.
      ...(learning && { mode: "learning" as const }),
    };
  };

  const startEngine = async (
    revision: number,
    conversationContext?: ReturnType<typeof buildConversationContext>,
    rotation?: { afterKeyId: string },
  ): Promise<EngineController | null> => {
    const settings = readSettings();
    const picked = choice(settings);
    if (picked.clampedTo !== undefined && picked.key !== null)
      clampNotice(picked.key, picked.clampedTo);
    const token = await deps.getToken(prefs.provider, tokenHint(true, rotation?.afterKeyId));
    if (revision !== navigationRev) return null;
    if (deps.requireProvider && token === undefined) {
      state.setNoProvider(true);
      state.setBusy(false);
      state.notice(
        t("La connexion au fournisseur n’est plus disponible. Reconnectez-le avant de continuer."),
        "error",
      );
      refresh();
      return null;
    }
    refresh();
    stopping = false;
    const transferring = conversationContext !== undefined;
    const invalidateTransfer = () => {
      if (!transferring || !transferContext) return;
      sessionId = undefined;
      if (current) current.sessionId = null;
      detached.add(ctl);
      if (controller === ctl) controller = null;
      applied = null;
      state.approvals.clear();
      state.setBusy(false);
      stopEngine(ctl);
      touch();
    };
    const ctl = make({
      enginePath: deps.enginePath,
      args: deps.engineArgs,
      cwd: deps.cwd,
      ...(token?.auth && { auth: token.auth }),
      handlers: {
        onMissionContext: (snapshot) => {
          if (!detached.has(ctl)) deps.onMissionContext?.(snapshot);
        },
        onStarted: ({ runId, warning }) => {
          if (detached.has(ctl)) return;
          if (current && isRunId(runId) && !current.runIds.includes(runId)) {
            current.runIds.push(runId);
            touch();
          }
          if (warning) warn(warning);
          refresh();
        },
        onEvent: (event) => {
          if (detached.has(ctl)) return;
          deps.onObservedEvent?.(event);
          trackers.get(ctl)?.observe(event);
          // Le moteur annonce la clé qu'il utilise vraiment : une autre que celle choisie l'arrête, sans relance.
          if (keyGuards.get(ctl)?.observe(event)) return rejectKey(ctl);
          if (event.kind === "turn.finished" && event.status === "error") void rotate(ctl);
          // Connu dès le début de la session : la reprise (changement de modèle) n'attend pas la fin du run.
          if (event.kind === "session.started") {
            sessionId = event.sessionId;
            if (current && isModelId(event.model)) current.model = event.model;
            touch();
          }
          if (event.kind === "tool.requested" && current) current.tools++;
          if (!stopping && transferring && transferContext && event.kind === "turn.finished") {
            if (event.status === "success") {
              transferContext = false;
              touch();
            } else if (event.status === "error") {
              invalidateTransfer();
            }
          }
          if (event.kind === "error") {
            if (!stopping) invalidateTransfer();
            if (skipAbortBubble(ctl, event)) return;
          }
          state.event(event);
          if (event.kind === "research.status" && event.status !== "requested")
            researchPending = false;
          if (stopping) state.setBusy(true);
          if (event.kind === "process.output" || event.kind === "agent.thinking") {
            outputTimer ??= setTimeout(refresh, 100);
          } else refresh();
        },
        onApproval: (pending) => {
          if (detached.has(ctl)) return;
          state.approvals.set(pending.toolUseId, toCard(pending));
          refresh();
        },
        onEnded: (summary) => {
          if (detached.has(ctl)) return;
          if (summary.status === "error") void rotate(ctl);
          if (stopping) {
            refresh();
            return;
          }
          if (transferring && transferContext && summary.status === "error") {
            invalidateTransfer();
          } else {
            if (summary.sessionId !== undefined) sessionId = summary.sessionId;
            if (transferring && summary.status === "success") transferContext = false;
          }
          touch();
          void enforceRetention();
          if (!stopping) state.setBusy(false);
          refresh();
        },
        onError: (reason) => {
          if (detached.has(ctl)) return;
          if (!stopping) invalidateTransfer();
          if (skipAbortBubble(ctl, reason)) return;
          state.error(reason);
          refresh();
        },
        onMountIssue: (issue) => {
          if (detached.has(ctl)) return;
          deps.onMountIssue?.(issue);
        },
        onBypassAck: (ack) => {
          if (detached.has(ctl)) return;
          bypassLinks.get(ctl)?.acked(ack.seq, ack.state);
        },
        onExit: ({ code, stderrTail }) => {
          // Avant le filtre des moteurs écartés : un moteur qui sort n'a plus de Bypass (échec fermé).
          bypassLinks.get(ctl)?.release();
          if (detached.has(ctl)) return;
          // Ancien moteur (réinitialisation puis nouveau message) : l'état n'est plus le sien.
          if (controller !== null && controller !== ctl) return;
          invalidateTransfer();
          controller = null;
          clearTimeout(stopTimer);
          stopTimer = undefined;
          if (researchPending) {
            researchPending = false;
            state.notice(t("Recherche demandée interrompue : résultat inconnu."), "error");
          }
          const interrupted = state.interruptPending();
          if (stopping) {
            state.notice(
              t(
                "Moteur arrêté. Les tâches détachées dans les conteneurs peuvent continuer ; vérifiez leur état.",
              ),
            );
          } else if (interrupted) {
            state.notice(
              t(
                "Moteur terminé avec des outils sans résultat. Les tâches détachées dans les conteneurs peuvent continuer ; vérifiez leur état.",
              ),
              "error",
            );
          }
          touch();
          state.approvals.clear();
          state.setBusy(false);
          if (!stopping && code !== 0 && code !== null) {
            state.notice(
              `${t`Le moteur s'est arrêté (code ${code}).`}${stderrTail ? `\n${stderrTail}` : ""}`,
              "error",
              66_000,
            );
          }
          stopping = false;
          refresh();
        },
        onLog: (text) => deps.onLog?.(text),
      },
    });
    if (token?.vault) picks.set(ctl, token.vault);
    adviceContexts.set(ctl, adviceFor(token, picked.model));
    refreshVaultEmpty();
    // Empreinte attendue de la clé d'API transmise (le jeton d'abonnement OAuth n'est pas une clé du coffre).
    if (token?.auth && token.auth.name !== "CLAUDE_CODE_OAUTH_TOKEN")
      keyGuards.set(ctl, createKeyGuard(fingerprint(token.auth.value)));
    trackers.set(ctl, createFailureTracker());
    controller = ctl;
    applied = {
      model: picked.model,
      effort: picked.effort,
      variant: picked.variant,
      supervision: prefs.supervision,
      learning,
    };
    if (current) {
      current.provider = prefs.provider;
      current.model = picked.model ?? null;
      current.variant = picked.variant ?? null;
      current.effort = prefs.effort;
      touch();
    }
    appliedAuth = authRev;
    appliedBurp = JSON.stringify([
      settings.burp ?? null,
      settings.integrations ?? [],
      settings.profile ?? null,
      settings.webSearch ?? true,
      settings.opencodeProviders ?? null,
    ]);
    const testAccounts = !learning ? await deps.getTestAccounts?.() : undefined;
    if (revision !== navigationRev || detached.has(ctl)) return null;
    await ctl.start({
      ...commonStartParams(settings, picked, token, testAccounts),
      ...(token?.vault && {
        vault: { provider: token.vault.provider, name: token.vault.name, rank: token.vault.rank },
      }),
      ...(conversationContext !== undefined && { conversationContext }),
      ...(!transferring && sessionId !== undefined && { resume: sessionId }),
    });
    if (revision !== navigationRev || detached.has(ctl)) return null;
    if (deps.bypass) {
      bypassLinks.set(
        ctl,
        deps.bypass.attach((state) => ctl.bypass(state)),
      );
    }
    return ctl;
  };

  // --- Coffre à clés (ADR 0056) : vérification de la clé effective et rotation ---
  let hostRecorder: ReturnType<typeof createRecorder> | undefined;
  /** Événement `vault.rotated` complet (journal de l'hôte), et avis lisible : rangs et empreintes, jamais de valeur. */
  const announceRotation = (payload: VaultRotatedPayload): void => {
    hostRecorder ??= createRecorder({
      ...(deps.extraSecrets !== undefined && { extraSecrets: deps.extraSecrets }),
    });
    deps.onObservedEvent?.(hostRecorder.emit(payload));
    state.rotation(payload);
  };

  /** Le moteur utilise une autre clé que celle choisie : il est arrêté et le tour n'est pas relancé. */
  const rejectKey = (ctl: EngineController): void => {
    detached.add(ctl);
    if (controller === ctl) controller = null;
    applied = null;
    state.approvals.clear();
    stopEngine(ctl);
    state.error(new CodedError("vault.keyMismatch"));
    state.setBusy(false);
    refresh();
  };

  /**
   * Fin d'un tour en échec : si l'échec est un quota ou une clé invalide et que la clé vient du coffre,
   * persiste l'état de la clé, écarte le moteur et en relance un NOUVEAU avec la clé suivante, en reprenant
   * la même session (`resume`). La consigne n'est rejouée que si la session n'a pas pu être créée.
   */
  const rotate = async (ctl: EngineController): Promise<void> => {
    const pick = picks.get(ctl);
    const failure = trackers.get(ctl)?.take();
    const vault = deps.vault;
    if (failure === undefined) return;
    if (stopping || disposed || detached.has(ctl) || controller !== ctl) return;
    if (pick === undefined) {
      // Aucune clé du coffre derrière ce moteur : pas de rotation, l'utilisateur doit savoir pourquoi.
      const context = adviceContexts.get(ctl);
      if (context !== undefined) await adviseNoRotation(context, failure, false);
      return;
    }
    if (vault === undefined) return;
    const revision = navigationRev;
    try {
      const outcome = await rotateAfterFailure(
        vault.store,
        pick,
        failure,
        (vault.now ?? (() => new Date()))(),
      );
      if (outcome.kind === "none") return;
      if (disposed || detached.has(ctl) || revision !== navigationRev) return;
      detached.add(ctl);
      if (controller === ctl) controller = null;
      applied = null;
      state.approvals.clear();
      stopEngine(ctl);
      announceRotation(outcome.event);
      const keys = await vault.store.get(pick.provider);
      if (outcome.kind === "exhausted" || rotations >= keys.keys.length) {
        const until = outcome.kind === "exhausted" ? outcome.until : soonestCooldown(keys);
        state.error(new CodedError("vault.allExhausted", until === undefined ? {} : { until }));
        const context = adviceContexts.get(ctl);
        if (context !== undefined) await adviseNoRotation(context, failure, false);
        state.setBusy(false);
        refresh();
        return;
      }
      rotations++;
      state.setBusy(true);
      refresh();
      const next = await startEngine(revision, undefined, { afterKeyId: pick.keyId });
      if (next === null || revision !== navigationRev) return;
      if (sessionId !== undefined) next.prompt(ROTATION_RESUME_PROMPT);
      else if (lastSent !== undefined)
        next.prompt(lastSent.prompt, lastSent.research, lastSent.images);
    } catch (error) {
      if (revision !== navigationRev) return;
      stopEngine(controller);
      controller = null;
      state.error(error);
      state.setBusy(false);
      refresh();
    }
  };

  // --- Campagne multi-agents (ADR 0054, lot 3b) : jamais empruntée quand le mode est éteint ---
  let campaignLink: BypassEngineLink | undefined;
  let campaignBypassAck: ((ack: { state: BypassState | null }) => void) | undefined;
  let campaignJournal: JournalWriter | undefined;
  /** Journal de la dernière campagne de la conversation ouverte en lecture seule (reprise possible). */
  let readonlyCampaign: { events: EngineEvent[]; workerIndexStart: number } | undefined;

  const sameBypass = (a: BypassState | null, b: BypassState | null): boolean =>
    a === null || b === null ? a === b : a.since === b.since && a.expiresAt === b.expiresAt;

  const agentLabel = (info: CampaignAgentInfo): ItemAgent => ({
    role: info.role,
    index: info.index,
    ...(info.intent !== undefined && { intent: cleanText(info.intent.title, 200) }),
  });

  /** Fin de campagne (normale, arrêt ou erreur) : Bypass libéré, journal fermé, chat libéré. */
  const endCampaign = (why: Reason) => {
    campaignLink?.release();
    campaignLink = undefined;
    campaignBypassAck = undefined;
    if (campaign !== null) campaignView = buildCampaignView(campaign);
    campaign = null;
    const journal = campaignJournal;
    campaignJournal = undefined;
    void journal?.close().catch(() => undefined);
    if (disposed) return;
    for (const [id, card] of state.approvals)
      if (card.agent !== undefined) state.approvals.delete(id);
    state.setBusy(false);
    state.notice(formatReason(why, getUiLocale()));
    refresh();
  };

  const cleanNote = (raw: unknown): string =>
    typeof raw === "string" ? cleanText(raw.trim(), 4000) : "";

  /**
   * Conversation en lecture seule : relit le dernier journal de campagne, reconstruit le panneau
   * (`finished: true`) et prépare la reprise. Un journal incohérent n'empêche pas l'ouverture :
   * le bouton « Reprendre (nouvelle session) » reste proposé, avec un avis.
   */
  const restoreReadonlyCampaign = async (
    meta: ConversationMeta,
    revision: number,
  ): Promise<boolean> => {
    const agents = meta.agents;
    if (!history || !agents) return false;
    const campaignRun = [...meta.runIds].reverse().find((id) => agents[id]?.role === "campaign");
    if (campaignRun === undefined) return false;
    try {
      const events = await readCampaignJournal(history.files, campaignRun);
      if (revision !== navigationRev || events === null) return false;
      const started = events.find((e) => e.kind === "campaign.started");
      const probe = restoreCampaignCoordinator(events, {
        recorder: createRecorder({ redact: false }),
        ...(started?.kind === "campaign.started" &&
          Number.isInteger(started.maxWorkers) &&
          started.maxWorkers >= 1 &&
          started.maxWorkers <= 8 && { maxWorkers: started.maxWorkers }),
      });
      const finished = [...events].reverse().find((e) => e.kind === "campaign.finished");
      const spent = finished?.kind === "campaign.finished" ? finished.spentUsd : 0;
      campaignView = campaignViewOf(
        { ...probe.status(), finished: true, spentUsd: spent },
        (runId) => agents[runId]?.index,
      );
      readonlyCampaign = {
        events,
        workerIndexStart: Math.max(
          0,
          ...Object.values(agents)
            .filter((a) => a.role === "worker")
            .map((a) => a.index),
        ),
      };
      return true;
    } catch (error) {
      if (revision === navigationRev) {
        state.error(error);
      }
      return false;
    }
  };

  const onCampaignMessage = (info: CampaignAgentInfo, message: FromEngine) => {
    if (disposed) return;
    switch (message.type) {
      case "event": {
        const event = message.event;
        deps.onObservedEvent?.(event);
        if (event.kind === "tool.requested" && current) current.tools++;
        // L'étiquette d'agent est une donnée de l'élément, jamais du texte du modèle.
        state.event(event, agentLabel(info));
        if (event.kind === "process.output" || event.kind === "agent.thinking") {
          outputTimer ??= setTimeout(refresh, 100);
        } else refresh();
        return;
      }
      case "error":
        state.error(message.reason);
        refresh();
        return;
      case "bypassAck":
        campaignBypassAck?.({ state: message.state });
        return;
      default:
        return; // `started`, `ended`, `missionContext` : la campagne n'en a pas l'usage
    }
  };

  /** Jeton et réglages relus à chaque lancement de moteur, comme pour un chat. */
  const campaignSetup = async (afterKeyId?: string): Promise<CampaignEngineSetup> => {
    const settings = readSettings();
    const picked = choice(settings);
    const token = await deps.getToken(prefs.provider, tokenHint(true, afterKeyId));
    if (deps.requireProvider && token === undefined)
      throw new Error(
        t("La connexion au fournisseur n’est plus disponible. Reconnectez-le avant de continuer."),
      );
    const testAccounts = await deps.getTestAccounts?.();
    return {
      ...(token?.auth && { auth: token.auth }),
      ...(token?.vault && { vault: token.vault }),
      advice: adviceFor(token, picked.model),
      params: commonStartParams(settings, picked, token, testAccounts),
    };
  };

  /** Rotation des moteurs de campagne : même logique que le chat (`rotateAfterFailure`), même coffre. */
  const campaignVault = (access: NonNullable<ChatSessionDeps["vault"]>): CampaignVaultAccess => ({
    rotate: (pick, failure) =>
      rotateAfterFailure(access.store, pick, failure, (access.now ?? (() => new Date()))()),
    keyCount: async (provider) => (await access.store.get(provider)).keys.length,
    advise: (context, failure) => adviseNoRotation(context, failure, true),
  });

  /** Envoi en mode multi-agents : une campagne remplace le run simple. */
  const startCampaign = async (
    text: string,
    prompt: string,
    revision: number,
    resume?: { events: readonly EngineEvent[]; note: string; workerIndexStart: number },
  ): Promise<boolean> => {
    if (!resume) ensureConversation(text);
    if (!resume || resume.note !== "") state.user(resume ? resume.note : text);
    campaignAdvised.clear();
    campaignView = undefined;
    refresh();
    let journal: JournalWriter | undefined;
    try {
      const recorder = createRecorder({
        ...(deps.extraSecrets !== undefined && { extraSecrets: deps.extraSecrets }),
      });
      if (history) {
        journal = await openJournal(join(history.files.dir, `${recorder.runId}.jsonl`));
        recorder.subscribe(journal.sink);
      }
      if (revision !== navigationRev) {
        await journal?.close().catch(() => undefined);
        return false;
      }
      campaignJournal = journal;
      // Le journal de campagne suit le sort de la conversation (rétention, suppression).
      if (journal) registerAgentRun(recorder.runId, "campaign", 0);
      const spawnEngine = createCampaignSpawner({
        make,
        options: { enginePath: deps.enginePath, args: deps.engineArgs, cwd: deps.cwd },
        resolve: campaignSetup,
        ...(deps.vault !== undefined && { vault: campaignVault(deps.vault) }),
      });
      const inScope = isRunId(historyProjects.activeId)
        ? deps.campaignScope?.(historyProjects.activeId)
        : undefined;
      const host = createCampaignHost({
        objective: prompt,
        workers: prefs.multiAgentWorkers,
        ...(resume && {
          restoreFrom: resume.events,
          userNote: resume.note,
          workerIndexStart: resume.workerIndexStart,
        }),
        ...(inScope !== undefined && { inScope }),
        spawnEngine,
        recorder,
        onApproval: (card) => {
          if (disposed) return;
          state.approvals.set(card.toolUseId, card);
          refresh();
        },
        onAgent: (info) => {
          if (!disposed) registerAgentRun(info.runId, info.role, info.index);
        },
        onMessage: onCampaignMessage,
        onChange: () => {
          if (!disposed) refresh();
        },
        onFinished: endCampaign,
      });
      campaign = host;
      if (hasPastedCredentials(prompt)) {
        state.notice(
          t(
            "Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir.",
          ),
        );
      }
      if (deps.bypass && !host.finished) {
        let seq = 0;
        let last: BypassState | null = null;
        campaignLink = deps.bypass.attach((bypassState) => {
          last = bypassState;
          host.setBypass(bypassState);
          return ++seq;
        });
        // Un accusé d'un moteur de la campagne confirme l'état courant ; un état périmé est ignoré
        // (l'échéance d'accusé du Bypass éteint tout si aucun moteur ne confirme).
        campaignBypassAck = (ack) => {
          if (sameBypass(ack.state, last)) campaignLink?.acked(seq, ack.state);
        };
      }
      refresh();
      return true;
    } catch (error) {
      if (campaignJournal === undefined) await journal?.close().catch(() => undefined);
      campaign = null;
      if (revision !== navigationRev) return false;
      state.error(error);
      state.setBusy(false);
      refresh();
      return false;
    }
  };

  /** Invalide aussi les lectures de connexion en attente, qui ne savent pas s'annuler. */
  const cancelModelLoad = () => {
    modelsRev++;
    modelLoad?.cancel();
    modelLoad = null;
  };

  /** Sondage borné dès la lecture de la connexion ; `force` remplace aussi un sondage en attente. */
  const loadModels = async (force = false): Promise<void> => {
    if (disposed || (modelLoad && !force) || (models !== null && !force)) return;
    cancelModelLoad();
    const revision = modelsRev;
    const provider = prefs.provider;
    const cacheKey = modelsKey();
    const cancelled = Symbol("cancelled");
    const timedOut = Symbol("timedOut");
    let probe: EngineController | null = null;
    let acceptingLogs = true;
    let rejectWait!: (error: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectWait = reject;
    });
    const killProbe = () => {
      acceptingLogs = false;
      const currentProbe = probe;
      probe = null;
      currentProbe?.kill();
    };
    const timer = setTimeout(() => {
      rejectWait(timedOut);
      killProbe();
    }, MODEL_LOAD_TIMEOUT_MS);
    modelLoad = {
      cancel: () => {
        clearTimeout(timer);
        rejectWait(cancelled);
        killProbe();
      },
    };
    const active = () => !disposed && revision === modelsRev;
    modelsStatus = "loading";
    modelsMessage = undefined;
    refresh();
    const failed = (message: string) => {
      modelsStatus = models ? "ready" : "unavailable";
      modelsMessage = message;
      if (lastModelsNotice !== message) {
        state.notice(message, "error");
        lastModelsNotice = message;
      }
    };
    try {
      const token = await Promise.race([deps.getToken(provider), interrupted]);
      if (!active()) return;
      if (deps.requireProvider && !token) {
        state.setNoProvider(true);
        models = null;
        failed(t("Connexion au fournisseur indisponible. Reconnectez-le puis réessayez."));
        return;
      }
      if (deps.requireProvider) state.setNoProvider(false);
      probe = make({
        enginePath: deps.enginePath,
        args: deps.engineArgs,
        cwd: deps.cwd,
        ...(token?.auth && { auth: token.auth }),
        handlers: {
          onProviders: (providers) => {
            if (active() && provider === "opencode") deps.onProviders?.(providers);
          },
          onLog: (text) => {
            if (active() && acceptingLogs) deps.onLog?.(text);
          },
        },
      });
      const list = usableModels(
        await Promise.race([
          probe.models({
            cwd: deps.cwd,
            auth: token?.mode ?? "auto",
            provider,
            ...(provider === "opencode" &&
              readSettings().opencodeProviders && {
                opencodeProviders: readSettings().opencodeProviders,
              }),
            timeoutMs: MODEL_LOAD_TIMEOUT_MS,
          }),
          interrupted,
        ]),
      );
      if (!active()) return;
      const routedList = routeModels(list);
      if (routedList.length === 0) {
        failed(
          t(
            "Le fournisseur n’a renvoyé aucun modèle utilisable. Réessayez ou vérifiez sa connexion.",
          ),
        );
        return;
      }
      models = routedList;
      modelsStatus = "ready";
      modelsMessage = undefined;
      lastModelsNotice = undefined;
      persist(cacheKey, { sdk: sdkVersion, models });
      if (prefs.model !== null && !list.some((m) => m.value === prefs.model)) {
        prefs = { ...prefs, model: null };
        persist(prefsKey, prefs);
        state.notice(t("Le modèle choisi n'est plus proposé : retour au modèle par défaut."));
      }
      clampVariant();
    } catch (error) {
      if (!active() || error === cancelled) return;
      killProbe();
      const message =
        error === timedOut
          ? t(
              "Chargement des modèles interrompu après 45 secondes. Réessayez ou vérifiez la connexion au fournisseur.",
            )
          : modelLoadFailure(error);
      deps.onLog?.(t`Catalogue des modèles : ${message}\n`);
      failed(message);
    } finally {
      acceptingLogs = false;
      clearTimeout(timer);
      if (active()) {
        modelLoad = null;
        refresh();
      }
    }
  };

  /** Ramène le niveau d'effort au plus proche niveau permis par le modèle courant. */
  const reclamp = () => {
    if (prefs.effort === null) return;
    const c = clampEffort(resolveEffort(prefs.effort, undefined).effort, supportedNow());
    if (c.effort !== null && c.clamped) {
      clampNotice(prefs.effort, c.effort);
      prefs = { ...prefs, effort: c.effort };
    }
  };

  /** Remplace le moteur inactif (modèle ou effort changé) ; le suivant reprendra la même session. */
  const retire = async (
    old: EngineController,
    notice = t("Réglages modifiés : nouveau moteur au prochain message, même session."),
  ) => {
    detached.add(old);
    controller = null;
    stopping = true;
    state.approvals.clear();
    stopEngine(old);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      old.exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timer);
    state.notice(notice);
  };

  /** Relit la présence d'un jeton (grise le chat sans fournisseur) ; sans effet si `requireProvider` est absent. */
  const refreshProvider = async (): Promise<void> => {
    if (!deps.requireProvider) return;
    const provider = prefs.provider;
    const revision = authRev;
    let has = false;
    try {
      has = (await deps.getToken(prefs.provider)) !== undefined;
    } catch {
      has = false;
    }
    if (!disposed && revision === authRev && provider === prefs.provider) state.setNoProvider(!has);
  };
  if (deps.requireProvider)
    void refreshProvider().then(() => {
      if (!disposed) refresh();
    });

  const resetConversation = () => {
    deps.bypass?.reset?.();
    campaign?.stop("user");
    campaignView = undefined;
    readonlyCampaign = undefined;
    researchPending = false;
    deps.onObservedEvent?.(null);
    selection = emptySelection();
    conversationGeneration++;
    navigationRev++;
    stopping = true;
    if (controller !== null) detached.add(controller);
    stopEngine(controller);
    controller = null;
    applied = null;
    sessionId = undefined;
    transferContext = false;
    current = null;
    latestPage();
    selection = emptySelection();
    state.clear();
    refresh();
  };
  // Une campagne démarre ou finit ailleurs : la disponibilité du mode change ici aussi.
  const unsubscribeCampaign = onCampaignActivity(() => {
    if (!disposed) refresh();
  });
  const unsubscribeHistory = history?.index.subscribe?.(() => {
    if (disposed) return;
    const incoming = parseHistory(history.index.get(historyKey));
    const active = current?.id ?? state.readonly?.id;
    if (active && !incoming.some((row) => row.id === active)) resetConversation();
    if (current) {
      const latest = incoming.find((row) => row.id === current?.id);
      if (latest) Object.assign(current, latest);
    }
    if (state.readonly) {
      const renamed = incoming.find((row) => row.id === state.readonly?.id);
      if (renamed) state.setReadonly({ ...state.readonly, title: renamed.title });
    }
    index = incoming.map((row) => (row.id === current?.id ? current : row));
    refresh();
  });
  /** Relit l'index depuis l'hôte (écritures d'une autre fenêtre) sans perdre la conversation courante. */
  const reloadIndex = () => {
    if (!history) return;
    const incoming = parseHistory(history.index.get(historyKey));
    const merged = incoming.map((row) => (row.id === current?.id ? current : row));
    index = current && !merged.includes(current) ? [current, ...merged] : merged;
  };
  const removable = (ids: readonly string[]) => {
    if (history?.canRemove && !history.canRemove(ids)) {
      state.notice(
        t("Arrêtez les conversations en cours avant de supprimer leur historique."),
        "error",
      );
      refresh();
      return false;
    }
    return true;
  };
  return {
    view: () => {
      sync();
      return view();
    },
    async timelinePage(direction: "older" | "newer" | "latest"): Promise<void> {
      if (!history) return;
      if (direction === "latest") {
        latestPage();
        refresh();
        return;
      }
      if (pageLoading) return;
      const meta = current ?? index.find((entry) => entry.id === state.readonly?.id);
      if (!meta) return;
      const shown = archive ?? state;
      const next = [...pageBefore];
      if (direction === "older") {
        if (shown.dropped === 0) return;
        const first = shown.view().items.find((item) => item.source)?.source;
        if (!first) return;
        next.push(first);
      } else {
        next.pop();
        if (next.length === 0) {
          latestPage();
          refresh();
          return;
        }
      }
      const revision = navigationRev;
      const request = ++pageRevision;
      const active = () => !disposed && revision === navigationRev && request === pageRevision;
      pageLoading = true;
      pageError = undefined;
      refresh();
      try {
        const result = await readConversationPage(
          history.files,
          meta.runIds,
          next.at(-1),
          active,
          meta.agents,
        );
        if (!result || !active()) return;
        if (!result.state.reached) {
          pageError = t("Journal indisponible ou pas encore écrit. Réessayez dans un instant.");
        } else {
          archive = result.state;
          pageBefore = next;
          const warnings = [
            ...(result.invalid ? [t`${result.invalid} ligne(s) invalide(s) ignorée(s).`] : []),
            ...(result.missing ? [t`${result.missing} journal(aux) introuvable(s).`] : []),
          ];
          if (warnings.length) pageError = warnings.join(" ");
        }
      } catch {
        if (active()) pageError = t("Lecture des messages précédents impossible. Réessayez.");
      } finally {
        if (active()) {
          pageLoading = false;
          refresh();
        }
      }
    },
    /** Déplace la lecture d'un seul message humain ou agent ; les outils ne sont pas des échanges. */
    async timelineExchange(
      direction: "older" | "newer",
      id: number,
      source?: string,
    ): Promise<void> {
      if (pageLoading) return;
      const shown = archive ?? state;
      const messages = (page: ChatState) =>
        page.view().items.filter((item) => item.kind === "user" || item.kind === "agent");
      const items = messages(shown);
      const indexInPage = items.findIndex(
        (item) => item.id === id && (!source || item.source === source),
      );
      if (indexInPage < 0) return;
      const choose = (item: (typeof items)[number]) => {
        exchangeTarget = {
          id: item.id,
          ...(item.source && { source: item.source }),
          revision: ++exchangeRevision,
        };
      };
      const adjacent = items[indexInPage + (direction === "older" ? -1 : 1)];
      if (adjacent) {
        choose(adjacent);
        refresh();
        return;
      }
      const anchor = items[indexInPage]?.source;
      const meta = current ?? index.find((entry) => entry.id === state.readonly?.id);
      if (!history || !meta || !anchor) return;
      const revision = navigationRev;
      const request = ++pageRevision;
      const active = () => !disposed && revision === navigationRev && request === pageRevision;
      pageLoading = true;
      pageError = undefined;
      refresh();
      try {
        const found = await findAdjacentExchange(
          history.files,
          meta.runIds,
          anchor,
          direction,
          active,
        );
        if (!found || !active()) return;
        if (!found.found) {
          pageError = t("Journal indisponible ou pas encore écrit. Réessayez dans un instant.");
          return;
        }
        if (!found.target) return;
        const liveTarget = state.view().items.find((item) => item.source === found.target?.source);
        if (liveTarget && (liveTarget.kind === "user" || liveTarget.kind === "agent")) {
          archive = null;
          pageBefore = [];
          choose(liveTarget);
          return;
        }
        const result = await readConversationPage(
          history.files,
          meta.runIds,
          found.target.before,
          active,
          meta.agents,
        );
        if (!result || !active()) return;
        const target = messages(result.state).find((item) => item.source === found.target?.source);
        if (!target || (found.target.before && !result.state.reached)) {
          pageError = t("Journal indisponible ou pas encore écrit. Réessayez dans un instant.");
          return;
        }
        archive = result.state;
        pageBefore = found.target.before ? [found.target.before] : [];
        choose(target);
      } catch {
        if (active()) pageError = t("Lecture des messages précédents impossible. Réessayez.");
      } finally {
        if (active()) {
          pageLoading = false;
          refresh();
        }
      }
    },
    loadModels,
    getProvider: () => prefs.provider,
    setSelection(raw: unknown): void {
      if (state.busy || state.readonly) return;
      const parsed = parseChatSelection(raw);
      if (parsed) selection = allowedSelection(rawSettings(), parsed);
      refresh();
    },
    async selectProvider(id: string): Promise<void> {
      if (state.busy || state.readonly) return;
      const entry = providerChoices(rawSettings()).find((p) => p.id === id);
      if (!entry) return;
      if (providerChoiceId === id && prefs.provider === entry.backend) return;
      providerChoiceId = id;
      state.clearActiveKey();
      if (entry.backend !== prefs.provider) await this.setProvider(entry.backend);
      else {
        cancelModelLoad();
        models = null;
        modelsStatus = "idle";
        prefs = { ...prefs, model: null, variant: null };
        persist(prefsKey, prefs);
        refresh();
        await loadModels(true);
      }
      // Une route personnalisée doit toujours démarrer avec un modèle de son catalogue.
      if (entry.prefix && models?.[0]) this.setModel(models[0].value);
    },
    async setProvider(raw: unknown): Promise<void> {
      if (state.busy || !isProvider(raw) || raw === prefs.provider) {
        refresh();
        return;
      }
      latestPage();
      navigationRev++;
      const previous = controller;
      if (previous !== null) detached.add(previous);
      controller = null;
      applied = null;
      state.approvals.clear();
      sessionId = undefined;
      state.clearActiveKey();
      transferContext = state
        .view()
        .items.some((item) => item.kind === "user" || item.kind === "agent");
      stopEngine(previous);
      prefs = { ...prefs, model: null, effort: null, variant: null, provider: raw };
      if (current) {
        current.provider = raw;
        current.model = null;
        current.effort = null;
        current.variant = null;
        current.sessionId = null;
        touch();
      }
      persist(prefsKey, prefs);
      cancelModelLoad();
      models = null;
      modelsStatus = "idle";
      modelsMessage = undefined;
      refresh();
      await loadModels();
    },
    /** Choix venu de la webview (hostile) : revalidé ; gelé pendant un tour, appliqué au message suivant. */
    setModel(raw: unknown): void {
      if (state.busy) {
        refresh();
        return;
      }
      const v = validateModelChoice(raw, models);
      if (
        v.ok &&
        v.model &&
        providerChoice()?.prefix &&
        !v.model.startsWith(providerChoice()?.prefix ?? "")
      )
        return;
      if (!v.ok) {
        state.notice(t("Modèle refusé : identifiant invalide ou absent de la liste."), "error");
        refresh();
        return;
      }
      prefs = { ...prefs, model: v.model };
      clampVariant();
      reclamp();
      persist(prefsKey, prefs);
      refresh();
    },
    setVariant(raw: unknown): void {
      if (state.busy || prefs.provider === "claude") {
        refresh();
        return;
      }
      const selected = effectiveModel(models, prefs.model, machineModel());
      if (
        raw !== null &&
        (typeof raw !== "string" || !selected?.reasoningVariants?.includes(raw))
      ) {
        state.notice(t("Variante refusée : absente du catalogue du modèle courant."), "error");
        refresh();
        return;
      }
      prefs = { ...prefs, variant: raw };
      persist(prefsKey, prefs);
      refresh();
    },
    setEffort(raw: unknown): void {
      if (state.busy || prefs.provider !== "claude") {
        refresh();
        return;
      }
      if (raw === null) {
        // Retour à « Auto » : plus aucun niveau transmis.
        prefs = { ...prefs, effort: null };
        persist(prefsKey, prefs);
        refresh();
        return;
      }
      const wanted = parseEffortChoice(raw);
      if (wanted === null) {
        state.notice(t("Niveau d'effort refusé : valeur inconnue."), "error");
        refresh();
        return;
      }
      const c = clampEffort(resolveEffort(wanted, undefined).effort, supportedNow());
      if (c.effort === null) {
        refresh(); // modèle sans effort réglable
        return;
      }
      if (wanted === "ultracode" && c.clamped) {
        // Ultracode s'appuie sur `max` : indisponible si le modèle ne le supporte pas (cran grisé).
        state.notice(
          t("Ultracode n'est pas disponible : ce modèle ne prend pas en charge « Max »."),
          "error",
        );
        refresh();
        return;
      }
      if (c.clamped) clampNotice(wanted, c.effort);
      prefs = { ...prefs, effort: wanted === "ultracode" ? wanted : c.effort };
      persist(prefsKey, prefs);
      refresh();
    },
    /** Niveau d'encadrement venu de la webview (hostile) : gelé pendant un tour, valeur inconnue = standard. */
    setSupervision(raw: unknown): void {
      if (state.busy) {
        refresh();
        return;
      }
      prefs = { ...prefs, supervision: parseSupervision(raw) };
      persist(prefsKey, prefs);
      refresh();
    },
    /** Mode multi-agents (ADR 0054) : demande venue de la webview (hostile), validée ici ; gelée pendant un tour. */
    setMultiAgent(raw: unknown): void {
      if (state.busy || campaign !== null || typeof raw !== "boolean") {
        refresh();
        return;
      }
      prefs = { ...prefs, multiAgent: raw };
      persist(prefsKey, prefs);
      refresh();
    },
    /** Nombre de workers : entier de 1 à 8, sinon la demande est refusée sans rien changer. */
    setMultiAgentWorkers(raw: unknown): void {
      if (state.busy || campaign !== null || parseMultiAgentWorkers(raw) !== raw) {
        refresh();
        return;
      }
      prefs = { ...prefs, multiAgentWorkers: raw as number };
      persist(prefsKey, prefs);
      refresh();
    },
    /** Bouton « Arrêter la campagne » : arrête tous les moteurs ; sans campagne, sans effet. */
    stopCampaign(): void {
      campaign?.stop("user");
    },
    /** Arrêt d'urgence de l'engagement : coupe tous les moteurs de la campagne de ce chat. */
    emergencyStop(): void {
      if (campaign === null) return;
      deps.bypass?.reset?.();
      campaign.stop("emergency");
    },
    /** Interrupteur venu de la webview (hostile) : booléen strict, gelé pendant un tour, appliqué au message suivant. */
    setLearning(raw: unknown): void {
      if (state.busy || typeof raw !== "boolean") {
        refresh();
        return;
      }
      learning = raw;
      if (deps.learningKey !== undefined) persist(deps.learningKey, raw);
      refresh();
    },
    async send(
      text: string,
      prompt = text,
      research = false,
      images: PromptImage[] = [],
    ): Promise<boolean> {
      if (
        images.length &&
        effectiveModel(models, prefs.model, machineModel())?.supportsImages === false
      ) {
        state.notice(t("Ce modèle ne prend pas les images en charge."), "error");
        refresh();
        return false;
      }
      // Mode lecture : aucune saisie tant que la conversation n'est pas reprise.
      // `text` est la bulle. `prompt` peut y joindre la sortie d'un terminal cité.
      if (
        (stopping && controller !== null) ||
        state.readonly ||
        text.trim() === "" ||
        (state.busy && controller === null)
      )
        return false;
      if (
        displaySettings().capabilities &&
        (!providerChoice() || (providerChoice()?.prefix && !choice(readSettings()).model))
      ) {
        state.notice(
          t("Choisissez un fournisseur activé et un modèle disponible avant d’envoyer."),
          "error",
        );
        refresh();
        return false;
      }
      if (deps.requireProvider && state.noProvider) {
        state.notice(
          t`Aucun fournisseur n'a été ajouté : ajoute un jeton (${PRODUCT_NAME} : définir le jeton) pour utiliser le chat.`,
          "error",
        );
        refresh();
        return false;
      }
      if (research && (learning || readSettings().webSearch !== true)) {
        state.notice(t("Activez les outils Web pour demander une recherche à ce tour."), "error");
        refresh();
        return false;
      }
      const activeController = state.busy ? controller : null;
      latestPage();
      if (!activeController) state.setBusy(true);
      const revision = activeController ? navigationRev : ++navigationRev;
      const projectsReady = await reloadHistoryProjects(revision);
      if (revision !== navigationRev) return false;
      if (
        !projectsReady ||
        (current !== null && (current.projectId ?? null) !== historyProjects.activeId)
      ) {
        if (!activeController) state.setBusy(false);
        if (projectsReady)
          state.notice(
            t(
              "Le projet actif a changé. Revenez au projet de cette conversation ou créez une nouvelle conversation dans le projet actif.",
            ),
            "error",
          );
        refresh();
        return false;
      }
      campaignView = undefined;
      if (!activeController && prefs.multiAgent && !learning)
        return await startCampaign(text, prompt, revision);
      rotations = 0;
      lastSent = {
        prompt,
        ...(research && { research: true as const }),
        ...(images.length && { images }),
      };
      if (activeController) {
        if (stopping || controller !== activeController || !state.busy || state.readonly)
          return false;
        try {
          activeController.prompt(
            prompt,
            research || undefined,
            images.length ? images : undefined,
          );
          state.user(text);
          refresh();
          return true;
        } catch (error) {
          state.error(error);
          refresh();
          return false;
        }
      }
      ensureConversation(text);
      let conversationContext = transferContext
        ? buildConversationContext(state.view().items)
        : undefined;
      if (transferContext && history && current?.runIds.length) {
        try {
          const durable = await readConversationContext(
            history.files,
            current.runIds,
            () => !disposed && revision === navigationRev,
          );
          if (!durable || revision !== navigationRev) return false;
          if (durable.messages.length)
            conversationContext = conversationContext
              ? mergeConversationTail(durable, conversationContext)
              : durable;
          else if (conversationContext) conversationContext.truncated = true;
        } catch {
          if (revision !== navigationRev) return false;
          if (conversationContext) conversationContext.truncated = true;
        }
      }
      state.user(text);
      refresh();
      try {
        if (controller !== null && applied !== null) {
          const want = choice(readSettings());
          if (
            want.model !== applied.model ||
            want.effort !== applied.effort ||
            want.variant !== applied.variant ||
            prefs.supervision !== applied.supervision ||
            learning !== applied.learning ||
            appliedBurp !==
              JSON.stringify([
                readSettings().burp ?? null,
                readSettings().integrations ?? [],
                readSettings().profile ?? null,
                readSettings().webSearch ?? true,
                readSettings().opencodeProviders ?? null,
              ])
          ) {
            await retire(controller);
          } else if (appliedAuth !== authRev) {
            // Jeton changé pendant un tour : le moteur courant garde l'ancien, le suivant relit le nouveau.
            await retire(
              controller,
              t("Jeton modifié : nouveau moteur démarré avec le nouveau jeton, même session."),
            );
          }
        }
        if (revision !== navigationRev) return false;
        const ctl = controller ?? (await startEngine(revision, conversationContext));
        if (revision !== navigationRev || ctl === null) return false;
        researchPending = research;
        if (hasPastedCredentials(prompt)) {
          state.notice(
            t(
              "Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir.",
            ),
          );
          refresh();
        }
        ctl.prompt(prompt, research || undefined, images.length ? images : undefined);
        return true;
      } catch (error) {
        if (revision !== navigationRev) return false;
        if (transferContext) {
          sessionId = undefined;
          if (current) current.sessionId = null;
          if (controller !== null) detached.add(controller);
          touch();
        }
        stopEngine(controller);
        controller = null;
        state.error(error);
        state.setBusy(false);
        refresh();
      }
      return false;
    },
    /**
     * Jeton défini ou effacé : appliqué sans redémarrer l'extension. Le moteur inactif est remplacé
     * (le suivant relit le jeton), la liste des modèles est sondée de nouveau, le chat se dégrise ou se grise.
     * Pendant un tour, le moteur courant finit avec l'ancien jeton ; le message suivant relira le nouveau.
     */
    testAccountsChanged(): void {
      appliedBurp = "";
    },
    async authChanged(): Promise<void> {
      authRev++;
      cancelModelLoad();
      models = null;
      modelsStatus = "idle";
      modelsMessage = undefined;
      persist(modelsKey(), undefined);
      const loading = loadModels(true);
      if (controller !== null && !state.busy) {
        await retire(
          controller,
          t("Jeton modifié : nouveau moteur au prochain message, même session."),
        );
      }
      refresh();
      await loading;
    },
    stop(): void {
      latestPage();
      navigationRev++;
      if (campaign !== null) {
        deps.bypass?.reset?.();
        campaign.stop("user");
      }
      if (controller === null) {
        state.setBusy(false);
        refresh();
        return;
      }
      userAbort.add(controller);
      stopping = true;
      state.setBusy(true);
      const stoppingController = controller;
      deps.bypass?.reset?.();
      stoppingController.abort();
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        if (controller === stoppingController && stopping) stoppingController.kill();
      }, 2000);
      stopTimer.unref();
      state.notice(t("Arrêt demandé."));
      refresh();
    },
    async approve(toolUseId: string, choice: Choice): Promise<void> {
      const card = state.approvals.get(toolUseId);
      if (!card || (controller === null && campaign === null) || confirming) return;
      if (choice === "always") {
        // « Toujours » : jamais pour un verdict non mémorisable ; confirmation native hors webview.
        if (!card.canRemember) return;
        confirming = true;
        const approver = controller;
        const pending = { ...card, confirming: true };
        state.approvals.set(toolUseId, pending);
        refresh();
        let accepted = false;
        try {
          accepted = await deps.confirmAlways(alwaysConfirmText(card));
        } finally {
          confirming = false;
          // Annulation ou erreur : la carte redevient utilisable, sans répondre au moteur.
          if (!accepted && state.approvals.get(toolUseId) === pending) {
            state.approvals.set(toolUseId, { ...card, confirming: false });
            refresh();
          }
        }
        if (!accepted || state.approvals.get(toolUseId) !== pending || controller !== approver)
          return;
      }
      // Campagne d'abord (routage par `toolUseId`), puis le chemin d'un chat simple.
      if (campaign?.answer(toolUseId, choice)) {
        state.approvals.delete(toolUseId);
        refresh();
        return;
      }
      if (controller === null) return;
      const { decision, remember } = answerFor(choice);
      controller.answer(toolUseId, decision, remember);
      state.approvals.delete(toolUseId);
      refresh();
    },
    reset(): void {
      resetConversation();
    },
    async refreshHistoryProjects(): Promise<void> {
      selection = emptySelection();
      // L'index est commun à toutes les fenêtres : on relit l'hôte pour voir leurs conversations.
      reloadIndex();
      const revision = navigationRev;
      await reloadHistoryProjects(revision);
      if (revision === navigationRev) refresh();
    },
    /** Ouvre une conversation en lecture seule : le fil est reconstruit depuis ses journaux (entrée non fiable). */
    async openConversation(id: unknown): Promise<void> {
      if (!history || state.busy || !isConversationId(id)) return;
      // L'identifiant ne sert qu'à retrouver une entrée de l'index ; les chemins viennent des `runId` validés.
      const meta = index.find((c) => c.id === id);
      if (!meta) return;
      deps.onObservedEvent?.(null);
      campaignView = undefined;
      readonlyCampaign = undefined;
      const revision = ++navigationRev;
      await reloadHistoryProjects(revision);
      if (revision !== navigationRev) return;
      stopping = true;
      // Bypass hôte à « off » avant d'arrêter l'ancien moteur : aucune décision ne le garde actif (lot 2c).
      deps.bypass?.reset?.();
      if (controller !== null) detached.add(controller);
      stopEngine(controller);
      controller = null;
      applied = null;
      sessionId = undefined;
      transferContext = false;
      current = null;
      selection = emptySelection();
      state.clear();
      latestPage();
      const result = await readConversationPage(
        history.files,
        meta.runIds,
        undefined,
        () => !disposed && revision === navigationRev,
        meta.agents,
      );
      if (!result || revision !== navigationRev) return;
      state = result.state;
      const { invalid, truncated, missing } = result;
      if (missing > 0) state.notice(t`${missing} journal(aux) introuvable(s).`);
      // Campagne multi-agents (ADR 0054) : panneau et reprise depuis le dernier journal de campagne.
      const restored = await restoreReadonlyCampaign(meta, revision);
      if (revision !== navigationRev) return;
      state.setReadonly({
        id: meta.id,
        title: meta.title,
        invalid,
        truncated,
        canResume:
          meta.sessionId !== null ||
          state.view().items.some((item) => item.kind === "user" || item.kind === "agent"),
        ...(restored && { campaign: true }),
      });
      refresh();
    },
    /** Reprend la conversation ouverte : nouveau message avec `resume`, sous la politique ACTUELLE. */
    async resumeConversation(note?: string): Promise<void> {
      if (state.busy) return;
      latestPage();
      const info = state.readonly;
      const meta = info ? index.find((c) => c.id === info.id) : undefined;
      if (!meta) return;
      if (readonlyCampaign !== undefined && isCampaignActive()) {
        // Une seule campagne active : refus avant tout changement d'état.
        state.notice(formatReason(reason("campaign.alreadyActive"), getUiLocale()), "error");
        refresh();
        return;
      }
      const revision = ++navigationRev;
      const projectsReady = await reloadHistoryProjects(revision);
      if (revision !== navigationRev) return;
      if (!projectsReady) {
        refresh();
        return;
      }
      if ((meta.projectId ?? null) !== historyProjects.activeId) {
        state.notice(
          t(
            "Cette conversation appartient à un autre projet. Revenez à son projet ou créez une nouvelle conversation dans le projet actif.",
          ),
          "error",
        );
        refresh();
        return;
      }
      const providerChanged = prefs.provider !== meta.provider;
      prefs = {
        provider: meta.provider,
        model: meta.model,
        effort: meta.effort,
        variant: meta.variant ?? null,
        supervision: prefs.supervision,
        multiAgent: prefs.multiAgent,
        multiAgentWorkers: prefs.multiAgentWorkers,
      };
      persist(prefsKey, prefs);
      if (providerChanged) {
        cancelModelLoad();
        models = null;
        modelsStatus = "idle";
        modelsMessage = undefined;
      }
      current = meta;
      if (readonlyCampaign !== undefined) {
        // Reprise de campagne : un nouvel hôte part du coordinateur restauré, pas d'un agent simple.
        const resume = { ...readonlyCampaign, note: cleanNote(note) };
        readonlyCampaign = undefined;
        sessionId = undefined;
        transferContext = false;
        state.setReadonly(null);
        state.setBusy(true);
        refresh();
        if (providerChanged) await loadModels();
        if (revision !== navigationRev) return;
        await startCampaign("", "", revision, resume);
        return;
      }
      sessionId = meta.sessionId ?? undefined;
      transferContext = meta.sessionId === null;
      state.setReadonly(null);
      state.notice(
        meta.sessionId === null
          ? t("Session introuvable : le prochain message démarre une nouvelle session.")
          : t("Conversation reprise dans son projet : la politique actuelle s'applique."),
      );
      refresh();
      if (providerChanged) await loadModels();
    },
    renameConversation(id: unknown, raw: unknown): void {
      const meta = isConversationId(id) ? index.find((c) => c.id === id) : undefined;
      if (!meta) return;
      const title = cleanTitle(raw);
      if (title === null) {
        state.notice(t("Titre refusé : il est vide."), "error");
        refresh();
        return;
      }
      meta.title = title;
      saveIndex({ upsert: [meta] });
      refresh();
    },
    async deleteConversation(id: unknown): Promise<void> {
      const meta = history && isConversationId(id) ? index.find((c) => c.id === id) : undefined;
      if (!history || !meta || !removable([meta.id])) return;
      const ok = await history.confirmDelete(
        t`Supprimer la conversation « ${cleanText(meta.title, 80)} » et ses journaux ?`,
      );
      if (!ok || !removable([meta.id])) return;
      if (meta.id === current?.id || meta.id === state.readonly?.id) this.reset();
      index = index.filter((c) => c.id !== meta.id);
      saveIndex({ remove: [meta.id] });
      await history.files.remove(meta.runIds);
      refresh();
    },
    async clearHistory(): Promise<void> {
      if (!history || !removable(index.map((row) => row.id))) return;
      const ok = await history.confirmDelete(
        t(
          history.index.update
            ? "Effacer l’historique commun des chats et ses journaux ?"
            : "Effacer tout l'historique des conversations et leurs journaux ?",
        ),
      );
      if (!ok || !removable(index.map((row) => row.id))) return;
      const removed = [...index];
      this.reset();
      index = [];
      saveIndex({ remove: removed.map((row) => row.id) });
      if (history.index.update) await history.files.remove(removed.flatMap((row) => row.runIds));
      else await history.files.removeAll();
      refresh();
    },
    dispose(): void {
      unsubscribeHistory?.();
      unsubscribeCampaign();
      deps.onObservedEvent?.(null);
      disposed = true;
      campaign?.stop("user");
      clearTimeout(outputTimer);
      clearTimeout(stopTimer);
      stopTimer = undefined;
      outputTimer = undefined;
      latestPage();
      cancelModelLoad();
      navigationRev++;
      stopping = true;
      if (controller !== null) detached.add(controller);
      stopEngine(controller);
      controller = null;
    },
  };
}

export type ChatSession = ReturnType<typeof createChatSession>;

/** Ouvre une entrée connue dans une session distincte sans modifier la session source. */
export async function openHistoryInNewChat(
  source: Pick<ChatSession, "view">,
  id: string,
  create: () => Pick<ChatSession, "openConversation"> | undefined,
): Promise<void> {
  if (!source.view().history.some((entry) => entry.id === id)) return;
  const target = create();
  if (target) await target.openConversation(id);
}
