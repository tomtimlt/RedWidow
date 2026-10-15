import type { AuthMode, Effort, ModelOption, Reason } from "@john-studio/core";
import { formatReason } from "@john-studio/messages";
import { alwaysConfirmText, answerFor, type Choice, toCard } from "./approval.js";
import { type ChatState, type ChatView, createChatState } from "./chat.js";
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
import { clampEffort, EFFORT_LEVELS, parseEffort } from "./effort.js";
import { parseModelCache, usableModels, validateModelChoice } from "./models.js";
import type { ChatSettings } from "./settings.js";

const PREFS_KEY = "john.prefs";
const MODELS_KEY = "john.models";
const labelOf = (e: Effort) => EFFORT_LEVELS.find((l) => l.value === e)?.label ?? e;

/** Jeton choisi par l'utilisateur : le mode d'authentification qui lui correspond. */
export interface TokenChoice {
  auth: EngineAuth;
  mode: AuthMode;
}

export interface ChatSessionDeps {
  cwd: string;
  enginePath: string;
  engineArgs: string[];
  /** Réglages machine validés (lève `CodedError`). */
  readSettings(): ChatSettings;
  /** Jeton (SecretStorage) ; `undefined` → authentification `auto` du binaire. */
  getToken(): Promise<TokenChoice | undefined>;
  /** Confirmation modale native (hors webview) pour « Toujours ». */
  confirmAlways(text: string): Promise<boolean>;
  onView(view: ChatView): void;
  /** Sortie d'erreur du moteur, déjà masquée. */
  onLog?(text: string): void;
  createController?(options: EngineControllerOptions): EngineController;
  /** Stockage persistant (globalState) : préférences et cache des modèles. Défaut : mémoire. */
  store?: { get(key: string): unknown; set(key: string, value: unknown): unknown };
  /** Version du SDK embarqué : clé du cache de la liste des modèles. */
  sdkVersion?: string;
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
  let confirming = false;
  let stopping = false;

  const sdkVersion = deps.sdkVersion ?? "unknown";
  const memory = new Map<string, unknown>();
  const store = deps.store ?? {
    get: (key: string) => memory.get(key),
    set: (key: string, value: unknown) => memory.set(key, value),
  };
  let prefs: Prefs = parsePrefs(store.get(PREFS_KEY));
  let models: ModelOption[] | null = parseModelCache(store.get(MODELS_KEY), sdkVersion);
  let modelsStatus: ModelsStatus = models ? "ready" : "idle";
  let probing = false;
  /** Choix avec lequel le moteur courant a démarré : un changement impose de reprendre la session. */
  let applied: { model: string | undefined; effort: Effort | undefined } | null = null;
  /** Moteurs écartés (changement de modèle ou d'effort) : leurs derniers messages sont ignorés. */
  const detached = new WeakSet<EngineController>();

  const persist = (key: string, value: unknown) =>
    void Promise.resolve(store.set(key, value)).catch(() => undefined);
  const machineModel = (): string | undefined => {
    try {
      return deps.readSettings().model;
    } catch {
      return undefined;
    }
  };
  const supportedNow = (fallback = machineModel()) =>
    effectiveModel(models, prefs.model, fallback)?.supportedEffortLevels;
  const sync = () =>
    state.setControls(
      buildControls({
        prefs,
        models,
        status: modelsStatus,
        defaultModel: machineModel(),
        busy: state.busy,
      }),
    );
  const refresh = () => {
    sync();
    deps.onView(state.view());
  };
  const warn = (reason: Reason) => state.notice(formatReason(reason), "error");
  const clampNotice = (wanted: Effort, got: Effort) =>
    state.notice(
      `Niveau d'effort ramené à « ${labelOf(got)} » : « ${labelOf(wanted)} » n'est pas pris en charge par ce modèle.`,
    );

  /** Modèle et effort du prochain message : préférence, sinon réglage machine ; effort ramené s'il n'est pas permis. */
  const choice = (settings: ChatSettings) => {
    const model = prefs.model ?? settings.model;
    const c = clampEffort(prefs.effort, supportedNow(settings.model));
    return {
      model,
      effort: c.effort ?? undefined,
      clampedTo: c.clamped && c.effort !== null ? c.effort : undefined,
    };
  };

  const startEngine = async (): Promise<EngineController> => {
    const settings = deps.readSettings();
    const picked = choice(settings);
    if (picked.clampedTo !== undefined) clampNotice(prefs.effort, picked.clampedTo);
    const token = await deps.getToken();
    state.setSandbox(settings.sandbox?.image ?? null);
    refresh();
    stopping = false;
    const ctl = make({
      enginePath: deps.enginePath,
      args: deps.engineArgs,
      cwd: deps.cwd,
      ...(token && { auth: token.auth }),
      handlers: {
        onStarted: ({ warning }) => {
          if (detached.has(ctl)) return;
          if (warning) warn(warning);
          refresh();
        },
        onEvent: (event) => {
          if (detached.has(ctl)) return;
          // Connu dès le début de la session : la reprise (changement de modèle) n'attend pas la fin du run.
          if (event.kind === "session.started") sessionId = event.sessionId;
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
          if (summary.sessionId !== undefined) sessionId = summary.sessionId;
          state.setBusy(false);
          refresh();
        },
        onError: (reason) => {
          if (detached.has(ctl)) return;
          state.error(reason);
          refresh();
        },
        onExit: ({ code }) => {
          if (detached.has(ctl)) return;
          // Ancien moteur (réinitialisation puis nouveau message) : l'état n'est plus le sien.
          if (controller !== null && controller !== ctl) return;
          controller = null;
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
    applied = { model: picked.model, effort: picked.effort };
    await ctl.start({
      cwd: deps.cwd,
      auth: token?.mode ?? "auto",
      ...(picked.model !== undefined && { model: picked.model }),
      ...(picked.effort !== undefined && { effort: picked.effort }),
      ...(settings.maxTurns !== undefined && { maxTurns: settings.maxTurns }),
      ...(settings.sandbox !== undefined && { sandbox: settings.sandbox }),
      ...(sessionId !== undefined && { resume: sessionId }),
    });
    return ctl;
  };

  /** Sondage de la liste des modèles (moteur éphémère sans consigne) ; sans effet si déjà connue, sauf `force`. */
  const loadModels = async (force = false): Promise<void> => {
    if (probing || (models !== null && !force)) return;
    probing = true;
    modelsStatus = "loading";
    refresh();
    try {
      const token = await deps.getToken();
      const probe = make({
        enginePath: deps.enginePath,
        args: deps.engineArgs,
        cwd: deps.cwd,
        ...(token && { auth: token.auth }),
        handlers: { onLog: (text) => deps.onLog?.(text) },
      });
      const list = usableModels(await probe.models({ cwd: deps.cwd, auth: token?.mode ?? "auto" }));
      if (list.length === 0) throw new Error("liste vide");
      models = list;
      modelsStatus = "ready";
      persist(MODELS_KEY, { sdk: sdkVersion, models: list });
      if (prefs.model !== null && !list.some((m) => m.value === prefs.model)) {
        prefs = { ...prefs, model: null };
        persist(PREFS_KEY, prefs);
        state.notice("Le modèle choisi n'est plus proposé : retour au modèle par défaut.");
      }
    } catch {
      // Repli : saisie libre (ou liste en cache). Aucune erreur affichée, rien n'a été perdu.
      modelsStatus = models ? "ready" : "unavailable";
    } finally {
      probing = false;
      refresh();
    }
  };

  /** Ramène le niveau d'effort au plus proche niveau permis par le modèle courant. */
  const reclamp = () => {
    const c = clampEffort(prefs.effort, supportedNow());
    if (c.effort !== null && c.clamped) {
      clampNotice(prefs.effort, c.effort);
      prefs = { ...prefs, effort: c.effort };
    }
  };

  /** Remplace le moteur inactif (modèle ou effort changé) ; le suivant reprendra la même session. */
  const retire = async (old: EngineController) => {
    detached.add(old);
    controller = null;
    stopping = true;
    state.approvals.clear();
    old.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      old.exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timer);
    state.notice("Modèle ou effort modifié : la conversation reprend avec la même session.");
  };

  return {
    view: () => {
      sync();
      return state.view();
    },
    loadModels,
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
      reclamp();
      persist(PREFS_KEY, prefs);
      refresh();
    },
    setEffort(raw: unknown): void {
      if (state.busy) {
        refresh();
        return;
      }
      const wanted = parseEffort(raw);
      if (wanted === null) {
        state.notice("Niveau d'effort refusé : valeur inconnue.", "error");
        refresh();
        return;
      }
      const c = clampEffort(wanted, supportedNow());
      if (c.effort === null) {
        refresh(); // modèle sans effort réglable
        return;
      }
      if (c.clamped) clampNotice(wanted, c.effort);
      prefs = { ...prefs, effort: c.effort };
      persist(PREFS_KEY, prefs);
      refresh();
    },
    async send(text: string): Promise<void> {
      if (state.busy || text.trim() === "") return;
      state.user(text);
      state.setBusy(true);
      refresh();
      try {
        if (controller !== null && applied !== null) {
          const want = choice(deps.readSettings());
          if (want.model !== applied.model || want.effort !== applied.effort) {
            await retire(controller);
          }
        }
        const ctl = controller ?? (await startEngine());
        ctl.prompt(text);
      } catch (error) {
        controller?.kill();
        controller = null;
        state.error(error);
        state.setBusy(false);
        refresh();
      }
    },
    stop(): void {
      if (controller === null) return;
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
      stopping = true;
      controller?.kill();
      controller = null;
      applied = null;
      sessionId = undefined;
      state.clear();
      refresh();
    },
    dispose(): void {
      stopping = true;
      controller?.kill();
      controller = null;
    },
  };
}

export type ChatSession = ReturnType<typeof createChatSession>;
