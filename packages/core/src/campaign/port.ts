/**
 * Port de campagne multi-agents vu par un agent (ADR 0054, lot 2). Asynchrone : le lot 3 le
 * branche par IPC sur le coordinateur de l'hôte. Les refus remontent en `CodedError` / `reason()`.
 * Distinct de `CampaignPort` (plan de campagne d'engagement, ADR 0041).
 */
import { CodedError } from "../reason.js";
import type { CampaignCoordinator } from "./coordinator.js";
import type { CampaignRunStatus, Intent, IntentClosure, IntentDraft } from "./types.js";

export type CampaignAgentRole = "planner" | "worker";

export interface AgentCampaignPort {
  /** Planificateur : ouvre 1 à 4 intentions ; renvoie celles qui ont été créées. */
  openIntents(drafts: readonly IntentDraft[]): Promise<readonly Intent[]>;
  /** Instantané de la campagne. */
  status(): Promise<CampaignRunStatus>;
  /** Worker : ferme l'intention qui lui est attribuée avec un verdict. */
  closeIntent(closure: IntentClosure): Promise<Intent>;
}

/** Rôle d'un run dans la campagne ; `RunContext.multiAgent`. Absent : aucun outil de campagne. */
export type CampaignRunRole =
  | { role: "planner"; port: AgentCampaignPort }
  | {
      role: "worker";
      port: AgentCampaignPort;
      intent: { id: string; title: string; rationale: string; target?: string };
    };

export interface LocalCampaignPortOptions {
  role: CampaignAgentRole;
  /** Run du worker (obligatoire pour `worker`) : seule son intention attribuée peut être fermée. */
  workerRunId?: string;
  /** Tour du planificateur ; défaut : un nouveau tour à chaque ouverture. */
  round?: () => number;
}

/** Adaptateur direct sur le coordinateur (tests, CLI) : même contrat, sans IPC. */
export function createLocalCampaignPort(
  coordinator: CampaignCoordinator,
  options: LocalCampaignPortOptions,
): AgentCampaignPort {
  const { role, workerRunId } = options;
  if (role === "worker" && (typeof workerRunId !== "string" || workerRunId === ""))
    throw new CodedError("campaign.invalidInput", { field: "workerRunId" });
  let round = 0;
  return {
    async openIntents(drafts) {
      if (role !== "planner") throw new CodedError("campaign.invalidInput", { field: "role" });
      const current = options.round ? options.round() : ++round;
      return coordinator.openIntents(current, drafts);
    },
    async status() {
      return coordinator.status();
    },
    async closeIntent(closure) {
      if (role !== "worker" || workerRunId === undefined)
        throw new CodedError("campaign.invalidInput", { field: "role" });
      const claimed = coordinator
        .status()
        .intents.find((i) => i.state === "claimed" && i.workerRunId === workerRunId);
      if (!claimed) throw new CodedError("campaign.notClaimant", { intentId: "" });
      return coordinator.close(claimed.id, workerRunId, closure);
    },
  };
}
