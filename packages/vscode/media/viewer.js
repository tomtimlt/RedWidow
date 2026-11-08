// Pages en lecture seule : Monitor, Sortie d'un exec, Rapport (brouillon). Aucune saisie vers l'agent :
// ni composer ni contrôle de chat. Les sorties de terminal et de l'agent ne sont pas fiables : tout le
// contenu est inséré en `textContent`, jamais en HTML. La vue est filtrée côté hôte (Sortie : un seul exec).
(() => {
  const vscode = acquireVsCodeApi();
  const fallbackText = (key, ...values) =>
    typeof key === "string"
      ? key
      : key.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
  const t = (...args) => globalThis.WarbandI18n?.t(...args) ?? fallbackText(...args);
  const $ = (id) => document.getElementById(id);
  const UI = globalThis.WarbandUI;
  const kind = document.body.dataset.kind;
  /** Plafond du texte envoyé à l'hôte pour l'export (le même est revérifié côté hôte). */
  const MAX_EXPORT_CHARS = 2_000_000;

  const main = $("viewer-main");
  const body = $("viewer-body");
  const strip = $("viewer-strip");
  const emptyEl = $("viewer-empty");
  const countEl = $("viewer-count");
  const statusEl = $("viewer-status");
  const filterEl = $("viewer-filter");
  const followBtn = $("viewer-follow");
  const copyBtn = $("viewer-copy");
  const exportBtn = $("viewer-export");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name, className) => globalThis.WarbandIcons?.create(name, className ?? "ico");
  /** Remplace les enfants seulement s'ils diffèrent : les défilements internes sont conservés. */
  const syncChildren = (parent, nodes) => {
    const current = [...parent.children];
    if (current.length === nodes.length && current.every((node, i) => node === nodes[i])) return;
    parent.replaceChildren(...nodes);
  };

  let lastView = null;
  /** Commandes (Monitor, Sortie) : `{ row, key, li, cmdText, lines: [{ el, text, low, shown }], out, tick, shown }`. */
  let records = new Map();
  /** Rapport : `{ item, findings: [{ li, text, low, shown }] }`. */
  let report = null;

  // ───────────────────────────── Suivi de la fin ─────────────────────────────
  let follow = kind !== "report";
  const followTitle = () =>
    follow
      ? t("Désactiver le suivi de la fin pour défiler librement")
      : t("Activer le suivi et revenir en bas");
  function toBottom() {
    for (const record of records.values())
      if (record.out) record.out.scrollTop = record.out.scrollHeight;
    main.scrollTop = main.scrollHeight;
  }
  function setFollow(on) {
    follow = on;
    followBtn.setAttribute("aria-pressed", String(on));
    followBtn.title = followTitle();
    if (on) toBottom();
  }
  followBtn.addEventListener("click", () => setFollow(!follow));
  // L'utilisateur qui remonte coupe le suivi ; le bouton le rétablit.
  main.addEventListener(
    "scroll",
    () => {
      if (follow && main.scrollHeight - main.scrollTop - main.clientHeight > 40) setFollow(false);
    },
    { passive: true },
  );

  // ───────────────────────────── Filtre local ─────────────────────────────
  const query = () =>
    String(filterEl.value ?? "")
      .trim()
      .toLowerCase();
  const hit = (low, q) => q === "" || low.includes(q);

  /** Applique le filtre : masque les lignes sans le texte, puis les cartes devenues vides. */
  function applyFilter() {
    const q = query();
    let shown = 0;
    let total = 0;
    if (kind === "report") {
      for (const f of report?.findings ?? []) {
        f.shown = hit(f.low, q);
        f.li.hidden = !f.shown;
        total++;
        if (f.shown) shown++;
      }
    } else {
      for (const record of records.values()) {
        const cmdHit = hit(record.cmdText, q);
        let lineHits = 0;
        for (const line of record.lines) {
          line.shown = hit(line.low, q);
          line.el.hidden = !line.shown;
          if (line.shown) lineHits++;
        }
        record.shown = cmdHit || lineHits > 0;
        record.li.hidden = !record.shown;
        if (record.out) record.out.hidden = q !== "" && lineHits === 0;
        if (record.tick) record.tick.hidden = !record.shown;
        total += 1 + record.lines.length;
        shown += (cmdHit ? 1 : 0) + lineHits;
      }
      strip.hidden = kind !== "monitor" || ![...records.values()].some((r) => r.shown);
    }
    paintCount(q, shown, total);
    if (follow) toBottom();
  }

  function paintCount(q, shown, total) {
    const rows = [...records.values()].map((record) => record.row);
    let text = "";
    if (q !== "") text = t("{0} / {1} lignes", { 0: shown, 1: total });
    else if (kind === "report") {
      const n = report?.findings.length ?? 0;
      text = n === 0 ? "" : n > 1 ? t`${n} constats` : t`${n} constat`;
    } else if (rows.length > 0) {
      const waiting = rows.filter((r) => r.tone === "wait").length;
      const failed = rows.filter((r) => r.tone === "err").length;
      text = [
        rows.length > 1 ? t`${rows.length} commandes` : t`${rows.length} commande`,
        waiting ? t`${waiting} en attente` : "",
        failed ? t`${failed} en erreur` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    countEl.textContent = text;
    const empty = total === 0;
    const none = !empty && shown === 0;
    emptyEl.hidden = !empty && !none;
    emptyEl.textContent = none
      ? t("Aucune ligne ne contient ce texte.")
      : kind === "monitor"
        ? t("Aucun appel Exegol / Kali dans cette conversation.")
        : kind === "watch"
          ? t("Aucune sortie à afficher.")
          : t("Aucun constat dans ce brouillon.");
  }
  filterEl.addEventListener("input", applyFilter);

  // ───────────────────────────── Commandes (Monitor, Sortie) ─────────────────────────────
  function buildRecord(row) {
    const li = el("li", `mon-row tone-${row.tone}`);
    li.dataset.monitorId = String(row.id);
    const cmd = el("div", "mon-cmd");
    const dot = el("span", "mon-dot");
    dot.setAttribute("aria-hidden", "true");
    cmd.append(dot);
    if (row.container !== "") {
      const tag = el("span", "prompt mon-space", row.container);
      tag.dataset.hue = String(
        ([...row.container].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6) + 1,
      );
      cmd.append(tag);
    }
    cmd.append(el("span", "prompt", "$"), el("code", "mon-text", row.command));
    const meta = el("div", "mon-meta");
    meta.append(el("span", "badge mon-state", row.status));
    if (kind === "monitor" && row.toolUseId !== "") {
      const open = el("button", "ghost mon-open", t("Suivre la sortie"));
      open.type = "button";
      open.addEventListener("click", () =>
        vscode.postMessage({ type: "watch", toolUseId: row.toolUseId }),
      );
      meta.append(open);
    }
    li.append(cmd, meta);
    const lines = [];
    let out = null;
    if (row.output !== "") {
      out = el("pre", "mon-out");
      const texts = row.output.replace(/\n$/, "").split("\n");
      texts.forEach((text, i) => {
        const node = el("span", "mon-line", text);
        node.dataset.n = String(i + 1);
        out.append(node);
        lines.push({ el: node, text, low: text.toLowerCase(), shown: true });
      });
      li.append(out);
    }
    if (row.truncated) li.append(el("p", "note", t("sortie tronquée")));
    const record = {
      row,
      li,
      out,
      lines,
      cmdText: `${row.container} ${row.command}`.toLowerCase(),
      tick: null,
      shown: true,
    };
    if (kind === "monitor") {
      const tick = el("button", `mon-tick tone-${row.tone}`);
      tick.type = "button";
      tick.addEventListener("click", () => {
        setFollow(false);
        li.scrollIntoView?.({ block: "start" });
        li.className = `${li.className} is-flash`;
        setTimeout(() => {
          li.className = li.className.replace(" is-flash", "");
        }, 1000);
      });
      record.tick = tick;
    }
    return record;
  }

  function renderRows(view) {
    const positions = new Map(
      [...records].map(([id, r]) => [
        id,
        { top: r.out?.scrollTop ?? 0, left: r.out?.scrollLeft ?? 0 },
      ]),
    );
    const rows = UI.monitorRows(view);
    // Sortie : si l'exec suivi disparaît de la vue (fenêtre glissante), on garde la dernière sortie connue.
    if (kind === "watch" && rows.length === 0 && records.size > 0) return;
    const next = new Map();
    rows.forEach((row, i) => {
      const key = JSON.stringify([
        row.toolUseId,
        row.container,
        row.command,
        row.output,
        row.truncated,
        row.status,
        row.tone,
      ]);
      let record = records.get(row.id);
      if (!record || record.key !== key) {
        record = buildRecord(row);
        record.key = key;
        const before = positions.get(row.id);
        if (before && record.out) {
          record.out.scrollTop = before.top;
          record.out.scrollLeft = before.left;
        }
      }
      if (record.tick) {
        record.tick.dataset.rowId = String(row.id);
        record.tick.setAttribute(
          "aria-label",
          t`Commande ${i + 1} : ${row.command}, ${row.status}`,
        );
        record.tick.title = `${row.command} · ${row.status}`;
      }
      next.set(row.id, record);
    });
    records = next;
    let list = body.children[0];
    if (!list) {
      list = el("ol", "mon-rows");
      body.append(list);
    }
    syncChildren(
      list,
      [...records.values()].map((r) => r.li),
    );
    if (kind === "monitor")
      syncChildren(
        strip,
        [...records.values()].map((r) => r.tick),
      );
  }

  // ───────────────────────────── Rapport ─────────────────────────────
  const severityLabels = () => [
    ["critical", t("Critique")],
    ["high", t("Élevée")],
    ["medium", t("Moyenne")],
    ["low", t("Faible")],
    ["info", t("Info")],
    ["unrated", t("À évaluer")],
  ];

  function renderReport(view) {
    const item = (Array.isArray(view?.items) ? view.items : []).find(
      (it) => it && it.kind === "report",
    );
    if (!item) {
      report = null;
      body.replaceChildren();
      return;
    }
    const findings = Array.isArray(item.findings) ? item.findings : [];
    const labels = severityLabels();
    const box = el("section", "report");
    box.setAttribute("aria-label", item.title || t("Rapport"));
    const head = el("div", "report-head");
    head.append(
      icon("file", "ico report-ico"),
      el("h2", "report-title", item.title || t("Rapport")),
      el(
        "span",
        "report-count",
        findings.length > 1 ? t`${findings.length} constats` : t`${findings.length} constat`,
      ),
    );
    const bar = el("div", "report-bar");
    bar.setAttribute("aria-hidden", "true");
    const parts = [];
    for (const [key, label] of labels) {
      const count = findings.filter((f) => f.severity === key).length;
      if (!count) continue;
      const seg = el("span", `report-seg sev-${key}`);
      seg.style.setProperty("flex-grow", String(count));
      bar.append(seg);
      parts.push(`${count} ${label.toLowerCase()}`);
    }
    box.append(head, bar, el("p", "report-summary", parts.join(" · ")));
    if (item.description) box.append(el("p", "report-caption", item.description));
    const list = el("ul", "report-list");
    const rows = findings.map((f) => {
      const known = labels.find(([key]) => key === f.severity) ?? labels[5];
      const li = el("li", `report-item sev-${known[0]}`);
      li.append(el("span", "report-sev", known[1]));
      const text = el("div", "report-body");
      text.append(el("span", "report-label", f.label ?? ""));
      if (f.detail) text.append(el("span", "report-detail", f.detail));
      li.append(text);
      list.append(li);
      const line = [known[1], f.label ?? "", f.detail ?? ""].filter(Boolean).join(" · ");
      return {
        li,
        text: `[${known[1]}] ${[f.label ?? "", f.detail ?? ""].filter(Boolean).join(" — ")}`,
        low: line.toLowerCase(),
        shown: true,
      };
    });
    box.append(list);
    body.replaceChildren(box);
    report = {
      projectId: typeof item.projectId === "string" ? item.projectId : "",
      title: item.title || t("Rapport"),
      description: item.description || "",
      findings: rows,
    };
  }

  // ───────────────────────────── Horloge du tour ─────────────────────────────
  const clockEl = $("viewer-clock");
  let clockStart = null;
  let clockTimer = 0;
  const pad2 = (n) => String(n).padStart(2, "0");
  function tickClock() {
    if (!clockEl) return;
    let text = "";
    if (clockStart !== null) {
      const total = Math.max(0, Math.floor((Date.now() - clockStart) / 1e3));
      const h = Math.floor(total / 3600);
      text = `T+${h ? `${h}:` : ""}${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
    }
    clockEl.textContent = text;
  }
  function paintClock(view) {
    clockStart = view?.busy && Number.isFinite(view.turnStartedAt) ? view.turnStartedAt : null;
    clearInterval(clockTimer);
    clockTimer = clockStart === null ? 0 : setInterval(tickClock, 1000);
    tickClock();
  }
  window.addEventListener("pagehide", () => clearInterval(clockTimer));

  // ───────────────────────────── Actions : copier, exporter ─────────────────────────────
  /** Texte de tout le contenu visible (après filtre), tel qu'affiché. */
  function visibleText() {
    if (kind === "report") {
      if (!report) return "";
      const lines = [report.title];
      if (report.description) lines.push(report.description);
      const shown = report.findings.filter((f) => f.shown);
      if (shown.length) lines.push("", ...shown.map((f) => `- ${f.text}`));
      return lines.join("\n");
    }
    return [...records.values()]
      .filter((r) => r.shown)
      .map((r) => {
        const row = r.row;
        const head = `${row.container ? `[${row.container}] ` : ""}$ ${row.command} (${row.status})`;
        return [head, ...r.lines.filter((l) => l.shown).map((l) => l.text)].join("\n");
      })
      .join("\n\n");
  }
  const say = (text) => {
    statusEl.textContent = text;
  };
  copyBtn.addEventListener("click", async () => {
    const label = copyBtn.querySelector?.("[data-i18n]");
    try {
      await navigator.clipboard.writeText(visibleText());
      say(t("Copié"));
    } catch {
      say(t("Échec"));
    }
    if (label) {
      label.textContent = statusEl.textContent;
      setTimeout(() => {
        label.textContent = t("Copier");
      }, 1500);
    }
  });
  exportBtn.addEventListener("click", () => {
    if (kind === "report") {
      // Export Markdown existant : l'hôte relit le projet, la page n'envoie que son identifiant.
      if (report?.projectId)
        vscode.postMessage({ type: "exportReport", projectId: report.projectId });
      return;
    }
    const text = visibleText();
    if (text.length > MAX_EXPORT_CHARS) {
      say(t("Contenu trop volumineux pour l'export : filtrez-le d'abord."));
      return;
    }
    vscode.postMessage({ type: "exportText", text });
  });

  // ───────────────────────────── Messages de l'hôte ─────────────────────────────
  function render(view) {
    lastView = view;
    if (kind === "report") renderReport(view);
    else renderRows(view);
    if (kind !== "report") paintClock(view);
    applyFilter();
  }

  function paintHeading(text) {
    const context = $("viewer-context");
    if (!context) return;
    context.textContent = text.slice(0, 120);
    context.title = context.textContent;
    context.hidden = context.textContent.length === 0;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (typeof message !== "object" || message === null) return;
    if (message.type === "locale" && (message.locale === "fr" || message.locale === "en")) {
      globalThis.WarbandI18n?.setLocale(message.locale);
      globalThis.WarbandI18n?.applyStatic(document);
      followBtn.title = followTitle();
      records = new Map();
      if (lastView) render(lastView);
      return;
    }
    if (message.type === "title" && typeof message.text === "string") {
      paintHeading(message.text);
      return;
    }
    if (message.type === "view" && typeof message.view === "object" && message.view !== null) {
      // Autre conversation : les nœuds mis en cache ne lui appartiennent plus.
      if (typeof message.chatId === "string" && message.chatId !== lastChatId) {
        lastChatId = message.chatId;
        records = new Map();
        body.replaceChildren();
        strip.replaceChildren();
      }
      render(message.view);
    }
  });
  let lastChatId = null;

  vscode.postMessage({ type: "ready" });
})();
