// Réglages : navigation en deux groupes, pages. DOM sûr (textContent, jamais de HTML injecté).
// La logique de navigation (navModel, killchainCount) est pure et testée par vitest (test/studio.test.ts).
// Hors webview (pas d'acquireVsCodeApi), seule la logique est exposée.

/**
 * Groupes de la navigation : clé, libellé et pictogramme (texte Unicode) de chaque page existante.
 * Miroir de STUDIO_PAGES et LABELS (src/logic/studio.ts), vérifié par test.
 */
const STUDIO_GROUPS = [
  {
    label: "Engagement",
    pages: [
      ["project", "Projet", "◆"],
      ["containers", "Conteneurs", "▣"],
      ["providers", "Fournisseurs", "⇄"],
      ["personas", "Personas", "◉"],
      ["approvals", "Approbations", "✓"],
      ["killchain", "Kill chain", "⚑"],
    ],
  },
  {
    label: "Système",
    pages: [
      ["model", "Modèle", "◈"],
      ["harness", "Harness", "▤"],
      ["mcp", "MCP", "⬡"],
      ["atlas", "Atlas", "▦"],
      ["layout", "Disposition", "▭"],
      ["modes", "Modes", "◐"],
      ["system", "Contrôle système", "⏻"],
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
const KC = { nodeW: 184, nodeH: 56, gapX: 88, gapY: 26 };

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

// Exposée pour les tests (même convention que ui.js : pas de module dans la webview).
globalThis.WarbandStudio = {
  STUDIO_GROUPS,
  MITRE_TACTICS,
  KC,
  killchainCount,
  killchainModel,
  killchainGraph,
  navModel,
};

if (typeof acquireVsCodeApi === "function") start();

function start() {
  const vscode = acquireVsCodeApi();
  const nav = document.getElementById("studio-nav");
  const main = document.getElementById("studio-main");

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

  function paintNav(current, findings) {
    if (!nav) return;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    nav.append(el("div", "studio-nav-title", "Réglages"));
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
        b.append(el("span", "btn-text", item.label));
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

  const KIND_ICON = {
    host: "\u25A3",
    site: "\uD83C\uDF10",
    credential: "\uD83D\uDD11",
    step: "\u276F",
    loot: "\u2691",
  };
  const KIND_LABEL = {
    host: "H\u00f4te",
    site: "Site / URL",
    credential: "Identifiant",
    step: "\u00c9tape",
    loot: "Loot",
  };

  /** Vue graphe de la kill chain : nœuds typés, arêtes courbes, zoom/pan, bouton Ajuster, légende. */
  function killchainGraphView(graph) {
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
    const pad = 28;
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
      const x1 = a.x + a.w + pad;
      const y1 = a.y + a.h / 2 + pad;
      const x2 = b.x + pad;
      const y2 = b.y + b.h / 2 + pad;
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
      head.append(decorative(el("span", "kc-node-ico", KIND_ICON[n.kind] || "\u25CF")));
      head.append(el("span", "kc-node-label", n.label));
      node.append(head);
      if (n.meta) node.append(el("span", "kc-node-meta", n.meta));
      node.title = [KIND_LABEL[n.kind] || n.kind, n.state, n.meta].filter(Boolean).join(" \u00b7 ");
      canvas.append(node);
    }
    viewport.append(canvas);
    wrap.append(bar, viewport);

    // Zoom et déplacement : transformation du canevas (jamais de scroll natif).
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const apply = () => {
      canvas.style.setProperty("transform", `translate(${tx}px, ${ty}px) scale(${scale})`);
    };
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
    let touched = false;
    for (const b of [zoomIn, zoomOut]) b.addEventListener("click", () => (touched = true));
    viewport.addEventListener("wheel", () => (touched = true), { passive: true });
    viewport.addEventListener("pointerdown", () => (touched = true));
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        if (!touched) fitToView();
      }).observe(viewport);
    } else {
      fitToView();
    }

    const legend = el("ul", "studio-kc-legend");
    for (const kind of ["host", "credential", "site", "step", "loot"]) {
      const li = el("li", "studio-kc-key");
      li.append(
        decorative(el("span", `kc-dot kind-${kind}`, KIND_ICON[kind] || "\u25CF")),
        el("span", "", KIND_LABEL[kind]),
      );
      legend.append(li);
    }
    for (const [state, text] of [
      ["confirmed", "Confirm\u00e9"],
      ["hypothesis", "Hypoth\u00e8se"],
      ["failed", "\u00c9chec"],
    ]) {
      const li = el("li", "studio-kc-key");
      li.append(decorative(el("span", `studio-kc-swatch is-${state}`)), el("span", "", text));
      legend.append(li);
    }
    wrap.append(legend);
    return wrap;
  }

  function render(view) {
    if (!main) return;
    while (main.firstChild) main.removeChild(main.firstChild);
    paintNav(view.page, view.findings);
    const page = view.page;
    if (page === "project") {
      const sec = el("section", "studio-card");
      sec.append(el("h2", "", "Projet"));
      if (!view.linkedBanner) {
        sec.append(el("p", "studio-help", "Aucun conteneur dédié. Créez-en un dans le cockpit."));
      } else {
        const b = view.linkedBanner;
        sec.append(el("p", "studio-kicker", "DÉDIÉ"));
        sec.append(el("p", "studio-name", b.name));
        sec.append(el("p", "studio-help", b.workspace));
        const del = el("button", "ghost");
        del.type = "button";
        del.append(el("span", "btn-text", "Retirer le projet"));
        del.addEventListener("click", () => vscode.postMessage({ type: "unlink" }));
        sec.append(del);
      }
      main.append(sec);
      return;
    }
    if (page === "containers" || page === "system") {
      const sec = el("section", "studio-card");
      sec.append(el("h2", "", page === "system" ? "Contrôle système" : "Conteneurs"));
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
      const sec = empty(
        "Kill chain",
        "Les nœuds notés par l'agent. Rien tant qu'il n'y a pas de trouvaille.",
      );
      const graph = killchainGraph(view.findings);
      if (graph.nodes.length > 0) sec.append(killchainGraphView(graph));
      main.append(sec);
      return;
    }
    if (page === "harness") {
      main.append(
        empty(
          "Harness",
          "Skills, agents, rules, hooks, briefs : tu déposes les fiches. Rien n'est rédigé ici.",
        ),
      );
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
    if (page === "mcp") {
      main.append(
        empty(
          "MCP",
          "Nom, endroit, interrupteur. Les appels passent par la gate. Aucun serveur n'est copié ici.",
        ),
      );
      return;
    }
    const label = STUDIO_GROUPS.flatMap((g) => g.pages).find((p) => p[0] === page)?.[1] ?? page;
    main.append(empty(label, "Cette page reste vide : pas d'interrupteur ajouté."));
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type !== "view") return;
    render(msg);
  });
  vscode.postMessage({ type: "refresh" });
}
