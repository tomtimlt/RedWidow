import { join } from "node:path";
import {
  type AgentRunner,
  type ApprovalGate,
  type AuthMode,
  createApprovalGate,
  createApprovalQueue,
  createRecorder,
  createRedactor,
  errorInfo,
  killOwnTree,
  LEARNING_POLICY,
  LEARNING_SYSTEM_PROMPT,
  loadPolicy,
  openJournal,
  secretsFromEnv,
} from "@warband/core";
import {
  type EndedSummary,
  type FromEngine,
  PROTOCOL_VERSION,
  parseToEngine,
  type StartParams,
} from "../logic/protocol.js";
import { createBypassMirror } from "./bypass-mirror.js";

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
   * `claude` juste avant `createSdkRunner`) ; une erreur est signalée au parent et termine le moteur.
   */
  createRunner: (mode?: StartParams["mode"]) => AgentRunner | Promise<AgentRunner>;
  /** Environnement dont on tire les secrets à masquer (défaut : `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Délai laissé au run pour s'arrêter après une déconnexion avant de rendre la main (défaut : 5000 ms). */
  disconnectGraceMs?: number;
  /** Arrêt de l'arbre de processus à la fin du délai de grâce (défaut : `killOwnTree`). */
  killTree?: () => void;
  /** Appelé quand une consigne est consommée, avant qu'elle n'atteigne le modèle. */
  onPrompt?: (text: string) => void | Promise<void>;
  /** Horloge du moteur, pour le miroir du Bypass et la gate (défaut : `Date.now`). */
  now?: () => number;
  /** Chargement de la politique du run (défaut : `loadPolicy` de `core`). Tests : politique fournie. */
  policyLoader?: (cwd: string) => ReturnType<typeof loadPolicy>;
}

/** Message dont le type est `bypass` : même rejeté par la validation, il met le miroir à « off ». */
const isBypassMessage = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "bypass";

/** Flux de consignes d'une session multi-tours : `push` alimente, `end` clôt. */
function createPromptStream(onTake: (text: string) => void | Promise<void>) {
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
          await onTake(next);
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
  onPrompt,
  now = Date.now,
  policyLoader = (cwd) => loadPolicy({ cwd }),
}: EngineOptions): Promise<number> {
  // Miroir en lecture du Bypass (ADR 0006, décision 6) : naît « off », jamais calculé ici.
  const mirror = createBypassMirror({ now });
  // Un message `bypass` n'est admis qu'après `start` (pas pendant un sondage `models`).
  let sessionStarted = false;
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
  let onUserMessage: (text: string) => void | Promise<void> = () => {};
  const prompts = createPromptStream(async (text) => {
    await onPrompt?.(text);
    await onUserMessage(text);
  });
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
      const recorder = createRecorder({ redact });
      onUserMessage = (text) => void recorder.emit({ kind: "user.message", text });
      // Journal de l'extension : hors du dépôt (`journalDir` validé par le protocole), sinon celui de la CLI.
      const journal = await openJournal(
        params.journalDir !== undefined
          ? join(params.journalDir, `${recorder.runId}.jsonl`)
          : join(params.cwd, ".warband", "runs", `${recorder.runId}.jsonl`),
      );
      try {
        // Mode apprentissage (ADR 0010) : politique dédiée figée, aucune politique lue ni approuvée.
        const learning = params.mode === "learning";
        const { policy, source, warning } = learning
          ? { policy: LEARNING_POLICY, source: null, warning: undefined }
          : await policyLoader(params.cwd);
        recorder.subscribe(journal.sink);
        recorder.subscribe((event) => send({ v: PROTOCOL_VERSION, type: "event", event }));
        const approvals = createApprovalQueue();
        queue = approvals;
        const gate: ApprovalGate = createApprovalGate({
          policy,
          recorder,
          // Claude exige Git Bash sous Windows : le shell est analysable comme POSIX (comme la CLI).
          workspace: { cwd: params.cwd, posixShell: true },
          // Sans `ask` en apprentissage : un verdict `ask` imprévu est refusé (approval.noAsker).
          ...(!learning && { ask: approvals }),
          bypass: mirror,
          now,
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
        const runner = await createRunner(params.mode);
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
            // En apprentissage, la consigne système ne vient jamais de l'UI.
            ...(learning
              ? { systemPrompt: LEARNING_SYSTEM_PROMPT }
              : params.systemPrompt !== undefined && { systemPrompt: params.systemPrompt }),
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
        // Échec fermé : un `bypass` rejeté met le miroir à « off ».
        if (isBypassMessage(raw)) mirror.off();
        send({ v: PROTOCOL_VERSION, type: "error", reason: parsed.reason });
        return;
      }
      const message = parsed.message;
      switch (message.type) {
        case "start": {
          if (started) return invalid("type", "state");
          started = true;
          sessionStarted = true;
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
        case "bypass": {
          if (!sessionStarted) {
            mirror.off();
            return invalid("type", "state");
          }
          // Rejeu ou désordre (seq non croissant) : ignoré, sans accusé.
          if (!mirror.apply(message.seq, message.state)) return;
          send({
            v: PROTOCOL_VERSION,
            type: "bypassAck",
            seq: message.seq,
            state: mirror.current(now()),
          });
          return;
        }
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
      // Échec fermé : le Bypass s'éteint avant l'annulation du run (aucune décision ultérieure ne l'utilise).
      mirror.off();
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
