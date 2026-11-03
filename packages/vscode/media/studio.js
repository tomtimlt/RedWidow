// Traduire au moment de produire les libellés, sans toucher aux données métier.
function studioT(message, ...values) {
  if (globalThis.WarbandI18n) return globalThis.WarbandI18n.t(message, ...values);
  return typeof message === "string"
    ? message
    : message.reduce((text, part, i) => text + (i ? values[i - 1] : "") + part, "");
}
const STUDIO_GROUPS = [
  {
    label: "Engagement",
    pages: [
      ["project", "Projet", "project"],
      ["containers", "Conteneurs", "container"],
      ["killchain", "Kill chain", "graph"],
      ["audit", "Audit", "history"],
    ],
  },
  {
    label: "Système",
    pages: [
      ["atlas", "Atlas", "book"],
      ["system", "Contrôle système", "server"],
    ],
  },
  { label: "Interface", pages: [["appearance", "Apparence", "palette"]] },
];
// Jeux de couleurs : mêmes identifiants que PALETTES dans src/logic/palette.ts (contrôlé par test).
const PALETTES = [
  ["widow", "Widow", "Noir profond et cramoisi : la marque RedWidow"],
  ["sentinelle", "Sentinelle", "Sarcelle et ardoise : veille, terminal, sécurité"],
  ["braise", "Braise", "Cramoisi et acier : la marque d'origine, plus offensive"],
  ["venom", "Venin", "Vert toxique sur acier : terminal, offensif"],
  ["arctic", "Arctique", "Bleu glacier : froid, net, défensif"],
  ["spectre", "Spectre", "Violet et glace : agents, recherche, nuit"],
  ["ultraviolet", "Ultraviolet", "Violet électrique : nuit, IA, laboratoire"],
  ["tactical", "Tactique", "Olive et kaki : terrain, opérations"],
  ["rouge", "Rouge", "Rouge franc"],
  ["orange", "Orange", "Orange vif ; proche de la couleur des alertes"],
  ["jaune", "Jaune", "Jaune soleil ; proche de la couleur des alertes"],
  ["vert", "Vert", "Vert franc"],
  ["bleu", "Bleu", "Bleu franc"],
  ["rose", "Rose", "Rose vif"],
  ["blanc", "Blanc", "Blanc pur, graphite en thème clair"],
  ["aurora", "Aurore", "Dégradé cyan, bleu et violet"],
  ["synthwave", "Synthwave", "Dégradé rose, violet et bleu"],
  ["toxic", "Toxique", "Dégradé lime, vert et cyan"],
  ["bloodmoon", "Lune de sang", "Dégradé cramoisi, magenta et violet"],
  ["ocean", "Abysse", "Dégradé sarcelle, bleu et indigo"],
  ["nebula", "Nébuleuse", "Dégradé rose, violet et cyan"],
  ["multi", "Multicolore", "Six teintes, une par rôle : corail, vert, cyan, bleu, violet et rose"],
  ["editeur", "Éditeur", "Accent du thème VS Code : intégration maximale"],
];
function killchainCount(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return findings.length;
}
function navModel(current, findings) {
  return STUDIO_GROUPS.map((group) => ({
    label: studioT(group.label),
    items: group.pages.map(([id, label, icon]) => {
      const item = { id, label: studioT(label), icon, current: id === current };
      if (id === "killchain") {
        const count = killchainCount(findings);
        if (count !== null) item.count = count;
      }
      return item;
    }),
  }));
}
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
function killchainModel(findings) {
  if (!Array.isArray(findings)) return { columns: [], edges: [] };
  const known = new Map(
    MITRE_TACTICS.map(([id, name]) => [id, { tactic: id, label: name, nodes: [] }]),
  );
  const unclassified = { tactic: null, label: studioT("Non classé"), nodes: [] };
  const ids = /* @__PURE__ */ new Set();
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
const KC = { nodeW: 190, nodeH: 118, gapX: 100, gapY: 36, diameter: 52 };
function killchainGraph(findings) {
  const empty = { nodes: [], edges: [], width: 0, height: 0 };
  if (!Array.isArray(findings)) return empty;
  const byId = /* @__PURE__ */ new Map();
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
  const seen = /* @__PURE__ */ new Set();
  for (const id of order) {
    const from = byId.get(id).from;
    if (!Array.isArray(from)) continue;
    for (const p of from) {
      if (!byId.has(p) || p === id) continue;
      const key = `${p}\0${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: p, to: id });
      children.get(p).push(id);
      parents.get(id).push(p);
    }
  }
  const indeg = new Map(order.map((id) => [id, parents.get(id).length]));
  const layer = new Map(order.map((id) => [id, 0]));
  const queue = order.filter((id) => indeg.get(id) === 0);
  const placed = /* @__PURE__ */ new Set();
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
  const maxLayer = Math.max(...order.map((id) => layer.get(id)));
  const cols = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of order) cols[layer.get(id)].push(id);
  const rowOf = /* @__PURE__ */ new Map();
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
    const top = (height - colH) / 2;
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
function bary(id, parents, rowOf) {
  const ps = parents.get(id);
  if (ps.length === 0) return rowOf.get(id);
  let sum = 0;
  for (const p of ps) sum += rowOf.get(p);
  return sum / ps.length;
}
const KIND_LABEL = {
  host: "Hôte",
  site: "Site / URL",
  credential: "Identifiant",
  step: "Étape",
  loot: "Loot",
};
const LEGEND_KINDS = ["host", "credential", "site", "step", "loot"];
const STATE_LABEL = {
  confirmed: "Confirmé",
  hypothesis: "Hypothèse",
  failed: "Échec",
};
const LEGEND_STATES = ["confirmed", "hypothesis", "failed"];
function killchainLegend(findings) {
  const kindCounts = /* @__PURE__ */ new Map();
  const stateCounts = /* @__PURE__ */ new Map();
  if (Array.isArray(findings)) {
    for (const f of findings) {
      if (!f || typeof f !== "object") continue;
      if (typeof f.kind === "string" && KIND_LABEL[f.kind] !== void 0) {
        kindCounts.set(f.kind, (kindCounts.get(f.kind) ?? 0) + 1);
      }
      if (typeof f.state === "string" && STATE_LABEL[f.state] !== void 0) {
        stateCounts.set(f.state, (stateCounts.get(f.state) ?? 0) + 1);
      }
    }
  }
  return [
    {
      label: "Type",
      entries: LEGEND_KINDS.map((kind) => ({
        kind,
        label: studioT(KIND_LABEL[kind]),
        count: kindCounts.get(kind) ?? 0,
      })),
    },
    {
      label: studioT("État"),
      entries: LEGEND_STATES.map((state) => ({
        state,
        label: studioT(STATE_LABEL[state]),
        count: stateCounts.get(state) ?? 0,
      })),
    },
  ];
}
const KC_PAD = 28;
const KC_MINIMAP = { maxW: 160, maxH: 100, minViewportW: 640 };
function killchainMinimap(graph, viewport, view) {
  const hidden = { visible: false, width: 0, height: 0, ratio: 0, rects: [], zone: null };
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return hidden;
  const gw = graph.width + KC_PAD * 2;
  const gh = graph.height + KC_PAD * 2;
  const { scale, tx, ty } = view;
  if (!(scale > 0) || !(viewport.width > 0) || !(viewport.height > 0)) return hidden;
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
function killchainMinimapRecenter(minimap, viewport, view, px, py) {
  if (!minimap || !(minimap.ratio > 0)) return { tx: view.tx, ty: view.ty };
  const cx = Math.min(minimap.width, Math.max(0, px)) / minimap.ratio;
  const cy = Math.min(minimap.height, Math.max(0, py)) / minimap.ratio;
  return {
    tx: viewport.width / 2 - cx * view.scale,
    ty: viewport.height / 2 - cy * view.scale,
  };
}
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
  const t = studioT;
  let lastView = null;
  const vscode = acquireVsCodeApi();
  // Un changement de langue reconstruit les libellés et conserve l’interaction en cours.
  const captureLocaleState = () => {
    const nodes = [...(document.querySelectorAll?.("*") ?? [])];
    const active = document.activeElement;
    const state = nodes.map((node, index) => ({
      index,
      id: node.id,
      value: node.value,
      checked: node.checked,
      open: node.open,
      top: node.scrollTop,
      left: node.scrollLeft,
      start: node.selectionStart,
      end: node.selectionEnd,
      direction: node.selectionDirection,
      focused: node === active,
    }));
    return () => {
      const next = [...(document.querySelectorAll?.("*") ?? [])];
      for (const item of state) {
        const node = item.id ? document.getElementById(item.id) : next[item.index];
        if (!node) continue;
        if (item.value !== undefined && node.id !== "studio-locale") node.value = item.value;
        if (item.checked !== undefined) node.checked = item.checked;
        if (item.open !== undefined) node.open = item.open;
        if (item.focused) {
          node.focus?.({ preventScroll: true });
          if (typeof item.start === "number")
            node.setSelectionRange?.(item.start, item.end, item.direction);
        }
        node.scrollTop = item.top;
        node.scrollLeft = item.left;
      }
    };
  };

  const killchainOnly = document.body.classList.contains("killchain-full");
  const nav = killchainOnly ? null : document.getElementById("studio-nav");
  const main = document.getElementById("studio-main");
  let legendCollapsed = null;
  let graphPose = null;
  let graphProject;
  let graphFingerprint = null;
  let graphCleanup = () => {};
  let cancelReplay = () => {};
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelReplay();
  });
  let graphStatus = null;
  let graphBar = null;
  let selectedFinding = null;
  let selectedEdge = null;
  let pendingPathEdge = null;
  let legendFilter = { kind: null, state: null };
  let ignoreGraphClick = false;
  let pendingFindingDelete = null;
  let paintFindingSelection = () => {};
  const clearSelection = () => {
    selectedFinding = null;
    selectedEdge = null;
    paintFindingSelection();
  };
  main?.addEventListener("click", (event) => {
    if (ignoreGraphClick) {
      ignoreGraphClick = false;
      return;
    }
    // Les commandes du graphe ne changent pas l’élément sélectionné.
    if (event.target?.closest?.("button, input, select, textarea, a, summary")) return;
    clearSelection();
  });
  main?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelReplay();
      clearSelection();
      event.preventDefault();
    }
  });
  const showGraphError = (message) => {
    if (graphStatus === null) {
      if (message === "" || main === null) return;
      graphStatus = el("p", "kc-live-status");
      graphStatus.setAttribute("role", "status");
      (graphBar ?? main).append(graphStatus);
    }
    graphStatus.textContent = message;
    graphStatus.hidden = message === "";
  };
  const summaryDrafts = /* @__PURE__ */ new Map();
  const summarySaving = /* @__PURE__ */ new Set();
  let projectNameDraft = "";
  let providerFilter = "";
  const auditDrafts = new Map();
  let lastAuditProject = null;
  const auditFilters = { search: "", actor: "", kind: "", from: "", to: "" };
  let projectPanel = null;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  const decorative = (node) => {
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  function paintNav(current, findings, view) {
    if (!nav) return;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    nav.append(el("div", "studio-nav-title", t("Réglages")));
    const language = el("label", "studio-help", t("Langue"));
    language.htmlFor = "studio-locale";
    const locale = el("select", "studio-project-control");
    locale.id = "studio-locale";
    locale.setAttribute("aria-label", t("Langue"));
    for (const [value, label] of [
      ["fr", "FR"],
      ["en", "EN"],
    ]) {
      const option = el("option", "", label);
      option.value = value;
      locale.append(option);
    }
    locale.value = globalThis.WarbandI18n?.getLocale() ?? "fr";
    locale.addEventListener("change", () => {
      if (locale.value === "fr" || locale.value === "en")
        vscode.postMessage({ type: "setLocale", locale: locale.value });
    });
    nav.append(language, locale);
    const active = view.projectChoices?.projects?.find(
      (project) => project.id === view.projectChoices.activeId,
    );
    const activeName = active?.name ?? view.projectSummary?.projectName;
    if (typeof activeName === "string") {
      const context = el("div", "studio-nav-project");
      context.append(
        el("span", "studio-kicker", t("Projet actif")),
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
        b.dataset.page = item.id;
        if (item.current) b.setAttribute("aria-current", "page");
        b.append(
          window.WarbandIcons.create(item.icon, { className: "ico" }),
          el("span", "btn-text", item.label),
        );
        if (item.count !== void 0) {
          const count = el("span", "studio-count", String(item.count));
          count.title = t`${item.count} élément${item.count > 1 ? "s" : ""}`;
          b.append(count);
        }
        b.addEventListener("click", () => vscode.postMessage({ type: "open", page: item.id }));
        section.append(b);
      }
      nav.append(section);
    }
  }
  // Apparence : l’hôte confirme l’enregistrement avant d’appliquer le choix.
  const currentPalette = () =>
    PALETTES.some(([id]) => id === document.body.dataset.palette)
      ? document.body.dataset.palette
      : PALETTES[0][0];
  const applyPalette = (id) => {
    if (PALETTES.some(([known]) => known === id)) document.body.dataset.palette = id;
  };
  let repaintPalette = () => {};
  let palettePending = false;
  function appearancePage() {
    const sec = el("section", "studio-card");
    sec.append(
      el("h2", "", t("Apparence")),
      el(
        "p",
        "studio-help",
        t(
          "Choisissez le jeu de couleurs de RedWidow. Il s’applique aussitôt à toutes les vues et s’adapte aux thèmes clair, sombre et contraste élevé de VS Code.",
        ),
      ),
    );
    if (
      document.body.classList.contains("vscode-high-contrast") ||
      document.body.classList.contains("vscode-high-contrast-light")
    ) {
      sec.append(
        el(
          "p",
          "studio-help pal-note",
          t(
            "En contraste élevé, RedWidow utilise les couleurs du thème : le choix est enregistré et s’applique dès que vous changez de thème.",
          ),
        ),
      );
    }
    const group = el("div", "pal-grid");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", t("Jeu de couleurs"));
    const paletteStatus = el("p", "studio-help");
    paletteStatus.setAttribute("role", "status");
    const cards = PALETTES.map(([id, label, detail]) => {
      const card = el("button", "pal-card");
      card.type = "button";
      card.dataset.palette = id;
      card.setAttribute("role", "radio");
      const logo = window.WarbandIcons.createBrand("brand pal-logo");
      const swatches = el("span", "pal-sw");
      swatches.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 6; i++) swatches.append(el("i"));
      const bar = el("span", "pal-bar");
      bar.setAttribute("aria-hidden", "true");
      bar.append(el("span", "pal-bar-fill"), el("span", "pal-bar-knob"));
      const top = el("span", "pal-top");
      top.append(logo, swatches);
      const preview = el("span", "pal-preview");
      preview.append(top, bar);
      const text = el("span", "pal-text");
      text.append(el("span", "pal-name", t(label)), el("span", "pal-desc", t(detail)));
      const check = decorative(el("span", "pal-check"));
      check.append(window.WarbandIcons.create("check"));
      card.append(preview, text, check);
      return card;
    });
    repaintPalette = (error = "") => {
      palettePending = false;
      group.setAttribute("aria-busy", "false");
      paletteStatus.textContent = error;
      const now = currentPalette();
      for (const card of cards) {
        card.setAttribute("aria-disabled", "false");
        const on = card.dataset.palette === now;
        card.setAttribute("aria-checked", String(on));
        card.tabIndex = on ? 0 : -1;
      }
    };
    const choose = (card) => {
      if (palettePending) return;
      palettePending = true;
      group.setAttribute("aria-busy", "true");
      const id = card.dataset.palette;
      for (const item of cards) item.setAttribute("aria-disabled", "true");
      paletteStatus.textContent = t("Enregistrement…");
      vscode.postMessage({ type: "setPalette", palette: id });
    };
    cards.forEach((card, i) => {
      card.addEventListener("click", () => choose(card));
      card.addEventListener("keydown", (event) => {
        if (palettePending) {
          event.preventDefault();
          return;
        }
        const last = cards.length - 1;
        const next = {
          ArrowRight: i + 1,
          ArrowDown: i + 1,
          ArrowLeft: i - 1,
          ArrowUp: i - 1,
          Home: 0,
          End: last,
        }[event.key];
        if (next === void 0) return;
        event.preventDefault();
        const target = cards[(next + cards.length) % cards.length];
        target.focus();
        choose(target);
      });
    });
    group.append(...cards);
    repaintPalette();
    sec.append(group, paletteStatus);
    return sec;
  }
  function empty(title, text) {
    const sec = el("section", "studio-card");
    sec.append(el("h2", "", title), el("p", "studio-help", text));
    return sec;
  }
  const SVG_NS = "http://www.w3.org/2000/svg";
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
  const STATE_BADGE = {
    confirmed: "✓",
    hypothesis: "?",
    failed: "✕",
  };
  function killchainGraphView(graph, findings, projectId, evidence) {
    const wrap = el("div", "studio-kc");
    const bar = el("div", "kc-bar");
    graphBar = bar;
    const fit = el("button", "ghost kc-btn");
    fit.type = "button";
    fit.title = t("Ajuster le graphe à la fenêtre (0)");
    fit.append(window.WarbandIcons.create("fit"), el("span", "btn-text", t("Ajuster")));
    const zoomOut = el("button", "ghost kc-btn kc-zoom");
    zoomOut.type = "button";
    zoomOut.title = t("Dézoomer (−)");
    zoomOut.setAttribute("aria-label", t("Dézoomer"));
    zoomOut.append(window.WarbandIcons.create("minus"));
    const zoomIn = el("button", "ghost kc-btn kc-zoom");
    zoomIn.type = "button";
    zoomIn.title = t("Zoomer (+)");
    zoomIn.setAttribute("aria-label", t("Zoomer"));
    zoomIn.append(window.WarbandIcons.create("plus"));
    bar.append(fit, zoomOut, zoomIn);
    const report = el("button", "ghost kc-btn kc-report");
    report.append(
      window.WarbandIcons.create("file"),
      el("span", "btn-text", t("Exporter le brouillon")),
    );
    report.type = "button";
    report.title = t("Rapport Markdown du projet, identifiants et loot exclus");
    report.disabled = typeof projectId !== "string";
    report.addEventListener("click", () => {
      if (!report.disabled) vscode.postMessage({ type: "exportReport", projectId });
    });
    bar.append(report);
    const preview = el("button", "ghost kc-btn kc-report-preview");
    preview.append(
      window.WarbandIcons.create("file"),
      el("span", "btn-text", t("Aperçu du rapport")),
    );
    preview.type = "button";
    preview.disabled = typeof projectId !== "string";
    preview.addEventListener("click", () => {
      if (!preview.disabled) vscode.postMessage({ type: "openReport", projectId });
    });
    bar.append(preview);
    const image = el("button", "ghost kc-btn kc-image");
    image.append(
      window.WarbandIcons.create("image"),
      el("span", "btn-text", t("Exporter l’image")),
    );
    image.type = "button";
    image.title = t(
      "Image SVG de tous les éléments, noms complets et liens (sans filtre ni cadrage)",
    );
    image.disabled = typeof projectId !== "string";
    image.addEventListener("click", () => {
      if (!image.disabled) vscode.postMessage({ type: "exportKillchain", projectId });
    });
    bar.append(image);
    const flow = el("button", "ghost kc-btn kc-flow");
    flow.type = "button";
    flow.textContent = "Attack Flow";
    flow.title = t("Exporter les étapes confirmées au format Attack Flow 2.0");
    flow.disabled = typeof projectId !== "string";
    flow.addEventListener("click", () => {
      if (!flow.disabled) vscode.postMessage({ type: "exportAttackFlow", projectId });
    });
    bar.append(flow);
    const selection = el("div", "kc-selection");
    const selectedLabel = el("span", "kc-selection-label");
    const remove = el("button", "ghost kc-btn kc-delete");
    remove.type = "button";
    remove.title = t("Supprimer l’élément sélectionné");
    const trash = document.createElementNS(SVG_NS, "svg");
    trash.setAttribute("viewBox", "0 0 16 16");
    trash.setAttribute("class", "kc-ico-svg");
    const trashPath = document.createElementNS(SVG_NS, "path");
    trashPath.setAttribute("d", "M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.5 9h7l.5-9M6.5 7v4M9.5 7v4");
    trash.append(trashPath);
    remove.append(decorative(trash), el("span", "btn-text", t("Supprimer")));
    const proofs = el("div", "kc-proofs");
    selection.append(selectedLabel, remove, proofs);
    selection.addEventListener("click", (event) => event.stopPropagation());
    bar.append(selection);
    const edgeSelection = el("div", "kc-selection kc-edge-selection");
    const edgeLabel = el("span", "kc-selection-label");
    const mark = el("button", "ghost kc-btn kc-mark-path", t("Chemin retenu"));
    mark.type = "button";
    mark.setAttribute("aria-pressed", "false");
    edgeSelection.append(edgeLabel, mark);
    edgeSelection.addEventListener("click", (event) => event.stopPropagation());
    bar.append(edgeSelection);
    const retainedEdges = /* @__PURE__ */ new Set();
    for (const entry of findings ?? []) {
      for (const parent of entry?.pathFrom ?? [])
        retainedEdges.add(JSON.stringify([parent, entry.id]));
    }
    const edgeKey = (edge) => JSON.stringify([edge.from, edge.to]);
    // Rejouer : parcourt le chemin retenu nœud par nœud, crochets verrouillés.
    const replay = el("button", "ghost kc-btn kc-replay");
    replay.type = "button";
    replay.title = t("Visualiser les liens retenus, étape par étape. Aucune commande exécutée.");
    replay.setAttribute("aria-pressed", "false");
    replay.append(window.WarbandIcons.create("play"), el("span", "btn-text", t("Rejouer")));
    image.after(replay);
    const replayStatus = el("span", "kc-replay-status");
    replayStatus.setAttribute("role", "status");
    replay.after(replayStatus);
    const edgeElements = [];
    const nodeButtons = /* @__PURE__ */ new Map();
    paintFindingSelection = () => {
      const selected = graph.nodes.find((node) => node.id === selectedFinding);
      selection.hidden = !selected;
      proofs.replaceChildren();
      const finding = findings?.find((row) => row.id === selectedFinding);
      for (const id of finding?.evidenceIds ?? []) {
        const proof = evidence?.find((row) => row.id === id);
        const button = el("button", "ghost kc-btn", proof?.label ?? t("Preuve indisponible"));
        button.type = "button";
        button.disabled = !proof;
        button.title = proof
          ? `${proof.source.reference} · ${proof.capturedAt} · SHA-256 ${proof.sha256}`
          : id;
        button.addEventListener(
          "click",
          () => proof && vscode.postMessage({ type: "openEvidence", projectId, id }),
        );
        proofs.append(button);
      }
      selectedLabel.textContent = selected?.label ?? "";
      selectedLabel.title = selected?.label ?? "";
      remove.disabled =
        !selected ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          projectId ?? "",
        ) ||
        pendingFindingDelete !== null;
      remove.setAttribute("aria-busy", String(pendingFindingDelete !== null));
      const edge = graph.edges.find(
        (row) => selectedEdge && row.from === selectedEdge.from && row.to === selectedEdge.to,
      );
      edgeSelection.hidden = !edge;
      edgeLabel.textContent = edge
        ? `${graph.nodes.find((n) => n.id === edge.from)?.label} → ${graph.nodes.find((n) => n.id === edge.to)?.label}`
        : "";
      edgeLabel.title = edgeLabel.textContent;
      const retained = edge && retainedEdges.has(edgeKey(edge));
      mark.textContent = retained ? t("Retirer du chemin") : t("Marquer le chemin");
      mark.setAttribute("aria-pressed", String(!!retained));
      mark.disabled = !edge || pendingPathEdge !== null || !/^[0-9a-f-]{36}$/.test(projectId ?? "");
      mark.setAttribute("aria-busy", String(pendingPathEdge !== null));
      for (const { edge: row, hit } of edgeElements) {
        hit.setAttribute("aria-pressed", String(!!edge && edgeKey(row) === edgeKey(edge)));
      }
      for (const [id, node] of nodeButtons) {
        node.setAttribute("aria-pressed", String(id === selectedFinding));
        node.classList.toggle("is-selected", id === selectedFinding);
      }
    };
    mark.addEventListener("click", () => {
      if (mark.disabled || !selectedEdge) return;
      pendingPathEdge = { projectId, ...selectedEdge };
      showGraphError("");
      paintFindingSelection();
      vscode.postMessage({
        type: "setPathEdge",
        ...pendingPathEdge,
        retained: !retainedEdges.has(edgeKey(selectedEdge)),
      });
    });
    remove.addEventListener("click", () => {
      if (remove.disabled || selectedFinding === null) return;
      pendingFindingDelete = { projectId, id: selectedFinding };
      showGraphError("");
      paintFindingSelection();
      vscode.postMessage({ type: "deleteFinding", projectId, id: selectedFinding });
    });
    const viewport = el("div", "kc-viewport");
    const canvas = el("div", "kc-canvas");
    const pad = KC_PAD;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "kc-edges");
    svg.setAttribute("aria-label", t("Liens du graphe"));
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
    const retainedMarker = document.createElementNS(SVG_NS, "marker");
    for (const [name, value] of Object.entries({
      id: "kc-arrow-path",
      viewBox: "0 0 10 10",
      refX: "8",
      refY: "5",
      markerWidth: "6",
      markerHeight: "6",
      orient: "auto-start-reverse",
    }))
      retainedMarker.setAttribute(name, value);
    const retainedTip = document.createElementNS(SVG_NS, "path");
    retainedTip.setAttribute("d", "M0 0 L10 5 L0 10 z");
    retainedTip.setAttribute("class", "kc-tip is-path");
    retainedMarker.append(retainedTip);
    defs.append(retainedMarker);
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
      const retained = retainedEdges.has(edgeKey(e));
      path.setAttribute("class", `kc-edge${retained ? " is-path" : ""}`);
      path.setAttribute("marker-end", retained ? "url(#kc-arrow-path)" : "url(#kc-arrow)");
      path.setAttribute("aria-hidden", "true");
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      hit.setAttribute("class", "kc-edge-hit");
      hit.setAttribute("role", "button");
      hit.setAttribute("tabindex", "0");
      hit.setAttribute(
        "aria-label",
        t`Lien ${a.label} vers ${b.label}${retained ? t(", chemin retenu") : ""}`,
      );
      const selectEdge = (event) => {
        event?.stopPropagation?.();
        selectedFinding = null;
        selectedEdge = { from: e.from, to: e.to };
        paintFindingSelection();
      };
      hit.addEventListener("pointerdown", (event) => event.stopPropagation());
      hit.addEventListener("click", selectEdge);
      hit.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectEdge(event);
        }
      });
      edgeElements.push({ edge: e, path, hit });
      svg.append(path, hit);
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
      const stateLabel = t(STATE_LABEL[n.state] || n.state);
      const badge = el("span", `kc-node-badge is-${n.state}`, STATE_BADGE[n.state] || "");
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", stateLabel);
      head.append(badge);
      node.append(head);
      node.append(el("span", "kc-node-label", n.label));
      if (n.meta) node.append(el("span", "kc-node-meta", n.meta));
      node.title = [n.label, t(KIND_LABEL[n.kind] || n.kind), stateLabel, n.meta]
        .filter(Boolean)
        .join(" · ");
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute(
        "aria-label",
        [n.label, t(KIND_LABEL[n.kind] || n.kind), stateLabel, n.meta].filter(Boolean).join(" · "),
      );
      const select = (event) => {
        event?.stopPropagation?.();
        selectedEdge = null;
        selectedFinding = n.id;
        paintFindingSelection();
      };
      node.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      node.addEventListener("click", select);
      node.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        select();
      });
      nodeButtons.set(n.id, node);
      canvas.append(node);
    }
    paintFindingSelection();
    const replayOrder = [...new Set([...retainedEdges].flatMap((key) => JSON.parse(key)))]
      .map((id) => graph.nodes.find((node) => node.id === id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    replay.disabled = replayOrder.length === 0;
    let replayTimer = 0;
    const stopReplay = () => {
      clearTimeout(replayTimer);
      replayTimer = 0;
      for (const node of nodeButtons.values()) node.classList.remove("is-replay", "is-visited");
      for (const { path } of edgeElements) path.classList.remove("is-lit");
      viewport.classList.remove("is-replaying");
      replay.setAttribute("aria-pressed", "false");
      replay.firstChild.replaceWith(window.WarbandIcons.create("play"));
      replay.lastChild.textContent = t("Rejouer");
    };
    cancelReplay = stopReplay;
    const replayStep = (index) => {
      if (!replay.isConnected) return stopReplay();
      if (index >= replayOrder.length) {
        replayStatus.textContent = t("Parcours visualisé.");
        replayTimer = setTimeout(() => {
          stopReplay();
          replayStatus.textContent = "";
        }, 1400);
        return;
      }
      const current = replayOrder[index];
      for (const node of nodeButtons.values()) node.classList.remove("is-replay");
      nodeButtons.get(current.id)?.classList.add("is-replay", "is-visited");
      const visited = new Set(replayOrder.slice(0, index + 1).map((node) => node.id));
      for (const { edge, path } of edgeElements)
        path.classList.toggle(
          "is-lit",
          retainedEdges.has(edgeKey(edge)) && visited.has(edge.from) && visited.has(edge.to),
        );
      replayStatus.textContent = t`Étape ${index + 1}/${replayOrder.length} : ${current.label}`;
      replayTimer = setTimeout(() => replayStep(index + 1), 700);
    };
    replay.addEventListener("click", (event) => {
      event.stopPropagation();
      if (replayTimer) {
        stopReplay();
        replayStatus.textContent = t("Rejeu interrompu.");
        return;
      }
      stopReplay();
      clearSelection();
      viewport.classList.add("is-replaying");
      replay.setAttribute("aria-pressed", "true");
      replay.firstChild.replaceWith(window.WarbandIcons.create("stop"));
      replay.lastChild.textContent = t("Arrêter");
      replayStep(0);
    });
    viewport.append(canvas);
    const aside = el("aside", "kc-legend");
    const legendHead = el("div", "kc-legend-head");
    const legendToggle = el("button", "ghost kc-legend-toggle");
    legendToggle.type = "button";
    legendToggle.setAttribute("aria-controls", "kc-legend-body");
    legendToggle.append(
      el("span", "btn-text", t("Légende")),
      window.WarbandIcons.create("caret", "caret"),
    );
    legendHead.append(legendToggle);
    const legendBody = el("div", "kc-legend-body");
    legendBody.id = "kc-legend-body";
    const filterButtons = [];
    const resetFilter = el("button", "ghost kc-filter-reset", t("Tout afficher"));
    resetFilter.type = "button";
    const paintFilter = () => {
      const matching = new Set(
        graph.nodes
          .filter(
            (node) =>
              (!legendFilter.kind || node.kind === legendFilter.kind) &&
              (!legendFilter.state || node.state === legendFilter.state),
          )
          .map((node) => node.id),
      );
      for (const [id, node] of nodeButtons) node.classList.toggle("is-dimmed", !matching.has(id));
      for (const { edge, path, hit } of edgeElements) {
        path.classList.toggle("is-dimmed", !matching.has(edge.from) || !matching.has(edge.to));
        hit.classList.toggle("is-dimmed", !matching.has(edge.from) || !matching.has(edge.to));
      }
      for (const button of filterButtons)
        button.setAttribute(
          "aria-pressed",
          String(legendFilter[button.dataset.filterField] === button.dataset.filterValue),
        );
      resetFilter.disabled = !legendFilter.kind && !legendFilter.state;
    };
    resetFilter.addEventListener("click", () => {
      legendFilter = { kind: null, state: null };
      paintFilter();
    });
    legendBody.append(resetFilter);
    for (const group of killchainLegend(findings)) {
      const sec = el("div", "kc-legend-group");
      sec.append(el("p", "kc-legend-title", group.label));
      const ul = el("ul", "kc-legend-list");
      for (const entry of group.entries) {
        const li = el("li", "");
        const button = el("button", "ghost kc-legend-item");
        button.type = "button";
        const field = entry.kind !== void 0 ? "kind" : "state";
        const value = entry.kind ?? entry.state;
        button.setAttribute("aria-pressed", String(legendFilter[field] === value));
        button.title = t`Mettre en évidence : ${entry.label}`;
        button.addEventListener("click", () => {
          legendFilter[field] = legendFilter[field] === value ? null : value;
          clearSelection();
          paintFilter();
        });
        if (entry.kind !== void 0) {
          const dot = el("span", `kc-dot kind-${entry.kind}`);
          dot.append(decorative(kindIcon(entry.kind)));
          button.append(dot);
        } else {
          button.append(decorative(el("span", `studio-kc-swatch is-${entry.state}`)));
        }
        button.append(el("span", "kc-legend-label", entry.label));
        button.append(el("span", "kc-legend-count", String(entry.count)));
        button.dataset.filterField = field;
        button.dataset.filterValue = value;
        filterButtons.push(button);
        li.append(button);
        ul.append(li);
      }
      sec.append(ul);
      legendBody.append(sec);
    }
    const pathHelp = el(
      "p",
      "studio-help kc-path-help",
      t(
        "Chemin retenu : liens verts marqués par l’agent ou par vous. Sélectionnez un lien pour le modifier.",
      ),
    );
    legendBody.append(pathHelp);
    paintFilter();
    aside.append(legendHead, legendBody);
    const setLegendCollapsed = (collapsed) => {
      legendCollapsed = collapsed;
      aside.classList.toggle("is-collapsed", collapsed);
      wrap.classList.toggle("legend-collapsed", collapsed);
      legendToggle.setAttribute("aria-expanded", String(!collapsed));
      legendBody.hidden = collapsed;
      legendToggle.title = collapsed ? t("Déplier la légende") : t("Replier la légende");
    };
    legendToggle.addEventListener("click", () => setLegendCollapsed(!legendCollapsed));
    if (legendCollapsed === null) {
      legendCollapsed =
        typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;
    }
    setLegendCollapsed(legendCollapsed);
    wrap.append(bar, viewport, aside);
    let scale = graphPose?.scale ?? 1;
    let tx = graphPose?.tx ?? 0;
    let ty = graphPose?.ty ?? 0;
    const mini = el("div", "kc-minimap");
    mini.setAttribute("role", "img");
    mini.setAttribute("aria-label", t("Minimap du graphe : zone actuellement visible"));
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
      ev.stopPropagation();
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
      const px = cx === void 0 ? vb.width / 2 : cx;
      const py = cy === void 0 ? vb.height / 2 : cy;
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
    viewport.tabIndex = 0;
    viewport.setAttribute("role", "group");
    viewport.setAttribute(
      "aria-label",
      t(
        "Graphe : flèches pour se déplacer, + et − pour zoomer, 0 pour ajuster, Échap pour désélectionner",
      ),
    );
    viewport.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        stopReplay();
        clearSelection();
        return;
      }
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const step = ev.shiftKey ? 160 : 48;
      const moves = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (moves[ev.key]) {
        tx += moves[ev.key][0];
        ty += moves[ev.key][1];
        apply();
      } else if (ev.key === "+" || ev.key === "=") setScale(scale * 1.2);
      else if (ev.key === "-" || ev.key === "−") setScale(scale / 1.2);
      else if (ev.key === "0") fitToView();
      else return;
      touched = true;
      ev.preventDefault();
    });
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
      ignoreGraphClick = false;
      drag = { x: ev.clientX - tx, y: ev.clientY - ty, startX: ev.clientX, startY: ev.clientY };
      viewport.setPointerCapture(ev.pointerId);
      viewport.classList.add("is-panning");
    });
    viewport.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY) > 4)
        ignoreGraphClick = true;
      tx = ev.clientX - drag.x;
      ty = ev.clientY - drag.y;
      apply();
    });
    const endDrag = () => {
      drag = null;
      viewport.classList.remove("is-panning");
    };
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", () => {
      endDrag();
      ignoreGraphClick = false;
    });
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
        stopReplay();
        disposed = true;
        observer.disconnect();
      };
    } else {
      graphCleanup = stopReplay;
      if (!touched) fitToView();
    }
    if (touched) apply();
    return wrap;
  }
  function auditPage(view, project) {
    const label = (value) => globalThis.WarbandI18n?.auditLabel(value) ?? value;
    const sec = el("section", "studio-card audit-page");
    sec.append(el("h2", "", t("Audit")));
    if (!project) {
      sec.append(
        el("p", "studio-help", t("Activez un projet pour démarrer sa collecte Audit automatique.")),
      );
      return sec;
    }
    if (view.auditError) {
      const error = el("p", "audit-warning", view.auditError);
      error.setAttribute("role", "alert");
      sec.append(error);
    }
    const audit = view.audit;
    if (!audit) {
      sec.append(el("p", "studio-help", t("Journal d’audit indisponible.")));
      return sec;
    }
    const head = el("div", "audit-toolbar");
    const toggle = el("button", "resource-toggle", t("Capture automatique"));
    toggle.type = "button";
    toggle.id = "audit-enabled";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(audit.enabled));
    toggle.addEventListener("click", () => {
      toggle.disabled = true;
      vscode.postMessage({ type: "setAuditEnabled", projectId: project, enabled: !audit.enabled });
    });
    head.append(toggle, el("span", "audit-badge", audit.enabled ? t("Auto") : t("En pause")));
    const download = el("button", "primary", t("Exporter le dossier d’audit"));
    download.type = "button";
    download.id = "audit-export";
    download.addEventListener("click", () =>
      vscode.postMessage({ type: "exportAudit", projectId: project }),
    );
    head.append(download);
    sec.append(
      head,
      el(
        "p",
        "studio-help",
        t(
          "Actions de l’agent et captures périodiques des terminaux RedWidow associés au projet, même sans IA. Conservation séparée du chat, sans effacement automatique.",
        ),
      ),
      el("p", "studio-help", t("Une exécution enregistrée ne constitue pas un contrôle validé.")),
      el(
        "p",
        "studio-help",
        t(
          "Les captures manuelles sont périodiques et bornées ; les outils externes ne sont pas enregistrés.",
        ),
      ),
      el(
        "p",
        "studio-help",
        t(
          "Le ZIP contient un HTML autonome, le registre, les preuves conservées, les JSONL et un manifeste SHA-256. Ces empreintes ne sont ni une signature ni un horodatage indépendant.",
        ),
      ),
    );
    if (audit.health?.incomplete || !audit.enabled) {
      const warning = el(
        "p",
        "audit-warning",
        t(
          "Collecte partielle : pauses, captures indisponibles ou sorties tronquées. Consultez les traces et le manifeste.",
        ),
      );
      warning.setAttribute("role", "status");
      sec.append(warning);
      if (audit.health?.error) sec.append(el("pre", "audit-raw", audit.health.error));
    }
    if (audit.viewLimited)
      sec.append(
        el(
          "p",
          "audit-warning",
          t(
            "Aperçu limité aux traces récentes. Les journaux conservés restent présents dans le ZIP ; le registre exporté est également un aperçu.",
          ),
        ),
      );
    sec.append(
      el(
        "p",
        "studio-help",
        t`${audit.records.length} traces affichées · ${audit.tests.length} contrôles · ${Math.ceil(audit.bytes / 1024)} Kio conservés`,
      ),
    );
    sec.append(el("h3", "", t("Registre des contrôles")));
    sec.append(
      el(
        "p",
        "studio-help",
        t(
          "Brouillons automatiques et annotations de l’agent : vérifiez objectif, cible et preuves avant de les qualifier.",
        ),
      ),
    );
    const registry = el("div", "audit-tests");
    if (!audit.tests.length)
      registry.append(el("p", "studio-help", t("Aucun contrôle enregistré.")));
    for (const test of [...audit.tests].reverse()) {
      const item = el("details", "audit-test");
      item.id = `audit-test-${test.id}`;
      const summary = el("summary");
      summary.append(
        el("strong", "", test.objective),
        el("span", "audit-badge", t(test.reviewed ? "Revu par l’opérateur" : "À qualifier")),
      );
      item.append(
        summary,
        el("p", "studio-help", `${test.startedAt} → ${test.ts}`),
        el(
          "p",
          "",
          `${test.target} · ${label(test.execution)} · ${label(test.conclusion)} · ${label(test.author)}`,
        ),
        el("pre", "audit-raw", test.observed),
        el("p", "studio-help audit-refs", `ID : ${test.id}\n${test.evidenceIds.join("\n")}`),
      );
      const form = el("form", "audit-review");
      const draftKey = `${project}:${test.id}`;
      const draft = auditDrafts.get(draftKey) ?? {
        objective: test.objective,
        target: test.target,
        testContext: test.testContext,
        method: test.method,
        observed: test.observed,
        conclusion: test.conclusion === "unreviewed" ? "inconclusive" : test.conclusion,
      };
      const labels = {
        objective: "Objectif du contrôle",
        target: "Cible",
        testContext: "Contexte de test / accès",
        method: "Méthode",
        observed: "Observations et limites",
      };
      const limits = {
        objective: 500,
        target: 500,
        testContext: 1000,
        method: 1000,
        observed: 8000,
      };
      for (const key of Object.keys(labels)) {
        const label = el("label", "", t(labels[key]));
        const input = el(key === "observed" ? "textarea" : "input", "studio-project-control");
        input.id = `audit-edit-${test.id}-${key}`;
        input.name = key;
        input.value = draft[key] ?? "";
        input.maxLength = limits[key];
        input.required = ["objective", "method", "observed"].includes(key);
        if (key === "observed") input.rows = 4;
        input.addEventListener("input", () => {
          draft[key] = input.value;
          auditDrafts.set(draftKey, draft);
          if (auditDrafts.size > 1000) auditDrafts.delete(auditDrafts.keys().next().value);
        });
        label.htmlFor = input.id;
        form.append(label, input);
      }
      const outcomeLabel = el("label", "", t("Conclusion du contrôle"));
      const outcome = el("select", "studio-project-control");
      outcome.id = `audit-edit-${test.id}-conclusion`;
      outcomeLabel.htmlFor = outcome.id;
      for (const value of ["finding", "not-observed", "inconclusive"]) {
        const option = el("option", "", label(value));
        option.value = value;
        outcome.append(option);
      }
      outcome.value = draft.conclusion;
      outcome.addEventListener("change", () => {
        draft.conclusion = outcome.value;
        auditDrafts.set(draftKey, draft);
      });
      const save = el("button", "ghost", t("Enregistrer ma qualification"));
      save.type = "submit";
      form.append(outcomeLabel, outcome, save);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        save.disabled = true;
        vscode.postMessage({
          type: "reviewAuditTest",
          projectId: project,
          testId: test.id,
          claim: { ...draft },
        });
      });
      item.append(form);
      registry.append(item);
    }
    sec.append(registry, el("h3", "", t("Journal de mission")));
    const filters = el("div", "audit-filters");
    const records = el("div", "audit-records");
    const count = el("p", "studio-help");
    count.setAttribute("role", "status");
    const rows = [];
    const apply = () => {
      let shown = 0;
      const from = auditFilters.from ? new Date(auditFilters.from).getTime() : -Infinity;
      const to = auditFilters.to ? new Date(auditFilters.to).getTime() : Infinity;
      for (const row of rows) {
        row.node.hidden =
          (!!auditFilters.actor && row.record.actor !== auditFilters.actor) ||
          (!!auditFilters.kind && row.kind !== auditFilters.kind) ||
          !row.search.includes(auditFilters.search.toLowerCase()) ||
          new Date(row.record.ts).getTime() < from ||
          new Date(row.record.ts).getTime() > to;
        if (!row.node.hidden) shown++;
      }
      count.textContent = t`${shown} traces correspondantes`;
    };
    for (const [key, label, type] of [
      ["search", "Cible, outil, commande ou résultat", "search"],
      ["from", "À partir du (heure locale)", "datetime-local"],
      ["to", "Jusqu’au (heure locale)", "datetime-local"],
    ]) {
      const wrap = el("label", "studio-help", t(label));
      const input = el("input", "studio-project-control");
      input.type = type;
      input.id = `audit-filter-${key}`;
      input.value = auditFilters[key];
      wrap.htmlFor = input.id;
      input.addEventListener("input", () => {
        auditFilters[key] = input.value;
        apply();
      });
      wrap.append(input);
      filters.append(wrap);
    }
    const kinds = [...new Set(audit.records.map((row) => row.data.kind ?? row.kind))].sort();
    for (const [key, label, choices] of [
      ["actor", "Tous les acteurs", ["agent", "operator", "system"]],
      ["kind", "Tous les événements", kinds],
    ]) {
      const wrap = el("label", "studio-help", t(label));
      const input = el("select", "studio-project-control");
      input.id = `audit-filter-${key}`;
      wrap.htmlFor = input.id;
      for (const value of ["", ...choices]) {
        const option = el(
          "option",
          "",
          value ? (globalThis.WarbandI18n?.auditLabel(value) ?? value) : t(label),
        );
        option.value = value;
        input.append(option);
      }
      input.value = auditFilters[key];
      input.addEventListener("change", () => {
        auditFilters[key] = input.value;
        apply();
      });
      wrap.append(input);
      filters.append(wrap);
    }
    for (const record of [...audit.records].reverse()) {
      const item = el("details", "audit-record");
      item.id = `audit-record-${record.id}`;
      const kind = record.data.kind ?? record.kind;
      item.append(
        el("summary", "", `${record.ts} · ${label(record.actor)} · ${kind}`),
        el(
          "p",
          "studio-help audit-refs",
          `${record.source ?? record.runId ?? ""} · ID : ${record.id}`,
        ),
        el("pre", "audit-raw", JSON.stringify(record.data, null, 2)),
      );
      records.append(item);
      rows.push({ node: item, record, kind, search: JSON.stringify(record).toLowerCase() });
    }
    apply();
    sec.append(filters, count, records);
    return sec;
  }

  function render(view, force = false) {
    lastView = { ...view, summarySaved: undefined, summaryFailed: undefined };
    // Une arrivée de traces ne doit pas interrompre la saisie dans une qualification.
    if (
      !force &&
      view.page === "audit" &&
      lastAuditProject === view.projectId &&
      document.activeElement?.closest?.(".audit-review") &&
      !document.activeElement.disabled
    )
      return;
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
      selectedFinding = null;
      selectedEdge = null;
      pendingPathEdge = null;
      legendFilter = { kind: null, state: null };
      pendingFindingDelete = null;
    }
    const findingExists = (id) =>
      Array.isArray(view.findings) && view.findings.some((entry) => entry?.id === id);
    if (selectedFinding !== null && !findingExists(selectedFinding)) selectedFinding = null;
    if (
      selectedEdge &&
      !view.findings?.some(
        (node) => node?.id === selectedEdge.to && node.from?.includes(selectedEdge.from),
      )
    )
      selectedEdge = null;
    if (pendingFindingDelete !== null && !findingExists(pendingFindingDelete.id)) {
      pendingFindingDelete = null;
    }
    const fingerprint =
      page === "killchain"
        ? JSON.stringify([
            view.findings ?? [],
            view.evidence ?? [],
            globalThis.WarbandI18n?.getLocale() ?? "fr",
          ])
        : null;
    showGraphError("");
    if (fingerprint !== null && fingerprint === graphFingerprint) return;
    graphFingerprint = fingerprint;
    const restoreAudit =
      page === "audit" && lastAuditProject === project ? captureLocaleState() : () => {};
    lastAuditProject = page === "audit" ? project : null;
    graphCleanup();
    graphCleanup = () => {};
    paintFindingSelection = () => {};
    graphStatus = null;
    graphBar = null;
    while (main.firstChild) main.removeChild(main.firstChild);
    if (!killchainOnly) paintNav(page, view.findings, view);
    if (page === "audit") {
      main.append(auditPage(view, project));
      restoreAudit();
      return;
    }
    if (page === "project") {
      const sec = el("section", "studio-card");
      sec.append(el("h2", "", t("Projet")));
      for (const [label, type] of [
        [t("Ouvrir l’espace RedWidow"), "openWorkspace"],
        [t("Préparer et vérifier les fichiers de mission"), "prepareMission"],
      ]) {
        const button = el("button", "ghost", label);
        button.type = "button";
        button.addEventListener("click", () => vscode.postMessage({ type }));
        sec.append(button);
      }
      const choices = view.projectChoices;
      if (choices && Array.isArray(choices.projects)) {
        const projectBusy = view.projectBusy === true;
        if (projectBusy)
          sec.append(
            el(
              "p",
              "studio-help",
              t("Attendez la fin du travail en cours pour changer de projet."),
            ),
          );
        if (typeof view.projectCreated === "string") {
          projectNameDraft = "";
          projectPanel = "choose";
        }
        const current = choices.projects.find((p) => p.id === choices.activeId);
        const active = el("div", "studio-project-active");
        active.append(el("p", "studio-kicker", t("Projet actif")));
        active.append(
          el("p", "studio-project-active-name", current?.name ?? t("Aucun projet actif")),
        );
        if (current) active.append(el("p", "studio-project-path", current.workspace));
        sec.append(active);
        if (choices.projects.length === 0) projectPanel = "create";
        else if (projectPanel === null) projectPanel = "choose";
        const tabs = el("div", "studio-project-tabs");
        tabs.setAttribute("role", "group");
        tabs.setAttribute("aria-label", t("Gestion des projets"));
        const chooseTab = el("button", "", t("Choisir un projet"));
        chooseTab.type = "button";
        chooseTab.id = "project-choose-tab";
        chooseTab.disabled = choices.projects.length === 0;
        const createTab = el("button", "", t("Nouveau projet"));
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
          const label2 = el("label", "studio-help", t("Choisir un projet"));
          label2.htmlFor = "project-choice";
          const select = el("select", "studio-project-control");
          select.id = "project-choice";
          select.disabled = projectBusy;
          const placeholder = el("option", "", t("Choisir un projet…"));
          placeholder.value = "";
          placeholder.disabled = true;
          select.append(placeholder);
          for (const project2 of choices.projects) {
            const option = el("option", "", project2.name);
            option.value = project2.id;
            select.append(option);
          }
          select.value = choices.activeId ?? "";
          const activate = el("button", "primary", t("Activer le projet"));
          activate.type = "button";
          const update2 = () => {
            activate.disabled = projectBusy || !select.value || select.value === choices.activeId;
          };
          select.addEventListener("change", update2);
          activate.addEventListener("click", () => {
            if (activate.disabled) return;
            activate.disabled = true;
            vscode.postMessage({ type: "activateProject", projectId: select.value });
          });
          update2();
          const rename = el("button", "ghost", t("Renommer…"));
          const remove = el("button", "ghost", t("Supprimer…"));
          rename.type = remove.type = "button";
          rename.id = "project-rename";
          remove.id = "project-delete";
          const managementState = () => {
            rename.disabled = remove.disabled = projectBusy || !select.value;
          };
          select.addEventListener("change", managementState);
          for (const [button, type] of [
            [rename, "renameProject"],
            [remove, "deleteProject"],
          ]) {
            button.addEventListener("click", () => {
              if (button.disabled) return;
              rename.disabled = remove.disabled = true;
              vscode.postMessage({ type, projectId: select.value });
            });
          }
          managementState();
          choosePanel.append(label2, select, activate, rename, remove);
        }
        const label = el("label", "studio-help", t("Nom du nouveau projet"));
        label.htmlFor = "project-name";
        const name = el("input", "studio-project-control");
        name.id = "project-name";
        name.type = "text";
        name.maxLength = 80;
        name.value = projectNameDraft;
        name.disabled = projectBusy;
        const create = el("button", "primary", t("Créer un projet et choisir son dossier…"));
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
          el("p", "studio-help", t("Donnez un nom au projet, puis choisissez son dossier.")),
          label,
          name,
          create,
        );
      }
      if (typeof view.projectError === "string") {
        const error = el("p", "studio-help", t(view.projectError));
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
            t("Aucun conteneur affiché. Gérez les associations dans le cockpit."),
          ),
        );
      } else {
        const b = view.linkedBanner;
        sec.append(el("p", "studio-kicker", t("Espace affiché")));
        sec.append(el("p", "studio-name", b.name));
        sec.append(el("p", "studio-help", b.workspace));
      }
      const summary = view.projectSummary;
      if (summary && typeof summary.projectId === "string" && typeof summary.text === "string") {
        const id = summary.projectId;
        sec.append(el("h2", "", t("Mémoire du projet")));
        sec.append(
          el(
            "p",
            "studio-help",
            t("Notes privées du projet. Non transmises automatiquement aux conversations."),
          ),
        );
        const label = el("label", "studio-help", t("Résumé de session"));
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
        const save = el("button", "primary", t("Enregistrer le résumé"));
        save.type = "button";
        const update = () => {
          const bytes = new TextEncoder().encode(input.value).length;
          save.disabled = bytes > 8192 || summarySaving.has(id);
          status.textContent =
            bytes > 8192
              ? t("Résumé trop long : 8 Kio maximum.")
              : t`${bytes} / 8192 octets · Les secrets reconnus sont masqués à l’enregistrement.`;
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
          status.textContent = t("Enregistrement…");
          vscode.postMessage({ type: "saveSummary", projectId: id, text: input.value });
        });
        update();
        if (view.summarySaved === id) status.textContent = t("Résumé enregistré.");
        if (typeof view.summaryError === "string") status.textContent = t(view.summaryError);
        sec.append(label, input, status, save);
      } else if (typeof view.summaryError === "string") {
        const error = el("p", "studio-help", t(view.summaryError));
        error.setAttribute("role", "status");
        sec.append(error);
      }
      main.append(sec);
      return;
    }
    if (page === "containers" || page === "system") {
      const sec = el("section", "studio-card");
      const header = el("div", "studio-section-head");
      header.append(el("h2", "", page === "system" ? t("Contrôle système") : t("Conteneurs")));
      if (page === "containers") {
        const manage = el("button", "secondary");
        manage.type = "button";
        manage.append(
          window.WarbandIcons.create("sliders"),
          el("span", "btn-text", t("Gérer les econtainers")),
        );
        manage.addEventListener("click", () => vscode.postMessage({ type: "openCockpit" }));
        header.append(manage);
      }
      sec.append(header);
      // Tuiles d'état : pictogramme, libellé, valeur et pastille de ton.
      const dl = el("dl", "studio-dl studio-tiles");
      const row = (k, v, tone, icon) => {
        const tile = el("div", `studio-tile tone-${tone}`);
        const head = el("dt", "studio-tile-label");
        head.append(window.WarbandIcons.create(icon, "ico studio-tile-ico"), el("span", "", k));
        const value = el("dd", "studio-tile-value");
        value.append(decorative(el("span", "dot")), el("span", "", v));
        tile.append(head, value);
        dl.append(tile);
      };
      row(
        "Docker",
        view.docker === "present" ? t("présent") : t("absent"),
        view.docker === "present" ? "ok" : "warn",
        "image",
      );
      row(
        t("Démon"),
        view.daemon === "reachable"
          ? t("joignable")
          : view.daemon === "unreachable"
            ? t("injoignable")
            : "—",
        view.daemon === "reachable" ? "ok" : view.daemon === "unreachable" ? "err" : "idle",
        "pulse",
      );
      row(
        "Exegol",
        view.exegol === "present" ? t("présent") : t("absent"),
        view.exegol === "present" ? "ok" : "warn",
        "server",
      );
      sec.append(dl);
      if (page === "system") {
        const caps = view.capabilities ?? {
          providers: [],
          skills: [],
          integrations: [],
          webSearch: false,
        };
        sec.append(
          el("h2", "", t("Fournisseurs IA")),
          el(
            "p",
            "studio-help",
            t(
              "Configurez une connexion, puis activez son accès dans le chat. Les clés restent dans le stockage sécurisé ou le gestionnaire du fournisseur.",
            ),
          ),
        );
        const capabilityRow = (kind, id, label, enabled, configure, detail, parent = sec) => {
          const row = el("div", "capability-row");
          const toggle = el("button", "resource-toggle", label);
          toggle.type = "button";
          toggle.id = `capability-${kind}-${id}`;
          toggle.setAttribute("role", "switch");
          toggle.setAttribute("aria-checked", String(enabled));
          toggle.addEventListener("click", () => {
            const on = toggle.getAttribute("aria-checked") !== "true";
            toggle.setAttribute("aria-checked", String(on));
            vscode.postMessage({ type: "setCapability", kind, id, enabled: on });
          });
          row.append(toggle);
          if (detail) row.append(el("span", "studio-help", detail));
          if (configure) {
            const button = el("button", "ghost resource-configure", t("Configurer"));
            button.type = "button";
            button.addEventListener("click", () => vscode.postMessage(configure));
            row.append(button);
          }
          parent.append(row);
        };
        const allProviders = view.providerCatalog ?? [];
        for (const p of allProviders.filter((p) => !p.runtimeId))
          capabilityRow("provider", p.id, p.label, caps.providers.includes(p.id), {
            type: "configureProvider",
            id: p.id,
          });
        const catalogHeader = el("div", "provider-catalog-head");
        catalogHeader.append(el("h3", "", t("Fournisseurs OpenCode")));
        const refreshProviders = el("button", "ghost", t("Actualiser le catalogue"));
        refreshProviders.type = "button";
        refreshProviders.disabled = view.providerCatalogStatus === "loading";
        refreshProviders.addEventListener("click", () =>
          vscode.postMessage({ type: "refreshProviderCatalog" }),
        );
        catalogHeader.append(refreshProviders);
        sec.append(catalogHeader);
        const providerStatus = el(
          "p",
          "studio-help",
          view.providerCatalogStatus === "loading"
            ? t("Chargement du catalogue OpenCode…")
            : view.providerCatalogError ||
                t(
                  "Activez les fournisseurs souhaités. OpenCode conserve aussi son accès général à tous les modèles connectés.",
                ),
        );
        providerStatus.setAttribute("role", "status");
        sec.append(providerStatus);
        const searchProviders = el("input", "provider-catalog-search");
        searchProviders.type = "search";
        searchProviders.id = "provider-catalog-filter";
        searchProviders.value = providerFilter;
        searchProviders.placeholder = t("Rechercher un fournisseur…");
        searchProviders.setAttribute("aria-label", t("Rechercher un fournisseur"));
        const providerList = el("div", "provider-catalog-list");
        for (const p of allProviders.filter((p) => p.runtimeId))
          capabilityRow(
            "provider",
            p.id,
            p.label,
            caps.providers.includes(p.id),
            { type: "configureProvider", id: p.id },
            p.connected ? t("connecté") : t("à connecter"),
            providerList,
          );
        const filterProviders = () => {
          providerFilter = searchProviders.value;
          const query = searchProviders.value.trim().toLocaleLowerCase();
          for (const row of providerList.children)
            row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
        };
        searchProviders.addEventListener("input", filterProviders);
        filterProviders();
        sec.append(searchProviders, providerList);
        const addProvider = el("button", "ghost", t("Ajouter Ollama / un endpoint compatible"));
        addProvider.type = "button";
        addProvider.addEventListener("click", () =>
          vscode.postMessage({ type: "configureProvider", id: "add" }),
        );
        sec.append(addProvider);
        sec.append(
          el("h2", "", t("Skills / méthodes")),
          el(
            "p",
            "studio-help",
            t(
              "Activez les méthodes à proposer dans le menu + du chat. Choisissez ensuite une méthode par conversation.",
            ),
          ),
        );
        for (const p of view.skillCatalog ?? [])
          capabilityRow("skill", p.id, p.label, caps.skills.includes(p.id));
        sec.append(
          el("h2", "", t("Connecteurs MCP")),
          el(
            "p",
            "studio-help",
            t(
              "Configurez les services locaux du projet, puis activez-les. Ils apparaîtront dans le menu + du chat pour une sélection explicite. Quatre services maximum.",
            ),
          ),
        );
        for (const entry of view.mcpCatalog ?? [])
          capabilityRow(
            "mcp",
            entry.id,
            entry.label,
            caps.integrations.includes(entry.id),
            { type: "configureMcp", id: entry.id },
            (view.mcpConfigured ?? []).some((c) => c.id === entry.id)
              ? t("configuré")
              : t("non configuré"),
          );
        capabilityRow(
          "mcp",
          "burp",
          "Burp Suite",
          caps.integrations.includes("burp"),
          { type: "configureBurp" },
          view.burpEnabled ? t("configuré") : t("non configuré"),
        );
        sec.append(el("h2", "", t("Recherche web")));
        capabilityRow(
          "web",
          "search",
          t("Recherche web"),
          caps.webSearch,
          null,
          t("Disponible à la demande dans le menu +. Désactivée pour les nouvelles conversations."),
        );
        sec.append(el("h2", "", "Burp Suite MCP"));
        sec.append(
          el(
            "p",
            "studio-help",
            view.burpEnabled
              ? t(
                  "Connexion locale activée. Les appels aux outils restent soumis à la gate RedWidow.",
                )
              : t(
                  "Connexion désactivée. Installez l’extension MCP officielle dans Burp Suite pour la connecter.",
                ),
          ),
        );
        const configure = el("button", "ghost", t("Configurer Burp Suite MCP…"));
        const test = el("button", "ghost", t("Tester la connexion"));
        configure.type = test.type = "button";
        configure.id = "burp-configure";
        test.id = "burp-test";
        configure.addEventListener("click", () => vscode.postMessage({ type: "configureBurp" }));
        test.addEventListener("click", () => vscode.postMessage({ type: "testBurp" }));
        sec.append(configure, test);
        if (view.burpStatus) {
          const status = el("p", "studio-help", t(view.burpStatus));
          status.setAttribute("role", "status");
          sec.append(status);
        }
      }
      if (page === "containers") {
        const running = (view.containers ?? []).filter((c) => c.state === "running").length;
        const listHead = el("div", "studio-list-head");
        listHead.append(
          el("p", "studio-kicker", t("Conteneurs")),
          el("span", "studio-count", t`${running}/${(view.containers ?? []).length} actifs`),
        );
        if ((view.containers ?? []).length > 0) sec.append(listHead);
        const ul = el("ul", "studio-rows");
        for (const c of view.containers ?? []) {
          const li = el(
            "li",
            `studio-row studio-space ${c.state === "running" ? "is-running" : "is-stopped"}`,
          );
          li.append(
            window.WarbandIcons.create("container", "ico studio-space-ico"),
            el("span", "studio-ellipsis", c.name),
            el("span", "studio-state", c.state === "running" ? t("en cours") : t("arrêté")),
          );
          li.querySelector(".studio-state").prepend(
            decorative(el("span", `dot ${c.state === "running" ? "is-running" : "is-stopped"}`)),
          );
          ul.append(li);
        }
        if ((view.containers ?? []).length > 0) sec.append(ul);
        if ((view.containers ?? []).length === 0) {
          sec.append(
            el(
              "p",
              "studio-help",
              t("Aucun conteneur pour l’instant. Créez-en un depuis « Gérer les econtainers »."),
            ),
          );
        }
      }
      main.append(sec);
      return;
    }
    if (page === "killchain") {
      if (killchainOnly) {
        const sec2 = el("section", "studio-kc-page");
        const graph = killchainGraph(view.findings);
        if (graph.nodes.length > 0) {
          sec2.append(killchainGraphView(graph, view.findings, project, view.evidence));
        } else {
          const wrap = el("div", "studio-kc");
          const viewport = el("div", "kc-viewport kc-empty");
          viewport.append(
            el(
              "p",
              "studio-help",
              t("Le graphe est vide : les éléments notés par l’agent apparaîtront ici."),
            ),
          );
          wrap.append(viewport);
          sec2.append(wrap);
        }
        main.append(sec2);
        return;
      }
      const count = killchainCount(view.findings);
      const sec = empty(
        t("Graphe"),
        count === null
          ? t(
              "Graphe des éléments notés par l’agent. Ouvrez la vue plein écran pour explorer le graphe.",
            )
          : t`${count} élément${count > 1 ? "s" : ""} : ouvrez la vue plein écran pour le graphe interactif.`,
      );
      const open = el("button", "primary");
      open.type = "button";
      open.append(el("span", "btn-text", t("Ouvrir le graphe")));
      open.addEventListener("click", () => vscode.postMessage({ type: "openKillchain" }));
      sec.append(open);
      main.append(sec);
      return;
    }
    if (page === "appearance") {
      main.append(appearancePage());
      return;
    }
    if (page === "atlas") {
      const sec = empty(
        "Atlas",
        t(
          "Dossier de cours lu par le mode Apprentissage, en lecture seule. Aucun cours inclus : dépose-y des sources libres, un sous-dossier par source.",
        ),
      );
      const open = el("button", "primary", t("Ouvrir le dossier de cours"));
      open.type = "button";
      open.addEventListener("click", () => vscode.postMessage({ type: "openCours" }));
      sec.append(open);
      const sources = Array.isArray(view.sources) ? view.sources : [];
      if (sources.length === 0) {
        sec.append(el("p", "studio-help", t("Aucune source dans le dossier de cours.")));
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
    main.append(empty(t("Réglages"), t("Choisissez une rubrique dans la navigation.")));
  }
  window.addEventListener("pagehide", () => graphCleanup());
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "locale" && (msg.locale === "fr" || msg.locale === "en")) {
      const restore = captureLocaleState();
      globalThis.WarbandI18n?.setLocale(msg.locale);
      if (lastView) render(lastView, true);
      globalThis.WarbandI18n?.applyStatic(document);
      restore();
      return;
    }
    if (msg?.type === "pathEdgeState") {
      if (
        !pendingPathEdge ||
        msg.projectId !== pendingPathEdge.projectId ||
        msg.from !== pendingPathEdge.from ||
        msg.to !== pendingPathEdge.to
      )
        return;
      pendingPathEdge = null;
      paintFindingSelection();
      if (typeof msg.error === "string") showGraphError(t(msg.error));
      return;
    }
    if (msg?.type === "findingDeleteState") {
      if (
        pendingFindingDelete === null ||
        msg.projectId !== pendingFindingDelete.projectId ||
        msg.id !== pendingFindingDelete.id ||
        typeof msg.busy !== "boolean"
      ) {
        return;
      }
      if (!msg.busy) pendingFindingDelete = null;
      paintFindingSelection();
      if (typeof msg.error === "string") showGraphError(t(msg.error));
      return;
    }
    if (msg?.type === "findingsError") {
      if (msg.projectId !== void 0 && msg.projectId !== graphProject) return;
      showGraphError(
        typeof msg.message === "string" ? msg.message : t("Actualisation du graphe indisponible."),
      );
      return;
    }
    if (msg?.type === "palette" && PALETTES.some(([id]) => id === msg.value)) {
      applyPalette(msg.value);
      repaintPalette();
      return;
    }
    if (msg?.type === "paletteError") {
      repaintPalette(t("Impossible d’enregistrer le jeu de couleurs. Réessayez."));
      return;
    }
    if (msg?.type !== "view") return;
    render(msg);
  });
  vscode.postMessage({ type: "refresh" });
}
