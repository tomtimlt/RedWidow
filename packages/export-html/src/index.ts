import {
  type EventGraph,
  type EventKind,
  type GraphEdge,
  type GraphNode,
  stripControl,
} from "@warband/core";
import { eventLabel, type Locale } from "@warband/messages";

export interface RenderOptions {
  title?: string;
  /** Langue des libellés (défaut : français). */
  locale?: Locale;
  /** Nombre maximal de nœuds dessinés (défaut : `MAX_RENDERED_NODES`). */
  maxNodes?: number;
}

/** Plafond d'affichage : au-delà, les nœuds suivants (ordre `seq`) sont masqués. */
export const MAX_RENDERED_NODES = 5000;
/** Longueur maximale du libellé complet en infobulle (borne la taille du HTML). */
const TOOLTIP_MAX = 4000;

const ROW = 44;
const COL = 220;
const NODE_W = 200;
const NODE_H = 30;
const PAD = 20;

export const KIND_CLASS: Record<EventKind, string> = {
  "run.started": "k-run",
  "run.finished": "k-run",
  "agent.text": "k-agent",
  "user.message": "k-agent",
  "tool.requested": "k-tool",
  "tool.result": "k-tool",
  "approval.decided": "k-approval",
  "process.started": "k-process",
  "process.output": "k-process",
  "process.exited": "k-process",
  error: "k-error",
  "session.started": "k-run",
  "agent.thinking": "k-agent",
  "permission.denied": "k-approval",
  "api.retry": "k-warn",
  "task.updated": "k-tool",
  "rate.limited": "k-warn",
  "sink.error": "k-error",
  "journal.truncated": "k-error",
  "approval.requested": "k-approval",
  "bypass.changed": "k-approval",
  "turn.finished": "k-run",
  "auth.info": "k-run",
  "auth.status": "k-warn",
  "sandbox.started": "k-process",
  "sandbox.stopped": "k-process",
};

export function escapeHtml(text: string): string {
  // Journal non fiable : contrôles et marques bidi retirés avant l'échappement.
  return stripControl(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Libellé court d'un nœud, calculé à l'affichage depuis son événement source. */
const labelOf = (node: GraphNode, locale: Locale | undefined) =>
  eventLabel(node.event, { maxLength: 80, ...(locale && { locale }) });

const linesOf = (n: number, locale?: Locale) =>
  `${n} ${locale === "en" ? (n > 1 ? "lines" : "line") : n > 1 ? "lignes" : "ligne"}`;

function tooltip(node: GraphNode, locale: Locale | undefined, grouped: boolean): string {
  const lines = [`#${node.seq} ${node.kind}`, node.ts];
  if (!grouped) {
    lines.push(eventLabel(node.event, { maxLength: TOOLTIP_MAX, ...(locale && { locale }) }));
  }
  if (node.output) {
    const { stdout, stderr } = node.output;
    lines.push(
      `${linesOf(stdout + stderr, locale)} (stdout ${stdout} · stderr ${stderr})`,
      ...node.output.tail,
    );
  }
  return lines.join("\n");
}

const TAIL = 5;

/**
 * Regroupe par parent les `process.output` restés des nœuds dans le graphe
 * (parent absent ou autre qu'un `process.started`) : un seul nœud « N lignes »
 * par parent, à la position du premier. Retourne les nœuds, les arêtes
 * réécrites vers le nœud groupé et l'ensemble des ids de nœuds groupés.
 */
function groupOrphanOutputs(graph: EventGraph): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  grouped: Set<string>;
} {
  const nodes = [...graph.nodes].sort((a, b) => a.seq - b.seq);
  const rep = new Map<string, string>(); // id supprimé -> id du nœud groupé
  const groups = new Map<string, GraphNode>(); // clé parent -> nœud groupé
  const grouped = new Set<string>();
  const kept: GraphNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "process.output" || n.event.kind !== "process.output") {
      kept.push(n);
      continue;
    }
    const key = n.event.parentId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { ...n, output: { stdout: 0, stderr: 0, tail: [] } };
      groups.set(key, g);
      grouped.add(g.id);
      kept.push(g);
    }
    const out = g.output as NonNullable<GraphNode["output"]>;
    out[n.event.stream]++;
    out.tail.push(n.event.line);
    if (out.tail.length > TAIL) out.tail.shift();
    rep.set(n.id, g.id);
  }
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of graph.edges) {
    const from = rep.get(e.from) ?? e.from;
    const to = rep.get(e.to) ?? e.to;
    const k = `${from}\u0000${to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ from, to });
  }
  return { nodes: kept, edges, grouped };
}

/**
 * Rendu HTML autonome (aucune ressource externe) : une ligne par événement
 * dans l'ordre `seq`, une colonne par profondeur causale, arêtes parent→enfant.
 */
export function renderGraphHtml(graph: EventGraph, options: RenderOptions = {}): string {
  const title = options.title ?? `Venator Ops · ${graph.runId ?? "run"}`;
  const runNote =
    graph.runs.length > 1
      ? `<p class="runs">run ${graph.runs.indexOf(graph.runId ?? "") + 1} ${options.locale === "en" ? "of" : "sur"} ${graph.runs.length} : ${graph.runs.map((r) => (r === graph.runId ? `<b>${escapeHtml(r)}</b>` : escapeHtml(r))).join(" · ")}</p>\n`
      : "";
  const all = groupOrphanOutputs(graph);
  const maxNodes = Math.max(0, options.maxNodes ?? MAX_RENDERED_NODES);
  const nodes = all.nodes.slice(0, maxNodes);
  // Événements masqués : un nœud en vaut 1, plus ses lignes de sortie agrégées.
  const hidden = all.nodes.slice(maxNodes).reduce((sum, n) => {
    const lines = n.output ? n.output.stdout + n.output.stderr : 0;
    return sum + (all.grouped.has(n.id) ? lines : 1 + lines);
  }, 0);
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, row) => {
    pos.set(n.id, { x: PAD + n.depth * COL, y: PAD + row * ROW });
  });
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const width = PAD * 2 + maxDepth * COL + NODE_W;
  const moreY = PAD + nodes.length * ROW;
  const height = PAD * 2 + Math.max(nodes.length - 1, 0) * ROW + NODE_H + (hidden > 0 ? ROW : 0);
  const more =
    hidden > 0
      ? `<text class="more" x="${PAD}" y="${moreY + 14}">${escapeHtml(`${hidden} ${options.locale === "en" ? (hidden > 1 ? "events not displayed" : "event not displayed") : hidden > 1 ? "événements non affichés" : "événement non affiché"}`)}</text>`
      : "";

  const edges = all.edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + 12;
      const y1 = a.y + NODE_H;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      return `<path class="edge" d="M${x1},${y1} V${y2} H${x2}"/>`;
    })
    .join("");

  const boxes = nodes
    .map((n) => {
      const p = pos.get(n.id) as { x: number; y: number };
      const cls = ["node", KIND_CLASS[n.kind], n.status ? `s-${n.status}` : ""].join(" ").trim();
      const isGroup = all.grouped.has(n.id);
      const count = n.output ? n.output.stdout + n.output.stderr : 0;
      const text = isGroup
        ? linesOf(count, options.locale)
        : n.output
          ? `${linesOf(count, options.locale)} · ${labelOf(n, options.locale)}`
          : labelOf(n, options.locale);
      return (
        `<g class="${cls}" transform="translate(${p.x},${p.y})">` +
        `<title>${escapeHtml(tooltip(n, options.locale, isGroup))}</title>` +
        `<rect width="${NODE_W}" height="${NODE_H}" rx="6"/>` +
        `<text x="8" y="19" clip-path="url(#c)">${escapeHtml(text)}</text></g>`
      );
    })
    .join("");

  return `<!doctype html>
<html lang="${options.locale ?? "fr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fafafa;--fg:#1d1d1f;--muted:#8a8a8e;--edge:#c4c4c8;--run:#4b5563;--agent:#2563eb;--tool:#7c3aed;--approval:#0d9488;--process:#b45309;--error:#dc2626;--ok:#16a34a;--warn:#ca8a04}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#e8e8ea;--muted:#8a8a8e;--edge:#3a3a3f;--run:#9ca3af;--agent:#60a5fa;--tool:#a78bfa;--approval:#2dd4bf;--process:#f59e0b;--error:#f87171;--ok:#4ade80;--warn:#facc15}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
h1{font-size:15px;font-weight:600;margin:0 0 12px}
.wrap{overflow:auto}
.edge{fill:none;stroke:var(--edge);stroke-width:1.5}
.node rect{fill:var(--bg);stroke:var(--c,var(--muted));stroke-width:1.5}
.node text{fill:var(--fg);font-size:12px}
.k-run{--c:var(--run)}.k-agent{--c:var(--agent)}.k-tool{--c:var(--tool)}.k-approval{--c:var(--approval)}.k-process{--c:var(--process)}.k-error{--c:var(--error)}.k-warn{--c:var(--warn)}
.more{fill:var(--muted);font-size:12px;font-style:italic}
.runs{margin:0 0 12px;color:var(--muted);font-size:12px}
.s-error rect,.s-denied rect{stroke:var(--error);stroke-width:2.5}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${runNote}<div class="wrap">
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><clipPath id="c"><rect width="${NODE_W - 8}" height="${NODE_H}"/></clipPath></defs>
${edges}${boxes}${more}
</svg>
</div>
</body>
</html>
`;
}
