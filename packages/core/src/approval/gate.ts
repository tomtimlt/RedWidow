import type { Decision } from "../events.js";
import { errorInfo, type Reason, reason } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { evaluatePolicy, type Policy, type PolicyContext, type PolicyVerdict } from "./policy.js";

export interface ApprovalRequest {
  toolUseId: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface ApprovalAnswer {
  decision: Decision;
  /** Motif de la réponse ; absent → celui du verdict de la politique. */
  reason?: Reason;
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
}

export function createApprovalGate({
  policy,
  recorder,
  ask,
  workspace,
}: ApprovalGateOptions): ApprovalGate {
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
        try {
          const answer = await ask(request, verdict, signal);
          outcome = {
            decision: answer.decision,
            reason: answer.reason ?? verdict.reason,
            source: "user",
          };
        } catch (err) {
          outcome = {
            decision: "deny",
            reason: reason("approval.interrupted", undefined, errorInfo(err)),
            source: "user",
          };
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
