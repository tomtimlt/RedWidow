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

// Exposée pour les tests (même convention que ui.js : pas de module dans la webview).
globalThis.JohnStudio = { STUDIO_GROUPS, killchainCount, navModel };

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
      const board = el("div", "studio-board");
      for (const node of view.findings ?? []) {
        const pill = el("span", `studio-node is-${node.state}`, node.label);
        pill.title = `${node.kind} · ${node.state}`;
        board.append(pill);
      }
      sec.append(board);
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
      main.append(
        empty("Atlas", "Lecteur des Markdown d'un dossier que tu choisis. Aucun cours inclus."),
      );
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
