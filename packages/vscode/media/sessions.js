// Webview « Sessions » : grille des chats ouverts. Les tuiles sont des données non fiables (titres,
// projets) : rendu par textContent seul, aucune insertion de HTML. La grille ne répond à aucune
// approbation : un clic demande seulement à l'hôte d'ouvrir le chat.
(() => {
  const t = (message, ...values) => {
    if (globalThis.WarbandI18n) return globalThis.WarbandI18n.t(message, ...values);
    return typeof message === "string"
      ? message
      : message.reduce((text, part, i) => text + (i ? values[i - 1] : "") + part, "");
  };
  const vscode = acquireVsCodeApi();
  const main = document.getElementById("main");
  const SIZES = ["s", "m", "l"];
  const FILTERS = ["all", "awaiting"];
  let tiles = [];
  let received = false;

  // Taille et filtre mémorisés par la webview (setState), jamais par l'hôte.
  const saved = vscode.getState();
  let size = saved && SIZES.includes(saved.size) ? saved.size : "m";
  let filter = saved && FILTERS.includes(saved.filter) ? saved.filter : "all";
  const remember = () => vscode.setState({ size, filter });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const stateLabel = () => ({
    idle: t("Au repos"),
    busy: t("Tour en cours"),
    approval: t("Approbation en attente"),
    error: t("Erreur"),
  });
  const tone = { idle: "off", busy: "ok", approval: "warn", error: "err" };

  // Même règle que filterSessionGrid (src/logic/session-grid.ts).
  const visible = () =>
    filter === "awaiting"
      ? tiles.filter((tile) => tile.state === "approval" || tile.state === "error")
      : tiles;

  const when = (iso) => {
    if (typeof iso !== "string") return t("Aucune activité");
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return t("Aucune activité");
    return date.toLocaleString(globalThis.WarbandI18n?.getLocale?.() ?? "fr", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const tileNode = (tile) => {
    const label = stateLabel()[tile.state] ?? "—";
    const card = el("button", `session-tile tone-${tone[tile.state] ?? "off"}`);
    card.type = "button";
    card.dataset.state = tile.state;
    card.setAttribute("aria-label", t("Ouvrir {0}", { 0: tile.name }));
    const head = el("span", "session-head");
    head.append(el("span", "dot"), el("strong", "session-name", tile.name));
    head.append(
      el("span", "badge", tile.location === "sidebar" ? t("Chat latéral") : t("Éditeur")),
    );
    card.append(head);
    if (tile.title) card.append(el("span", "session-title", tile.title));
    const state = el("span", "session-state", label);
    if (tile.state === "approval" && tile.approvals > 1)
      state.textContent = `${label} · ${t("{0} approbation(s)", { 0: tile.approvals })}`;
    card.append(state);
    const meta = el("span", "session-meta");
    if (tile.model) meta.append(el("span", "badge", tile.model));
    if (tile.project) meta.append(el("span", "session-project", tile.project));
    meta.append(el("span", "session-time", when(tile.updatedAt)));
    card.append(meta);
    card.addEventListener("click", () => vscode.postMessage({ type: "open", chatId: tile.id }));
    return card;
  };

  const syncControls = () => {
    for (const id of FILTERS) {
      document.getElementById(`filter-${id}`)?.setAttribute("aria-pressed", String(filter === id));
    }
    for (const id of SIZES) {
      document.getElementById(`size-${id}`)?.setAttribute("aria-pressed", String(size === id));
    }
  };

  function render() {
    while (main.firstChild) main.removeChild(main.firstChild);
    syncControls();
    if (!received) return;
    const shown = visible();
    if (shown.length === 0) {
      main.append(
        el(
          "p",
          "session-empty",
          tiles.length === 0 ? t("Aucune session ouverte.") : t("Aucune session n’attend de toi."),
        ),
      );
      return;
    }
    const grid = el("div", `session-grid size-${size}`);
    for (const tile of shown) grid.append(tileNode(tile));
    main.append(grid);
  }

  for (const id of FILTERS) {
    document.getElementById(`filter-${id}`)?.addEventListener("click", () => {
      filter = id;
      remember();
      render();
    });
  }
  for (const id of SIZES) {
    document.getElementById(`size-${id}`)?.addEventListener("click", () => {
      size = id;
      remember();
      render();
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (typeof msg !== "object" || msg === null) return;
    if (msg.type === "locale" && (msg.locale === "fr" || msg.locale === "en")) {
      globalThis.WarbandI18n?.setLocale(msg.locale);
      globalThis.WarbandI18n?.applyStatic(document);
      render();
      return;
    }
    if (msg.type === "view" && Array.isArray(msg.tiles)) {
      tiles = msg.tiles.filter((tile) => typeof tile === "object" && tile !== null);
      received = true;
      render();
    }
  });

  render();
  vscode.postMessage({ type: "ready" });
})();
