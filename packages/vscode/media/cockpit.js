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

  // État du formulaire, hors du DOM : un rafraîchissement reconstruit la vue sans l'effacer.
  const form = {
    touched: false,
    engine: null,
    name: "",
    image: "",
    source: "",
    images: [],
    imagesAsked: false,
  };
  let lastView = null;

  const engineOf = (view) => {
    if (view.exegol !== "present") return "kali";
    if (form.touched && (form.engine === "exegol" || form.engine === "kali")) return form.engine;
    return "exegol";
  };

  const askImages = () => {
    if (form.imagesAsked) return;
    form.imagesAsked = true;
    vscode.postMessage({ type: "listImages" });
  };

  const rerender = () => {
    if (lastView) render(lastView);
  };

  const fillSelect = (select) => {
    while (select.firstChild) select.removeChild(select.firstChild);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.textContent = "—";
    select.append(placeholder);
    for (const ref of form.images) {
      const opt = document.createElement("option");
      opt.value = ref;
      opt.textContent = ref;
      select.append(opt);
    }
    select.value = form.images.includes(form.image) ? form.image : "";
  };

  const labeled = (text, control) => {
    const wrap = el("label", "cockpit-field");
    wrap.append(el("span", "cockpit-field-label", text), control);
    return wrap;
  };

  function renderCreate(view) {
    const engine = engineOf(view);
    const section = el("section", "cockpit-create");
    section.setAttribute("aria-label", "Créer un conteneur");
    section.append(heading("Créer un conteneur"));

    const engines = el("div", "cockpit-actions");
    const choices = view.exegol === "present" ? ["exegol", "kali"] : ["kali"];
    const labels = { exegol: "Exegol", kali: "Kali" };
    for (const choice of choices) {
      const selected = choice === engine;
      const b = button(selected ? "primary" : "secondary", labels[choice], undefined, () => {
        if (choice === "kali") form.imagesAsked = false;
        if (choice === engine && choice !== "kali") return;
        form.touched = true;
        form.engine = choice;
        rerender();
      });
      b.setAttribute("aria-pressed", selected ? "true" : "false");
      engines.append(b);
    }

    const fields = el("div", "cockpit-fields");
    const nameInput = el("input");
    nameInput.type = "text";
    nameInput.value = form.name;
    nameInput.spellcheck = false;
    nameInput.setAttribute("autocomplete", "off");
    nameInput.addEventListener("input", () => {
      form.name = nameInput.value;
    });
    fields.append(labeled("Nom", nameInput));

    const imageSelect = el("select");
    imageSelect.id = "cockpit-image";
    fillSelect(imageSelect);
    imageSelect.addEventListener("change", () => {
      form.image = imageSelect.value;
    });
    if (engine !== "kali") imageSelect.disabled = true;
    fields.append(labeled("Image", imageSelect));

    const folderRow = el("div", "cockpit-actions");
    folderRow.id = "cockpit-folder";
    const folderBtn = button("secondary", "Dossier", "folder", () => {
      vscode.postMessage({ type: "pickSource" });
    });
    if (engine !== "kali") folderBtn.disabled = true;
    folderRow.append(folderBtn);
    if (form.source !== "") {
      const src = el("span", "cockpit-ellipsis cockpit-source");
      src.id = "cockpit-source";
      ellipsize(src, form.source, 64);
      folderRow.append(src);
    }
    fields.append(folderRow);

    const actions = el("div", "cockpit-actions");
    actions.append(
      button("primary", "Créer", undefined, () => {
        const name = nameInput.value;
        if (engine === "exegol") {
          vscode.postMessage({ type: "createExegol", name });
          return;
        }
        vscode.postMessage({
          type: "createKali",
          image: imageSelect.value,
          name,
          source: form.source,
        });
      }),
    );
    section.append(engines, fields, actions);
    if (engine === "kali") askImages();
    return section;
  }

  function render(view) {
    if (!main) return;
    lastView = view;
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

    if (view.docker === "absent" || view.empty === "docker") {
      main.append(el("p", "cockpit-notice", "Docker est absent."));
      return;
    }

    if (view.error) {
      main.append(el("p", "cockpit-error", view.error));
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
      const hasRunningLinked = (view.containers ?? []).some(
        (c) => c.linked && c.state === "running",
      );
      if (!hasRunningLinked || view.projectInvalid) termBtn.disabled = true;
      actions.append(termBtn);
      actions.append(
        button("secondary", "Ouvrir le dossier", "folder", () =>
          vscode.postMessage({ type: "openWorkspace" }),
        ),
      );
      card.append(head, meta, actions);
      linkedSec.append(card);
    }
    main.append(linkedSec);
    main.append(renderCreate(view));

    if (view.error) return;

    if (view.empty === "list") {
      main.append(el("p", "cockpit-notice", "Aucun conteneur."));
      return;
    }

    // 3. Tous les conteneurs : une carte par ligne, état coloré à gauche, actions à droite.
    const rows = view.containers ?? [];
    const listSec = el("section", "cockpit-list");
    listSec.setAttribute("aria-label", "Conteneurs");
    listSec.append(heading("Conteneurs", rows.length));
    const linkedCount = rows.filter((r) => r.linked).length;
    const ul = el("ul", "cockpit-rows");
    for (const row of rows) {
      const li = el("li", `cockpit-row ${row.state === "running" ? "is-running" : "is-stopped"}`);
      li.append(el("span", "dot"));
      const mainCol = el("div", "cockpit-row-main");
      const top = el("div", "cockpit-row-top");
      const n = el("span", "cockpit-ellipsis cockpit-row-name");
      ellipsize(n, row.short || row.name);
      top.append(n);
      if (row.linked) {
        top.append(
          row.primary
            ? el("span", "cockpit-linked-tag is-primary", "PRIMARY")
            : el("span", "cockpit-linked-tag", "lié"),
        );
      }
      const sub = el("div", "cockpit-row-sub");
      const im = el("span", "cockpit-ellipsis cockpit-row-image");
      ellipsize(im, row.image);
      sub.append(
        el("span", "cockpit-row-state", stateLabel(row.state)),
        el("span", "cockpit-muted", row.family),
        im,
      );
      if (row.workspace === undefined) {
        sub.append(el("span", "cockpit-muted cockpit-row-ws", "sans dossier"));
      }
      mainCol.append(top, sub);
      li.append(mainCol);
      const act = el("div", "cockpit-row-act");
      if (row.linked && !row.primary && linkedCount >= 2) {
        const primaryBtn = button("secondary", "Principal", "link", () =>
          vscode.postMessage({ type: "setPrimary", name: row.name }),
        );
        primaryBtn.title = "Définir comme conteneur principal (affichage seulement)";
        act.append(primaryBtn);
      }
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

  const applyImages = (images) => {
    form.images = images;
    const select = document.getElementById("cockpit-image");
    if (!select) return;
    fillSelect(select);
  };

  const applySource = (source) => {
    form.source = source;
    const node = document.getElementById("cockpit-source");
    if (node) {
      ellipsize(node, source, 64);
      return;
    }
    const row = document.getElementById("cockpit-folder");
    if (!row) return;
    const src = el("span", "cockpit-ellipsis cockpit-source");
    src.id = "cockpit-source";
    ellipsize(src, source, 64);
    row.append(src);
  };

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (typeof msg !== "object" || msg === null) return;
    if (msg.type === "images") {
      if (!Array.isArray(msg.images) || msg.images.some((item) => typeof item !== "string")) return;
      applyImages(msg.images);
      return;
    }
    if (msg.type === "pickedSource") {
      if (typeof msg.source !== "string" || msg.source === "") return;
      applySource(msg.source);
      return;
    }
    if (msg.type !== "view") return;
    const loading = msg.loading === true;
    if (refreshBtn) refreshBtn.disabled = loading;
    render(msg);
  });

  vscode.postMessage({ type: "refresh" });
})();
