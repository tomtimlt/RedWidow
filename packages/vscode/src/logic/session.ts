import { randomUUID } from "node:crypto";
import type { AuthMode, Effort, EngineEvent, ModelOption, Reason } from "@warband/core";
import { formatReason } from "@warband/messages";
import { alwaysConfirmText, answerFor, type Choice, cleanText, toCard } from "./approval.js";
import type { BypassEngineLink, BypassSend } from "./bypass.js";
import {
  type ChatState,
  type ChatView,
  createChatState,
  type HistoryEntry,
  isAbortError,
} from "./chat.js";
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
  parsePrefs,
} from "./controls.js";
import { buildConversationContext } from "./conversation-context.js";
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
  type ConversationMeta,
  cleanTitle,
  type HistoryProjects,
  historyProject,
  isConversationId,
  isRunId,
  parseIndex,
  parseUntrustedJournal,
  replayEvents,
  sortRecent,
  titleFrom,
} from "./history.js";
import type { JournalFiles } from "./historyStore.js";
import { modelLoadFailure } from "./model-load-error.js";
import { isModelId, parseModelCache, usableModels, validateModelChoice } from "./models.js";
import type { ChatSettings } from "./settings.js";

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
}

export interface ChatSessionDeps {
  cwd: string;
  enginePath: string;
  engineArgs: string[];
  /** Réglages machine validés (lève `CodedError`). */
  readSettings(): ChatSettings;
  /** Jeton (SecretStorage) ; `undefined` → authentification `auto` du binaire. */
  getToken(provider?: Provider): Promise<TokenChoice | undefined>;
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
  createController?(options: EngineControllerOptions): EngineController;
  /** Bypass (ADR 0006) : lien vers le moteur courant, pour pousser l'état et recevoir l'accusé. */
  bypass?: { attach(send: BypassSend): BypassEngineLink; reset?(): void };
  /** Clé de stockage du mode apprentissage de ce chat (`warband.learning.<id>`), distincte de `warband.prefs`. Absente : mémoire. */
  learningKey?: string;
  /** Stockage persistant (globalState) : préférences et cache des modèles. Défaut : mémoire. */
  store?: { get(key: string): unknown; set(key: string, value: unknown): unknown };
  /** Version du SDK embarqué : clé du cache de la liste des modèles. */
  sdkVersion?: string;
  /** Historique (F4) : index dans `workspaceState`, journaux hors du dépôt. Absent : pas d'historique. */
  readHistoryProjects?(): Promise<HistoryProjects>;
  history?: {
    /** Clé d'index de ce chat. Défaut : `warband.history` (un seul chat). */
    key?: string;
    index: { get(key: string): unknown; set(key: string, value: unknown): unknown };
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
  const state: ChatState = createChatState();
  let controller: EngineController | null = null;
  let sessionId: string | undefined;
  let transferContext = false;
  let confirming = false;
  let stopping = false;

  const sdkVersion = deps.sdkVersion ?? "unknown";
  const memory = new Map<string, unknown>();
  const store = deps.store ?? {
    get: (key: string) => memory.get(key),
    set: (key: string, value: unknown) => memory.set(key, value),
  };
  let prefs: Prefs = parsePrefs(store.get(PREFS_KEY));
  const modelsKey = () =>
    prefs.provider === "claude" ? MODELS_KEY : `${MODELS_KEY}.${prefs.provider}`;
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
    learning: boolean;
  } | null = null;
  /** Révision de l'authentification : incrémentée à chaque jeton défini ou effacé ; le moteur démarré avec une autre est remplacé. */
  let authRev = 0;
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
      return prefs.provider === "claude" ? deps.readSettings().model : undefined;
    } catch {
      return undefined;
    }
  };
  const supportedNow = (fallback = machineModel()) =>
    effectiveModel(models, prefs.model, fallback)?.supportedEffortLevels;
  const ultracodeLimits = (): UltracodeLimits | undefined => {
    try {
      return deps.readSettings().ultracode;
    } catch {
      return undefined;
    }
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
        ...(ultracode && { ultracode }),
      }),
    );
    state.setHistory(historyEntries());
  };
  const refresh = () => {
    sync();
    deps.onView(state.view());
  };
  const warn = (reason: Reason) => state.notice(formatReason(reason), "error");
  const clampNotice = (wanted: EffortChoice, got: Effort) =>
    state.notice(
      `Niveau d'effort ramené à « ${labelOf(got)} » : « ${labelOf(wanted)} » n'est pas pris en charge par ce modèle.`,
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
      persist(PREFS_KEY, prefs);
    }
  };

  /** Modèle et effort du prochain message : préférence, sinon réglage machine ; effort ramené s'il n'est pas permis. */
  const choice = (settings: ChatSettings) => {
    const model = prefs.model ?? (prefs.provider === "claude" ? settings.model : undefined);
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
  let index: ConversationMeta[] = history ? parseIndex(history.index.get(historyKey)) : [];
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
        "Liste des projets indisponible : envoi suspendu, réessayez après vérification du projet actif.",
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
        model: c.model ?? "défaut",
        current: c.id === current?.id,
        projectKey: historyProject(c, historyProjects.projects).key,
        projectLabel: historyProject(c, historyProjects.projects).label,
      }));
  const saveIndex = () => {
    if (history) void Promise.resolve(history.index.set(historyKey, index)).catch(() => undefined);
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
    const { keep, drop } = applyRetention(index, sizes, { protect: current?.id });
    if (drop.length === 0) return;
    index = keep;
    saveIndex();
    await history.files.remove(drop.flatMap((c) => c.runIds));
    refresh();
  };
  const ensureConversation = (firstPrompt: string) => {
    if (!history || current !== null) return;
    const now = new Date().toISOString();
    current = {
      id: randomUUID(),
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
  const touch = () => {
    if (!current) return;
    current.updatedAt = new Date().toISOString();
    // Une session SDK partielle ne devient reprenable qu’après confirmation du transfert.
    if (sessionId !== undefined && !transferContext) current.sessionId = sessionId;
    saveIndex();
  };

  const startEngine = async (
    revision: number,
    conversationContext?: ReturnType<typeof buildConversationContext>,
  ): Promise<EngineController | null> => {
    const settings = deps.readSettings();
    const picked = choice(settings);
    if (picked.clampedTo !== undefined && picked.key !== null)
      clampNotice(picked.key, picked.clampedTo);
    const token = await deps.getToken(prefs.provider);
    if (revision !== navigationRev) return null;
    if (deps.requireProvider && token === undefined) {
      state.setNoProvider(true);
      state.setBusy(false);
      state.notice(
        "La connexion au fournisseur n’est plus disponible. Reconnectez-le avant de continuer.",
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
          // Connu dès le début de la session : la reprise (changement de modèle) n'attend pas la fin du run.
          if (event.kind === "session.started") {
            sessionId = event.sessionId;
            if (current && isModelId(event.model)) current.model = event.model;
            touch();
          }
          if (event.kind === "tool.requested" && current) current.tools++;
          if (transferring && transferContext && event.kind === "turn.finished") {
            if (event.status === "success") {
              transferContext = false;
              touch();
            } else if (event.status === "error") {
              invalidateTransfer();
            }
          }
          if (event.kind === "error") {
            invalidateTransfer();
            if (skipAbortBubble(ctl, event)) return;
          }
          state.event(event);
          refresh();
        },
        onApproval: (pending) => {
          if (detached.has(ctl)) return;
          state.approvals.set(pending.toolUseId, toCard(pending));
          refresh();
        },
        onEnded: (summary) => {
          if (detached.has(ctl)) return;
          if (transferring && transferContext && summary.status === "error") {
            invalidateTransfer();
          } else {
            if (summary.sessionId !== undefined) sessionId = summary.sessionId;
            if (transferring && summary.status === "success") transferContext = false;
          }
          touch();
          void enforceRetention();
          state.setBusy(false);
          refresh();
        },
        onError: (reason) => {
          if (detached.has(ctl)) return;
          invalidateTransfer();
          if (skipAbortBubble(ctl, reason)) return;
          state.error(reason);
          refresh();
        },
        onBypassAck: (ack) => {
          if (detached.has(ctl)) return;
          bypassLinks.get(ctl)?.acked(ack.seq, ack.state);
        },
        onExit: ({ code }) => {
          // Avant le filtre des moteurs écartés : un moteur qui sort n'a plus de Bypass (échec fermé).
          bypassLinks.get(ctl)?.release();
          if (detached.has(ctl)) return;
          // Ancien moteur (réinitialisation puis nouveau message) : l'état n'est plus le sien.
          if (controller !== null && controller !== ctl) return;
          invalidateTransfer();
          controller = null;
          touch();
          state.approvals.clear();
          state.setBusy(false);
          if (!stopping && code !== 0 && code !== null) {
            state.notice(`Le moteur s'est arrêté (code ${code}).`, "error");
          }
          refresh();
        },
        onLog: (text) => deps.onLog?.(text),
      },
    });
    controller = ctl;
    applied = { model: picked.model, effort: picked.effort, variant: picked.variant, learning };
    if (current) {
      current.provider = prefs.provider;
      current.model = picked.model ?? null;
      current.variant = picked.variant ?? null;
      current.effort = prefs.effort;
      touch();
    }
    appliedAuth = authRev;
    const maxTurns = picked.ultra ? picked.ultra.maxTurns : settings.maxTurns;
    await ctl.start({
      cwd: deps.cwd,
      auth: token?.mode ?? "auto",
      provider: prefs.provider,
      ...(picked.model !== undefined && { model: picked.model }),
      ...(picked.effort !== undefined && { effort: picked.effort }),
      ...(picked.variant !== undefined && { variant: picked.variant }),
      ...(conversationContext !== undefined && { conversationContext }),
      ...(maxTurns !== undefined && { maxTurns }),
      ...(picked.ultra?.maxBudgetUsd !== undefined && { maxBudgetUsd: picked.ultra.maxBudgetUsd }),
      ...(history && { journalDir: history.files.dir }),
      ...(!transferring && sessionId !== undefined && { resume: sessionId }),
      // Le mode exclut `systemPrompt` (ADR 0010) : la consigne vient du moteur, jamais de l'UI.
      ...(learning && { mode: "learning" as const }),
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
        failed("Connexion au fournisseur indisponible. Reconnectez-le puis réessayez.");
        return;
      }
      if (deps.requireProvider) state.setNoProvider(false);
      probe = make({
        enginePath: deps.enginePath,
        args: deps.engineArgs,
        cwd: deps.cwd,
        ...(token?.auth && { auth: token.auth }),
        handlers: {
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
            timeoutMs: MODEL_LOAD_TIMEOUT_MS,
          }),
          interrupted,
        ]),
      );
      if (!active()) return;
      if (list.length === 0) {
        failed(
          "Le fournisseur n’a renvoyé aucun modèle utilisable. Réessayez ou vérifiez sa connexion.",
        );
        return;
      }
      models = list;
      modelsStatus = "ready";
      modelsMessage = undefined;
      lastModelsNotice = undefined;
      persist(cacheKey, { sdk: sdkVersion, models: list });
      if (prefs.model !== null && !list.some((m) => m.value === prefs.model)) {
        prefs = { ...prefs, model: null };
        persist(PREFS_KEY, prefs);
        state.notice("Le modèle choisi n'est plus proposé : retour au modèle par défaut.");
      }
      clampVariant();
    } catch (error) {
      if (!active() || error === cancelled) return;
      killProbe();
      const message =
        error === timedOut
          ? "Chargement des modèles interrompu après 45 secondes. Réessayez ou vérifiez la connexion au fournisseur."
          : modelLoadFailure(error);
      deps.onLog?.(`Catalogue des modèles : ${message}\n`);
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
    notice = "Réglages modifiés : nouveau moteur au prochain message, même session.",
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

  return {
    view: () => {
      sync();
      return state.view();
    },
    loadModels,
    getProvider: () => prefs.provider,
    async setProvider(raw: unknown): Promise<void> {
      if (state.busy || !isProvider(raw) || raw === prefs.provider) {
        refresh();
        return;
      }
      navigationRev++;
      const previous = controller;
      if (previous !== null) detached.add(previous);
      controller = null;
      applied = null;
      state.approvals.clear();
      sessionId = undefined;
      transferContext = state
        .view()
        .items.some((item) => item.kind === "user" || item.kind === "agent");
      stopEngine(previous);
      prefs = { model: null, effort: null, variant: null, provider: raw };
      if (current) {
        current.provider = raw;
        current.model = null;
        current.effort = null;
        current.variant = null;
        current.sessionId = null;
        touch();
      }
      persist(PREFS_KEY, prefs);
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
      if (!v.ok) {
        state.notice("Modèle refusé : identifiant invalide ou absent de la liste.", "error");
        refresh();
        return;
      }
      prefs = { ...prefs, model: v.model };
      clampVariant();
      reclamp();
      persist(PREFS_KEY, prefs);
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
        state.notice("Variante refusée : absente du catalogue du modèle courant.", "error");
        refresh();
        return;
      }
      prefs = { ...prefs, variant: raw };
      persist(PREFS_KEY, prefs);
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
        persist(PREFS_KEY, prefs);
        refresh();
        return;
      }
      const wanted = parseEffortChoice(raw);
      if (wanted === null) {
        state.notice("Niveau d'effort refusé : valeur inconnue.", "error");
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
          "Ultracode n'est pas disponible : ce modèle ne prend pas en charge « Max ».",
          "error",
        );
        refresh();
        return;
      }
      if (c.clamped) clampNotice(wanted, c.effort);
      prefs = { ...prefs, effort: wanted === "ultracode" ? wanted : c.effort };
      persist(PREFS_KEY, prefs);
      refresh();
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
    async send(text: string, prompt = text): Promise<void> {
      // Mode lecture : aucune saisie tant que la conversation n'est pas reprise.
      // `text` est la bulle. `prompt` peut y joindre la sortie d'un terminal cité.
      if (state.busy || state.readonly || text.trim() === "") return;
      if (deps.requireProvider && state.noProvider) {
        state.notice(
          "Aucun fournisseur n'a été ajouté : ajoute un jeton (Warband : définir le jeton) pour utiliser le chat.",
          "error",
        );
        refresh();
        return;
      }
      state.setBusy(true);
      const revision = ++navigationRev;
      const projectsReady = await reloadHistoryProjects(revision);
      if (revision !== navigationRev) return;
      if (
        !projectsReady ||
        (current !== null && (current.projectId ?? null) !== historyProjects.activeId)
      ) {
        state.setBusy(false);
        if (projectsReady)
          state.notice(
            "Le projet actif a changé. Revenez au projet de cette conversation ou créez une nouvelle conversation dans le projet actif.",
            "error",
          );
        refresh();
        return;
      }
      ensureConversation(text);
      const conversationContext = transferContext
        ? buildConversationContext(state.view().items)
        : undefined;
      state.user(text);
      refresh();
      try {
        if (controller !== null && applied !== null) {
          const want = choice(deps.readSettings());
          if (
            want.model !== applied.model ||
            want.effort !== applied.effort ||
            want.variant !== applied.variant ||
            learning !== applied.learning
          ) {
            await retire(controller);
          } else if (appliedAuth !== authRev) {
            // Jeton changé pendant un tour : le moteur courant garde l'ancien, le suivant relit le nouveau.
            await retire(
              controller,
              "Jeton modifié : nouveau moteur démarré avec le nouveau jeton, même session.",
            );
          }
        }
        if (revision !== navigationRev) return;
        const ctl = controller ?? (await startEngine(revision, conversationContext));
        if (revision !== navigationRev || ctl === null) return;
        ctl.prompt(prompt);
      } catch (error) {
        if (revision !== navigationRev) return;
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
    },
    /**
     * Jeton défini ou effacé : appliqué sans redémarrer l'extension. Le moteur inactif est remplacé
     * (le suivant relit le jeton), la liste des modèles est sondée de nouveau, le chat se dégrise ou se grise.
     * Pendant un tour, le moteur courant finit avec l'ancien jeton ; le message suivant relira le nouveau.
     */
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
          "Jeton modifié : nouveau moteur au prochain message, même session.",
        );
      }
      refresh();
      await loading;
    },
    stop(): void {
      navigationRev++;
      if (controller === null) {
        state.setBusy(false);
        refresh();
        return;
      }
      userAbort.add(controller);
      stopping = true;
      controller.abort();
      state.notice("Arrêt demandé.");
      refresh();
    },
    async approve(toolUseId: string, choice: Choice): Promise<void> {
      const card = state.approvals.get(toolUseId);
      if (!card || controller === null || confirming) return;
      if (choice === "always") {
        // « Toujours » : jamais pour un verdict non mémorisable ; confirmation native hors webview.
        if (!card.canRemember) return;
        confirming = true;
        try {
          if (!(await deps.confirmAlways(alwaysConfirmText(card)))) return;
        } finally {
          confirming = false;
        }
        if (!state.approvals.has(toolUseId) || controller === null) return;
      }
      const { decision, remember } = answerFor(choice);
      controller.answer(toolUseId, decision, remember);
      state.approvals.delete(toolUseId);
      refresh();
    },
    reset(): void {
      navigationRev++;
      stopping = true;
      if (controller !== null) detached.add(controller);
      stopEngine(controller);
      controller = null;
      applied = null;
      sessionId = undefined;
      transferContext = false;
      current = null;
      state.clear();
      refresh();
    },
    async refreshHistoryProjects(): Promise<void> {
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
      state.clear();
      const events: EngineEvent[] = [];
      let invalid = 0;
      let truncated = false;
      let missing = 0;
      for (const runId of meta.runIds) {
        const text = await history.files.read(runId);
        if (revision !== navigationRev) return;
        if (text === null) {
          missing++;
          continue;
        }
        const parsed = parseUntrustedJournal(text, runId);
        events.push(...parsed.events);
        invalid += parsed.invalid;
        truncated ||= parsed.truncated;
      }
      replayEvents(state, events);
      if (missing > 0) state.notice(`${missing} journal(aux) introuvable(s).`);
      state.setReadonly({
        id: meta.id,
        title: meta.title,
        invalid,
        truncated,
        canResume:
          meta.sessionId !== null ||
          state.view().items.some((item) => item.kind === "user" || item.kind === "agent"),
      });
      refresh();
    },
    /** Reprend la conversation ouverte : nouveau message avec `resume`, sous la politique ACTUELLE. */
    async resumeConversation(): Promise<void> {
      if (state.busy) return;
      const info = state.readonly;
      const meta = info ? index.find((c) => c.id === info.id) : undefined;
      if (!meta) return;
      const revision = ++navigationRev;
      const projectsReady = await reloadHistoryProjects(revision);
      if (revision !== navigationRev) return;
      if (!projectsReady) {
        refresh();
        return;
      }
      if ((meta.projectId ?? null) !== historyProjects.activeId) {
        state.notice(
          "Cette conversation appartient à un autre projet. Revenez à son projet ou créez une nouvelle conversation dans le projet actif.",
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
      };
      persist(PREFS_KEY, prefs);
      if (providerChanged) {
        cancelModelLoad();
        models = null;
        modelsStatus = "idle";
        modelsMessage = undefined;
      }
      current = meta;
      sessionId = meta.sessionId ?? undefined;
      transferContext = meta.sessionId === null;
      state.setReadonly(null);
      state.notice(
        meta.sessionId === null
          ? "Session introuvable : le prochain message démarre une nouvelle session."
          : "Conversation reprise dans son projet : la politique actuelle s'applique.",
      );
      refresh();
      if (providerChanged) await loadModels();
    },
    renameConversation(id: unknown, raw: unknown): void {
      const meta = isConversationId(id) ? index.find((c) => c.id === id) : undefined;
      if (!meta) return;
      const title = cleanTitle(raw);
      if (title === null) {
        state.notice("Titre refusé : il est vide.", "error");
        refresh();
        return;
      }
      meta.title = title;
      saveIndex();
      refresh();
    },
    async deleteConversation(id: unknown): Promise<void> {
      const meta = history && isConversationId(id) ? index.find((c) => c.id === id) : undefined;
      if (!history || !meta) return;
      const ok = await history.confirmDelete(
        `Supprimer la conversation « ${cleanText(meta.title, 80)} » et ses journaux ?`,
      );
      if (!ok) return;
      if (meta.id === current?.id || meta.id === state.readonly?.id) this.reset();
      index = index.filter((c) => c.id !== meta.id);
      saveIndex();
      await history.files.remove(meta.runIds);
      refresh();
    },
    async clearHistory(): Promise<void> {
      if (!history) return;
      const ok = await history.confirmDelete(
        "Effacer tout l'historique des conversations et leurs journaux ?",
      );
      if (!ok) return;
      this.reset();
      index = [];
      saveIndex();
      await history.files.removeAll();
      refresh();
    },
    dispose(): void {
      disposed = true;
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
