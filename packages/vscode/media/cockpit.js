// Webview cockpit : état système et conteneurs. DOM sûr (textContent), pas de réseau.
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

  const icon = (name) => window.WarbandIcons.create(name, { className: "ico" });

  const button = (cls, label, iconName, onClick) => {
    const b = el("button", cls);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
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
    open: false,
    touched: false,
    engine: null,
    name: "",
    image: "warband/kali:complete-1",
    exegolImage: "free",
    vpn: false,
    vpnLabel: "",
    desktop: false,
    desktopPort: 6080,
    network: "nat",
    shareResources: true,
    shareMyResources: true,
    source: "",
    images: [],
    imagesAsked: false,
  };
  let lastView = null;
  let operation = { busy: false, stage: "" };
  const submitOperation = (message) => {
    if (operation.busy) return;
    operation = { busy: true, stage: "Préparation…" };
    vscode.postMessage(message);
    rerender();
  };
  const expandedRows = new Set();

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
    const choices = [
      [
        "warband/kali:complete-1",
        "Kali Warband complète — MCP et outils prêts (construction locale)",
      ],
      ["kalilinux/kali-rolling:latest", "Kali officielle — image minimale"],
      ...form.images
        .filter(
          (ref) => !["warband/kali:complete-1", "kalilinux/kali-rolling:latest"].includes(ref),
        )
        .map((ref) => [ref, ref]),
    ];
    for (const [ref, label] of choices) {
      const opt = document.createElement("option");
      opt.value = ref;
      opt.textContent = label;
      select.append(opt);
    }
    select.value = form.image;
  };

  const labeled = (text, control) => {
    const wrap = el("label", "cockpit-field");
    wrap.append(el("span", "cockpit-field-label", text), control);
    return wrap;
  };

  const validSource = (source) =>
    source.length > 0 && source.length <= 4096 && !/[\0\r\n]/.test(source);
  const canCreate = (engine) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(form.name)) return false;
    if (engine === "kali")
      return (
        form.image.length <= 256 &&
        /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/.test(form.image) &&
        validSource(form.source)
      );
    return (
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(form.exegolImage) &&
      (!form.source || validSource(form.source)) &&
      Number.isInteger(form.desktopPort) &&
      form.desktopPort >= 1 &&
      form.desktopPort <= 65535 &&
      (!form.desktop || form.network === "nat")
    );
  };
  const updateCreate = () => {
    const create = document.getElementById("cockpit-submit");
    if (create && lastView) create.disabled = operation.busy || !canCreate(engineOf(lastView));
  };

  function renderCreate(view) {
    const engine = engineOf(view);
    const section = el("section", "cockpit-create");
    section.id = "cockpit-create";
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
    nameInput.id = "cockpit-name";
    nameInput.type = "text";
    nameInput.value = form.name;
    nameInput.spellcheck = false;
    nameInput.maxLength = 64;
    nameInput.pattern = "[A-Za-z0-9][A-Za-z0-9_.-]{0,63}";
    nameInput.title =
      "1 à 64 caractères : lettres, chiffres, point, tiret ou soulignement ; commence par une lettre ou un chiffre.";
    nameInput.setAttribute("autocomplete", "off");
    nameInput.addEventListener("input", () => {
      form.name = nameInput.value;
      updateCreate();
    });
    fields.append(labeled("Nom", nameInput));

    const imageSelect = el(engine === "kali" ? "select" : "input");
    imageSelect.id = "cockpit-image";
    if (engine === "kali") fillSelect(imageSelect);
    else {
      imageSelect.type = "text";
      imageSelect.value = form.exegolImage;
    }
    imageSelect.addEventListener(engine === "kali" ? "change" : "input", () => {
      if (engine === "kali") form.image = imageSelect.value;
      else form.exegolImage = imageSelect.value;
      updateCreate();
    });
    fields.append(labeled(engine === "kali" ? "Image" : "Image Exegol (tag)", imageSelect));

    const folderRow = el("div", "cockpit-actions");
    folderRow.id = "cockpit-folder";
    const folderBtn = button(
      "secondary",
      engine === "exegol" ? "Dossier (facultatif)" : "Dossier (obligatoire)",
      "folder",
      () => {
        vscode.postMessage({ type: "pickSource" });
      },
    );

    folderRow.append(folderBtn);
    if (form.source !== "") {
      const src = el("span", "cockpit-ellipsis cockpit-source");
      src.id = "cockpit-source";
      ellipsize(src, form.source, 64);
      folderRow.append(src);
    }
    fields.append(folderRow);

    if (engine === "exegol") {
      const checkbox = (key, label, onChange) => {
        const input = el("input");
        input.id = `cockpit-${key}`;
        input.type = "checkbox";
        input.checked = form[key];
        input.addEventListener("change", () => {
          form[key] = input.checked;
          onChange?.();
        });
        const wrap = labeled(label, input);
        wrap.className += " cockpit-checkbox";
        fields.append(wrap);
      };
      checkbox("vpn", "Activer le VPN", rerender);
      const vpnButton = button("secondary", "Choisir une configuration VPN", "folder", () =>
        vscode.postMessage({ type: "pickVpn" }),
      );
      vpnButton.disabled = !form.vpn;
      fields.append(vpnButton);
      if (form.vpnLabel) fields.append(el("span", "cockpit-source", form.vpnLabel));
      checkbox("desktop", "Activer le bureau web", rerender);
      const port = el("input");
      port.id = "cockpit-desktop-port";
      port.type = "number";
      port.min = "1";
      port.max = "65535";
      port.value = String(form.desktopPort);
      port.disabled = !form.desktop;
      port.addEventListener("input", () => {
        form.desktopPort = Number(port.value);
        updateCreate();
      });
      fields.append(
        labeled("Port du bureau web", port),
        el(
          "p",
          "cockpit-help",
          "Le bureau est accessible uniquement sur votre machine (127.0.0.1). Choisissez un port libre, de 1 à 65535.",
        ),
      );
      const network = el("select");
      network.id = "cockpit-network";
      for (const [value, label] of [
        ["nat", "NAT (recommandé)"],
        ["host", "Réseau de l’hôte"],
        ["disabled", "Sans réseau"],
      ]) {
        const option = el("option", "", label);
        option.value = value;
        network.append(option);
      }
      network.value = form.network;
      network.addEventListener("change", () => {
        form.network = network.value;
        rerender();
      });
      fields.append(labeled("Réseau", network));
      if (form.network === "host")
        fields.append(
          el(
            "p",
            "cockpit-help",
            "Le réseau de l’hôte partage directement ses interfaces. Un VPN dans le conteneur peut modifier les routes de votre machine. Le bureau web exige le réseau NAT.",
          ),
        );
      checkbox("shareResources", "Partager les ressources Exegol");
      checkbox("shareMyResources", "Partager mes ressources Exegol");
    }
    const actions = el("div", "cockpit-actions");
    const create = button("primary", "Créer", undefined, () => {
      if (!canCreate(engine)) return;
      if (engine === "exegol") {
        if (!Number.isInteger(form.desktopPort) || form.desktopPort < 1 || form.desktopPort > 65535)
          return;
        submitOperation({
          type: "createExegol",
          name: form.name,
          image: form.exegolImage,
          ...(form.source ? { source: form.source } : {}),
          vpn: form.vpn,
          desktop: form.desktop,
          desktopPort: form.desktopPort,
          network: form.network,
          shareResources: form.shareResources,
          shareMyResources: form.shareMyResources,
        });
      } else
        submitOperation({
          type: "createKali",
          image: form.image,
          name: form.name,
          source: form.source,
        });
    });
    create.id = "cockpit-submit";
    create.disabled = operation.busy || !canCreate(engine);
    actions.append(create);
    section.append(engines, fields, actions);
    if (engine === "kali") askImages();
    return section;
  }

  function renderProgress() {
    if (operation.busy || operation.error || operation.stage) {
      let card = document.getElementById("cockpit-progress");
      if (!card) {
        card = el("section", "cockpit-progress");
        card.id = "cockpit-progress";
        const content = el("div");
        content.id = "cockpit-progress-content";
        card.append(content);
        if (operation.busy)
          card.append(
            button("secondary", "Annuler", undefined, () =>
              vscode.postMessage({ type: "cancelOperation" }),
            ),
          );
      }
      const progress = card.children[0];
      while (progress.firstChild) progress.removeChild(progress.firstChild);
      progress.setAttribute("aria-label", "Progression de l’opération");
      const status = el("p", "", operation.stage || "Préparation…");
      status.setAttribute("role", "status");
      progress.append(status);
      if (operation.message) progress.append(el("p", "cockpit-help", operation.message));
      for (const layer of operation.layers ?? []) {
        const row = el("div", "cockpit-layer");
        const speed = Number.isFinite(layer.speedBytesPerSecond)
          ? ` · ${(layer.speedBytesPerSecond / 1048576).toFixed(1)} Mio/s`
          : "";
        const label = `${layer.id} — ${layer.status}${speed}`;
        row.append(el("span", "", label));
        const bar = el("progress");
        bar.setAttribute("aria-label", label);
        if (["Pull complete", "Already exists"].includes(layer.status)) {
          bar.max = 1;
          bar.value = 1;
        } else if (
          Number.isFinite(layer.total) &&
          layer.total > 0 &&
          Number.isFinite(layer.current)
        ) {
          bar.max = layer.total;
          bar.value = Math.min(layer.total, Math.max(0, layer.current));
        }
        row.append(bar);
        progress.append(row);
      }
      if (operation.error) progress.append(el("p", "cockpit-error", operation.error));
      return card;
    }
    return null;
  }

  function render(view) {
    if (!main) return;
    lastView = view;
    while (main.firstChild) main.removeChild(main.firstChild);

    if (view.loading) {
      main.append(el("p", "cockpit-notice", "Actualisation…"));
      return;
    }

    const progress = renderProgress();
    if (progress) main.append(progress);

    // État compact du système et de la liaison au projet.
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
        view.exegol === "present" ? "ok" : "off",
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

    // Contexte du projet et commandes du conteneur affiché.
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
      const card = el("div", `cockpit-context tone-${tone}`);
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
      if (!hasRunningLinked || view.projectInvalid) {
        termBtn.disabled = true;
        termBtn.title = view.projectInvalid ? "Projet invalide" : "Aucun conteneur lié en cours";
      }
      actions.append(termBtn);
      actions.append(
        button("secondary", "Ouvrir le dossier", "folder", () =>
          vscode.postMessage({ type: "openWorkspace" }),
        ),
      );
      const details = el("details", "cockpit-context-details");
      const summary = el("summary", "", "Dossier et image");
      details.append(summary, meta);
      card.append(head, actions, details);
      linkedSec.append(card);
    }
    main.append(linkedSec);
    const createBar = el("div", "cockpit-create-bar");
    const createToggle = button("secondary", "Nouveau conteneur", "plus", () => {
      form.open = !form.open;
      rerender();
      document.getElementById(form.open ? "cockpit-name" : "cockpit-create-toggle")?.focus();
    });
    createToggle.id = "cockpit-create-toggle";
    createToggle.setAttribute("aria-expanded", String(form.open));
    createToggle.setAttribute("aria-controls", "cockpit-create");
    createBar.append(createToggle);
    main.append(createBar);
    if (form.open) main.append(renderCreate(view));

    if (view.error) return;

    if (view.empty === "list") {
      main.append(el("p", "cockpit-notice", "Aucun conteneur."));
      return;
    }

    // Lignes compactes et détails repliables conservés entre actualisations.
    const rows = view.containers ?? [];
    const listSec = el("section", "cockpit-list");
    listSec.setAttribute("aria-label", "Conteneurs");
    listSec.append(heading("Conteneurs", rows.length));
    const linkedCount = rows.filter((r) => r.linked).length;
    const ul = el("ul", "cockpit-rows");
    for (const row of rows) {
      const li = el("li", `cockpit-row ${row.state === "running" ? "is-running" : "is-stopped"}`);
      const details = el("div", "cockpit-row-details");
      details.id = `cockpit-details-${ul.children.length}`;
      details.hidden = !expandedRows.has(row.name);
      const toggle = button(
        "ghost cockpit-row-toggle",
        `Détails de ${row.short || row.name}`,
        "chevronRight",
        () => {
          details.hidden = !details.hidden;
          if (details.hidden) expandedRows.delete(row.name);
          else expandedRows.add(row.name);
          toggle.setAttribute("aria-expanded", String(!details.hidden));
        },
      );
      toggle.setAttribute("aria-controls", details.id);
      toggle.setAttribute("aria-expanded", String(!details.hidden));
      toggle.querySelector(".btn-text")?.remove();
      li.append(toggle, el("span", "dot"));
      const mainCol = el("div", "cockpit-row-main");
      const top = el("div", "cockpit-row-top");
      const n = el("span", "cockpit-ellipsis cockpit-row-name");
      ellipsize(n, row.short || row.name);
      top.append(n);
      if (row.linked) {
        top.append(
          row.primary
            ? el("span", "cockpit-linked-tag is-primary", "Principal")
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
          linkBtn.title = row.linkTitle || "Association indisponible";
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
            submitOperation({ type: "stop", name: row.name }),
          ),
        );
      } else {
        act.append(
          button("primary", "Démarrer", "play", () =>
            submitOperation({ type: "start", name: row.name }),
          ),
        );
      }
      act.append(
        button("danger", "Supprimer", "trash", () =>
          submitOperation({ type: "remove", name: row.name }),
        ),
      );
      for (const control of act.children) {
        if (["Démarrer", "Arrêter", "Supprimer"].includes(control.title))
          control.disabled = operation.busy;
      }
      const workspace = el("span", "cockpit-row-workspace");
      workspace.textContent = row.workspace ?? "Sans dossier hôte";
      details.append(
        el("span", "cockpit-muted", row.name),
        el("span", "cockpit-row-image", row.image),
        workspace,
      );
      li.append(act, details);
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
    if (!select || engineOf(lastView) !== "kali") return;
    fillSelect(select);
    updateCreate();
  };

  const applySource = (source) => {
    form.source = source;
    updateCreate();
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
    if (msg.type === "operation") {
      if (typeof msg.busy !== "boolean" || typeof msg.stage !== "string") return;
      const sameBusy = operation.busy === msg.busy;
      operation = { ...msg, layers: Array.isArray(msg.layers) ? msg.layers : [] };
      if (sameBusy && document.getElementById("cockpit-progress")) renderProgress();
      else rerender();
      return;
    }
    if (msg.type === "pickedVpn") {
      if (typeof msg.label !== "string") return;
      form.vpnLabel = msg.label;
      rerender();
      return;
    }
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
