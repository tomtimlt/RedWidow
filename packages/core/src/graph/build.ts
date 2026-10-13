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
  /** Run représenté par ce graphe (`null` si aucun événement). */
  runId: string | null;
  /** Tous les runs présents dans les événements, dans l'ordre d'apparition. */
  runs: string[];
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
      return clip(e.output);
    case "process.started":
      return clip(e.argv.join(" "));
    case "process.output":
      return clip(e.line);
    case "process.exited":
      return `exit ${e.code ?? e.signal} · ${e.durationMs} ms`;
    case "run.finished":
      return `${e.status} · ${e.turns} tours · $${e.costUsd.toFixed(4)}`;
    case "error":
    case "sink.error":
      return clip(e.message);
    case "session.started":
      return clip(`session ${e.model} · ${e.tools.length} outils`);
    case "agent.thinking":
      return e.redacted ? "réflexion (masquée)" : clip(`réflexion : ${e.text}`);
    case "permission.denied":
      return clip(`refusé par le SDK : ${e.tool} · ${e.message}`);
    case "api.retry":
      return `nouvel essai ${e.attempt}/${e.maxRetries} · ${e.error}`;
    case "task.updated":
      return clip(`tâche ${e.phase} : ${e.description ?? e.summary ?? e.taskId}`);
    case "rate.limited":
      return clip(`limite d'usage : ${e.status}`);
    case "journal.truncated":
      return `journal tronqué · ${e.droppedEvents} événements perdus`;
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
    case "sink.error":
      return "error";
    case "permission.denied":
      return "denied";
    default:
      return undefined;
  }
}

/**
 * Sépare les événements par run, en conservant l'ordre d'apparition des runs
 * et, dans chaque run, l'ordre `seq`.
 */
export function splitRuns(events: readonly EngineEvent[]): Map<string, EngineEvent[]> {
  const runs = new Map<string, EngineEvent[]>();
  for (const e of events) {
    const list = runs.get(e.runId);
    if (list) list.push(e);
    else runs.set(e.runId, [e]);
  }
  for (const list of runs.values()) list.sort((a, b) => a.seq - b.seq);
  return runs;
}

export interface BuildGraphOptions {
  /** Run à représenter. Défaut : le dernier run apparu dans `events`. */
  runId?: string;
}

/**
 * Construit le graphe causal d'UN run à partir des `parentId`. S'il y a
 * plusieurs runs et aucun `runId`, le dernier (ordre d'apparition) est retenu ;
 * `graph.runs` liste tous les runs. Les lignes `process.output` sont agrégées
 * sur leur `process.started` pour garder un graphe lisible. Un parent absent
 * du journal fait de l'événement une racine.
 */
export function buildGraph(
  events: readonly EngineEvent[],
  options: BuildGraphOptions = {},
): EventGraph {
  const byRun = splitRuns(events);
  const runs = [...byRun.keys()];
  const runId = options.runId ?? runs.at(-1) ?? null;
  const sorted = (runId === null ? undefined : byRun.get(runId)) ?? [];
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

  return { runId: sorted.length > 0 ? runId : null, runs, nodes: [...nodes.values()], edges };
}
