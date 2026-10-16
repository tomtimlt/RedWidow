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

  function render(view) {
    if (!main) return;
    while (main.firstChild) main.removeChild(main.firstChild);

    if (view.loading) {
      main.append(el("p", "cockpit-notice", "Actualisation…"));
      return;
    }

    const status = el("section", "cockpit-status");
    status.setAttribute("aria-label", "État système");
    const dl = el("dl", "cockpit-dl");
    const addRow = (term, desc) => {
      dl.append(el("dt", "", term), el("dd", "", desc));
    };
    addRow("Docker", view.docker === "present" ? "présent" : "absent");
    addRow("Démon", daemonLine(view.daemon));
    addRow("Exegol", view.exegol === "present" ? "présent" : "absent");
    addRow("Conteneur lié", linkedLine(view.linked));
    status.append(dl);
    main.append(status);

    if (view.error) {
      main.append(el("p", "cockpit-error", view.error));
      return;
    }

    if (view.empty === "docker") {
      main.append(el("p", "cockpit-notice", "Docker est absent."));
      return;
    }

    const linkedSec = el("section", "cockpit-linked");
    linkedSec.setAttribute("aria-label", "Conteneur lié");
    if (!view.linkedBanner) {
      linkedSec.append(el("p", "cockpit-muted", "Aucun conteneur lié."));
    } else {
      const b = view.linkedBanner;
      const head = el("div", "cockpit-linked-head");
      const name = el("strong", "cockpit-ellipsis");
      ellipsize(name, b.short || b.name);
      head.append(name);
      const meta = el("div", "cockpit-linked-meta");
      const img = el("span", "cockpit-ellipsis");
      ellipsize(img, b.image ?? "—");
      const path = el("span", "cockpit-ellipsis");
      ellipsize(path, b.workspace);
      meta.append(el("span", "", "Image : "), img, el("span", "", " · Chemin hôte : "), path);
      head.append(meta);
      const st = el("span", "cockpit-badge");
      if (b.state === "absent") st.textContent = "absent";
      else st.textContent = stateLabel(b.state);
      head.append(st);
      linkedSec.append(head);
      const actions = el("div", "cockpit-actions");
      const openBtn = el("button", "ghost", undefined);
      openBtn.type = "button";
      openBtn.append(el("span", "btn-text", "Ouvrir le dossier"));
      openBtn.addEventListener("click", () => vscode.postMessage({ type: "openWorkspace" }));
      const termBtn = el("button", "primary", undefined);
      termBtn.type = "button";
      termBtn.append(el("span", "btn-text", "Terminal"));
      termBtn.addEventListener("click", () => vscode.postMessage({ type: "terminal" }));
      if (b.state !== "running" || view.projectInvalid) termBtn.disabled = true;
      actions.append(openBtn, termBtn);
      if (b.state === "absent") {
        const startBtn = el("button", "primary", undefined);
        startBtn.type = "button";
        startBtn.append(el("span", "btn-text", "Démarrer"));
        startBtn.addEventListener("click", () => vscode.postMessage({ type: "create" }));
        actions.append(startBtn);
      }
      linkedSec.append(actions);
    }
    main.append(linkedSec);

    if (view.empty === "list") {
      main.append(
        el("p", "cockpit-notice", "Aucun conteneur. Lancez-en un hors de John, puis actualisez."),
      );
      return;
    }

    const listSec = el("section", "cockpit-list");
    listSec.setAttribute("aria-label", "Conteneurs");
    const ul = el("ul", "cockpit-rows");
    for (const row of view.containers ?? []) {
      const li = el("li", "cockpit-row");
      const mainCol = el("div", "cockpit-row-main");
      const n = el("span", "cockpit-ellipsis cockpit-row-name");
      ellipsize(n, row.short || row.name);
      const im = el("span", "cockpit-ellipsis cockpit-row-image");
      ellipsize(im, row.image);
      const st = el("span", "cockpit-row-state", stateLabel(row.state));
      mainCol.append(n, im, st);
      if (row.workspace === undefined) {
        mainCol.append(el("span", "cockpit-muted cockpit-row-ws", "sans dossier"));
      }
      li.append(mainCol);
      const act = el("div", "cockpit-row-act");
      if (row.linked) {
        act.append(el("span", "cockpit-linked-tag", "lié"));
      } else {
        const linkBtn = el("button", "secondary", undefined);
        linkBtn.type = "button";
        linkBtn.append(el("span", "btn-text", "Lier"));
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
        const stopBtn = el("button", "danger", undefined);
        stopBtn.type = "button";
        stopBtn.append(el("span", "btn-text", "Arrêter"));
        stopBtn.addEventListener("click", () =>
          vscode.postMessage({ type: "stop", name: row.name }),
        );
        act.append(stopBtn);
      } else {
        const startBtn = el("button", "primary", undefined);
        startBtn.type = "button";
        startBtn.append(el("span", "btn-text", "Démarrer"));
        startBtn.addEventListener("click", () =>
          vscode.postMessage({ type: "start", name: row.name }),
        );
        act.append(startBtn);
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
