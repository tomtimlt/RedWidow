// Réglages : navigation et pages. DOM sûr (textContent).
(() => {
  const vscode = acquireVsCodeApi();
  const nav = document.getElementById("studio-nav");
  const main = document.getElementById("studio-main");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const PAGES = [
    ["project", "Projet"],
    ["containers", "Conteneurs"],
    ["providers", "Fournisseurs"],
    ["model", "Modèle"],
    ["harness", "Harness"],
    ["mcp", "MCP"],
    ["atlas", "Atlas"],
    ["layout", "Disposition"],
    ["modes", "Modes"],
    ["personas", "Personas"],
    ["approvals", "Approbations"],
    ["killchain", "Kill chain"],
    ["system", "Contrôle système"],
  ];

  function paintNav(current) {
    if (!nav) return;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    const title = el("div", "studio-nav-title", "Réglages");
    nav.append(title);
    for (const [id, label] of PAGES) {
      const b = el(
        "button",
        id === current ? "ghost studio-nav-btn is-current" : "ghost studio-nav-btn",
      );
      b.type = "button";
      b.append(el("span", "btn-text", label));
      b.addEventListener("click", () => vscode.postMessage({ type: "open", page: id }));
      nav.append(b);
    }
  }

  function empty(title, text) {
    const sec = el("section", "studio-card");
    sec.append(el("h2", "", title), el("p", "cockpit-muted", text));
    return sec;
  }

  function render(view) {
    if (!main) return;
    while (main.firstChild) main.removeChild(main.firstChild);
    paintNav(view.page);
    const page = view.page;
    if (page === "project") {
      const sec = el("section", "studio-card");
      sec.append(el("h2", "", "Projet"));
      if (!view.linkedBanner) {
        sec.append(
          el(
            "p",
            "cockpit-muted",
            "Aucun conteneur dédié. Lance-en un avec /start <nom> dans le chat.",
          ),
        );
      } else {
        const b = view.linkedBanner;
        sec.append(el("p", "studio-kicker", "DÉDIÉ"));
        sec.append(el("p", "studio-name", b.name));
        sec.append(el("p", "cockpit-muted", b.workspace));
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
      const dl = el("dl", "cockpit-dl");
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
        const ul = el("ul", "cockpit-rows");
        for (const c of view.containers ?? []) {
          const li = el("li", "cockpit-row");
          li.append(
            el("span", "cockpit-ellipsis", c.name),
            el("span", "cockpit-muted", c.state === "running" ? "en cours" : "arrêté"),
          );
          ul.append(li);
        }
        sec.append(ul);
        if ((view.containers ?? []).length === 0) {
          sec.append(el("p", "cockpit-muted", "Aucun conteneur. /start <nom> dans le chat."));
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
    const label = PAGES.find((p) => p[0] === page)?.[1] ?? page;
    main.append(empty(label, "Cette page reste vide : pas d'interrupteur ajouté."));
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type !== "view") return;
    render(msg);
  });
  vscode.postMessage({ type: "refresh" });
})();
