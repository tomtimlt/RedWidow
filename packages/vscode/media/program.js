// Webview « Fiche programme ». La fiche est une donnée non fiable : rendu par textContent seul,
// aucune insertion de HTML. L'empreinte n'est jamais renvoyée à l'hôte (il la mémorise à l'affichage).
(() => {
  const t = (message, ...values) => {
    if (globalThis.WarbandI18n) return globalThis.WarbandI18n.t(message, ...values);
    return typeof message === "string"
      ? message
      : message.reduce((text, part, i) => text + (i ? values[i - 1] : "") + part, "");
  };
  const vscode = acquireVsCodeApi();
  const main = document.getElementById("main");
  const refreshBtn = document.getElementById("refresh");
  let lastView = null;
  let lastError = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (cls, label, onClick) => {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  const states = () => ({
    none: [t("Aucune fiche"), "off"],
    draft: [t("Brouillon, non validé"), "warn"],
    approved: [t("Validée et appliquée"), "ok"],
    suspended: [t("Suspendue"), "warn"],
    invalidated: [t("Modifiée depuis la validation"), "err"],
    unreadable: [t("Illisible"), "err"],
  });

  const paceText = (pace) => {
    if (typeof pace.maxRequestsPerSecond === "number")
      return t("{0} requête(s) par seconde au plus", { 0: pace.maxRequestsPerSecond });
    return { fast: t("Rapide"), normal: t("Normal"), careful: t("Prudent") }[pace.preset] ?? "—";
  };

  const citationBlock = (field, citation) => {
    const box = el("div", "cockpit-notice");
    box.append(el("div", "", citation.quote));
    const meta = el("div", "cockpit-tile-label");
    meta.textContent = `${citation.url} · ${citation.retrievedAt}`;
    box.append(meta);
    if (!citation.verified) box.append(el("strong", "", t("Citation non vérifiée")));
    box.append(
      button("ghost", t("Ouvrir la source…"), () =>
        vscode.postMessage({ type: "openCitation", field }),
      ),
    );
    return box;
  };

  const section = (title, field, content, citation) => {
    const sec = el("section", "cockpit-status");
    sec.append(el("h2", "cockpit-h", title), content);
    if (citation) sec.append(citationBlock(field, citation));
    return sec;
  };

  const list = (values) => {
    const ul = el("ul", "");
    if (values.length === 0) ul.append(el("li", "", t("Aucun")));
    for (const value of values) ul.append(el("li", "", value));
    return ul;
  };

  function render(view) {
    lastView = view;
    while (main.firstChild) main.removeChild(main.firstChild);
    if (lastError) main.append(el("p", "cockpit-error", lastError));
    const [label, tone] = states()[view.state] ?? ["—", "off"];
    const tile = el("div", `cockpit-tile tone-${tone}`);
    tile.append(
      el("span", "dot"),
      el("span", "cockpit-tile-label", t("État")),
      el("strong", "", label),
    );
    main.append(tile);

    if (view.state === "none") {
      main.append(
        el(
          "p",
          "cockpit-notice",
          t(
            "Aucune fiche programme pour ce projet. Importez-la avec la commande « program import ».",
          ),
        ),
      );
    }
    if (view.digest) {
      const d = el("p", "cockpit-notice");
      d.append(el("span", "", t("Empreinte : ")), el("code", "", view.digest));
      main.append(d);
    }
    if (view.approvedAt)
      main.append(el("p", "cockpit-tile-label", `${t("Validée le")} ${view.approvedAt}`));
    if (view.suspendedAt)
      main.append(el("p", "cockpit-tile-label", `${t("Suspendue le")} ${view.suspendedAt}`));

    if (view.inScope)
      main.append(
        section(t("Périmètre"), "inScope", list(view.inScope.values), view.inScope.citation),
      );
    if (view.outOfScope)
      main.append(
        section(
          t("Hors périmètre"),
          "outOfScope",
          list(view.outOfScope.values),
          view.outOfScope.citation,
        ),
      );
    if (view.userAgentSuffix)
      main.append(
        section(
          t("Suffixe User-Agent"),
          "userAgentSuffix",
          el("p", "", view.userAgentSuffix.value),
          view.userAgentSuffix.citation,
        ),
      );
    if (view.pace)
      main.append(
        section(t("Rythme"), "pace", el("p", "", paceText(view.pace.value)), view.pace.citation),
      );

    const halted = el("section", "cockpit-status");
    halted.append(el("h2", "cockpit-h", t("Hôtes arrêtés")));
    if (view.haltedHosts.length === 0)
      halted.append(el("p", "cockpit-notice", t("Aucun hôte arrêté.")));
    for (const host of view.haltedHosts) {
      const row = el("div", "cockpit-tile tone-err");
      row.append(
        el("span", "dot"),
        el("strong", "", host),
        button("ghost", t("Reprendre"), () => vscode.postMessage({ type: "resume", host })),
      );
      halted.append(row);
    }
    main.append(halted);

    const actions = el("div", "cockpit-actions");
    if (view.canValidate)
      actions.append(
        button("primary", t("Valider la fiche…"), () => vscode.postMessage({ type: "validate" })),
      );
    if (view.canSuspend)
      actions.append(
        button("ghost", t("Suspendre"), () => vscode.postMessage({ type: "suspend" })),
      );
    main.append(actions);
  }

  refreshBtn?.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (typeof msg !== "object" || msg === null) return;
    if (msg.type === "locale" && (msg.locale === "fr" || msg.locale === "en")) {
      globalThis.WarbandI18n?.setLocale(msg.locale);
      globalThis.WarbandI18n?.applyStatic(document);
      if (lastView) render(lastView);
      return;
    }
    if (msg.type === "error" && typeof msg.text === "string") {
      lastError = msg.text;
      if (lastView) render(lastView);
      return;
    }
    if (msg.type !== "view" || typeof msg.view !== "object" || msg.view === null) return;
    lastError = null;
    render(msg.view);
  });

  vscode.postMessage({ type: "ready" });
})();
