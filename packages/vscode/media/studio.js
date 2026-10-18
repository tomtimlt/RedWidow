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

// Exposée pour les tests (même convention que ui.js : pas de module dans la webview).
globalThis.WarbandStudio = {
  STUDIO_GROUPS,
  MITRE_TACTICS,
  killchainCount,
  killchainModel,
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
        b.append(decorative(el("span", "studio-ico", item.icon)));
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

  function killchainBoard(model) {
    const wrap = el("div", "studio-kc");
    const scroll = el("div", "studio-kc-scroll");
    const grid = el("div", "studio-board");
    const nodes = new Map();
    for (const col of model.columns) {
      const colEl = el("div", "studio-kc-col");
      colEl.append(
        el("h3", "studio-kc-head", col.tactic ? `${col.tactic} · ${col.label}` : col.label),
      );
      for (const f of col.nodes) {
        const node = el("div", `studio-node is-${f.state}`);
        node.append(el("span", "studio-node-label", f.label));
        const meta = [f.kind, f.technique].filter(Boolean).join(" · ");
        if (meta) node.append(el("span", "studio-node-meta", meta));
        node.title = [f.kind, f.state, f.technique].filter(Boolean).join(" · ");
        nodes.set(f.id, node);
        colEl.append(node);
      }
      grid.append(colEl);
    }

    const svg = decorative(document.createElementNS(SVG_NS, "svg"));
    svg.setAttribute("class", "studio-kc-edges");
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "studio-kc-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto");
    const tip = document.createElementNS(SVG_NS, "path");
    tip.setAttribute("d", "M0 0 L10 5 L0 10 z");
    tip.setAttribute("class", "studio-kc-tip");
    marker.append(tip);
    defs.append(marker);
    svg.append(defs);
    const paths = document.createElementNS(SVG_NS, "g");
    svg.append(paths);
    grid.append(svg);

    // Les flèches se calculent après mise en page : repère = la grille (indépendant du défilement).
    function drawEdges() {
      while (paths.firstChild) paths.removeChild(paths.firstChild);
      const box = grid.getBoundingClientRect();
      svg.setAttribute("width", String(grid.scrollWidth));
      svg.setAttribute("height", String(grid.scrollHeight));
      for (const edge of model.edges) {
        const a = nodes.get(edge.from);
        const b = nodes.get(edge.to);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = ra.right - box.left;
        const y1 = ra.top + ra.height / 2 - box.top;
        const x2 = rb.left - box.left;
        const y2 = rb.top + rb.height / 2 - box.top;
        const dx = Math.max(24, Math.abs(x2 - x1) / 2);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
        path.setAttribute("class", "studio-kc-edge");
        path.setAttribute("marker-end", "url(#studio-kc-arrow)");
        paths.append(path);
      }
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(drawEdges).observe(grid);
    scroll.addEventListener("scroll", drawEdges, { passive: true });
    scroll.append(grid);
    wrap.append(scroll);

    const legend = el("ul", "studio-kc-legend");
    for (const [state, text] of [
      ["confirmed", "Confirmé"],
      ["hypothesis", "Hypothèse"],
      ["failed", "Échec"],
    ]) {
      const li = el("li", "studio-kc-key");
      li.append(decorative(el("span", `studio-kc-swatch is-${state}`)), el("span", "", text));
      legend.append(li);
    }
    wrap.append(legend);
    // Premier calcul une fois la mise en page faite (ResizeObserver notifie à l'observation).
    drawEdges();
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
        sec.append(
          el(
            "p",
            "studio-help",
            "Aucun conteneur dédié. Lance-en un avec /start <nom> dans le chat.",
          ),
        );
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
          sec.append(el("p", "studio-help", "Aucun conteneur. /start <nom> dans le chat."));
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
      const model = killchainModel(view.findings);
      if (model.columns.length > 0) sec.append(killchainBoard(model));
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
