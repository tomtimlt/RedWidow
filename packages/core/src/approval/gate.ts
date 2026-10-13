import type { Decision } from "../events.js";
import { errorInfo, type Reason, reason } from "../reason.js";
import type { Recorder } from "../recorder.js";
import {
  BASH_TOOL,
  evaluatePolicy,
  type Policy,
  type PolicyContext,
  type PolicyRule,
  type PolicyVerdict,
} from "./policy.js";
import { parseShell } from "./shell.js";

export interface ApprovalRequest {
  toolUseId: string;
  tool: string;
  input: Record<string, unknown>;
}

/** Portée d'une autorisation : `once` (défaut), `session` (cette gate) ou `always` (politique utilisateur). */
export type RememberScope = "once" | "session" | "always";

export interface ApprovalAnswer {
  decision: Decision;
  /** Motif de la réponse ; absent → celui du verdict de la politique. */
  reason?: Reason;
  /**
   * Durée de validité d'une autorisation (ignorée pour un refus). Une règle
   * mémorisée ne s'applique jamais à un `deny` de la politique ni aux
   * garde-fous (chemin sensible ou hors espace de travail, accès à l'hôte
   * d'un conteneur, danger shell) : ces cas redemandent toujours.
   */
  remember?: RememberScope;
}

/**
 * Fourni par l'UI pour trancher les cas « ask ». Le moteur ne sait pas
 * comment l'utilisateur est sollicité (prompt terminal, boîte VS Code…).
 */
export type Asker = (
  request: ApprovalRequest,
  verdict: PolicyVerdict,
  signal: AbortSignal,
) => Promise<ApprovalAnswer>;

export interface ApprovalOutcome {
  decision: Decision;
  reason: Reason;
  source: "policy" | "user";
}

export interface ApprovalGate {
  decide(
    request: ApprovalRequest,
    signal: AbortSignal,
    parentId?: string | null,
  ): Promise<ApprovalOutcome>;
}

export interface ApprovalGateOptions {
  policy: Policy;
  recorder: Recorder;
  /** Absent → les cas « ask » sont refusés (mode non interactif). */
  ask?: Asker;
  /** Espace de travail pour les garde-fous de chemin (défaut : `process.cwd()`). */
  workspace?: PolicyContext;
  /** Délai de réponse de l'Asker (ms) ; au-delà, refus `approval.timeout`. Absent → pas de délai. */
  timeoutMs?: number;
  /**
   * Persiste une règle « toujours autoriser » (réponse `remember: "always"`).
   * La gate la retient aussi pour la session, même si la persistance échoue.
   */
  persistRule?: (rule: PolicyRule) => void | Promise<void>;
}

/**
 * Motifs de verdict « ask » dont une autorisation mémorisée peut tenir lieu de
 * réponse : une règle `ask` explicite ou l'absence de règle. Tout le reste
 * (garde-fous de chemin, accès hôte, dangers du shell, commande illisible…)
 * redemande à chaque fois.
 */
const REMEMBERABLE = new Set([
  "policy.rule",
  "policy.rule.custom",
  "policy.default",
  "bash.noRule",
]);

/**
 * Motifs pour lesquels une règle `allow` persistée aurait un effet : une règle
 * `ask` explicite l'emporterait sur elle (`deny` > `ask` > `allow`), inutile de l'écrire.
 */
const PERSISTABLE = new Set(["policy.default", "bash.noRule"]);

/** Clé d'autorisation de session : le même outil et, pour Bash, la même commande exacte ; `null` si non mémorisable. */
function sessionKey(request: ApprovalRequest, verdict: PolicyVerdict): string | null {
  if (verdict.decision !== "ask" || !REMEMBERABLE.has(verdict.reason.code)) return null;
  if (request.tool !== BASH_TOOL) return JSON.stringify([request.tool]);
  const command = request.input.command;
  if (typeof command !== "string" || command.trim() === "") return null;
  return JSON.stringify([BASH_TOOL, command.trim()]);
}

/**
 * Règle `allow` à persister pour une requête, ou `null`. Pour Bash : la commande
 * exacte, seulement si elle tient en un segment sans joker ni espace dans ses
 * arguments (un motif de politique est découpé sur les espaces et `*` est un joker).
 */
function persistableRule(request: ApprovalRequest, verdict: PolicyVerdict): PolicyRule | null {
  if (sessionKey(request, verdict) === null || !PERSISTABLE.has(verdict.reason.code)) return null;
  if (request.tool !== BASH_TOOL) return { tool: request.tool, decision: "allow" };
  const parsed = parseShell(String(request.input.command));
  if (!parsed.ok || parsed.value.hazards.size > 0 || parsed.value.segments.length !== 1)
    return null;
  const argv = parsed.value.segments[0] ?? [];
  if (argv.length === 0 || argv.some((a) => a === "" || /[\s*]/.test(a))) return null;
  return { tool: BASH_TOOL, command: argv.join(" "), decision: "allow" };
}

class AskTimeout extends Error {}

export function createApprovalGate({
  policy,
  recorder,
  ask,
  workspace,
  timeoutMs,
  persistRule,
}: ApprovalGateOptions): ApprovalGate {
  /** Autorisations de session. Consultées seulement face à un verdict « ask » mémorisable. */
  const session = new Set<string>();

  /** Sollicite l'Asker avec un éventuel délai ; le signal transmis s'annule aussi à l'échéance. */
  const askWithTimeout = async (
    asker: Asker,
    request: ApprovalRequest,
    verdict: PolicyVerdict,
    signal: AbortSignal,
  ): Promise<ApprovalAnswer> => {
    if (timeoutMs === undefined) return asker(request, verdict, signal);
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    if (signal.aborted) forward();
    signal.addEventListener("abort", forward, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new AskTimeout();
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const answered = asker(request, verdict, controller.signal);
    answered.catch(() => undefined); // réponse tardive ou rejet après l'échéance : ignoré
    try {
      return await Promise.race([answered, expired]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  };

  const remember = async (
    scope: RememberScope | undefined,
    request: ApprovalRequest,
    verdict: PolicyVerdict,
  ) => {
    if (scope !== "session" && scope !== "always") return;
    const key = sessionKey(request, verdict);
    if (key === null) return;
    session.add(key);
    const rule = persistableRule(request, verdict);
    if (scope === "always" && persistRule && rule !== null) {
      try {
        await persistRule(rule);
      } catch (err) {
        recorder.emit({ kind: "error", ...errorInfo(err) });
      }
    }
  };

  return {
    async decide(request, signal, parentId = null) {
      const verdict = evaluatePolicy(policy, request.tool, request.input, workspace);
      let outcome: ApprovalOutcome;

      if (verdict.decision !== "ask") {
        outcome = { decision: verdict.decision, reason: verdict.reason, source: "policy" };
      } else if (!ask) {
        outcome = {
          decision: "deny",
          reason: reason("approval.noAsker", undefined, verdict.reason),
          source: "policy",
        };
      } else {
        const key = sessionKey(request, verdict);
        if (key !== null && session.has(key)) {
          outcome = {
            decision: "allow",
            reason: reason("approval.remembered", undefined, verdict.reason),
            source: "user",
          };
        } else {
          recorder.emit(
            {
              kind: "approval.requested",
              toolUseId: request.toolUseId,
              tool: request.tool,
              input: request.input,
              verdict: verdict.reason,
            },
            parentId,
          );
          try {
            const answer = await askWithTimeout(ask, request, verdict, signal);
            outcome = {
              decision: answer.decision,
              reason: answer.reason ?? verdict.reason,
              source: "user",
            };
            if (answer.decision === "allow") await remember(answer.remember, request, verdict);
          } catch (err) {
            outcome = {
              decision: "deny",
              reason:
                err instanceof AskTimeout
                  ? reason(
                      "approval.timeout",
                      { seconds: Number(((timeoutMs ?? 0) / 1000).toFixed(3)) },
                      verdict.reason,
                    )
                  : reason("approval.interrupted", undefined, errorInfo(err)),
              source: "user",
            };
          }
        }
      }

      recorder.emit(
        {
          kind: "approval.decided",
          toolUseId: request.toolUseId,
          decision: outcome.decision,
          source: outcome.source,
          reason: outcome.reason,
        },
        parentId,
      );
      return outcome;
    },
  };
}

// ---------------------------------------------------------------------------
// File d'approbations pour une UI sans terminal
// ---------------------------------------------------------------------------

/** Demande en attente de réponse : la requête et le verdict qui a motivé la question. */
export interface PendingApproval extends ApprovalRequest {
  verdict: PolicyVerdict;
}

/**
 * Approbateur à file d'attente : s'utilise comme `Asker`, et expose les demandes
 * à une UI (ex. extension VS Code) qui répond quand elle veut.
 */
export interface ApprovalQueue extends Asker {
  /** Demandes en attente, de la plus ancienne à la plus récente. */
  pending(): PendingApproval[];
  /** Répond à une demande ; `false` si elle n'existe plus (déjà traitée ou annulée). */
  answer(toolUseId: string, answer: ApprovalAnswer): boolean;
  /**
   * Flux des demandes : d'abord celles déjà en attente, puis les nouvelles.
   * Se termine sur `close()` ou sur `abort` du signal.
   */
  requests(signal?: AbortSignal): AsyncIterable<PendingApproval>;
  /** Refuse toutes les demandes en attente (interrompues) et termine les flux. */
  close(): void;
}

export function createApprovalQueue(): ApprovalQueue {
  interface Entry {
    pending: PendingApproval;
    resolve: (answer: ApprovalAnswer) => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  }
  const entries = new Map<string, Entry>();
  const listeners = new Set<(p: PendingApproval) => void>();
  const closers = new Set<() => void>();
  let closed = false;

  const ask: Asker = (request, verdict, signal) =>
    new Promise<ApprovalAnswer>((resolve, reject) => {
      if (closed) return reject(new Error("file d'approbation fermée"));
      if (signal.aborted) return reject(signal.reason ?? new Error("annulé"));
      // Un même toolUseId ne peut avoir deux demandes ouvertes : l'ancienne est interrompue.
      entries.get(request.toolUseId)?.reject(new Error("remplacée par une nouvelle demande"));
      const onAbort = () => {
        entries.delete(request.toolUseId);
        reject(signal.reason ?? new Error("annulé"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const pending: PendingApproval = { ...request, verdict };
      const entry: Entry = {
        pending,
        resolve,
        reject: (error) => {
          entry.cleanup();
          reject(error);
        },
        cleanup: () => {
          signal.removeEventListener("abort", onAbort);
          if (entries.get(request.toolUseId) === entry) entries.delete(request.toolUseId);
        },
      };
      entries.set(request.toolUseId, entry);
      for (const listener of [...listeners]) listener(pending);
    });

  return Object.assign(ask, {
    pending: () => [...entries.values()].map((e) => e.pending),
    answer(toolUseId: string, answer: ApprovalAnswer) {
      const entry = entries.get(toolUseId);
      if (!entry) return false;
      entry.cleanup();
      entry.resolve(answer);
      return true;
    },
    requests(signal?: AbortSignal): AsyncIterable<PendingApproval> {
      const buffer: PendingApproval[] = [...entries.values()].map((e) => e.pending);
      let ended = closed || signal?.aborted === true;
      let wake: (() => void) | null = null;
      const listener = (p: PendingApproval) => {
        buffer.push(p);
        wake?.();
      };
      const end = () => {
        ended = true;
        listeners.delete(listener);
        closers.delete(end);
        signal?.removeEventListener("abort", end);
        wake?.();
      };
      if (!ended) {
        listeners.add(listener);
        closers.add(end);
        signal?.addEventListener("abort", end, { once: true });
      }
      return {
        [Symbol.asyncIterator]: () => ({
          async next(): Promise<IteratorResult<PendingApproval>> {
            while (buffer.length === 0 && !ended) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = null;
            }
            const next = buffer.shift();
            return next === undefined
              ? { done: true, value: undefined }
              : { done: false, value: next };
          },
          async return(): Promise<IteratorResult<PendingApproval>> {
            end();
            buffer.length = 0;
            return { done: true, value: undefined };
          },
        }),
      };
    },
    close() {
      closed = true;
      for (const entry of [...entries.values()])
        entry.reject(new Error("file d'approbation fermée"));
      for (const end of [...closers]) end();
    },
  }) satisfies ApprovalQueue;
}
