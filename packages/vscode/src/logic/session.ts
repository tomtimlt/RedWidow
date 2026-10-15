import type { AuthMode, Reason } from "@john-studio/core";
import { formatReason } from "@john-studio/messages";
import { alwaysConfirmText, answerFor, type Choice, toCard } from "./approval.js";
import { type ChatState, type ChatView, createChatState } from "./chat.js";
import {
  createEngineController,
  type EngineAuth,
  type EngineController,
  type EngineControllerOptions,
} from "./controller.js";
import type { ChatSettings } from "./settings.js";

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
}

/**
 * Conversation : pilote le contrôleur du moteur et l'état du chat. Pas d'import de `vscode`.
 * `stop` termine le run (le moteur sort) ; le message suivant relance un moteur en reprenant la session.
 */
export function createChatSession(deps: ChatSessionDeps) {
  const make = deps.createController ?? createEngineController;
  const state: ChatState = createChatState();
  let controller: EngineController | null = null;
  let sessionId: string | undefined;
  let confirming = false;
  let stopping = false;

  const refresh = () => deps.onView(state.view());
  const warn = (reason: Reason) => state.notice(formatReason(reason), "error");

  const startEngine = async (): Promise<EngineController> => {
    const settings = deps.readSettings();
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
          if (warning) warn(warning);
          refresh();
        },
        onEvent: (event) => {
          state.event(event);
          refresh();
        },
        onApproval: (pending) => {
          state.approvals.set(pending.toolUseId, toCard(pending));
          refresh();
        },
        onEnded: (summary) => {
          if (summary.sessionId !== undefined) sessionId = summary.sessionId;
          state.setBusy(false);
          refresh();
        },
        onError: (reason) => {
          state.error(reason);
          refresh();
        },
        onExit: ({ code }) => {
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
    await ctl.start({
      cwd: deps.cwd,
      auth: token?.mode ?? "auto",
      ...(settings.model !== undefined && { model: settings.model }),
      ...(settings.maxTurns !== undefined && { maxTurns: settings.maxTurns }),
      ...(settings.sandbox !== undefined && { sandbox: settings.sandbox }),
      ...(sessionId !== undefined && { resume: sessionId }),
    });
    return ctl;
  };

  return {
    view: () => state.view(),
    async send(text: string): Promise<void> {
      if (state.busy || text.trim() === "") return;
      state.user(text);
      state.setBusy(true);
      refresh();
      try {
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
