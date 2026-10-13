import type { EventGraph, EventKind, GraphNode } from "@john-studio/core";
import { eventLabel, type Locale } from "@john-studio/messages";

export interface RenderOptions {
  title?: string;
  /** Langue des libellés (défaut : français). */
  locale?: Locale;
}

const ROW = 44;
const COL = 220;
const NODE_W = 200;
const NODE_H = 30;
const PAD = 20;

export const KIND_CLASS: Record<EventKind, string> = {
  "run.started": "k-run",
  "run.finished": "k-run",
  "agent.text": "k-agent",
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
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Libellé court d'un nœud, calculé à l'affichage depuis son événement source. */
const labelOf = (node: GraphNode, locale: Locale | undefined) =>
  eventLabel(node.event, { maxLength: 80, ...(locale && { locale }) });

function tooltip(node: GraphNode, locale: Locale | undefined): string {
  const lines = [`#${node.seq} ${node.kind}`, node.ts, labelOf(node, locale)];
  if (node.output) {
    lines.push(`stdout ${node.output.stdout} · stderr ${node.output.stderr}`, ...node.output.tail);
  }
  return lines.join("\n");
}

/**
 * Rendu HTML autonome (aucune ressource externe) : une ligne par événement
 * dans l'ordre `seq`, une colonne par profondeur causale, arêtes parent→enfant.
 */
export function renderGraphHtml(graph: EventGraph, options: RenderOptions = {}): string {
  const title = options.title ?? `john-studio · ${graph.runId ?? "run"}`;
  const runNote =
    graph.runs.length > 1
      ? `<p class="runs">run ${graph.runs.indexOf(graph.runId ?? "") + 1} sur ${graph.runs.length} : ${graph.runs.map((r) => (r === graph.runId ? `<b>${escapeHtml(r)}</b>` : escapeHtml(r))).join(" · ")}</p>\n`
      : "";
  const nodes = [...graph.nodes].sort((a, b) => a.seq - b.seq);
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, row) => {
    pos.set(n.id, { x: PAD + n.depth * COL, y: PAD + row * ROW });
  });
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const width = PAD * 2 + maxDepth * COL + NODE_W;
  const height = PAD * 2 + Math.max(nodes.length - 1, 0) * ROW + NODE_H;

  const edges = graph.edges
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
      const label = labelOf(n, options.locale);
      const text = n.output ? `${label} [${n.output.stdout + n.output.stderr} l.]` : label;
      return (
        `<g class="${cls}" transform="translate(${p.x},${p.y})">` +
        `<title>${escapeHtml(tooltip(n, options.locale))}</title>` +
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
.runs{margin:0 0 12px;color:var(--muted);font-size:12px}
.s-error rect,.s-denied rect{stroke:var(--error);stroke-width:2.5}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${runNote}<div class="wrap">
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><clipPath id="c"><rect width="${NODE_W - 8}" height="${NODE_H}"/></clipPath></defs>
${edges}${boxes}
</svg>
</div>
</body>
</html>
`;
}
