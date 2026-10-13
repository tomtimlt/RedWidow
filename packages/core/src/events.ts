/**
 * Modèle d'événements du moteur. Tout ce que le moteur produit passe par ici :
 * les UI (CLI, export HTML, extension VS Code) ne consomment que ces objets.
 */

export type Decision = "allow" | "deny";

export type EventPayload =
  | { kind: "run.started"; prompt: string; cwd: string }
  | { kind: "agent.text"; text: string }
  | { kind: "tool.requested"; toolUseId: string; tool: string; input: Record<string, unknown> }
  | {
      kind: "approval.decided";
      toolUseId: string;
      decision: Decision;
      source: "policy" | "user";
      reason: string;
    }
  | { kind: "tool.result"; toolUseId: string; isError: boolean; summary: string }
  | { kind: "process.started"; argv: string[]; pid: number | null }
  | { kind: "process.output"; stream: "stdout" | "stderr"; line: string }
  | {
      kind: "process.exited";
      code: number | null;
      signal: string | null;
      durationMs: number;
    }
  | {
      kind: "run.finished";
      status: "success" | "error";
      turns: number;
      costUsd: number;
      result: string | null;
    }
  | { kind: "error"; message: string };

export type EventKind = EventPayload["kind"];

export interface EventMeta {
  /** Identifiant unique, stable dans le journal. */
  id: string;
  /** Rang monotone dans le run (0, 1, 2…). */
  seq: number;
  /** ISO-8601. */
  ts: string;
  runId: string;
  /** Événement causal parent (sert à construire le graphe). */
  parentId: string | null;
}

export type EngineEvent = EventMeta & EventPayload;

export type EventOf<K extends EventKind> = Extract<EngineEvent, { kind: K }>;

export const EVENT_KINDS: readonly EventKind[] = [
  "run.started",
  "agent.text",
  "tool.requested",
  "approval.decided",
  "tool.result",
  "process.started",
  "process.output",
  "process.exited",
  "run.finished",
  "error",
];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}
