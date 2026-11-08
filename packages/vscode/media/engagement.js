// Webview « Engagement » (red team). L'engagement, le plan et le journal sont des données non fiables :
// rendu par textContent seul, aucune insertion de HTML. Les empreintes ne sont jamais renvoyées à
// l'hôte (il les mémorise à l'affichage) ; aucun message ne porte de donnée.
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
  const send = (type) => () => vscode.postMessage({ type });

  const states = () => ({
    none: [t("Aucun"), "off"],
    draft: [t("Brouillon, non validé"), "warn"],
    approved: [t("Validée et appliquée"), "ok"],
    suspended: [t("Suspendue"), "warn"],
    invalidated: [t("Modifiée depuis la validation"), "err"],
    unreadable: [t("Illisible"), "err"],
  });

  const stateTile = (label, state) => {
    const [text, tone] = states()[state] ?? ["—", "off"];
    const tile = el("div", `cockpit-tile tone-${tone}`);
    tile.append(el("span", "dot"), el("span", "cockpit-tile-label", label), el("strong", "", text));
    return tile;
  };

  const citationBlock = (field, citation) => {
    const box = el("div", "cockpit-notice");
    box.append(el("div", "", citation.quote));
    box.append(el("div", "cockpit-tile-label", `${citation.url} · ${citation.retrievedAt}`));
    if (!citation.verified) box.append(el("strong", "", t("Citation non vérifiée")));
    box.append(
      button("ghost", t("Ouvrir la source…"), () =>
        vscode.postMessage({ type: "openCitation", field }),
      ),
    );
    return box;
  };

  const section = (title, content, field, citation) => {
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
  const grid = (rows) => {
    const dl = el("dl", "eng-grid");
    for (const [label, value] of rows) {
      if (value === undefined || value === "") continue;
      dl.append(el("dt", "", label), el("dd", "", value));
    }
    return dl;
  };
  const text = (value) => el("p", "eng-text", value);
  const digestLine = (digest) => {
    const d = el("p", "cockpit-notice");
    d.append(el("span", "", t("Empreinte : ")), el("code", "", digest));
    return d;
  };
  const dates = (view) => {
    const box = el("div", "");
    if (view.approvedAt)
      box.append(el("p", "cockpit-tile-label", `${t("Validée le")} ${view.approvedAt}`));
    if (view.suspendedAt)
      box.append(el("p", "cockpit-tile-label", `${t("Suspendue le")} ${view.suspendedAt}`));
    return box;
  };

  // Bandeau d'arrêt d'urgence : en tête de page, couleur d'avertissement du thème.
  function haltBanner(halt) {
    const box = el("section", halt.active ? "eng-halt is-on" : "eng-halt");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", t("Arrêt d'urgence"));
    const body = el("div", "eng-halt-text");
    body.append(
      el("span", "eng-halt-title", halt.active ? t("ARRÊT D'URGENCE ACTIF") : t("Arrêt d'urgence")),
      el(
        "span",
        "eng-halt-sub",
        halt.active
          ? halt.since
            ? `${t("Posé le")} ${halt.since} · ${t("Les actions de l'agent sont refusées.")}`
            : t("Les actions de l'agent sont refusées.")
          : t("Inactif. Un geste suffit pour refuser toute action de l'agent sur ce projet."),
      ),
    );
    box.append(
      body,
      button(
        halt.active ? "ghost" : "primary",
        halt.active ? t("Lever l'arrêt…") : t("Activer…"),
        send(halt.active ? "resume" : "halt"),
      ),
    );
    return box;
  }

  function engagementSection(view) {
    const wrap = el("div", "eng-block");
    const head = el("section", "cockpit-status");
    head.append(el("h2", "cockpit-h", t("Engagement")), stateTile(t("État"), view.state));
    if (view.state === "none")
      head.append(el("p", "cockpit-notice", t("Aucun engagement pour ce projet.")));
    if (view.digest) head.append(digestLine(view.digest));
    head.append(dates(view));
    wrap.append(head);
    const s = view.sheet;
    if (s) {
      const a = s.authorization.value;
      wrap.append(
        section(
          t("Autorisation"),
          grid([
            [t("Mandant"), a.principal],
            [t("Référence"), a.reference],
            [t("Signataire"), a.signatory],
          ]),
          "authorization",
          s.authorization.citation,
        ),
        section(
          t("Fenêtre d'engagement"),
          grid([
            [t("Période"), s.window.value.text],
            [t("Début"), s.window.value.notBefore],
            [t("Fin"), s.window.value.notAfter],
          ]),
          "window",
          s.window.citation,
        ),
        section(t("Périmètre"), list(s.inScope.value), "inScope", s.inScope.citation),
        section(
          t("Infrastructure de l'agent"),
          list(s.infrastructure.value),
          "infrastructure",
          s.infrastructure.citation,
        ),
        section(t("Hors périmètre"), list(s.outOfScope.value), "outOfScope", s.outOfScope.citation),
        section(
          t("Règles d'engagement"),
          text(s.rulesOfEngagement.value),
          "rulesOfEngagement",
          s.rulesOfEngagement.citation,
        ),
        section(
          t("White team"),
          grid([
            [t("Contact"), s.whiteTeam.value.contact],
            [t("Déconfliction"), s.whiteTeam.value.deconfliction],
            [t("Notes"), s.whiteTeam.value.text],
          ]),
          "whiteTeam",
          s.whiteTeam.citation,
        ),
        section(
          t("Politique OSINT"),
          text(s.osintPolicy.value),
          "osintPolicy",
          s.osintPolicy.citation,
        ),
      );
    }
    const actions = el("div", "cockpit-actions");
    if (view.canValidate)
      actions.append(button("primary", t("Valider l'engagement…"), send("validateEngagement")));
    if (view.canSuspend) actions.append(button("ghost", t("Suspendre"), send("suspendSheet")));
    actions.append(button("ghost", t("Importer un fichier…"), send("importEngagement")));
    wrap.append(actions);
    return wrap;
  }

  const resultLabel = () => ({
    success: t("Réussie"),
    partial: t("Partielle"),
    failed: t("Échec"),
    blocked: t("Bloquée"),
  });

  function campaignSection(view) {
    const c = view.campaign;
    const wrap = el("div", "eng-block");
    const head = el("section", "cockpit-status");
    head.append(el("h2", "cockpit-h", t("Plan de campagne")), stateTile(t("État"), c.state));
    if (c.state === "none")
      head.append(el("p", "cockpit-notice", t("Aucun plan de campagne pour ce projet.")));
    if (c.digest) head.append(digestLine(c.digest));
    head.append(dates(c));
    wrap.append(head);
    if (c.threatSummary)
      wrap.append(
        section(
          t("Synthèse de la menace"),
          text(c.threatSummary.value),
          "threatSummary",
          c.threatSummary.citation,
        ),
      );
    if (c.objectives.length > 0) {
      const ul = el("ul", "");
      for (const o of c.objectives) ul.append(el("li", "", `${o.label} — ${o.successCriterion}`));
      wrap.append(section(t("Objectifs"), ul));
    }
    if (c.steps.length > 0) {
      const box = el("div", "");
      const progress = el("div", "eng-progress");
      const bar = el("div", "eng-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(c.percent));
      const fill = el("span", "");
      fill.style.setProperty("width", `${c.percent}%`);
      bar.append(fill);
      progress.append(
        bar,
        el("strong", "", `${c.percent} %`),
        el("span", "cockpit-tile-label", `${c.executed} / ${c.total}`),
      );
      const ol = el("ol", "eng-steps");
      for (const step of c.steps) {
        const li = el("li", step.executed ? "eng-step is-done" : "eng-step");
        li.append(
          el("span", "dot"),
          el("span", "eng-step-label", step.label),
          el("span", "eng-tag", [step.tactic, step.technique].filter(Boolean).join(" · ")),
          el(
            "span",
            "cockpit-tile-label",
            step.executed
              ? (resultLabel()[step.result] ?? t("Exécutée"))
              : (resultLabel()[step.result] ?? t("À faire")),
          ),
        );
        ol.append(li);
      }
      box.append(progress, ol);
      wrap.append(section(t("Étapes"), box));
    }
    const actions = el("div", "cockpit-actions");
    if (c.canValidate)
      actions.append(button("primary", t("Valider le plan…"), send("validateCampaign")));
    if (c.canSuspend) actions.append(button("ghost", t("Suspendre"), send("suspendPlan")));
    actions.append(button("ghost", t("Importer un fichier…"), send("importCampaign")));
    wrap.append(actions);
    return wrap;
  }

  function journalSection(journal) {
    const sec = el("section", "cockpit-status");
    sec.append(el("h2", "cockpit-h", t("Journal d'opérations")));
    if (journal.rows.length === 0) {
      sec.append(el("p", "cockpit-notice", t("Aucune étape enregistrée.")));
      return sec;
    }
    const wrap = el("div", "eng-table-wrap");
    const table = el("table", "eng-table");
    const headRow = el("tr", "");
    for (const label of [t("Horodatage"), t("Étape"), t("Technique"), t("Cible"), t("Résultat")])
      headRow.append(el("th", "", label));
    const thead = el("thead", "");
    thead.append(headRow);
    const tbody = el("tbody", "");
    const labels = resultLabel();
    for (const row of journal.rows) {
      const tr = el("tr", "");
      const result = el("td", `eng-result-${row.result}`, labels[row.result] ?? row.result);
      tr.append(
        el("td", "mono", row.ts),
        el("td", "", row.stepLabel),
        el("td", "mono", row.technique ?? "—"),
        el("td", "", row.target ?? "—"),
        result,
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    sec.append(wrap);
    if (journal.total > journal.rows.length)
      sec.append(
        el(
          "p",
          "cockpit-tile-label",
          t("{0} lignes sur {1} (les plus récentes).", {
            0: journal.rows.length,
            1: journal.total,
          }),
        ),
      );
    return sec;
  }

  function closureSection(closure) {
    const sec = el("section", "cockpit-status");
    sec.append(el("h2", "cockpit-h", t("Clôture")));
    if (closure === null) {
      sec.append(el("p", "cockpit-notice", t("Aucune liste de démontage.")));
      return sec;
    }
    const tone = closure.canClose ? "ok" : "warn";
    const tile = el("div", `cockpit-tile tone-${tone}`);
    tile.append(
      el("span", "dot"),
      el(
        "strong",
        "",
        closure.canClose
          ? t("Démontage terminé")
          : t("{0} élément(s) restant(s)", { 0: closure.remaining }),
      ),
    );
    const ul = el("ul", "eng-steps");
    for (const item of closure.items) {
      const li = el("li", item.done ? "eng-step is-done" : "eng-step");
      li.append(
        el("span", "dot"),
        el("span", "eng-step-label", item.label),
        el("span", "eng-tag", item.kind),
        el(
          "span",
          "cockpit-tile-label",
          item.done ? `${t("Fait le")} ${item.doneAt ?? ""}` : t("À faire"),
        ),
      );
      ul.append(li);
    }
    sec.append(tile, ul);
    return sec;
  }

  function render(view) {
    lastView = view;
    while (main.firstChild) main.removeChild(main.firstChild);
    if (lastError) main.append(el("p", "cockpit-error", lastError));
    main.append(
      haltBanner(view.halt),
      engagementSection(view),
      campaignSection(view),
      journalSection(view.journal),
      closureSection(view.closure),
    );
  }

  refreshBtn?.addEventListener("click", send("refresh"));

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
