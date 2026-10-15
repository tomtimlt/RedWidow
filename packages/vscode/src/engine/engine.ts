import { join } from "node:path";
import {
  type AgentRunner,
  type ApprovalGate,
  type AuthMode,
  activeSandboxId,
  createApprovalGate,
  createApprovalQueue,
  createRecorder,
  createRedactor,
  createSandbox,
  createSandboxContext,
  errorInfo,
  killOwnTree,
  loadPolicy,
  openJournal,
  removeAllSandboxes,
  type SandboxContext,
  secretsFromEnv,
} from "@john-studio/core";
import {
  type EndedSummary,
  type FromEngine,
  PROTOCOL_VERSION,
  parseToEngine,
  type StartParams,
} from "../logic/protocol.js";

/** Canal vers le parent (IPC de Node en production, paire factice dans les tests). */
export interface EngineChannel {
  /** Envoie un message ; la promesse se résout quand il est parti (ou si le canal est coupé). */
  send(message: FromEngine): Promise<void>;
  /** Messages bruts reçus : ils sont validés par le moteur. */
  onMessage(handler: (raw: unknown) => void): void;
  /** Le parent a disparu (déconnexion IPC). */
  onDisconnect(handler: () => void): void;
}

export interface EngineOptions {
  channel: EngineChannel;
  /**
   * Fabrique du runner, appelée au `start` (production : vérifie l'empreinte du binaire
   * `claude` juste avant `createSdkRunner`) ; reçoit le contexte du bac à sable demandé au `start`, s'il y en a un. Une erreur est signalée au parent et termine le moteur.
   */
  createRunner: (sandbox: SandboxContext | undefined) => AgentRunner | Promise<AgentRunner>;
  /** Environnement dont on tire les secrets à masquer (défaut : `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Délai laissé au run pour s'arrêter après une déconnexion avant de rendre la main (défaut : 5000 ms). */
  disconnectGraceMs?: number;
  /** Arrêt de l'arbre de processus à la fin du délai de grâce (défaut : `killOwnTree`). */
  killTree?: () => void;
  /**
   * Binaire Docker de test (hors protocole IPC). Absent en production : le binaire reste `docker`.
   */
  docker?: { binary: string; argsPrefix?: readonly string[] };
}

/** Flux de consignes d'une session multi-tours : `push` alimente, `end` clôt. */
function createPromptStream(onTake: (text: string) => void) {
  const buffer: string[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  return {
    push(text: string) {
      if (!ended) buffer.push(text);
      poke();
    },
    end() {
      ended = true;
      poke();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      for (;;) {
        const next = buffer.shift();
        if (next !== undefined) {
          onTake(next);
          yield next;
        } else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

/**
 * Moteur enfant : un run par processus. Assemble comme la CLI (recorder, journal, gate
 * dont le `ask` passe par l'IPC, runner) et relaie événements et demandes d'approbation.
 * Résout avec le code de sortie souhaité ; l'appelant termine le processus.
 */
export function runEngine({
  channel,
  createRunner,
  env = process.env,
  disconnectGraceMs = 5000,
  killTree = killOwnTree,
  docker,
}: EngineOptions): Promise<number> {
  // Tout ce qui part vers le parent est masqué, y compris ce que le recorder ne voit pas
  // (entrée d'un outil en attente d'approbation, erreurs, résumé).
  const redact = createRedactor({ values: secretsFromEnv(env) });
  const pendingSends = new Set<Promise<void>>();
  const send = (message: FromEngine) => {
    const p = channel.send(redact(message)).catch(() => undefined);
    pendingSends.add(p);
    void p.finally(() => pendingSends.delete(p));
  };

  const abort = new AbortController();
  // Chaque consigne consommée par le runner est consignée (`user.message`) : le journal permet de rejouer le fil.
  let onUserMessage: (text: string) => void = () => {};
  const prompts = createPromptStream((text) => onUserMessage(text));
  let queue: ReturnType<typeof createApprovalQueue> | null = null;
  let started = false;

  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      void Promise.allSettled([...pendingSends]).then(() => resolve(code));
    };

    const invalid = (field: string, why: string) =>
      send({
        v: PROTOCOL_VERSION,
        type: "error",
        reason: { code: "ipc.invalidMessage", params: { field, reason: why } },
      });

    const session = async (params: StartParams) => {
      let code = 0;
      let sandboxCtx: SandboxContext | undefined;
      const recorder = createRecorder({ redact });
      onUserMessage = (text) => void recorder.emit({ kind: "user.message", text });
      // Journal de l'extension : hors du dépôt (`journalDir` validé par le protocole), sinon celui de la CLI.
      const journal = await openJournal(
        params.journalDir !== undefined
          ? join(params.journalDir, `${recorder.runId}.jsonl`)
          : join(params.cwd, ".john-studio", "runs", `${recorder.runId}.jsonl`),
      );
      try {
        const { policy, source, warning } = await loadPolicy({ cwd: params.cwd });
        sandboxCtx = params.sandbox
          ? createSandboxContext({
              recorder,
              maxTimeoutSec: params.sandbox.timeoutSec,
              ...(docker && {
                binary: docker.binary,
                ...(docker.argsPrefix !== undefined && { argsPrefix: docker.argsPrefix }),
              }),
            })
          : undefined;
        const sandbox = sandboxCtx;
        recorder.subscribe(journal.sink);
        recorder.subscribe((event) => send({ v: PROTOCOL_VERSION, type: "event", event }));
        const approvals = createApprovalQueue();
        queue = approvals;
        const gate: ApprovalGate = createApprovalGate({
          policy,
          recorder,
          // Claude exige Git Bash sous Windows : le shell est analysable comme POSIX (comme la CLI).
          workspace: { cwd: params.cwd, posixShell: true },
          ask: approvals,
          // Identifiant fourni par le registre (ADR 0003 D), jamais par l'entrée d'un outil.
          ...(sandbox && { sandboxContainerId: () => activeSandboxId(sandbox) }),
        });
        // Les demandes en attente partent vers l'UI ; la réponse revient par `answer`.
        void (async () => {
          for await (const approval of approvals.requests(abort.signal)) {
            send({ v: PROTOCOL_VERSION, type: "approval", approval });
          }
        })();
        send({
          v: PROTOCOL_VERSION,
          type: "started",
          runId: recorder.runId,
          policySource: source,
          ...(warning && { warning }),
        });
        if (sandbox && params.sandbox) {
          await createSandbox(sandbox, {
            image: params.sandbox.image,
            network: params.sandbox.network,
            memory: params.sandbox.memory,
            cpus: params.sandbox.cpus,
            signal: abort.signal,
          });
        }
        const runner = await createRunner(sandbox);
        const summary = await runner.run(
          {
            prompt: prompts,
            cwd: params.cwd,
            ...(params.model !== undefined && { model: params.model }),
            ...(params.effort !== undefined && { effort: params.effort }),
            ...(params.maxTurns !== undefined && { maxTurns: params.maxTurns }),
            auth: params.auth ?? "auto",
            ...(params.resume !== undefined && { resume: params.resume }),
            ...(params.maxBudgetUsd !== undefined && { maxBudgetUsd: params.maxBudgetUsd }),
            ...(params.systemPrompt !== undefined && { systemPrompt: params.systemPrompt }),
          },
          { recorder, gate, signal: abort.signal },
        );
        const ended: EndedSummary = {
          status: summary.status,
          turns: summary.turns,
          costUsd: summary.costUsd,
          result: summary.result,
          ...(summary.sessionId !== undefined && { sessionId: summary.sessionId }),
        };
        send({ v: PROTOCOL_VERSION, type: "ended", summary: ended });
        code = summary.status === "success" ? 0 : 1;
      } catch (error) {
        send({ v: PROTOCOL_VERSION, type: "error", reason: errorInfo(error) });
        code = 1;
      } finally {
        // Refuse ce qui restait en attente (interrompu), ferme les flux puis le journal.
        queue?.close();
        // Conteneur supprimé en fin de run, sur annulation et sur erreur, avant la fermeture du journal.
        if (sandboxCtx) {
          await removeAllSandboxes(sandboxCtx, abort.signal.aborted ? "abort" : "runEnd").catch(
            () => undefined,
          );
        }
        recorder.close();
        await journal.close().catch(() => undefined);
      }
      finish(code);
    };

    /** Sondage : liste des modèles sans consigne (donc sans tour, outil ni coût d'inférence), puis sortie. */
    const probe = async (cwd: string, auth: AuthMode | undefined) => {
      try {
        const runner = await createRunner(undefined);
        const models =
          (await runner.listModels?.({
            cwd,
            ...(auth !== undefined && { auth }),
            signal: abort.signal,
          })) ?? [];
        send({ v: PROTOCOL_VERSION, type: "models", models });
        finish(0);
      } catch (error) {
        send({ v: PROTOCOL_VERSION, type: "error", reason: errorInfo(error) });
        finish(1);
      }
    };

    channel.onMessage((raw) => {
      const parsed = parseToEngine(raw);
      if (!parsed.ok) {
        send({ v: PROTOCOL_VERSION, type: "error", reason: parsed.reason });
        return;
      }
      const message = parsed.message;
      switch (message.type) {
        case "start": {
          if (started) return invalid("type", "state");
          started = true;
          const { v: _v, type: _type, ...params } = message;
          void session(params).catch((error) => {
            send({ v: PROTOCOL_VERSION, type: "error", reason: errorInfo(error) });
            finish(1);
          });
          return;
        }
        case "models":
          if (started) return invalid("type", "state");
          started = true;
          void probe(message.cwd, message.auth);
          return;
        case "prompt":
          if (!started) return invalid("type", "state");
          prompts.push(message.text);
          return;
        case "answer":
          // Sans effet si la demande n'existe pas (inconnue, déjà traitée ou annulée).
          if (
            !queue?.answer(message.toolUseId, {
              decision: message.decision,
              ...(message.remember !== undefined && { remember: message.remember }),
            })
          ) {
            invalid("toolUseId", "unknown");
          }
          return;
        case "abort":
          abort.abort(new Error("annulé par l'utilisateur"));
          prompts.end();
          return;
        case "dispose":
          prompts.end();
          if (!started) finish(0);
          return;
      }
    });

    // Parent disparu : annule le run (le SDK termine son binaire), puis rend la main
    // après un délai de grâce même si le run ne répond plus.
    channel.onDisconnect(() => {
      abort.abort(new Error("IPC coupée"));
      prompts.end();
      if (!started) return finish(1);
      const timer = setTimeout(() => {
        // Run sans réponse : son binaire et ses descendants ne doivent pas survivre au moteur.
        killTree();
        finish(1);
      }, disconnectGraceMs);
      timer.unref();
    });
  });
}
