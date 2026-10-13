import type { ApprovalGate } from "./approval/gate.js";
import type { Recorder } from "./recorder.js";

/** Entrée d'un run. `cwd` est obligatoire : le cœur ne devine jamais le répertoire de travail. */
export interface RunInput {
  prompt: string;
  cwd: string;
  model?: string;
  maxTurns?: number;
}

/** Services fournis par l'appelant : journal d'événements, approbation, annulation. */
export interface RunContext {
  recorder: Recorder;
  gate: ApprovalGate;
  signal?: AbortSignal;
}

export interface RunSummary {
  status: "success" | "error";
  turns: number;
  costUsd: number;
  result: string | null;
}

/**
 * Contrat d'un moteur d'agent. Le cœur ne connaît aucun SDK : un adaptateur
 * (ex. `@john-studio/agent-sdk`) l'implémente et traduit son flux en événements.
 */
export interface AgentRunner {
  run(input: RunInput, ctx: RunContext): Promise<RunSummary>;
}
