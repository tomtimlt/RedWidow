import { type ChildProcess, fork } from "node:child_process";
import {
  type AuthMode,
  type BypassState,
  CodedError,
  type CredentialInput,
  type CredentialResult,
  createRedactor,
  createSecretMasker,
  createTestAccounts,
  type EngineEvent,
  type ErrorInfo,
  type ModelOption,
  type PendingApproval,
  type PromptImage,
  type ProviderOption,
  type Reason,
  type RememberScope,
  safeEnv,
  spawnOptionsForTree,
  type TestAccounts,
  terminateProcessTree,
  trackProcessTree,
} from "@warband/core";
import { t } from "@warband/messages";
import { ModelProbeError } from "./model-load-error.js";
import {
  type EndedSummary,
  type FromEngine,
  PROTOCOL_VERSION,
  parseFromEngine,
  type StartParams,
  type ToEngine,
} from "./protocol.js";

/** Variables d'authentification admises vers le moteur (une à la fois). */
export const AUTH_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  // Clé OpenCode (Zen) : posée seulement par l'hôte serveur (réserve de clés) ; l'adaptateur ne la
  // transmet au serveur OpenCode que sous configuration isolée.
  "OPENCODE_API_KEY",
] as const;
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
  // Dossiers d’authentification OpenCode et réseau de l’hôte ; aucune clé héritée.
  for (const key of [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    if (base[key]) env[key] = base[key];
  }
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
  onProviders?(providers: ProviderOption[]): void;
  onStarted?(info: { runId: string; policySource: string | null; warning?: Reason }): void;
  onEvent?(event: EngineEvent): void;
  onMissionContext?(snapshot: { runId: string; text: string }): void;
  onApproval?(approval: PendingApproval): void;
  onEnded?(summary: EndedSummary): void;
  /** Erreur du moteur, ou message rejeté par la validation (le message fautif est ignoré). */
  onError?(reason: ErrorInfo): void;
  /** Accusé du miroir du Bypass : `state` est l'état réellement retenu (ADR 0006, décision 3). */
  onBypassAck?(ack: { seq: number; state: BypassState | null }): void;
  /**
   * Identifiant découvert par l'agent, à stocker dans le coffre de l'hôte. La demande porte le secret en
   * clair : ne jamais la journaliser. Absent : le contrôleur répond `ok: false` (hôte sans coffre).
   */
  onCredential?(request: CredentialInput): Promise<CredentialResult>;
  /** Processus enfant terminé. */
  onExit?(info: { code: number | null; signal: NodeJS.Signals | null; stderrTail?: string }): void;
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
  /** Délai de grâce de `kill()` avant l'arrêt forcé de l'arbre de processus (défaut : 2 s). */
  killGraceMs?: number;
}

export interface EngineController {
  /** Lance le moteur, attend `ready`, puis envoie `start`. Rejette si le démarrage échoue. */
  start(params: StartParams): Promise<void>;
  /**
   * Sondage : lance un moteur éphémère SANS consigne, lit la liste des modèles puis le termine.
   * Rejette si le moteur échoue, répond mal ou dépasse `timeoutMs` (défaut : 30 s).
   */
  models(params: {
    cwd: string;
    auth?: AuthMode;
    provider?: StartParams["provider"];
    opencodeProviders?: StartParams["opencodeProviders"];
    timeoutMs?: number;
  }): Promise<ModelOption[]>;
  prompt(text: string, research?: boolean, images?: PromptImage[]): void;
  answer(toolUseId: string, decision: "allow" | "deny", remember?: RememberScope): void;
  /**
   * Envoie l'état du Bypass au moteur (`null` = inactif) et renvoie le `seq` attribué. Le compteur
   * repart de 1 à chaque moteur (nouveau contrôleur). Ne fait rien de plus : l'accusé arrive par `onBypassAck`.
   */
  bypass(state: BypassState | null): number;
  /** Annule le run en cours. */
  abort(): void;
  /** Termine la session proprement (le run s'achève puis le moteur sort). */
  dispose(): void;
  /** Désactivation de l'extension : `abort` + `dispose`, délai de grâce, puis arrêt forcé de l'arbre de processus. */
  kill(): void;
  /** Résolue à la fin du processus enfant. */
  readonly exited: Promise<void>;
}

/** Contrôleur côté extension : pas d'import de `vscode`, testable avec un vrai enfant. */
export function createEngineController(options: EngineControllerOptions): EngineController {
  const { handlers = {}, startTimeoutMs = 15_000, killGraceMs = 2000 } = options;
  // Le jeton connu est masqué dans tout ce que l'on relaie, en plus des motifs usuels.
  const baseRedact = createRedactor({ values: options.auth ? [options.auth.value] : [] });
  let accounts: TestAccounts | undefined;
  // Secrets d'identifiants enregistrés par l'agent : masqués aussi dans la sortie d'erreur du moteur.
  const learned = createSecretMasker();
  const redact: import("@warband/core").Redactor = <T>(value: T): T =>
    learned.redact(baseRedact(accounts ? accounts.redact(value) : value));
  let child: ChildProcess | null = null;
  /** Sondage en cours : la réponse `models` ou une erreur du moteur le résout. */
  let probe: { resolve(models: ModelOption[]): void; reject(error: unknown): void } | null = null;
  /** Dernier `seq` envoyé au moteur de ce contrôleur (un moteur par contrôleur : repart de 0). */
  let bypassSeq = 0;
  /** Vrai dès `start` : seul un moteur de session accepte `bypass` (un sondage `models` le refuse). */
  let sessionStarted = false;
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

  /** Envoie l'état du Bypass avec le `seq` suivant ; `null` éteint. */
  const sendBypass = (state: BypassState | null): number => {
    bypassSeq += 1;
    post({ v: PROTOCOL_VERSION, type: "bypass", seq: bypassSeq, state });
    return bypassSeq;
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
      case "missionContext":
        return handlers.onMissionContext?.({ runId: message.runId, text: message.text });
      case "approval":
        return handlers.onApproval?.(message.approval);
      case "ended":
        return handlers.onEnded?.(message.summary);
      case "models":
        if (message.providers) handlers.onProviders?.(message.providers);
        return probe?.resolve(message.models);
      case "error":
        if (probe) return probe.reject(new ModelProbeError(message.reason));
        return handlers.onError?.(message.reason);
      case "bypassAck":
        return handlers.onBypassAck?.({ seq: message.seq, state: message.state });
      case "credential": {
        const { v: _v, type: _type, requestId, ...request } = message;
        learned.add(request.secret);
        // Sans gestionnaire, ou en cas d'échec : refus (`ok: false`), jamais d'erreur qui citerait la demande.
        const ack = (result: CredentialResult) =>
          post({
            v: PROTOCOL_VERSION,
            type: "credentialAck",
            requestId,
            ok: result.ok,
            ...(result.ok && result.id !== undefined && { id: result.id }),
          });
        if (handlers.onCredential === undefined) return ack({ ok: false });
        void handlers.onCredential(request).then(ack, () => ack({ ok: false }));
        return;
      }
      case "ready":
        return;
    }
  };

  /** Lance l'enfant, attend `ready`, puis lui envoie le premier message (`start` ou `models`). */
  const launch = (first: ToEngine): Promise<void> =>
    new Promise<void>((resolve, reject) => {
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
        ...spawnOptionsForTree(), // POSIX : chef de groupe, pour tuer aussi les petits-enfants
      });
      trackProcessTree(proc);
      child = proc;
      const timer = setTimeout(
        () => fail(new CodedError("ipc.startTimeout", { seconds: startTimeoutMs / 1000 })),
        startTimeoutMs,
      );
      const stderrChunks: Buffer[] = [];
      let stderrBytes = 0;
      let stderrOverflow = false;
      let stderrIncomplete = false;
      let stderrFinished = false;
      let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      const finishStderr = () => {
        if (stderrFinished || !exitInfo) return;
        stderrFinished = true;
        if (drainTimer) clearTimeout(drainTimer);
        const output = stderrOverflow
          ? t("[stderr trop volumineux : diagnostic ignoré]")
          : stderrIncomplete
            ? t("[stderr incomplet : diagnostic ignoré]")
            : redact(Buffer.concat(stderrChunks).toString("utf8"));
        stderrChunks.length = 0;
        if (output) handlers.onLog?.(output);
        const lines = output.replace(/\n$/, "").split(/\r?\n/).slice(-20).join("\n");
        handlers.onExit?.({ ...exitInfo, ...(lines && { stderrTail: lines }) });
        resolveExited();
      };
      proc.stderr?.on("data", (chunk: Buffer) => {
        if (stderrFinished || stderrOverflow) return;
        stderrBytes += chunk.length;
        if (stderrBytes > 64 * 1024) {
          stderrOverflow = true;
          stderrChunks.length = 0;
        } else stderrChunks.push(chunk);
      });
      let stderrEnded = !proc.stderr;
      proc.stderr?.on("end", () => {
        stderrEnded = true;
        finishStderr();
      });
      proc.on("error", fail);
      proc.on("exit", (code, signal) => {
        fail(
          new CodedError("ipc.engineExited", {
            ...(signal ? { signal } : { code: code ?? -1 }),
          }),
        );
        probe?.reject(new CodedError("ipc.engineExited", { code: code ?? -1 }));
        exitInfo = { code, signal };
        if (stderrEnded) finishStderr();
        else
          drainTimer = setTimeout(() => {
            // Un descendant peut conserver le descripteur : le bloc incomplet ne doit pas fuiter.
            stderrIncomplete = true;
            finishStderr();
          }, 250);
      });
      proc.on("message", (raw) => {
        const parsed = parseFromEngine(raw);
        if (!parsed.ok) {
          if (probe) probe.reject(new ModelProbeError(parsed.reason));
          else handlers.onError?.(parsed.reason);
          return;
        }
        if (parsed.message.type === "ready" && !ready) {
          ready = true;
          clearTimeout(timer);
          post(first);
          return resolve();
        }
        dispatch(parsed.message);
      });
    });

  return {
    exited,
    start(params) {
      accounts = params.testAccounts ? createTestAccounts(params.testAccounts) : undefined;
      sessionStarted = true;
      return launch({ v: PROTOCOL_VERSION, type: "start", ...params });
    },
    models({ cwd, auth, provider, opencodeProviders, timeoutMs = 30_000 }) {
      return new Promise<ModelOption[]>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            settle(() => reject(new CodedError("ipc.startTimeout", { seconds: timeoutMs / 1000 }))),
          timeoutMs,
        );
        const settle = (done: () => void) => {
          clearTimeout(timer);
          probe = null;
          done();
          this.kill();
        };
        probe = {
          resolve: (models) => settle(() => resolve(models)),
          reject: (error) => settle(() => reject(error)),
        };
        launch({
          v: PROTOCOL_VERSION,
          type: "models",
          cwd,
          ...(auth !== undefined && { auth }),
          ...(provider !== undefined && { provider }),
          ...(opencodeProviders !== undefined && { opencodeProviders }),
        }).catch((error) => settle(() => reject(error)));
      });
    },
    prompt: (text, research, images) =>
      post({
        v: PROTOCOL_VERSION,
        type: "prompt",
        text,
        ...(research !== undefined && { research }),
        ...(images !== undefined && { images }),
      }),
    answer: (toolUseId, decision, remember) =>
      post({
        v: PROTOCOL_VERSION,
        type: "answer",
        toolUseId,
        decision,
        ...(remember !== undefined && { remember }),
      }),
    bypass: sendBypass,
    abort: () => post({ v: PROTOCOL_VERSION, type: "abort" }),
    dispose: () => post({ v: PROTOCOL_VERSION, type: "dispose" }),
    kill() {
      const proc = child;
      if (proc === null) return;
      // ADR 0006, lot 2c : le Bypass s'éteint D'ABORD côté moteur, avant toute annulation du run.
      if (sessionStarted) sendBypass(null);
      post({ v: PROTOCOL_VERSION, type: "abort" });
      post({ v: PROTOCOL_VERSION, type: "dispose" });
      const timer = setTimeout(() => {
        // Le moteur n'a pas fini : arbre entier (son binaire `claude` inclus), sans attendre davantage.
        void terminateProcessTree(proc, { graceMs: 1000 });
      }, killGraceMs);
      timer.unref();
      void exited.then(() => clearTimeout(timer));
    },
  };
}
