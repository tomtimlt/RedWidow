// Webview cockpit : état système et conteneurs Exegol. DOM sûr (textContent), pas de réseau.
(() => {
  const vscode = acquireVsCodeApi();
  const main = document.getElementById("main");
  const refreshBtn = document.getElementById("refresh");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const stateLabel = (s) => (s === "running" ? "en cours" : "arrêté");

  const linkedLine = (v) => {
    if (v === "running") return "en cours";
    if (v === "stopped") return "arrêté";
    if (v === "absent") return "absent";
    if (v === "none") return "non lié";
    return "—";
  };

  const daemonLine = (v) => {
    if (v === "reachable") return "joignable";
    if (v === "unreachable") return "injoignable";
    return "—";
  };

  const ellipsize = (node, text, max = 48) => {
    const t = String(text ?? "");
    node.title = t;
    node.textContent = t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };

  // Icônes au trait (SVG construit nœud par nœud, jamais de HTML injecté).
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    terminal: ["m5 8 4 4-4 4", "M12 17h7"],
    folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
    play: ["M8 5.5v13l10.5-6.5z"],
    stop: ["M7 7h10v10H7z"],
    link: [
      "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
      "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    ],
  };
  const icon = (name) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of [
      ["class", "ico"],
      ["viewBox", "0 0 24 24"],
      ["width", "16"],
      ["height", "16"],
      ["fill", "none"],
      ["stroke", "currentColor"],
      ["stroke-width", "2"],
      ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"],
      ["aria-hidden", "true"],
    ]) {
      svg.setAttribute(k, v);
    }
    for (const d of ICON_PATHS[name] ?? []) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  };

  const button = (cls, label, iconName, onClick) => {
    const b = el("button", cls);
    b.type = "button";
    if (iconName) b.append(icon(iconName));
    b.append(el("span", "btn-text", label));
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  const heading = (text, count) => {
    const h = el("h2", "cockpit-h", text);
    if (count !== undefined) h.append(el("span", "cockpit-count", String(count)));
    return h;
  };

  /** Pastille d'état colorée (ok, warn, err, off) suivie d'un libellé. */
  const pill = (tone, text) => {
    const p = el("span", `cockpit-pill tone-${tone}`);
    p.append(el("span", "dot"), el("span", "", text));
    return p;
  };

  const tile = (label, value, tone) => {
    const t = el("div", `cockpit-tile tone-${tone}`);
    t.append(el("span", "dot"), el("span", "cockpit-tile-label", label), el("strong", "", value));
    return t;
  };

  function render(view) {
    if (!main) return;
    while (main.firstChild) main.removeChild(main.firstChild);

    if (view.loading) {
      main.append(el("p", "cockpit-notice", "Actualisation…"));
      return;
    }

    // 1. Santé du système : quatre tuiles colorées, lisibles d'un coup d'œil.
    const status = el("section", "cockpit-status");
    status.setAttribute("aria-label", "État système");
    const grid = el("div", "cockpit-tiles");
    const linkedTone = { running: "ok", stopped: "warn", absent: "err" }[view.linked] ?? "off";
    const daemonTone = { reachable: "ok", unreachable: "err" }[view.daemon] ?? "off";
    grid.append(
      tile(
        "Docker",
        view.docker === "present" ? "présent" : "absent",
        view.docker === "present" ? "ok" : "err",
      ),
      tile("Démon", daemonLine(view.daemon), daemonTone),
      tile(
        "Exegol",
        view.exegol === "present" ? "présent" : "absent",
        view.exegol === "present" ? "ok" : "err",
      ),
      tile("Conteneur lié", linkedLine(view.linked), linkedTone),
    );
    status.append(heading("Système"), grid);
    main.append(status);

    if (view.error) {
      main.append(el("p", "cockpit-error", view.error));
      return;
    }

    if (view.empty === "docker") {
      main.append(el("p", "cockpit-notice", "Docker est absent."));
      return;
    }

    // 2. Conteneur lié : carte principale, actions en tête de lecture.
    const linkedSec = el("section", "cockpit-linked");
    linkedSec.setAttribute("aria-label", "Conteneur lié");
    linkedSec.append(heading("Conteneur lié"));
    if (!view.linkedBanner) {
      linkedSec.append(
        el(
          "p",
          "cockpit-muted",
          "Aucun conteneur lié. Choisissez-en un dans la liste ci-dessous (Lier).",
        ),
      );
    } else {
      const b = view.linkedBanner;
      const tone = { running: "ok", stopped: "warn", absent: "err" }[b.state] ?? "off";
      const card = el("div", `cockpit-hero tone-${tone}`);
      const head = el("div", "cockpit-linked-head");
      const name = el("strong", "cockpit-ellipsis cockpit-hero-name");
      ellipsize(name, b.short || b.name);
      head.append(name, pill(tone, b.state === "absent" ? "absent" : stateLabel(b.state)));
      const meta = el("dl", "cockpit-meta");
      const img = el("dd", "cockpit-ellipsis");
      ellipsize(img, b.image ?? "—", 64);
      const path = el("dd", "cockpit-ellipsis");
      ellipsize(path, b.workspace, 64);
      meta.append(el("dt", "", "Image"), img, el("dt", "", "Dossier hôte"), path);
      const actions = el("div", "cockpit-actions");
      const termBtn = button("primary", "Terminal", "terminal", () =>
        vscode.postMessage({ type: "terminal" }),
      );
      if (b.state !== "running" || view.projectInvalid) termBtn.disabled = true;
      actions.append(termBtn);
      if (b.state === "absent") {
        actions.append(
          button("primary", "Démarrer", "play", () => vscode.postMessage({ type: "create" })),
        );
      }
      actions.append(
        button("secondary", "Ouvrir le dossier", "folder", () =>
          vscode.postMessage({ type: "openWorkspace" }),
        ),
      );
      card.append(head, meta, actions);
      linkedSec.append(card);
    }
    main.append(linkedSec);

    if (view.empty === "list") {
      main.append(
        el(
          "p",
          "cockpit-notice",
          "Aucun conteneur. Lancez-en un hors de Warband, puis actualisez.",
        ),
      );
      return;
    }

    // 3. Tous les conteneurs : une carte par ligne, état coloré à gauche, actions à droite.
    const rows = view.containers ?? [];
    const listSec = el("section", "cockpit-list");
    listSec.setAttribute("aria-label", "Conteneurs");
    listSec.append(heading("Conteneurs", rows.length));
    const ul = el("ul", "cockpit-rows");
    for (const row of rows) {
      const li = el("li", `cockpit-row ${row.state === "running" ? "is-running" : "is-stopped"}`);
      li.append(el("span", "dot"));
      const mainCol = el("div", "cockpit-row-main");
      const top = el("div", "cockpit-row-top");
      const n = el("span", "cockpit-ellipsis cockpit-row-name");
      ellipsize(n, row.short || row.name);
      top.append(n);
      if (row.linked) top.append(el("span", "cockpit-linked-tag", "lié"));
      const sub = el("div", "cockpit-row-sub");
      const im = el("span", "cockpit-ellipsis cockpit-row-image");
      ellipsize(im, row.image);
      sub.append(el("span", "cockpit-row-state", stateLabel(row.state)), im);
      if (row.workspace === undefined) {
        sub.append(el("span", "cockpit-muted cockpit-row-ws", "sans dossier"));
      }
      mainCol.append(top, sub);
      li.append(mainCol);
      const act = el("div", "cockpit-row-act");
      if (!row.linked) {
        const linkBtn = button("secondary", "Lier", "link");
        if (!row.canLink) {
          linkBtn.disabled = true;
          if (row.linkTitle) linkBtn.title = row.linkTitle;
        } else {
          linkBtn.addEventListener("click", () =>
            vscode.postMessage({ type: "link", name: row.name }),
          );
        }
        act.append(linkBtn);
      }
      if (row.state === "running") {
        act.append(
          button("danger", "Arrêter", "stop", () =>
            vscode.postMessage({ type: "stop", name: row.name }),
          ),
        );
      } else {
        act.append(
          button("primary", "Démarrer", "play", () =>
            vscode.postMessage({ type: "start", name: row.name }),
          ),
        );
      }
      li.append(act);
      ul.append(li);
    }
    listSec.append(ul);
    main.append(listSec);
  }

  refreshBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (typeof msg !== "object" || msg === null || msg.type !== "view") return;
    const loading = msg.loading === true;
    if (refreshBtn) refreshBtn.disabled = loading;
    render(msg);
  });

  vscode.postMessage({ type: "refresh" });
})();
