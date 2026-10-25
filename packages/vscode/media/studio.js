// Réglages : navigation en deux groupes, pages. DOM sûr (textContent, jamais de HTML injecté).
// La logique de navigation (navModel, killchainCount) est pure et testée par vitest (test/studio.test.ts).
// Hors webview (pas d'acquireVsCodeApi), seule la logique est exposée.

/**
 * Groupes de la navigation : clé, libellé et nom d’icône SVG de chaque page existante.
 * Miroir de STUDIO_PAGES et LABELS (src/logic/studio.ts), vérifié par test.
 */
const STUDIO_GROUPS = [
  {
    label: "Engagement",
    pages: [
      ["project", "Projet", "project"],
      ["containers", "Conteneurs", "container"],
      ["killchain", "Kill chain", "graph"],
    ],
  },
  {
    label: "Système",
    pages: [
      ["atlas", "Atlas", "book"],
      ["system", "Contrôle système", "server"],
    ],
  },
];

/**
 * Compteur de la page « Kill chain » : nombre réel de trouvailles. `null` (compteur omis) si la liste
 * est vide ou absente : aucun chiffre inventé.
 */
function killchainCount(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return findings.length;
}

/**
 * Modèle de la navigation : groupes, entrée courante, et `count` seulement sur « Kill chain » quand
 * il y a des trouvailles. Aucune pastille de statut, aucune entrée hors de STUDIO_GROUPS.
 */
function navModel(current, findings) {
  return STUDIO_GROUPS.map((group) => ({
    label: group.label,
    items: group.pages.map(([id, label, icon]) => {
      const item = { id, label, icon, current: id === current };
      if (id === "killchain") {
        const count = killchainCount(findings);
        if (count !== null) item.count = count;
      }
      return item;
    }),
  }));
}

/**
 * Tactiques ATT&CK dans l'ordre de la kill chain : [id, nom officiel]. Les noms restent en anglais
 * (noms propres). Les ids sont vérifiés par test contre MITRE_TACTICS du cœur.
 */
const MITRE_TACTICS = [
  ["TA0043", "Reconnaissance"],
  ["TA0042", "Resource Development"],
  ["TA0001", "Initial Access"],
  ["TA0002", "Execution"],
  ["TA0003", "Persistence"],
  ["TA0004", "Privilege Escalation"],
  ["TA0005", "Defense Evasion"],
  ["TA0006", "Credential Access"],
  ["TA0007", "Discovery"],
  ["TA0008", "Lateral Movement"],
  ["TA0009", "Collection"],
  ["TA0011", "Command and Control"],
  ["TA0010", "Exfiltration"],
  ["TA0040", "Impact"],
];

/**
 * Modèle du graphe de la kill chain : colonnes par tactique (ordre ATT&CK, seulement les présentes),
 * colonne finale « Non classé » (`tactic: null`) pour les trouvailles sans tactique connue, et arêtes
 * parent -> enfant quand les deux extrémités existent. Entrée non tableau : rien.
 */
function killchainModel(findings) {
  if (!Array.isArray(findings)) return { columns: [], edges: [] };
  const known = new Map(
    MITRE_TACTICS.map(([id, name]) => [id, { tactic: id, label: name, nodes: [] }]),
  );
  const unclassified = { tactic: null, label: "Non classé", nodes: [] };
  const ids = new Set();
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    ids.add(f.id);
    (known.get(f.tactic) ?? unclassified).nodes.push(f);
  }
  const columns = [...known.values()].filter((c) => c.nodes.length > 0);
  if (unclassified.nodes.length > 0) columns.push(unclassified);
  const edges = [];
  for (const f of findings) {
    if (!f || typeof f !== "object" || !Array.isArray(f.from)) continue;
    for (const parent of f.from) {
      if (ids.has(parent) && ids.has(f.id)) edges.push({ from: parent, to: f.id });
    }
  }
  return { columns, edges };
}

/** Dimensions d'un nœud et des espaces entre couches (repère du graphe, px). */
const KC = { nodeW: 190, nodeH: 118, gapX: 100, gapY: 36, diameter: 52 };

/**
 * Disposition du graphe de la kill chain (DAG en couches, de gauche à droite). Pure et testée.
 * - Couches par plus long chemin depuis une racine (Kahn + repli sur les cycles).
 * - Arêtes seulement si les deux extrémités existent ; les arcs arrière (cycle) sont gardés mais
 *   n'avancent pas la couche.
 * - Ordre dans chaque couche par barycentre des parents (deux passes) pour limiter les croisements.
 * Retour : `nodes` avec x/y/w/h, `edges` (ids validés), `width`/`height`. Entrée non tableau : vide.
 */
function killchainGraph(findings) {
  const empty = { nodes: [], edges: [], width: 0, height: 0 };
  if (!Array.isArray(findings)) return empty;
  const byId = new Map();
  const order = [];
  for (const f of findings) {
    if (!f || typeof f !== "object" || typeof f.id !== "string" || byId.has(f.id)) continue;
    byId.set(f.id, f);
    order.push(f.id);
  }
  if (order.length === 0) return empty;

  const children = new Map(order.map((id) => [id, []]));
  const parents = new Map(order.map((id) => [id, []]));
  const edges = [];
  const seen = new Set();
  for (const id of order) {
    const from = byId.get(id).from;
    if (!Array.isArray(from)) continue;
    for (const p of from) {
      if (!byId.has(p) || p === id) continue;
      const key = `${p}\u0000${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: p, to: id });
      children.get(p).push(id);
      parents.get(id).push(p);
    }
  }

  // Couches : Kahn par indegree ; le reste (cycles) traité en repli, couche = max(parent)+1.
  const indeg = new Map(order.map((id) => [id, parents.get(id).length]));
  const layer = new Map(order.map((id) => [id, 0]));
  const queue = order.filter((id) => indeg.get(id) === 0);
  const placed = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    placed.add(id);
    for (const c of children.get(id)) {
      if (layer.get(c) < layer.get(id) + 1) layer.set(c, layer.get(id) + 1);
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  for (const id of order) {
    if (placed.has(id)) continue;
    let max = -1;
    for (const p of parents.get(id)) if (placed.has(p) && layer.get(p) > max) max = layer.get(p);
    layer.set(id, max + 1);
    placed.add(id);
  }

  // Colonnes dans l'ordre d'insertion, puis barycentre des parents (deux passes) pour l'ordre vertical.
  const maxLayer = Math.max(...order.map((id) => layer.get(id)));
  const cols = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of order) cols[layer.get(id)].push(id);
  const rowOf = new Map();
  const reindex = () => {
    for (const col of cols)
      col.forEach((id, i) => {
        rowOf.set(id, i);
      });
  };
  reindex();
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      cols[l].sort((a, b) => bary(a, parents, rowOf) - bary(b, parents, rowOf));
      reindex();
    }
  }

  const rows = Math.max(...cols.map((c) => c.length), 1);
  const height = rows * KC.nodeH + (rows - 1) * KC.gapY;
  const nodes = [];
  cols.forEach((col, l) => {
    const colH = col.length * KC.nodeH + (col.length - 1) * KC.gapY;
    const top = (height - colH) / 2; // chaque colonne centrée verticalement
    col.forEach((id, i) => {
      const f = byId.get(id);
      nodes.push({
        id,
        kind: f.kind,
        state: f.state,
        label: f.label,
        meta: [f.kind, f.technique, f.tactic].filter(Boolean).join(" · "),
        x: l * (KC.nodeW + KC.gapX),
        y: top + i * (KC.nodeH + KC.gapY),
        w: KC.nodeW,
        h: KC.nodeH,
      });
    });
  });
  const width = (maxLayer + 1) * KC.nodeW + maxLayer * KC.gapX;
  return { nodes, edges, width, height };
}

/** Barycentre : moyenne des rangs des parents, sinon rang courant (stabilité). */
function bary(id, parents, rowOf) {
  const ps = parents.get(id);
  if (ps.length === 0) return rowOf.get(id);
  let sum = 0;
  for (const p of ps) sum += rowOf.get(p);
  return sum / ps.length;
}

/** Libellés fr des types de nœud (ordre du groupe « Type » du panneau légende). */
const KIND_LABEL = {
  host: "Hôte",
  site: "Site / URL",
  credential: "Identifiant",
  step: "Étape",
  loot: "Loot",
};
/** Ordre d'affichage des types dans le panneau légende. */
const LEGEND_KINDS = ["host", "credential", "site", "step", "loot"];
/** Libellés fr des états de trouvaille (ordre du groupe « État » du panneau légende). */
const STATE_LABEL = {
  confirmed: "Confirmé",
  hypothesis: "Hypothèse",
  failed: "Échec",
};
/** Ordre d'affichage des états dans le panneau légende. */
const LEGEND_STATES = ["confirmed", "hypothesis", "failed"];

/**
 * Modèle du panneau légende de la kill chain : deux groupes (Type, État), chacun avec un compteur
 * réel par entrée, calculé sur les trouvailles passées. Entrée non tableau : tous les compteurs à
 * zéro. `kind`/`state` inconnu dans une trouvaille : ignoré (ne compte dans aucune entrée).
 */
function killchainLegend(findings) {
  const kindCounts = new Map();
  const stateCounts = new Map();
  if (Array.isArray(findings)) {
    for (const f of findings) {
      if (!f || typeof f !== "object") continue;
      if (typeof f.kind === "string" && KIND_LABEL[f.kind] !== undefined) {
        kindCounts.set(f.kind, (kindCounts.get(f.kind) ?? 0) + 1);
      }
      if (typeof f.state === "string" && STATE_LABEL[f.state] !== undefined) {
        stateCounts.set(f.state, (stateCounts.get(f.state) ?? 0) + 1);
      }
    }
  }
  return [
    {
      label: "Type",
      entries: LEGEND_KINDS.map((kind) => ({
        kind,
        label: KIND_LABEL[kind],
        count: kindCounts.get(kind) ?? 0,
      })),
    },
    {
      label: "État",
      entries: LEGEND_STATES.map((state) => ({
        state,
        label: STATE_LABEL[state],
        count: stateCounts.get(state) ?? 0,
      })),
    },
  ];
}

/** Marge autour du graphe dans le canevas (px) et gabarit maximal de la minimap. */
const KC_PAD = 28;
const KC_MINIMAP = { maxW: 160, maxH: 100, minViewportW: 640 };

/**
 * Géométrie de la minimap du graphe (pure, testée). Entrées : `graph` (killchainGraph), `viewport`
 * ({ width, height } en px), `view` ({ scale, tx, ty } : transformation actuelle du canevas).
 * Retour : `visible` (false si viewport < 640 px de large, graphe vide, ou graphe entièrement à
 * l'écran), `width`/`height`/`ratio` de la minimap, `rects` (un par nœud, avec son état) et `zone`
 * (portion du canevas visible dans le viewport, bornée au canevas), le tout en px de minimap.
 */
function killchainMinimap(graph, viewport, view) {
  const hidden = { visible: false, width: 0, height: 0, ratio: 0, rects: [], zone: null };
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return hidden;
  const gw = graph.width + KC_PAD * 2;
  const gh = graph.height + KC_PAD * 2;
  const { scale, tx, ty } = view;
  if (!(scale > 0) || !(viewport.width > 0) || !(viewport.height > 0)) return hidden;
  // Zone visible en coordonnées du canevas.
  const vx = -tx / scale;
  const vy = -ty / scale;
  const vw = viewport.width / scale;
  const vh = viewport.height / scale;
  const fits = vx <= 0 && vy <= 0 && vx + vw >= gw && vy + vh >= gh;
  if (viewport.width < KC_MINIMAP.minViewportW || fits) return hidden;
  const ratio = Math.min(KC_MINIMAP.maxW / gw, KC_MINIMAP.maxH / gh);
  const x0 = Math.min(gw, Math.max(0, vx));
  const y0 = Math.min(gh, Math.max(0, vy));
  const x1 = Math.min(gw, vx + vw);
  const y1 = Math.min(gh, vy + vh);
  return {
    visible: true,
    width: gw * ratio,
    height: gh * ratio,
    ratio,
    rects: graph.nodes.map((n) => ({
      id: n.id,
      state: n.state,
      x: (n.x + KC_PAD) * ratio,
      y: (n.y + KC_PAD) * ratio,
      w: n.w * ratio,
      h: n.h * ratio,
    })),
    zone: {
      x: x0 * ratio,
      y: y0 * ratio,
      w: Math.max(0, x1 - x0) * ratio,
      h: Math.max(0, y1 - y0) * ratio,
    },
  };
}

/**
 * Recentrage par clic/glissement sur la minimap (pure, testée) : le point (px, py) de la minimap
 * (borné à ses dimensions) devient le centre du viewport. Retour : nouvelle translation { tx, ty }
 * du canevas, à l'échelle courante. Minimap invalide (ratio nul) : translation inchangée.
 */
function killchainMinimapRecenter(minimap, viewport, view, px, py) {
  if (!minimap || !(minimap.ratio > 0)) return { tx: view.tx, ty: view.ty };
  const cx = Math.min(minimap.width, Math.max(0, px)) / minimap.ratio;
  const cy = Math.min(minimap.height, Math.max(0, py)) / minimap.ratio;
  return {
    tx: viewport.width / 2 - cx * view.scale,
    ty: viewport.height / 2 - cy * view.scale,
  };
}

// Exposée pour les tests (même convention que ui.js : pas de module dans la webview).
globalThis.WarbandStudio = {
  STUDIO_GROUPS,
  MITRE_TACTICS,
  KC,
  KC_PAD,
  KC_MINIMAP,
  killchainMinimap,
  killchainMinimapRecenter,
  killchainCount,
  killchainModel,
  killchainGraph,
  killchainLegend,
  navModel,
};

if (typeof acquireVsCodeApi === "function") start();

function start() {
  const vscode = acquireVsCodeApi();
  const killchainOnly = document.body.classList.contains("killchain-full");
  const nav = killchainOnly ? null : document.getElementById("studio-nav");
  const main = document.getElementById("studio-main");

  // État de repli du panneau légende : variable de module, survit aux render() successifs.
  // `null` tant qu'il n'a pas été initialisé (calcul différé à la première ouverture du graphe).
  let legendCollapsed = null;
  let graphPose = null;
  let graphProject;
  let graphFingerprint = null;
  let graphCleanup = () => {};
  let graphStatus = null;
  const showGraphError = (message) => {
    if (graphStatus === null) {
      if (message === "" || main === null) return;
      graphStatus = el("p", "kc-live-status");
      graphStatus.setAttribute("role", "status");
      main.append(graphStatus);
    }
    graphStatus.textContent = message;
    graphStatus.hidden = message === "";
  };
  // Les rafraîchissements du panneau ne doivent pas écraser une saisie en cours.
  const summaryDrafts = new Map();
  const summarySaving = new Set();
  let projectNameDraft = "";
  let projectPanel = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const decorative = (node) => {
    node.setAttribute("aria-hidden", "true");
    return node;
  };

  function paintNav(current, findings, view) {
    if (!nav) return;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    nav.append(el("div", "studio-nav-title", "Réglages"));
    const active = view.projectChoices?.projects?.find(
      (project) => project.id === view.projectChoices.activeId,
    );
    const activeName = active?.name ?? view.projectSummary?.projectName;
    if (typeof activeName === "string") {
      const context = el("div", "studio-nav-project");
      context.append(
        el("span", "studio-kicker", "Projet actif"),
        el("strong", "studio-nav-project-name", activeName),
      );
      nav.append(context);
    }
    for (const group of navModel(current, findings)) {
      const section = el("div", "studio-group");
      section.append(el("p", "studio-group-title", group.label));
      for (const item of group.items) {
        const b = el(
          "button",
          item.current ? "ghost studio-nav-btn is-current" : "ghost studio-nav-btn",
        );
        b.type = "button";
        if (item.current) b.setAttribute("aria-current", "page");
        b.append(
          window.WarbandIcons.create(item.icon, { className: "ico" }),
          el("span", "btn-text", item.label),
        );
        if (item.count !== undefined) {
          const count = el("span", "studio-count", String(item.count));
          count.title = `${item.count} trouvaille${item.count > 1 ? "s" : ""}`;
          b.append(count);
        }
        b.addEventListener("click", () => vscode.postMessage({ type: "open", page: item.id }));
        section.append(b);
      }
      nav.append(section);
    }
  }

  function empty(title, text) {
    const sec = el("section", "studio-card");
    sec.append(el("h2", "", title), el("p", "studio-help", text));
    return sec;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  /**
   * Glyphes des types de n\u0153ud, en trac\u00E9s SVG (trait `currentColor`, pas de remplissage) : rep\u00E8re
   * [tag, attributs] par forme. Rendus par `kindIcon`, jamais de texte ou d'emoji.
   */
  const KIND_ICON_SHAPES = {
    host: [
      ["rect", { x: "2.5", y: "3.5", width: "11", height: "7", rx: "1" }],
      ["line", { x1: "5", y1: "12.5", x2: "11", y2: "12.5" }],
    ],
    site: [
      ["circle", { cx: "8", cy: "8", r: "5.5" }],
      ["path", { d: "M8 2.5C5.7 2.5 5.7 13.5 8 13.5C10.3 13.5 10.3 2.5 8 2.5Z" }],
      ["line", { x1: "2.5", y1: "8", x2: "13.5", y2: "8" }],
    ],
    credential: [
      ["circle", { cx: "5", cy: "8", r: "2.5" }],
      ["line", { x1: "7.4", y1: "8", x2: "13", y2: "8" }],
      ["line", { x1: "13", y1: "8", x2: "13", y2: "10.5" }],
      ["line", { x1: "10.6", y1: "8", x2: "10.6", y2: "10" }],
    ],
    step: [["path", { d: "M5 3L11 8L5 13" }]],
    loot: [
      ["line", { x1: "4", y1: "2.5", x2: "4", y2: "13.5" }],
      ["path", { d: "M4 3L12 5.5L4 8" }],
    ],
  };
  function kindIcon(kind) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "kc-ico-svg");
    for (const [tag, attrs] of KIND_ICON_SHAPES[kind] || []) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
      svg.append(shape);
    }
    return svg;
  }
  /** Glyphe du badge d'\u00E9tat, dans l'en-t\u00EAte du n\u0153ud (en plus de la bordure). */
  const STATE_BADGE = {
    confirmed: "\u2713",
    hypothesis: "?",
    failed: "\u2715",
  };

  /**
   * Vue graphe de la kill chain : nœuds typés, arêtes courbes, zoom/pan, bouton Ajuster, et le panneau
   * légende (repliable, à droite). `findings` alimente uniquement les compteurs du panneau.
   */
  function killchainGraphView(graph, findings) {
    const wrap = el("div", "studio-kc");

    const bar = el("div", "kc-bar");
    const fit = el("button", "ghost kc-btn");
    fit.type = "button";
    fit.append(el("span", "btn-text", "Ajuster"));
    const zoomOut = el("button", "ghost kc-btn kc-zoom");
    zoomOut.type = "button";
    zoomOut.title = "D\u00e9zoomer";
    zoomOut.append(decorative(el("span", "", "\u2212")));
    const zoomIn = el("button", "ghost kc-btn kc-zoom");
    zoomIn.type = "button";
    zoomIn.title = "Zoomer";
    zoomIn.append(decorative(el("span", "", "+")));
    bar.append(fit, zoomOut, zoomIn);

    const viewport = el("div", "kc-viewport");
    const canvas = el("div", "kc-canvas");
    const pad = KC_PAD;
    const svg = decorative(document.createElementNS(SVG_NS, "svg"));
    svg.setAttribute("class", "kc-edges");
    svg.setAttribute("width", String(graph.width + pad * 2));
    svg.setAttribute("height", String(graph.height + pad * 2));
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "kc-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const tip = document.createElementNS(SVG_NS, "path");
    tip.setAttribute("d", "M0 0 L10 5 L0 10 z");
    tip.setAttribute("class", "kc-tip");
    marker.append(tip);
    defs.append(marker);
    svg.append(defs);

    const pos = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const x1 = a.x + a.w / 2 + KC.diameter / 2 + pad;
      const y1 = a.y + KC.diameter / 2 + pad;
      const x2 = b.x + b.w / 2 - KC.diameter / 2 + pad;
      const y2 = b.y + KC.diameter / 2 + pad;
      const dx = Math.max(32, Math.abs(x2 - x1) / 2);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      path.setAttribute("class", "kc-edge");
      path.setAttribute("marker-end", "url(#kc-arrow)");
      svg.append(path);
    }
    canvas.append(svg);

    for (const n of graph.nodes) {
      const node = el("div", `kc-node is-${n.state} kind-${n.kind}`);
      node.style.setProperty("left", `${n.x + pad}px`);
      node.style.setProperty("top", `${n.y + pad}px`);
      node.style.setProperty("width", `${n.w}px`);
      const head = el("div", "kc-node-head");
      const ico = el("span", "kc-node-ico");
      ico.append(decorative(kindIcon(n.kind)));
      head.append(ico);
      const stateLabel = STATE_LABEL[n.state] || n.state;
      const badge = el("span", `kc-node-badge is-${n.state}`, STATE_BADGE[n.state] || "");
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", stateLabel);
      head.append(badge);
      node.append(head);
      node.append(el("span", "kc-node-label", n.label));
      if (n.meta) node.append(el("span", "kc-node-meta", n.meta));
      node.title = [n.label, KIND_LABEL[n.kind] || n.kind, stateLabel, n.meta]
        .filter(Boolean)
        .join(" \u00b7 ");
      node.tabIndex = 0;
      node.setAttribute(
        "aria-label",
        [n.label, KIND_LABEL[n.kind] || n.kind, stateLabel, n.meta].filter(Boolean).join(" · "),
      );
      canvas.append(node);
    }
    viewport.append(canvas);

    // Panneau légende : frère du viewport (colonne propre, pas de superposition), repliable.
    const aside = el("aside", "kc-legend");
    const legendHead = el("div", "kc-legend-head");
    const legendToggle = el("button", "ghost kc-legend-toggle");
    legendToggle.type = "button";
    legendToggle.setAttribute("aria-controls", "kc-legend-body");
    legendToggle.append(el("span", "btn-text", "Légende"));
    legendHead.append(legendToggle);
    const legendBody = el("div", "kc-legend-body");
    legendBody.id = "kc-legend-body";
    for (const group of killchainLegend(findings)) {
      const sec = el("div", "kc-legend-group");
      sec.append(el("p", "kc-legend-title", group.label));
      const ul = el("ul", "kc-legend-list");
      for (const entry of group.entries) {
        const li = el("li", "kc-legend-item");
        if (entry.kind !== undefined) {
          const dot = el("span", `kc-dot kind-${entry.kind}`);
          dot.append(decorative(kindIcon(entry.kind)));
          li.append(dot);
        } else {
          li.append(decorative(el("span", `studio-kc-swatch is-${entry.state}`)));
        }
        li.append(el("span", "kc-legend-label", entry.label));
        li.append(el("span", "kc-legend-count", String(entry.count)));
        ul.append(li);
      }
      sec.append(ul);
      legendBody.append(sec);
    }
    aside.append(legendHead, legendBody);
    const setLegendCollapsed = (collapsed) => {
      legendCollapsed = collapsed;
      aside.classList.toggle("is-collapsed", collapsed);
      legendToggle.setAttribute("aria-expanded", String(!collapsed));
      legendBody.hidden = collapsed;
    };
    legendToggle.addEventListener("click", () => setLegendCollapsed(!legendCollapsed));
    if (legendCollapsed === null) {
      legendCollapsed =
        typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;
    }
    setLegendCollapsed(legendCollapsed);

    wrap.append(bar, viewport, aside);

    // Zoom et déplacement : transformation du canevas (jamais de scroll natif).
    let scale = graphPose?.scale ?? 1;
    let tx = graphPose?.tx ?? 0;
    let ty = graphPose?.ty ?? 0;
    // Minimap : un rectangle par nœud + zone visible ; clic/glisser recentre le viewport.
    const mini = el("div", "kc-minimap");
    mini.setAttribute("role", "img");
    mini.setAttribute("aria-label", "Minimap du graphe : zone actuellement visible");
    const miniSvg = document.createElementNS(SVG_NS, "svg");
    miniSvg.setAttribute("class", "kc-minimap-svg");
    mini.append(miniSvg);
    viewport.append(mini);
    let miniGeom = null;
    const viewSize = () => {
      const vb = viewport.getBoundingClientRect();
      return { width: vb.width, height: vb.height };
    };
    const paintMinimap = () => {
      miniGeom = killchainMinimap(graph, viewSize(), { scale, tx, ty });
      mini.hidden = !miniGeom.visible;
      if (!miniGeom.visible) return;
      while (miniSvg.firstChild) miniSvg.removeChild(miniSvg.firstChild);
      miniSvg.setAttribute("width", String(miniGeom.width));
      miniSvg.setAttribute("height", String(miniGeom.height));
      for (const r of miniGeom.rects) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("class", `kc-minimap-node is-${r.state}`);
        rect.setAttribute("x", String(r.x));
        rect.setAttribute("y", String(r.y));
        rect.setAttribute("width", String(Math.max(1, r.w)));
        rect.setAttribute("height", String(Math.max(1, r.h)));
        miniSvg.append(rect);
      }
      const zone = document.createElementNS(SVG_NS, "rect");
      zone.setAttribute("class", "kc-minimap-zone");
      zone.setAttribute("x", String(miniGeom.zone.x));
      zone.setAttribute("y", String(miniGeom.zone.y));
      zone.setAttribute("width", String(miniGeom.zone.w));
      zone.setAttribute("height", String(miniGeom.zone.h));
      miniSvg.append(zone);
    };
    const apply = () => {
      graphPose = { scale, tx, ty };
      canvas.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${scale})`);
      paintMinimap();
    };
    const recenterFrom = (ev) => {
      if (!miniGeom || !miniGeom.visible) return;
      const mb = miniSvg.getBoundingClientRect();
      const next = killchainMinimapRecenter(
        miniGeom,
        viewSize(),
        { scale, tx, ty },
        ev.clientX - mb.left,
        ev.clientY - mb.top,
      );
      tx = next.tx;
      ty = next.ty;
      apply();
    };
    let miniDrag = false;
    mini.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation(); // ne déclenche pas le pan du viewport
      touched = true;
      miniDrag = true;
      mini.setPointerCapture(ev.pointerId);
      recenterFrom(ev);
    });
    mini.addEventListener("pointermove", (ev) => {
      if (miniDrag) recenterFrom(ev);
    });
    const endMiniDrag = () => {
      miniDrag = false;
    };
    mini.addEventListener("pointerup", endMiniDrag);
    mini.addEventListener("pointercancel", endMiniDrag);
    mini.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
    const setScale = (next, cx, cy) => {
      const s = Math.min(2.5, Math.max(0.2, next));
      const vb = viewport.getBoundingClientRect();
      const px = cx === undefined ? vb.width / 2 : cx;
      const py = cy === undefined ? vb.height / 2 : cy;
      tx = px - ((px - tx) * s) / scale;
      ty = py - ((py - ty) * s) / scale;
      scale = s;
      apply();
    };
    const fitToView = () => {
      const vb = viewport.getBoundingClientRect();
      const gw = graph.width + pad * 2;
      const gh = graph.height + pad * 2;
      if (vb.width === 0 || gw === 0) return;
      scale = Math.min(1, vb.width / gw, vb.height / gh);
      tx = (vb.width - gw * scale) / 2;
      ty = (vb.height - gh * scale) / 2;
      apply();
    };
    fit.addEventListener("click", fitToView);
    zoomIn.addEventListener("click", () => setScale(scale * 1.2));
    zoomOut.addEventListener("click", () => setScale(scale / 1.2));
    viewport.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const vb = viewport.getBoundingClientRect();
        setScale(
          scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1),
          ev.clientX - vb.left,
          ev.clientY - vb.top,
        );
      },
      { passive: false },
    );
    let drag = null;
    viewport.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX - tx, y: ev.clientY - ty };
      viewport.setPointerCapture(ev.pointerId);
      viewport.classList.add("is-panning");
    });
    viewport.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      tx = ev.clientX - drag.x;
      ty = ev.clientY - drag.y;
      apply();
    });
    const endDrag = () => {
      drag = null;
      viewport.classList.remove("is-panning");
    };
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    // Ajuste à la première mesure (ResizeObserver notifie dès l'observation), puis à chaque changement
    // de taille du panneau tant que l'utilisateur n'a pas zoomé/déplacé lui-même.
    let touched = graphPose !== null;
    for (const b of [zoomIn, zoomOut]) b.addEventListener("click", () => (touched = true));
    viewport.addEventListener("wheel", () => (touched = true), { passive: true });
    viewport.addEventListener("pointerdown", () => (touched = true));
    if (typeof ResizeObserver === "function") {
      let disposed = false;
      const observer = new ResizeObserver(() => {
        if (disposed) return;
        if (!touched) fitToView();
        else paintMinimap();
      });
      observer.observe(viewport);
      graphCleanup = () => {
        disposed = true;
        observer.disconnect();
      };
    } else if (!touched) {
      fitToView();
    }
    if (touched) apply();

    return wrap;
  }

  function render(view) {
    // Les accusés concernent une requête, même si l'utilisateur a changé de page/projet.
    if (typeof view.summarySaved === "string") {
      summaryDrafts.delete(view.summarySaved);
      summarySaving.delete(view.summarySaved);
    }
    if (typeof view.summaryFailed === "string") summarySaving.delete(view.summaryFailed);
    if (!main) return;
    const page = killchainOnly ? "killchain" : view.page;
    const project = typeof view.projectId === "string" ? view.projectId : null;
    if (project !== graphProject) {
      graphProject = project;
      graphPose = null;
      graphFingerprint = null;
    }
    const fingerprint = page === "killchain" ? JSON.stringify(view.findings ?? []) : null;
    showGraphError("");
    // Une notification sans nouvelle trouvaille ne remplace pas le graphe ni son focus.
    if (fingerprint !== null && fingerprint === graphFingerprint) return;
    graphFingerprint = fingerprint;
    graphCleanup();
    graphCleanup = () => {};
    graphStatus = null;
    while (main.firstChild) main.removeChild(main.firstChild);
    if (!killchainOnly) paintNav(page, view.findings, view);
    if (page === "project") {
      const sec = el("section", "studio-card");
      sec.append(el("h2", "", "Projet"));
      const choices = view.projectChoices;
      if (choices && Array.isArray(choices.projects)) {
        const projectBusy = view.projectBusy === true;
        if (projectBusy)
          sec.append(
            el("p", "studio-help", "Attendez la fin du travail en cours pour changer de projet."),
          );
        if (typeof view.projectCreated === "string") {
          projectNameDraft = "";
          projectPanel = "choose";
        }
        const current = choices.projects.find((p) => p.id === choices.activeId);
        const active = el("div", "studio-project-active");
        active.append(el("p", "studio-kicker", "Projet actif"));
        active.append(el("p", "studio-project-active-name", current?.name ?? "Aucun projet actif"));
        if (current) active.append(el("p", "studio-project-path", current.workspace));
        sec.append(active);

        if (choices.projects.length === 0) projectPanel = "create";
        else if (projectPanel === null) projectPanel = "choose";
        const tabs = el("div", "studio-project-tabs");
        tabs.setAttribute("role", "group");
        tabs.setAttribute("aria-label", "Gestion des projets");
        const chooseTab = el("button", "", "Choisir un projet");
        chooseTab.type = "button";
        chooseTab.id = "project-choose-tab";
        chooseTab.disabled = choices.projects.length === 0;
        const createTab = el("button", "", "Nouveau projet");
        createTab.type = "button";
        createTab.id = "project-create-tab";
        const choosePanel = el("div", "studio-project-panel");
        choosePanel.id = "project-choose-panel";
        choosePanel.setAttribute("role", "region");
        choosePanel.setAttribute("aria-labelledby", chooseTab.id);
        const createPanel = el("div", "studio-project-panel");
        createPanel.id = "project-create-panel";
        createPanel.setAttribute("role", "region");
        createPanel.setAttribute("aria-labelledby", createTab.id);
        chooseTab.setAttribute("aria-controls", choosePanel.id);
        createTab.setAttribute("aria-controls", createPanel.id);
        const showPanel = (next) => {
          projectPanel = next;
          choosePanel.hidden = next !== "choose";
          createPanel.hidden = next !== "create";
          for (const [button, id] of [
            [chooseTab, "choose"],
            [createTab, "create"],
          ]) {
            button.className = `ghost studio-project-tab${next === id ? " is-current" : ""}`;
            button.setAttribute("aria-pressed", String(next === id));
          }
        };
        chooseTab.addEventListener("click", () => {
          if (!chooseTab.disabled) showPanel("choose");
        });
        createTab.addEventListener("click", () => showPanel("create"));
        showPanel(projectPanel);
        tabs.append(chooseTab, createTab);
        sec.append(tabs, choosePanel, createPanel);
        if (choices.projects.length > 0) {
          const label = el("label", "studio-help", "Choisir un projet");
          label.htmlFor = "project-choice";
          const select = el("select", "studio-project-control");
          select.id = "project-choice";
          select.disabled = projectBusy;
          const placeholder = el("option", "", "Choisir un projet…");
          placeholder.value = "";
          placeholder.disabled = true;
          select.append(placeholder);
          for (const project of choices.projects) {
            const option = el("option", "", project.name);
            option.value = project.id;
            select.append(option);
          }
          select.value = choices.activeId ?? "";
          const activate = el("button", "primary", "Activer le projet");
          activate.type = "button";
          const update = () => {
            activate.disabled = projectBusy || !select.value || select.value === choices.activeId;
          };
          select.addEventListener("change", update);
          activate.addEventListener("click", () => {
            if (activate.disabled) return;
            activate.disabled = true;
            vscode.postMessage({ type: "activateProject", projectId: select.value });
          });
          update();
          choosePanel.append(label, select, activate);
        }
        const label = el("label", "studio-help", "Nom du nouveau projet");
        label.htmlFor = "project-name";
        const name = el("input", "studio-project-control");
        name.id = "project-name";
        name.type = "text";
        name.maxLength = 80;
        name.value = projectNameDraft;
        name.disabled = projectBusy;
        const create = el("button", "primary", "Créer un projet et choisir son dossier…");
        create.type = "button";
        const update = () => {
          create.disabled = projectBusy || !name.value.trim();
        };
        name.addEventListener("input", () => {
          projectNameDraft = name.value;
          update();
        });
        create.addEventListener("click", () => {
          if (create.disabled) return;
          create.disabled = true;
          vscode.postMessage({ type: "createProject", name: name.value.trim() });
        });
        update();
        createPanel.append(
          el("p", "studio-help", "Donnez un nom au projet, puis choisissez son dossier."),
          label,
          name,
          create,
        );
      }
      if (typeof view.projectError === "string") {
        const error = el("p", "studio-help", view.projectError);
        error.setAttribute("role", "status");
        sec.append(error);
      }
      if (!choices && typeof view.projectSummary?.projectName === "string") {
        sec.append(el("p", "studio-name", view.projectSummary.projectName));
      }
      if (!view.linkedBanner) {
        sec.append(
          el(
            "p",
            "studio-help",
            "Aucun conteneur affiché. Gérez les associations dans le cockpit.",
          ),
        );
      } else {
        const b = view.linkedBanner;
        sec.append(el("p", "studio-kicker", "Conteneur affiché"));
        sec.append(el("p", "studio-name", b.name));
        sec.append(el("p", "studio-help", b.workspace));
        const del = el("button", "ghost");
        del.type = "button";
        del.append(el("span", "btn-text", "Délier le conteneur affiché"));
        del.addEventListener("click", () => vscode.postMessage({ type: "unlink" }));
        sec.append(del);
      }
      const summary = view.projectSummary;
      if (summary && typeof summary.projectId === "string" && typeof summary.text === "string") {
        const id = summary.projectId;
        sec.append(el("h2", "", "Mémoire du projet"));
        sec.append(
          el(
            "p",
            "studio-help",
            "Ce résumé est partagé avec l'agent au démarrage des nouvelles conversations. Il ne remplace pas l'historique.",
          ),
        );
        const label = el("label", "studio-help", "Résumé de session");
        label.htmlFor = "project-summary";
        const input = el("textarea", "studio-summary");
        input.id = "project-summary";
        input.rows = 10;
        input.maxLength = 8192;
        input.value = summaryDrafts.get(id) ?? summary.text;
        input.disabled = summarySaving.has(id);
        input.setAttribute("aria-describedby", "summary-status");
        const status = el("p", "studio-help");
        status.id = "summary-status";
        status.setAttribute("role", "status");
        const save = el("button", "primary", "Enregistrer le résumé");
        save.type = "button";
        const update = () => {
          const bytes = new TextEncoder().encode(input.value).length;
          save.disabled = bytes > 8192 || summarySaving.has(id);
          status.textContent =
            bytes > 8192
              ? "Résumé trop long : 8 Kio maximum."
              : `${bytes} / 8192 octets · Les secrets reconnus sont masqués à l'enregistrement.`;
        };
        input.addEventListener("input", () => {
          summaryDrafts.set(id, input.value);
          update();
        });
        save.addEventListener("click", () => {
          if (save.disabled) return;
          summaryDrafts.set(id, input.value);
          summarySaving.add(id);
          input.disabled = true;
          save.disabled = true;
          status.textContent = "Enregistrement…";
          vscode.postMessage({ type: "saveSummary", projectId: id, text: input.value });
        });
        update();
        if (view.summarySaved === id) status.textContent = "Résumé enregistré.";
        if (typeof view.summaryError === "string") status.textContent = view.summaryError;
        sec.append(label, input, status, save);
      } else if (typeof view.summaryError === "string") {
        const error = el("p", "studio-help", view.summaryError);
        error.setAttribute("role", "status");
        sec.append(error);
      }
      main.append(sec);
      return;
    }
    if (page === "containers" || page === "system") {
      const sec = el("section", "studio-card");
      const header = el("div", "studio-section-head");
      header.append(el("h2", "", page === "system" ? "Contrôle système" : "Conteneurs"));
      if (page === "containers") {
        const manage = el("button", "secondary");
        manage.type = "button";
        manage.append(
          window.WarbandIcons.create("sliders"),
          el("span", "btn-text", "Gérer les conteneurs"),
        );
        manage.addEventListener("click", () => vscode.postMessage({ type: "openCockpit" }));
        header.append(manage);
      }
      sec.append(header);
      const dl = el("dl", "studio-dl");
      const row = (k, v) => {
        dl.append(el("dt", "", k), el("dd", "", v));
      };
      row("Docker", view.docker === "present" ? "présent" : "absent");
      row(
        "Démon",
        view.daemon === "reachable"
          ? "joignable"
          : view.daemon === "unreachable"
            ? "injoignable"
            : "—",
      );
      row("Exegol", view.exegol === "present" ? "présent" : "absent");
      sec.append(dl);
      if (page === "containers") {
        const ul = el("ul", "studio-rows");
        for (const c of view.containers ?? []) {
          const li = el("li", "studio-row");
          li.append(
            window.WarbandIcons.create("container"),
            el("span", `dot ${c.state === "running" ? "is-running" : "is-stopped"}`),
            el("span", "studio-ellipsis", c.name),
            el("span", "studio-help", c.state === "running" ? "en cours" : "arrêté"),
          );
          ul.append(li);
        }
        sec.append(ul);
        if ((view.containers ?? []).length === 0) {
          sec.append(el("p", "studio-help", "Aucun conteneur. Créez-en un dans le cockpit."));
        }
      }
      main.append(sec);
      return;
    }
    if (page === "killchain") {
      if (killchainOnly) {
        const sec = el("section", "studio-kc-page");
        const graph = killchainGraph(view.findings);
        if (graph.nodes.length > 0) {
          sec.append(killchainGraphView(graph, view.findings));
        } else {
          const wrap = el("div", "studio-kc");
          const viewport = el("div", "kc-viewport kc-empty");
          viewport.append(
            el(
              "p",
              "studio-help",
              "Les nœuds notés par l'agent. Rien tant qu'il n'y a pas de trouvaille.",
            ),
          );
          wrap.append(viewport);
          sec.append(wrap);
        }
        main.append(sec);
        return;
      }
      const count = killchainCount(view.findings);
      const sec = empty(
        "Kill chain",
        count === null
          ? "Graphe des trouvailles notées par l'agent. Ouvrez la vue plein écran pour explorer le graphe."
          : `${count} trouvaille${count > 1 ? "s" : ""} : ouvrez la vue plein écran pour le graphe interactif.`,
      );
      const open = el("button", "primary");
      open.type = "button";
      open.append(el("span", "btn-text", "Ouvrir la Kill chain"));
      open.addEventListener("click", () => vscode.postMessage({ type: "openKillchain" }));
      sec.append(open);
      main.append(sec);
      return;
    }
    if (page === "atlas") {
      const sec = empty(
        "Atlas",
        "Dossier de cours lu par le mode Apprentissage, en lecture seule. Aucun cours inclus : dépose-y des sources libres, un sous-dossier par source.",
      );
      const open = el("button", "primary", "Ouvrir le dossier de cours");
      open.type = "button";
      open.addEventListener("click", () => vscode.postMessage({ type: "openCours" }));
      sec.append(open);
      // Données de l'hôte, affichées en texte seulement (textContent).
      const sources = Array.isArray(view.sources) ? view.sources : [];
      if (sources.length === 0) {
        sec.append(el("p", "studio-help", "Aucune source dans le dossier de cours."));
      } else {
        const ul = el("ul", "studio-rows");
        for (const src of sources) {
          if (!src || typeof src.name !== "string" || typeof src.droits !== "string") continue;
          const li = el("li", "studio-row");
          li.append(el("span", "studio-ellipsis", src.name), el("span", "studio-help", src.droits));
          ul.append(li);
        }
        sec.append(ul);
      }
      main.append(sec);
      return;
    }
    main.append(empty("Réglages", "Choisissez une rubrique dans la navigation."));
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "findingsError") {
      if (msg.projectId !== undefined && msg.projectId !== graphProject) return;
      showGraphError(
        typeof msg.message === "string" ? msg.message : "Actualisation du graphe indisponible.",
      );
      return;
    }
    if (msg?.type !== "view") return;
    render(msg);
  });
  vscode.postMessage({ type: "refresh" });
}
