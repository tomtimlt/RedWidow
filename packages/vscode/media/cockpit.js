// Webview cockpit : état système et conteneurs. DOM sûr (textContent), pas de réseau.
(() => {
  const t = (message, ...values) => {
    if (globalThis.WarbandI18n) return globalThis.WarbandI18n.t(message, ...values);
    return typeof message === "string"
      ? message
      : message.reduce((text, part, i) => text + (i ? values[i - 1] : "") + part, "");
  };
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

  const main = document.getElementById("main");
  const refreshBtn = document.getElementById("refresh");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const stateLabel = (s) => (s === "running" ? t("en cours") : t("arrêté"));

  const linkedLine = (v) => {
    if (v === "running") return t("en cours");
    if (v === "stopped") return t("arrêté");
    if (v === t("absent")) return t("absent");
    if (v === "none") return t("non lié");
    return "—";
  };

  const daemonLine = (v) => {
    if (v === "reachable") return t("joignable");
    if (v === "unreachable") return t("injoignable");
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
    open: document.body?.dataset?.openCreate === "true",
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
    sharedFolder: "",
    // « project » ou « multi » ; null tant que l'utilisateur n'a pas choisi (défaut selon le projet actif).
    shareMode: null,
    // Bandeau de partage : n'afficher que les conteneurs qui voient le projet actif.
    compatibleOnly: false,
    images: [],
    imagesAsked: false,
  };
  let lastView = null;
  let loadingNow = false;
  let operation = { busy: false, stage: "" };
  // Création en cours ou terminée : étape atteinte, message rejouable, position du panneau figée.
  let creation = null;
  let highlight = null;
  const cardNodes = new Map();
  const CREATE_ENGINES = { createKali: "kali", createExegol: "exegol" };
  const STEP_IDS = {
    kali: ["image", "download", "start", "mcp", "link"],
    exegol: ["image", "terminal", "start"],
  };
  const stepLabel = (id) =>
    ({
      image: t("Image"),
      download: t("Téléchargement / Construction"),
      terminal: t("Création dans le terminal"),
      start: t("Démarrage"),
      mcp: t("Vérification MCP"),
      link: t("Liaison"),
    })[id];
  // Les libellés de l’hôte sont déjà traduits : on accepte la clé source fr ou son rendu.
  const sameStage = (stage, key) => stage === key || stage === t(key);
  const mcpStage = (stage) =>
    ["Serveur MCP Kali :", t("Serveur MCP Kali : {0}", { 0: "" }).trimEnd()].some((prefix) =>
      stage.startsWith(prefix),
    );
  const stepIndexFor = (engine, stage, layers) => {
    const ids = STEP_IDS[engine];
    let id = null;
    if (engine === "kali") {
      if (sameStage(stage, "Préparation de l’image Kali…")) id = "image";
      else if (
        sameStage(stage, "Téléchargement de l’image…") ||
        sameStage(stage, "Installation des outils Kali…") ||
        (Array.isArray(layers) && layers.length > 0)
      )
        id = "download";
      else if (sameStage(stage, "Création et démarrage du conteneur…")) id = "start";
      else if (sameStage(stage, "Vérification du serveur MCP Kali…") || mcpStage(stage)) id = "mcp";
      else if (sameStage(stage, "Liaison au projet…")) id = "link";
    } else if (sameStage(stage, "Préparation Exegol…")) id = "image";
    else if (sameStage(stage, "Création du conteneur dans le terminal…")) id = "terminal";
    return id === null ? -1 : ids.indexOf(id);
  };
  const insideFolder = (project, folder) => {
    if (typeof project !== "string" || typeof folder !== "string" || !project || !folder)
      return false;
    const trim = (path) => path.replace(/[\\/]+$/, "");
    const p = trim(project);
    const f = trim(folder);
    return p === f || p.startsWith(`${f}/`) || p.startsWith(`${f}\\`);
  };
  const submitOperation = (message) => {
    if (operation.busy) return;
    operation = { busy: true, stage: "Préparation…" };
    const engine = CREATE_ENGINES[message.type];
    if (engine)
      creation = {
        engine,
        message,
        step: 0,
        status: "running",
        notice: "",
        linkExpected:
          message.shareMode === "project" ||
          insideFolder(lastView?.projectWorkspace, form.sharedFolder),
        createFirst: !lastView?.linkedBanner,
      };
    vscode.postMessage(message);
    rerender();
  };
  const creationVisible = () => creation !== null && creation.status !== "success" && form.open;
  const closeCreation = () => {
    creation = null;
    operation = { busy: false, stage: "" };
    form.open = false;
    form.name = "";
    rerender();
    document.getElementById("cockpit-create-toggle")?.focus?.({ preventScroll: true });
  };
  const showCreated = () => {
    const name = creation?.message?.name ?? "";
    const rows = lastView?.containers ?? [];
    const row = name
      ? (rows.find((r) => r.short === name || r.name === name) ??
        rows.find((r) => r.name.includes(name)))
      : undefined;
    highlight = row ? row.name : null;
    closeCreation();
    const node = highlight ? cardNodes.get(highlight) : undefined;
    node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (node && typeof setTimeout === "function")
      setTimeout(() => {
        node.className = node.className.replace(/ is-highlight/g, "");
        highlight = null;
      }, 2400);
  };

  const engineOf = (view) => {
    if (view.exegol !== "present") return "kali";
    if (form.touched && (form.engine === "exegol" || form.engine === "kali")) return form.engine;
    return "exegol";
  };

  // Mode « project » : dossier du projet actif (relu par l'hôte) ; sans projet actif, retombe sur « multi ».
  const shareModeOf = (view) => {
    const hasProject = typeof view?.projectWorkspace === "string" && view.projectWorkspace !== "";
    if (form.shareMode === "multi") return "multi";
    if (form.shareMode === "project" && hasProject) return "project";
    return hasProject && form.shareMode === null ? "project" : "multi";
  };

  const askImages = () => {
    if (form.imagesAsked) return;
    form.imagesAsked = true;
    vscode.postMessage({ type: "listImages" });
  };

  const rerender = () => {
    if (lastView) renderFull(lastView);
  };

  const fillSelect = (select) => {
    while (select.firstChild) select.removeChild(select.firstChild);
    const choices = [
      [
        "warband/kali:complete-1",
        t("Kali RedWidow complète — MCP et outils prêts (construction locale)"),
      ],
      ["kalilinux/kali-rolling:latest", t("Kali officielle — image minimale")],
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

  // Chemin renvoyé par le sélecteur de l'hôte, jamais saisi ni retransmis à la création.
  const validSource = (folder) => folder.length > 0 && folder.length <= 4096;
  // Mode projet : aucun dossier à choisir ; mode multi : le dossier choisi sur l'hôte est requis.
  const shareReady = () => shareModeOf(lastView) === "project" || validSource(form.sharedFolder);
  const canCreate = (engine) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(form.name)) return false;
    if (engine === "kali")
      return (
        form.image.length <= 256 &&
        /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/.test(form.image) &&
        shareReady()
      );
    return (
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(form.exegolImage) &&
      shareReady() &&
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
    section.setAttribute("aria-label", t("Créer un conteneur"));
    const head = el("div", "cockpit-create-head");
    const close = button("ghost cockpit-create-close", t("Replier le formulaire"), "caret", () => {
      form.open = false;
      if (creation && creation.status !== "running") creation = null;
      rerender();
      document.getElementById("cockpit-create-toggle")?.focus();
    });
    close.setAttribute("aria-controls", "cockpit-create");
    close.disabled = creation?.status === "running";
    close.querySelector(".btn-text")?.remove();
    head.append(heading(t("Créer un conteneur")), close);
    section.append(head);
    if (creation?.status === "success") {
      section.append(renderSuccess());
      return section;
    }
    if (creation) section.append(buildProgressCard(true));

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
    const shareMode = shareModeOf(view);
    const hasProject = typeof view.projectWorkspace === "string" && view.projectWorkspace !== "";
    const modes = el("div", "cockpit-actions cockpit-share-modes");
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", t("Dossier partagé"));
    for (const [mode, label] of [
      ["project", t("Conteneur projet")],
      ["multi", t("Conteneur multi-projets")],
    ]) {
      const radio = el("input");
      radio.id = `cockpit-share-${mode}`;
      radio.type = "radio";
      radio.name = "cockpit-share-mode";
      radio.value = mode;
      radio.checked = shareMode === mode;
      const unavailable = mode === "project" && !hasProject;
      radio.disabled = unavailable;
      if (unavailable) radio.title = t("Ouvrez un projet pour créer un conteneur projet.");
      radio.addEventListener("change", () => {
        if (unavailable) return;
        form.shareMode = mode;
        rerender();
      });
      const wrap = el("label", "cockpit-field cockpit-field-inline");
      wrap.append(radio, el("span", "cockpit-field-label", label));
      modes.append(wrap);
    }
    fields.append(modes);
    const nameInput = el("input");
    nameInput.id = "cockpit-name";
    nameInput.type = "text";
    nameInput.value = form.name;
    nameInput.spellcheck = false;
    nameInput.maxLength = 64;
    nameInput.pattern = "[A-Za-z0-9][A-Za-z0-9_.-]{0,63}";
    nameInput.title = t(
      "1 à 64 caractères : lettres, chiffres, point, tiret ou soulignement ; commence par une lettre ou un chiffre.",
    );
    nameInput.setAttribute("autocomplete", "off");
    nameInput.addEventListener("input", () => {
      form.name = nameInput.value;
      updateCreate();
    });
    fields.append(labeled(t("Nom"), nameInput));

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
    fields.append(labeled(engine === "kali" ? "Image" : t("Image Exegol (tag)"), imageSelect));

    if (shareMode === "multi") {
      const folderRow = el("div", "cockpit-actions");
      folderRow.id = "cockpit-folder";
      const folderBtn = button("secondary", t("Choisir…"), "folder", () => {
        vscode.postMessage({ type: "pickSharedFolder" });
      });

      folderRow.append(el("span", "cockpit-field-label", t("Dossier partagé")), folderBtn);
      if (form.sharedFolder !== "") {
        const src = el("span", "cockpit-ellipsis cockpit-source");
        src.id = "cockpit-source";
        ellipsize(src, form.sharedFolder, 64);
        folderRow.append(src);
      }
      fields.append(
        folderRow,
        el(
          "p",
          "studio-help",
          t(
            "Le conteneur partage ce dossier. Il sera lié au projet actif si le dossier du projet s'y trouve.",
          ),
        ),
      );
    } else {
      const help = el("p", "studio-help", t("Le dossier partagé sera le dossier du projet actif."));
      help.id = "cockpit-share-project-help";
      fields.append(help);
    }

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
      checkbox("vpn", t("Activer le VPN"), rerender);
      const vpnButton = button("secondary", t("Choisir une configuration VPN"), "folder", () =>
        vscode.postMessage({ type: "pickVpn" }),
      );
      vpnButton.disabled = !form.vpn;
      fields.append(vpnButton);
      if (form.vpnLabel) fields.append(el("span", "cockpit-source", form.vpnLabel));
      checkbox("desktop", t("Activer le bureau web"), rerender);
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
        labeled(t("Port du bureau web"), port),
        el(
          "p",
          "cockpit-help",
          t(
            "Le bureau est accessible uniquement sur votre machine (127.0.0.1). Choisissez un port libre, de 1 à 65535.",
          ),
        ),
      );
      const network = el("select");
      network.id = "cockpit-network";
      for (const [value, label] of [
        ["nat", t("NAT (recommandé)")],
        ["host", t("Réseau de l’hôte")],
        ["disabled", t("Sans réseau")],
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
      fields.append(labeled(t("Réseau"), network));
      if (form.network === "host")
        fields.append(
          el(
            "p",
            "cockpit-help",
            t(
              "Le réseau de l’hôte partage directement ses interfaces. Un VPN dans le conteneur peut modifier les routes de votre machine. Le bureau web exige le réseau NAT.",
            ),
          ),
        );
      checkbox("shareResources", t("Partager les ressources Exegol"));
      checkbox("shareMyResources", t("Partager mes ressources Exegol"));
    }
    const actions = el("div", "cockpit-actions");
    const running = creation?.status === "running";
    const failed = creation?.status === "failed";
    if (failed) {
      const retry = button("primary", t("Réessayer"), "refresh", () =>
        submitOperation(creation.message),
      );
      retry.id = "cockpit-retry";
      actions.append(retry);
    }
    const create = button(
      failed ? "secondary" : "primary",
      running ? t("Création…") : t("Créer"),
      undefined,
      () => {
        if (!canCreate(engine)) return;
        if (engine === "exegol") {
          if (
            !Number.isInteger(form.desktopPort) ||
            form.desktopPort < 1 ||
            form.desktopPort > 65535
          )
            return;
          submitOperation({
            type: "createExegol",
            shareMode,
            name: form.name,
            image: form.exegolImage,
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
            shareMode,
            image: form.image,
            name: form.name,
          });
      },
    );
    create.id = "cockpit-submit";
    create.disabled = operation.busy || !canCreate(engine);
    actions.append(create);
    if (running)
      actions.append(
        button("ghost cockpit-cancel-link", t("Annuler"), undefined, () =>
          vscode.postMessage({ type: "cancelOperation" }),
        ),
      );
    if (operation.busy) {
      const lock = (node) => {
        if (["input", "select", "button"].includes((node.tagName ?? node.tag ?? "").toLowerCase()))
          node.disabled = true;
        for (const child of node.children) lock(child);
      };
      lock(engines);
      lock(fields);
    }
    section.append(engines, fields, actions);
    if (engine === "kali") askImages();
    return section;
  }

  const visibleSteps = () =>
    STEP_IDS[creation.engine].filter(
      (id) => id !== "link" || creation.linkExpected || creation.step >= 4,
    );

  function renderStepper() {
    const ids = STEP_IDS[creation.engine];
    const list = el("ol", "cockpit-steps");
    list.setAttribute("aria-label", t("Étapes de création"));
    for (const id of visibleSteps()) {
      const index = ids.indexOf(id);
      let state = "todo";
      if (creation.status === "success" || index < creation.step) state = "done";
      else if (index === creation.step) state = creation.status === "failed" ? "failed" : "active";
      const item = el("li", `cockpit-step is-${state}`);
      const mark = el("span", "cockpit-step-mark");
      if (state === "done") mark.append(icon("check"));
      else if (state === "failed") mark.textContent = "!";
      if (state === "active") item.setAttribute("aria-current", "step");
      if (state === "failed") item.title = t("Échec");
      item.append(mark, el("span", "cockpit-step-label", stepLabel(id)));
      list.append(item);
    }
    return list;
  }

  function fillProgress(content, withSteps) {
    while (content.firstChild) content.removeChild(content.firstChild);
    content.setAttribute("aria-label", t("Progression de l’opération"));
    if (withSteps && creation) content.append(renderStepper());
    const status = el("p", "", t(operation.stage || "Préparation…"));
    status.setAttribute("role", "status");
    content.append(status);
    if (operation.message) content.append(el("p", "cockpit-help", t(operation.message)));
    for (const layer of operation.layers ?? []) {
      const row = el("div", "cockpit-layer");
      const speed = Number.isFinite(layer.speedBytesPerSecond)
        ? t` · ${(layer.speedBytesPerSecond / 1048576).toFixed(1)} Mio/s`
        : "";
      const label = `${layer.id} — ${t(layer.status)}${speed}`;
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
      content.append(row);
    }
    if (operation.error) content.append(el("p", "cockpit-error", t(operation.error)));
  }

  /** Carte de progression : bouton d’annulation intégré seulement hors panneau de création. */
  function buildProgressCard(withSteps) {
    const card = el("section", "cockpit-progress");
    card.id = "cockpit-progress";
    const content = el("div");
    content.id = "cockpit-progress-content";
    card.append(content);
    if (!withSteps && operation.busy)
      card.append(
        button("ghost cockpit-cancel-link", t("Annuler"), undefined, () =>
          vscode.postMessage({ type: "cancelOperation" }),
        ),
      );
    fillProgress(content, withSteps);
    return card;
  }

  const updateProgress = () => {
    const content = document.getElementById("cockpit-progress-content");
    if (content) fillProgress(content, creationVisible());
  };

  function renderSuccess() {
    const box = el("div", "cockpit-success");
    const head = el("div", "cockpit-success-head");
    const check = el("span", "cockpit-check");
    check.setAttribute("aria-hidden", "true");
    const stage = creation.notice;
    const text = el(
      "p",
      "cockpit-success-text",
      !stage || sameStage(stage, "Terminé") ? t("Conteneur créé") : t(stage),
    );
    text.setAttribute("role", "status");
    head.append(check, text);
    const actions = el("div", "cockpit-actions");
    const view = button("primary", t("Voir le conteneur"), undefined, showCreated);
    view.id = "cockpit-view-container";
    const close = button("secondary", t("Fermer"), undefined, closeCreation);
    close.id = "cockpit-success-close";
    actions.append(view, close);
    box.append(head, renderStepper(), actions);
    return box;
  }

  function renderCard(row, linkedCount) {
    const li = el(
      "li",
      `cockpit-card ${row.state === "running" ? "is-running" : "is-stopped"}${row.linked ? " is-linked" : ""}${highlight === row.name ? " is-highlight" : ""}`,
    );
    cardNodes.set(row.name, li);
    const head = el("div", "cockpit-card-head");
    const n = el("span", "cockpit-ellipsis cockpit-row-name");
    ellipsize(n, row.short || row.name);
    head.append(el("span", "dot"), n);
    if (row.linked) {
      head.append(
        row.primary
          ? el("span", "cockpit-linked-tag is-primary", t("Principal"))
          : el("span", "cockpit-linked-tag", t("lié")),
      );
    }
    const sub = el("div", "cockpit-row-sub");
    const state = typeof row.uptime === "string" && row.uptime ? row.uptime : stateLabel(row.state);
    sub.append(el("span", "cockpit-row-state", state), el("span", "cockpit-muted", row.family));
    const im = el("div", "cockpit-ellipsis cockpit-row-image");
    ellipsize(im, row.image, 64);
    const ws = el("div", "cockpit-ellipsis cockpit-muted cockpit-row-ws");
    ellipsize(ws, row.workspace ?? t("Sans dossier hôte"), 64);
    // Projets enregistrés dans le partage du conteneur ; cliquer sur un autre projet l'active (ADR 0052).
    const projectsBox = el("div", "cockpit-card-projects");
    if (Array.isArray(row.projects) && typeof row.workspace === "string") {
      projectsBox.append(
        el("div", "cockpit-muted cockpit-card-projects-title", t("Projets dans ce conteneur")),
      );
      if (row.projects.length === 0)
        projectsBox.append(el("div", "cockpit-muted", t("Aucun projet dans ce partage.")));
      for (const project of row.projects) {
        if (project.active) {
          const current = el("span", "cockpit-linked-tag is-project", project.name);
          current.title = t("Projet actif");
          projectsBox.append(current);
        } else {
          const choose = button("ghost cockpit-project-link", project.name, undefined, () =>
            vscode.postMessage({ type: "activateProject", projectId: project.id }),
          );
          choose.disabled = operation.busy;
          projectsBox.append(choose);
        }
      }
    }
    // Compatibilité avec le projet actif (calculée par l'hôte, jamais déduite ici).
    const hasActive = typeof lastView?.projectWorkspace === "string";
    const compat =
      hasActive && typeof row.workspace === "string"
        ? row.compatible === true
          ? el("span", "cockpit-compat is-ok", t("Compatible avec le projet actif"))
          : el("span", "cockpit-compat is-no", t("Ce conteneur ne voit pas le dossier du projet."))
        : null;
    const act = el("div", "cockpit-card-act");
    if (row.linked && !row.primary && linkedCount >= 2) {
      const primaryBtn = button("secondary", t("Principal"), "link", () =>
        vscode.postMessage({ type: "setPrimary", name: row.name }),
      );
      primaryBtn.title = t("Définir comme conteneur principal (affichage seulement)");
      act.append(primaryBtn);
    }
    if (!row.linked) {
      const linkBtn = button("secondary", t("Lier"), "link");
      if (!row.canLink) {
        linkBtn.disabled = true;
        linkBtn.title = t(row.linkTitle || "Association indisponible");
      } else {
        linkBtn.addEventListener("click", () =>
          vscode.postMessage({ type: "link", name: row.name }),
        );
      }
      act.append(linkBtn);
    }
    if (row.state === "running") {
      act.append(
        button("danger", t("Arrêter"), "stop", () =>
          submitOperation({ type: "stop", name: row.name }),
        ),
      );
    } else {
      act.append(
        button("primary", t("Démarrer"), "play", () =>
          submitOperation({ type: "start", name: row.name }),
        ),
      );
    }
    act.append(
      button("danger", t("Supprimer"), "trash", () =>
        submitOperation({ type: "remove", name: row.name }),
      ),
    );
    for (const control of act.children) {
      if ([t("Démarrer"), t("Arrêter"), t("Supprimer")].includes(control.title))
        control.disabled = operation.busy;
    }
    li.append(head, sub, im, ws, projectsBox);
    if (compat) li.append(compat);
    li.append(act);
    return li;
  }

  // Bandeau du moteur : le projet actif n'est pas dans le partage du conteneur lié (ADR 0052, point 5).
  const buildMountIssue = (issue) => {
    const box = el("section", "cockpit-notice cockpit-mount-issue");
    box.id = "cockpit-mount-issue";
    box.setAttribute("role", "alert");
    const title = el(
      "strong",
      "",
      t("Le projet « {0} » n’est pas visible depuis le conteneur « {1} ».", {
        0: issue.projectName,
        1: shortOf(issue.container),
      }),
    );
    const mounted = el("div", "cockpit-ellipsis cockpit-muted");
    ellipsize(mounted, t("Le conteneur partage : {0}", { 0: issue.mounted }), 64);
    const acts = el("div", "cockpit-actions");
    const create = button("primary", t("Créer un conteneur projet pour ce dossier"), "plus", () => {
      form.open = true;
      form.shareMode = "project";
      rerender();
      document.getElementById("cockpit-name")?.focus?.();
    });
    create.id = "cockpit-issue-create";
    const choose = button(
      "secondary",
      form.compatibleOnly
        ? t("Afficher tous les conteneurs")
        : t("Choisir un conteneur compatible"),
      "link",
      () => {
        form.compatibleOnly = !form.compatibleOnly;
        rerender();
      },
    );
    choose.id = "cockpit-issue-choose";
    const move = button("secondary", t("Déplacer le projet"), "folder", () =>
      vscode.postMessage({ type: "moveProject" }),
    );
    move.id = "cockpit-issue-move";
    const dismiss = button("ghost", t("Masquer"), undefined, () => {
      form.compatibleOnly = false;
      vscode.postMessage({ type: "dismissMountIssue" });
    });
    dismiss.id = "cockpit-issue-dismiss";
    create.disabled = operation.busy;
    move.disabled = operation.busy;
    acts.append(create, choose, move, dismiss);
    box.append(title, mounted, acts);
    return box;
  };
  const shortOf = (name) => {
    const row = (lastView?.containers ?? []).find((r) => r.name === name);
    return row?.short ?? name;
  };

  function render(view) {
    if (!main) return;
    if (view.loading) {
      loadingNow = true;
      // Pendant une opération, la vue précédente reste affichée avec un indicateur discret.
      if (lastView && (operation.busy || creation)) {
        renderFull(lastView);
        return;
      }
      while (main.firstChild) main.removeChild(main.firstChild);
      main.append(el("p", "cockpit-notice", t("Actualisation…")));
      return;
    }
    loadingNow = false;
    lastView = view;
    renderFull(view);
  }

  function renderFull(view) {
    if (!main) return;
    while (main.firstChild) main.removeChild(main.firstChild);
    cardNodes.clear();

    if (loadingNow) {
      const busy = el("p", "cockpit-loading", t("Actualisation…"));
      busy.setAttribute("role", "status");
      main.append(busy);
    }

    if (!creationVisible() && (operation.busy || operation.error || operation.stage))
      main.append(buildProgressCard(false));

    // Bandeau d’état : un voyant par champ présent dans la vue.
    const status = el("section", "cockpit-status");
    status.setAttribute("aria-label", t("État système"));
    const grid = el("div", "cockpit-tiles");
    if (view.docker !== undefined)
      grid.append(
        tile(
          "Docker",
          view.docker === "present" ? t("présent") : t("absent"),
          view.docker === "present" ? "ok" : "err",
        ),
      );
    if (view.daemon !== undefined)
      grid.append(
        tile(
          t("Démon"),
          daemonLine(view.daemon),
          { reachable: "ok", unreachable: "err" }[view.daemon] ?? "off",
        ),
      );
    if (view.exegol !== undefined)
      grid.append(
        tile(
          "Exegol",
          view.exegol === "present" ? t("présent") : t("absent"),
          view.exegol === "present" ? "ok" : "off",
        ),
      );
    if (view.linked !== undefined)
      grid.append(
        tile(
          t("Conteneur lié"),
          linkedLine(view.linked),
          { running: "ok", stopped: "warn", absent: "err" }[view.linked] ?? "off",
        ),
      );
    status.append(heading(t("Système")), grid);
    if (view.program && typeof view.program.state === "string") {
      const programLabels = {
        none: t("aucune fiche"),
        draft: t("brouillon à valider"),
        approved: t("validée"),
        suspended: t("suspendue"),
        invalidated: t("modifiée depuis la validation"),
        unreadable: t("illisible"),
      };
      const programTone =
        { approved: "ok", draft: "warn", suspended: "warn" }[view.program.state] ?? "off";
      const halted = Number.isInteger(view.program.halted) ? view.program.halted : 0;
      const programState = programLabels[view.program.state] ?? "—";
      const line = el("button", `cockpit-tile cockpit-program-line tone-${programTone}`);
      line.type = "button";
      line.id = "cockpit-program";
      line.append(
        el("span", "dot"),
        el("span", "cockpit-tile-label", t("Fiche programme")),
        el(
          "strong",
          "",
          halted > 0
            ? `${programState} · ${t("{0} hôte(s) arrêté(s)", { 0: halted })}`
            : programState,
        ),
      );
      line.addEventListener("click", () => vscode.postMessage({ type: "openProgram" }));
      status.append(line);
    }
    // Engagement red team : ligne présente seulement si un engagement ou un arrêt d'urgence existe.
    if (view.engagement && typeof view.engagement.state === "string") {
      const engagementLabels = {
        none: t("Aucun engagement"),
        draft: t("brouillon à valider"),
        approved: t("validée"),
        suspended: t("suspendue"),
        invalidated: t("modifiée depuis la validation"),
        unreadable: t("illisible"),
      };
      const halted = view.engagement.halt === true;
      const engagementTone = halted
        ? "warn"
        : ({ approved: "ok", draft: "warn", suspended: "warn" }[view.engagement.state] ?? "off");
      const engagementState = engagementLabels[view.engagement.state] ?? "—";
      const eline = el("button", `cockpit-tile cockpit-program-line tone-${engagementTone}`);
      eline.type = "button";
      eline.id = "cockpit-engagement";
      eline.append(
        el("span", "dot"),
        el("span", "cockpit-tile-label", t("Engagement")),
        el(
          "strong",
          "",
          halted ? `${engagementState} · ${t("arrêt d'urgence actif")}` : engagementState,
        ),
      );
      eline.addEventListener("click", () => vscode.postMessage({ type: "openEngagement" }));
      status.append(eline);
    }
    main.append(status);
    const issue = view.mountIssue;
    const issueShown =
      issue !== undefined &&
      issue !== null &&
      typeof issue.projectName === "string" &&
      typeof issue.container === "string" &&
      typeof issue.mounted === "string";
    if (issueShown) main.append(buildMountIssue(issue));
    else form.compatibleOnly = false;

    if (view.docker === "absent" || view.empty === "docker") {
      main.append(el("p", "cockpit-notice", t("Docker est absent.")));
      return;
    }

    if (view.error) {
      main.append(el("p", "cockpit-error", t(view.error)));
    }

    // Sans conteneur, un seul appel à l’action ; sinon le bouton est masqué quand le panneau est ouvert.
    const appendCreate = () => {
      if (form.open) {
        main.append(renderCreate(view));
        return;
      }
      const createToggle = button("primary", t("Nouveau conteneur"), "plus", () => {
        form.open = true;
        rerender();
        document.getElementById("cockpit-name")?.focus();
      });
      createToggle.id = "cockpit-create-toggle";
      createToggle.setAttribute("aria-expanded", "false");
      createToggle.setAttribute("aria-controls", "cockpit-create");
      if (view.empty === "list" && !view.error) {
        const empty = el("section", "cockpit-empty");
        empty.append(
          el("strong", "cockpit-empty-title", t("Aucun conteneur pour l’instant")),
          el(
            "p",
            "cockpit-muted",
            t("Créez un environnement isolé pour lancer vos outils et garder le projet à portée."),
          ),
          createToggle,
        );
        main.append(empty);
        return;
      }
      const createBar = el("div", "cockpit-create-bar");
      createToggle.className = "secondary";
      createBar.append(createToggle);
      main.append(createBar);
    };
    // Sans conteneur lié, la création passe en tête ; sinon elle suit la liste.
    // La position est figée pendant la création et jusqu’à la fermeture de l’état de réussite.
    const createFirst = creation ? creation.createFirst : !view.linkedBanner;
    if (createFirst) appendCreate();

    // Contexte du projet et commandes du conteneur lié.
    if (view.linkedBanner) {
      const linkedSec = el("section", "cockpit-linked");
      linkedSec.setAttribute("aria-label", t("Conteneur lié"));
      linkedSec.append(heading(t("Conteneur lié")));
      const b = view.linkedBanner;
      const tone = { running: "ok", stopped: "warn", absent: "err" }[b.state] ?? "off";
      const card = el("div", `cockpit-context tone-${tone}`);
      const head = el("div", "cockpit-linked-head");
      const name = el("strong", "cockpit-ellipsis cockpit-hero-name");
      ellipsize(name, b.short || b.name);
      head.append(name, pill(tone, b.state === "absent" ? t("absent") : stateLabel(b.state)));
      const meta = el("dl", "cockpit-meta");
      const img = el("dd", "cockpit-ellipsis");
      ellipsize(img, b.image ?? "—", 64);
      const path = el("dd", "cockpit-ellipsis");
      ellipsize(path, b.workspace, 64);
      meta.append(el("dt", "", "Image"), img, el("dt", "", t("Dossier hôte")), path);
      const actions = el("div", "cockpit-actions");
      const termBtn = button("primary", "Terminal", "terminal", () =>
        vscode.postMessage({ type: "terminal" }),
      );
      const hasRunningLinked = (view.containers ?? []).some(
        (c) => c.linked && c.state === "running",
      );
      if (!hasRunningLinked || view.projectInvalid) {
        termBtn.disabled = true;
        termBtn.title = view.projectInvalid
          ? t("Projet invalide")
          : t("Aucun conteneur lié en cours");
      }
      actions.append(termBtn);
      actions.append(
        button("secondary", t("Ouvrir le dossier"), "folder", () =>
          vscode.postMessage({ type: "openWorkspace" }),
        ),
      );
      const moveBtn = button("secondary", t("Déplacer le projet"), "folder", () =>
        vscode.postMessage({ type: "moveProject" }),
      );
      moveBtn.id = "cockpit-move";
      moveBtn.disabled = operation.busy;
      actions.append(moveBtn);
      card.append(head, meta, actions);
      linkedSec.append(card);
      main.append(linkedSec);
    }
    if (view.error) {
      if (!createFirst) appendCreate();
      return;
    }

    if (view.empty === "list") {
      if (!createFirst) appendCreate();
      return;
    }

    // Grille de cartes vivantes.
    const allRows = view.containers ?? [];
    const rows =
      issueShown && form.compatibleOnly ? allRows.filter((r) => r.compatible === true) : allRows;
    const listSec = el("section", "cockpit-list");
    listSec.setAttribute("aria-label", t("Conteneurs"));
    listSec.append(heading(t("Conteneurs"), rows.length));
    const linkedCount = allRows.filter((r) => r.linked).length;
    if (rows.length === 0 && allRows.length > 0)
      listSec.append(el("p", "cockpit-muted", t("Aucun conteneur compatible.")));
    const ul = el("ul", "cockpit-cards");
    for (const row of rows) ul.append(renderCard(row, linkedCount));
    listSec.append(ul);
    main.append(listSec);
    if (!createFirst) appendCreate();
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

  const applySharedFolder = (path) => {
    form.sharedFolder = path;
    updateCreate();
    const node = document.getElementById("cockpit-source");
    if (path === "") {
      rerender();
      return;
    }
    if (node) {
      ellipsize(node, path, 64);
      return;
    }
    const row = document.getElementById("cockpit-folder");
    if (!row) return;
    const src = el("span", "cockpit-ellipsis cockpit-source");
    src.id = "cockpit-source";
    ellipsize(src, path, 64);
    row.append(src);
  };

  let firstRendered = false;
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (typeof msg !== "object" || msg === null) return;
    if (msg.type === "locale" && (msg.locale === "fr" || msg.locale === "en")) {
      const restore = captureLocaleState();
      globalThis.WarbandI18n?.setLocale(msg.locale);
      rerender();
      globalThis.WarbandI18n?.applyStatic(document);
      restore();
      return;
    }
    if (msg.type === "focusCreate") {
      form.open = true;
      rerender();
      document.getElementById("cockpit-name")?.focus();
      return;
    }
    if (msg.type === "projectMetadata") {
      if (!lastView || !msg.program || typeof msg.program !== "object") return;
      lastView = { ...lastView, program: msg.program, engagement: msg.engagement ?? undefined };
      rerender();
      return;
    }
    if (msg.type === "operation") {
      if (typeof msg.busy !== "boolean" || typeof msg.stage !== "string") return;
      const sameBusy = operation.busy === msg.busy;
      operation = { ...msg, layers: Array.isArray(msg.layers) ? msg.layers : [] };
      if (creation?.status === "running") {
        if (msg.busy) {
          // L’étape ne recule jamais pendant une opération.
          const index = stepIndexFor(creation.engine, msg.stage, operation.layers);
          if (index > creation.step) creation.step = index;
          if (sameStage(msg.stage, "Liaison au projet…")) creation.linkExpected = true;
        } else if (typeof msg.error === "string" || sameStage(msg.stage, "Échec de l’opération"))
          creation.status = "failed";
        else if (sameStage(msg.stage, "Opération annulée")) creation = null;
        else {
          creation.status = "success";
          creation.notice = msg.stage;
        }
      }
      if (sameBusy && document.getElementById("cockpit-progress")) updateProgress();
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
    if (msg.type === "pickedSharedFolder") {
      if (typeof msg.path !== "string") return;
      applySharedFolder(msg.path);
      return;
    }
    if (msg.type !== "view") return;
    const loading = msg.loading === true;
    if (refreshBtn) refreshBtn.disabled = loading;
    render(msg);
    if (!firstRendered) {
      firstRendered = true;
      vscode.postMessage({ type: "rendered" });
    }
  });

  vscode.postMessage({ type: "ready" });
})();
