import type { EngineEvent, EventKind } from "../events.js";

export interface GraphNode {
  id: string;
  kind: EventKind;
  seq: number;
  ts: string;
  /** Libellé court, texte brut (l'échappement est à la charge du rendu). */
  label: string;
  /** Profondeur dans l'arbre causal (0 = racine). */
  depth: number;
  /** Pour process.started : lignes de sortie agrégées. */
  output?: { stdout: number; stderr: number; tail: string[] };
  status?: "ok" | "error" | "denied";
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface EventGraph {
  runId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const TAIL = 5;
const MAX_LABEL = 80;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

function labelOf(e: EngineEvent): string {
  switch (e.kind) {
    case "run.started":
      return clip(`run : ${e.prompt}`);
    case "agent.text":
      return clip(e.text);
    case "tool.requested": {
      const detail =
        typeof e.input.command === "string"
          ? e.input.command
          : Object.keys(e.input).length > 0
            ? JSON.stringify(e.input)
            : "";
      return clip(`${e.tool} ${detail}`);
    }
    case "approval.decided":
      return clip(`${e.decision} (${e.source}) : ${e.reason}`);
    case "tool.result":
      return clip(e.summary);
    case "process.started":
      return clip(e.argv.join(" "));
    case "process.output":
      return clip(e.line);
    case "process.exited":
      return `exit ${e.code ?? e.signal} · ${e.durationMs} ms`;
    case "run.finished":
      return `${e.status} · ${e.turns} tours · $${e.costUsd.toFixed(4)}`;
    case "error":
      return clip(e.message);
  }
}

function statusOf(e: EngineEvent): GraphNode["status"] {
  switch (e.kind) {
    case "approval.decided":
      return e.decision === "deny" ? "denied" : "ok";
    case "tool.result":
      return e.isError ? "error" : "ok";
    case "process.exited":
      return e.code === 0 ? "ok" : "error";
    case "run.finished":
      return e.status === "success" ? "ok" : "error";
    case "error":
      return "error";
    default:
      return undefined;
  }
}

/**
 * Construit le graphe causal d'un run à partir des `parentId`. Les lignes
 * `process.output` sont agrégées sur leur `process.started` pour garder un
 * graphe lisible. Un parent absent du journal fait de l'événement une racine.
 */
export function buildGraph(events: readonly EngineEvent[]): EventGraph {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const e of sorted) {
    if (e.kind === "process.output") {
      const host = e.parentId ? nodes.get(e.parentId) : undefined;
      if (host?.output) {
        host.output[e.stream]++;
        host.output.tail.push(e.line);
        if (host.output.tail.length > TAIL) host.output.tail.shift();
        continue;
      }
    }
    const parent = e.parentId ? nodes.get(e.parentId) : undefined;
    const status = statusOf(e);
    const node: GraphNode = {
      id: e.id,
      kind: e.kind,
      seq: e.seq,
      ts: e.ts,
      label: labelOf(e),
      depth: parent ? parent.depth + 1 : 0,
      ...(status && { status }),
      ...(e.kind === "process.started" && { output: { stdout: 0, stderr: 0, tail: [] } }),
    };
    nodes.set(e.id, node);
    if (parent) edges.push({ from: parent.id, to: e.id });
  }

  return { runId: sorted[0]?.runId ?? null, nodes: [...nodes.values()], edges };
}
