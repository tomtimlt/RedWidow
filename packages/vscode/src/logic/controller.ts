import { type ChildProcess, fork } from "node:child_process";
import {
  CodedError,
  createRedactor,
  type EngineEvent,
  type ErrorInfo,
  type PendingApproval,
  type Reason,
  type RememberScope,
  safeEnv,
} from "@john-studio/core";
import {
  type EndedSummary,
  type FromEngine,
  PROTOCOL_VERSION,
  parseFromEngine,
  type StartParams,
  type ToEngine,
} from "./protocol.js";

/** Les deux seules variables d'authentification que l'on transmet au moteur (une à la fois). */
export const AUTH_ENV_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;
export type AuthEnvName = (typeof AUTH_ENV_NAMES)[number];

export interface EngineAuth {
  name: AuthEnvName;
  value: string;
}

/**
 * Environnement de l'enfant : liste blanche de `safeEnv()`, `ELECTRON_RUN_AS_NODE` (le Node
 * d'Electron joue le rôle de Node) et, au plus, une variable d'authentification. Le jeton
 * n'est jamais posé dans `process.env` de l'extension host.
 */
export function buildEngineEnv(
  auth?: EngineAuth,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...safeEnv(base), ELECTRON_RUN_AS_NODE: "1" };
  if (auth !== undefined) {
    if (!(AUTH_ENV_NAMES as readonly string[]).includes(auth.name) || auth.value === "") {
      throw new CodedError("ipc.invalidMessage", { field: "auth", reason: "invalid" });
    }
    env[auth.name] = auth.value;
  }
  return env;
}

/** Pas de fenêtre de console sous Windows (option acceptée par `fork`, absente des typings). */
const HIDDEN_WINDOW = { windowsHide: true };

export interface EngineHandlers {
  onStarted?(info: { runId: string; policySource: string | null; warning?: Reason }): void;
  onEvent?(event: EngineEvent): void;
  onApproval?(approval: PendingApproval): void;
  onEnded?(summary: EndedSummary): void;
  /** Erreur du moteur, ou message rejeté par la validation (le message fautif est ignoré). */
  onError?(reason: ErrorInfo): void;
  /** Processus enfant terminé. */
  onExit?(info: { code: number | null; signal: NodeJS.Signals | null }): void;
  /** Sortie d'erreur du moteur, masquée (jeton et motifs usuels de secrets). */
  onLog?(text: string): void;
}

export interface EngineControllerOptions {
  /** Script du moteur (`engine.mjs` empaqueté). */
  enginePath: string;
  /** Arguments passés au moteur (dossier de l'extension). */
  args?: string[];
  auth?: EngineAuth;
  /** Environnement de base (défaut : `process.env`), filtré par `safeEnv`. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Délai de démarrage avant abandon (défaut : 15 s). */
  startTimeoutMs?: number;
  handlers?: EngineHandlers;
  /** Dossier de travail de l'enfant. */
  cwd?: string;
}

export interface EngineController {
  /** Lance le moteur, attend `ready`, puis envoie `start`. Rejette si le démarrage échoue. */
  start(params: StartParams): Promise<void>;
  prompt(text: string): void;
  answer(toolUseId: string, decision: "allow" | "deny", remember?: RememberScope): void;
  /** Annule le run en cours. */
  abort(): void;
  /** Termine la session proprement (le run s'achève puis le moteur sort). */
  dispose(): void;
  /** Tue le processus enfant sans attendre (désactivation de l'extension). */
  kill(): void;
  /** Résolue à la fin du processus enfant. */
  readonly exited: Promise<void>;
}

/** Contrôleur côté extension : pas d'import de `vscode`, testable avec un vrai enfant. */
export function createEngineController(options: EngineControllerOptions): EngineController {
  const { handlers = {}, startTimeoutMs = 15_000 } = options;
  // Le jeton connu est masqué dans tout ce que l'on relaie, en plus des motifs usuels.
  const redact = createRedactor({ values: options.auth ? [options.auth.value] : [] });
  let child: ChildProcess | null = null;
  let resolveExited!: () => void;
  const exited = new Promise<void>((resolve) => (resolveExited = resolve));

  const post = (message: ToEngine) => {
    if (child?.connected !== true) return;
    try {
      child.send(message);
    } catch {
      // Canal fermé : `exit` / `disconnect` le signalera.
    }
  };

  const dispatch = (message: FromEngine) => {
    switch (message.type) {
      case "started":
        return handlers.onStarted?.({
          runId: message.runId,
          policySource: message.policySource,
          ...(message.warning && { warning: message.warning }),
        });
      case "event":
        return handlers.onEvent?.(message.event);
      case "approval":
        return handlers.onApproval?.(message.approval);
      case "ended":
        return handlers.onEnded?.(message.summary);
      case "error":
        return handlers.onError?.(message.reason);
      case "ready":
        return;
    }
  };

  return {
    exited,
    start(params) {
      return new Promise<void>((resolve, reject) => {
        if (child !== null) {
          return reject(new CodedError("ipc.invalidMessage", { field: "type", reason: "state" }));
        }
        let ready = false;
        const fail = (error: unknown) => {
          if (ready) return;
          ready = true;
          clearTimeout(timer);
          child?.kill();
          reject(error);
        };
        const proc = fork(options.enginePath, options.args ?? [], {
          env: buildEngineEnv(options.auth, options.baseEnv),
          ...(options.cwd !== undefined && { cwd: options.cwd }),
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          ...HIDDEN_WINDOW,
        });
        child = proc;
        const timer = setTimeout(
          () => fail(new CodedError("ipc.startTimeout", { seconds: startTimeoutMs / 1000 })),
          startTimeoutMs,
        );
        proc.stderr?.on("data", (chunk: Buffer) => handlers.onLog?.(redact(chunk.toString())));
        proc.on("error", fail);
        proc.on("exit", (code, signal) => {
          fail(
            new CodedError("ipc.engineExited", {
              ...(signal ? { signal } : { code: code ?? -1 }),
            }),
          );
          handlers.onExit?.({ code, signal });
          resolveExited();
        });
        proc.on("message", (raw) => {
          const parsed = parseFromEngine(raw);
          if (!parsed.ok) return handlers.onError?.(parsed.reason);
          if (parsed.message.type === "ready" && !ready) {
            ready = true;
            clearTimeout(timer);
            post({ v: PROTOCOL_VERSION, type: "start", ...params });
            return resolve();
          }
          dispatch(parsed.message);
        });
      });
    },
    prompt: (text) => post({ v: PROTOCOL_VERSION, type: "prompt", text }),
    answer: (toolUseId, decision, remember) =>
      post({
        v: PROTOCOL_VERSION,
        type: "answer",
        toolUseId,
        decision,
        ...(remember !== undefined && { remember }),
      }),
    abort: () => post({ v: PROTOCOL_VERSION, type: "abort" }),
    dispose: () => post({ v: PROTOCOL_VERSION, type: "dispose" }),
    kill: () => void child?.kill(),
  };
}
