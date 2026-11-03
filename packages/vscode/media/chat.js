(() => {
  const vscode = acquireVsCodeApi();
  const t = (...args) => globalThis.WarbandI18n?.t(...args) ?? fallbackText(...args);
  const fallbackText = (key, ...values) =>
    typeof key === "string"
      ? key
      : key.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const approvals = $("approvals");
  const historyList = $("history-list");
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  const UI = globalThis.WarbandUI;
  // Ces liens portent uniquement des textes produit explicitement marqués par l().
  const productBindings = new Set();
  const l = (...args) => ({ translation: args });
  function productAttribute(node, attribute, value) {
    const paint = () => {
      const text = value?.byLocale
        ? (value.byLocale[globalThis.WarbandI18n?.getLocale() ?? "en"] ?? value.fallback)
        : value?.translation
          ? t(...value.translation)
          : value;
      if (attribute) node.setAttribute(attribute, text);
      else node.textContent = text;
    };
    paint();
    if (value?.translation || value?.byLocale) productBindings.add({ node, paint });
  }
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) productAttribute(node, null, text);
    return node;
  };
  const exampleKeys = [
    "Fais un nmap peu verbeux et résume les ports ouverts",
    "Parmi les services trouvés, lesquels valent un test en premier ?",
    "Cherche les pages qui prennent un paramètre et sentent l'injection",
  ];
  const statusLabels = () => ({
    pending: t("en cours"),
    ok: t("réussi"),
    error: t("erreur"),
    denied: t("refusé"),
  });
  const ICON = { pending: "clock", ok: "check", error: "close", denied: "ban" };
  const svg = (name, className) => globalThis.WarbandIcons.create(name, className);
  function inline(parent, nodes) {
    for (const n of nodes) {
      if (n.t === "text") parent.append(document.createTextNode(n.v));
      else if (n.t === "code") parent.append(el("code", "", n.v));
      else if (n.t === "b" || n.t === "i") {
        const wrap = el(n.t === "b" ? "strong" : "em");
        inline(wrap, n.c);
        parent.append(wrap);
      }
    }
  }
  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = t("Copié");
    } catch {
      button.textContent = t("Échec");
    }
    setTimeout(() => {
      button.textContent = t("Copier");
    }, 1500);
  }
  function renderBlock(b) {
    if (b.t === "p") {
      const p = el("p");
      inline(p, b.c);
      return p;
    }
    if (b.t === "h") {
      const h = el(`h${b.level + 2}`, "md-h");
      inline(h, b.c);
      return h;
    }
    if (b.t === "table") {
      const wrap = el("div", "md-table");
      const table = el("table");
      const thead = el("thead");
      const hr = el("tr");
      b.headers.forEach((cell, i) => {
        const th = el("th");
        const align = b.align[i];
        if (align && align !== "left") th.setAttribute("data-align", align);
        inline(th, cell);
        hr.append(th);
      });
      thead.append(hr);
      const tbody = el("tbody");
      for (const row of b.rows) {
        const tr = el("tr");
        row.forEach((cell, i) => {
          const td = el("td");
          const align = b.align[i];
          if (align && align !== "left") td.setAttribute("data-align", align);
          inline(td, cell);
          tr.append(td);
        });
        tbody.append(tr);
      }
      table.append(thead, tbody);
      wrap.append(table);
      return wrap;
    }
    if (b.t === "code") {
      const box = el("div", "codeblock");
      const head = el("div", "codehead");
      head.append(el("span", "lang", b.lang));
      const btn = el("button", "copy", t("Copier"));
      btn.type = "button";
      btn.addEventListener("click", () => copy(b.text, btn));
      head.append(btn);
      const pre = el("pre");
      pre.append(el("code", "", b.text));
      box.append(head, pre);
      return box;
    }
    const list = el(b.t === "ol" ? "ol" : "ul");
    for (const item of b.items) {
      const li = el("li");
      inline(li, item);
      list.append(li);
    }
    return list;
  }
  const openTools = /* @__PURE__ */ new Set();
  const toolStatus = /* @__PURE__ */ new Map();
  function renderTool(item, credential) {
    const toolUseId = item.toolUseId;
    const box = el("details", `tool ${item.status}`);
    box.open = openTools.has(item.toolUseId);
    box.addEventListener("toggle", () => {
      if (box.open) openTools.add(toolUseId);
      else openTools.delete(toolUseId);
    });
    const sum = el("summary");
    const icon = svg(ICON[item.status] ?? "tool", "ico icon");
    const before = toolStatus.get(item.toolUseId);
    if (before !== void 0 && before !== item.status) icon.classList.add("settled");
    toolStatus.set(item.toolUseId, item.status);
    sum.append(
      svg("chevronRight", "ico tool-chevron"),
      svg(UI.toolIcon(item.tool), "ico tool-family"),
      el("span", "tool-name", item.label),
    );
    if (item.summary) sum.append(el("span", "tool-summary", item.summary));
    sum.append(icon, el("span", "tool-state", statusLabels()[item.status] ?? item.status));
    box.append(sum);
    let body;
    const paintBody = () => {
      if (!box.open) {
        body?.remove();
        body = void 0;
        return;
      }
      if (body) return;
      const current = credential.item;
      body = el("div", "tool-body");
      body.append(el("div", "label", t("Entrée")), el("pre", "", current.input));
      if (current.output)
        body.append(
          el("div", "label", t("Sortie")),
          el(
            "pre",
            "",
            current.truncated
              ? t`${current.output}
[…tronqué]`
              : current.output,
          ),
        );
      box.append(body);
    };
    box.addEventListener("toggle", paintBody);
    paintBody();
    return box;
  }
  function copyButton(text) {
    const btn = el("button", "msg-copy", t("Copier"));
    btn.type = "button";
    btn.title = t("Copier le message");
    btn.addEventListener("click", () => copy(text, btn));
    return btn;
  }
  // Les réponses de l'agent sont signées du logo, repris de l'en-tête.
  function agentMark() {
    const mark = document.querySelector("#title .brand")?.cloneNode(true);
    if (!mark) return null;
    mark.setAttribute("class", "brand msg-avatar");
    mark.setAttribute("width", "20");
    mark.setAttribute("height", "20");
    return mark;
  }
  function messageShell(kind, text, body) {
    const row = el("div", `msg-row ${kind}`);
    const mark = kind === "agent" ? agentMark() : null;
    if (mark) row.append(mark);
    row.append(body, copyButton(text));
    return row;
  }
  // Rapport : constats classés par gravité, avec une barre de répartition.
  const severityLabels = () => [
    ["critical", t("Critique")],
    ["high", t("Élevée")],
    ["medium", t("Moyenne")],
    ["low", t("Faible")],
    ["info", t("Info")],
    ["unrated", t("À évaluer")],
  ];
  function renderReport(item) {
    const findings = Array.isArray(item.findings) ? item.findings : [];
    const box = el("section", "report");
    box.setAttribute("aria-label", item.title || t("Rapport"));
    const head = el("div", "report-head");
    head.append(
      svg("file", "ico report-ico"),
      el("h3", "report-title", item.title || t("Rapport")),
    );
    head.append(
      el(
        "span",
        "report-count",
        findings.length > 1 ? t`${findings.length} constats` : t`${findings.length} constat`,
      ),
    );
    const bar = el("div", "report-bar");
    bar.setAttribute("aria-hidden", "true");
    const summary = el("p", "report-summary");
    const parts = [];
    for (const [key, label] of severityLabels()) {
      const count = findings.filter((f) => f.severity === key).length;
      if (!count) continue;
      const seg = el("span", `report-seg sev-${key}`);
      seg.style.setProperty("flex-grow", String(count));
      bar.append(seg);
      parts.push(`${count} ${label.toLowerCase()}`);
    }
    summary.textContent = parts.join(" · ");
    const list = el("ul", "report-list");
    for (const f of findings) {
      const known = severityLabels().find(([key]) => key === f.severity) ?? severityLabels()[5];
      const li = el("li", `report-item sev-${known[0]}`);
      li.append(el("span", "report-sev", known[1]));
      const body = el("div", "report-body");
      body.append(el("span", "report-label", f.label ?? ""));
      if (f.detail) body.append(el("span", "report-detail", f.detail));
      li.append(body);
      list.append(li);
    }
    box.append(head, bar, summary);
    if (item.description) box.append(el("p", "report-caption", item.description));
    box.append(list);
    if (item.projectId) {
      const save = el("button", "primary", t("Exporter le brouillon Markdown"));
      save.type = "button";
      save.addEventListener("click", () =>
        vscode.postMessage({ type: "exportReport", projectId: item.projectId }),
      );
      box.append(save);
    }
    return box;
  }
  // Progression de la mission : rail de phases sous l'en-tête.
  function paintMission(mission) {
    const nav = $("mission");
    const phases = Array.isArray(mission?.phases) ? mission.phases : [];
    nav.hidden = phases.length === 0;
    const STATE = {
      done: t("terminée"),
      current: t("en cours"),
      wait: t("en attente d'accord"),
      todo: t("à venir"),
    };
    $("mission-steps").replaceChildren(
      ...phases.map((tactic, i) => {
        const li = el("li", `mission-step is-${tactic.state}`);
        if (tactic.state === "current" || tactic.state === "wait")
          li.setAttribute("aria-current", "step");
        const mark = el("span", "mission-mark");
        mark.setAttribute("aria-hidden", "true");
        if (tactic.state === "done") mark.append(svg("check", "ico"));
        else mark.textContent = String(i + 1);
        li.append(
          mark,
          el("span", "mission-label", tactic.label),
          el("span", "sr-only", ` : ${STATE[tactic.state] ?? tactic.state}`),
        );
        return li;
      }),
    );
  }
  const itemNodes = /* @__PURE__ */ new Map();
  const sameDisplay = (a, b) =>
    a &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(b).every((key) => key === "blocks" || a[key] === b[key]);
  function renderItem(item) {
    const cached = itemNodes.get(item.id);
    if (sameDisplay(cached?.item, item)) {
      cached.item = item;
      return cached.node;
    }
    const credential = { item, node: null };
    let node;
    if (item.kind === "tool") node = renderTool(item, credential);
    else if (item.kind === "report") node = renderReport(item);
    else if (item.kind === "user")
      node = messageShell("user", item.text, el("div", "msg user", item.text));
    else if (item.kind === "agent") {
      const message = el("div", "msg agent");
      for (const block of item.blocks) message.append(renderBlock(block));
      node = messageShell("agent", item.text, message);
    } else {
      node = el("div", `notice ${item.level}`, item.text);
      if (item.level === "error") node.setAttribute("role", "alert");
    }
    credential.node = node;
    itemNodes.set(item.id, credential);
    return node;
  }
  function renderItems(items) {
    const nodes = [];
    let group = null;
    for (const item of items) {
      if (item.kind === "tool") {
        if (!group) {
          group = el("div", "tool-group");
          nodes.push(group);
        }
        group.append(renderItem(item));
        continue;
      }
      group = null;
      nodes.push(renderItem(item));
    }
    const ids = new Set(items.map((item) => item.id));
    for (const id of itemNodes.keys()) if (!ids.has(id)) itemNodes.delete(id);
    const tools = new Set(
      items.filter((item) => item.kind === "tool").map((item) => item.toolUseId),
    );
    for (const id of toolStatus.keys()) if (!tools.has(id)) toolStatus.delete(id);
    for (const id of openTools) if (!tools.has(id)) openTools.delete(id);
    return nodes;
  }
  function welcome(sandbox) {
    const box = el("div", "welcome");
    const spider = globalThis.WarbandSpider?.create("rw-spider welcome-spider");
    const mark = spider ? null : document.querySelector("#title .brand")?.cloneNode(true);
    if (spider) {
      box.append(spider);
    } else if (mark) {
      mark.setAttribute("class", "brand welcome-mark");
      mark.removeAttribute("width");
      mark.removeAttribute("height");
      box.append(mark);
    }
    const tagline = el(
      "h2",
      "welcome-tagline",
      t("Le pentest dans VS Code, avec l’IA à la demande."),
    );
    tagline.setAttribute("lang", globalThis.WarbandI18n?.getLocale() ?? "fr");
    box.append(
      tagline,
      el(
        "p",
        "hint",
        t(
          "Pilote tes conteneurs depuis le cockpit, travaille dans les terminaux et relie tes trouvailles dans la Kill chain. L’IA intervient à la demande et reste optionnelle.",
        ),
      ),
    );
    const list = el("div", "examples");
    for (const key of exampleKeys) {
      const text = t(key);
      const b = el("button", "example", text);
      b.type = "button";
      b.addEventListener("click", () => {
        input.value = text;
        grow();
        input.focus();
      });
      list.append(b);
    }
    box.append(list);
    if (sandbox) {
      box.append(el("p", "hint", t`Bac à sable actif : les commandes tournent dans ${sandbox}.`));
    }
    return box;
  }
  const seenCards = /* @__PURE__ */ new Set();
  const approvalNodes = new Map();
  function cardTraits(card) {
    const risks = [];
    if (UI.toolIcon(card.tool) === "terminal") risks.push(["terminal", l("Exécution")]);
    if (card.networkActive) risks.push(["link", l("Réseau")]);
    if (card.canRemember) risks.push(["history", l("Mémorisable")]);
    return risks;
  }
  function renderCard(card, isNew, previous) {
    const previousChoice =
      !!previous?.card.confirming === !!card.confirming ? previous?.node.dataset.choice : undefined;
    const box = el("div", isNew ? "card enter" : "card");
    box.tabIndex = -1;
    box.setAttribute("role", "group");
    productAttribute(box, "aria-label", l`Demande d'autorisation : ${card.label}`);
    const risks = cardTraits(card);
    const head = el("div", "card-head");
    const icon = svg("shield", "ico card-icon");
    icon.setAttribute("aria-hidden", "true");
    head.append(icon, el("div", "card-title", l("Autorisation requise")));
    const chips = el("div", "card-risks");
    for (const [name, label] of risks) {
      const chip = el("span", "card-risk");
      chip.append(svg(name, "ico"), el("span", "", label));
      chips.append(chip);
    }
    const grid = el("div", "card-grid");
    const outil = el(
      "div",
      "card-val",
      card.labelByLocale ? { byLocale: card.labelByLocale, fallback: card.label } : card.label,
    );
    if (card.networkActive) outil.append(el("span", "", l(" · réseau activé")));
    grid.append(
      el("span", "card-key", l("Outil")),
      outil,
      el("span", "card-key", l("Action")),
      el("code", "card-summary", card.summary || card.tool),
      el("span", "card-key", l("Raison")),
      el(
        "div",
        "card-val card-reason",
        card.reasonByLocale
          ? { byLocale: card.reasonByLocale, fallback: card.reason }
          : card.reason,
      ),
    );
    const det = el("details", "card-details");
    det.open = previous?.node.querySelector?.(".card-details")?.open === true;
    det.append(el("summary", "", l("Détails")), el("pre", "", card.detail));
    box.append(head);
    if (risks.length) box.append(chips);
    box.append(grid, det);
    const row = el("div", "card-buttons");
    const buttons = {};
    const pendingText = l("Confirmation native en cours…");
    const decide = (choice) => {
      if (box.dataset.decided || card.confirming) return;
      box.dataset.decided = "true";
      box.dataset.choice = choice;
      if (choice !== "always") box.classList.add(choice === "deny" ? "is-denied" : "is-locked");
      for (const button of row.querySelectorAll("button")) button.disabled = true;
      row.replaceChildren(
        el(
          "span",
          "badge",
          choice === "always" ? pendingText : choice === "deny" ? l("Refusé") : l("Autorisé"),
        ),
      );
      vscode.postMessage({ type: "approve", toolUseId: card.toolUseId, choice });
    };
    const button = (label, choice, css) => {
      const b = el("button", css, label);
      b.type = "button";
      b.addEventListener("click", () => decide(choice));
      buttons[choice] = b;
      row.append(b);
    };
    button(l("Autoriser une fois"), "once", "primary");
    button(l("Refuser"), "deny", "danger");
    if (card.canRemember) button(l("Toujours"), "always", "link");
    if (card.confirming || previousChoice) {
      box.dataset.decided = "true";
      if (previousChoice) box.dataset.choice = previousChoice;
      if (previousChoice && previousChoice !== "always")
        box.classList.add(previousChoice === "deny" ? "is-denied" : "is-locked");
      for (const button of row.querySelectorAll("button")) button.disabled = true;
      row.replaceChildren(
        el(
          "span",
          "badge",
          previousChoice === "deny"
            ? l("Refusé")
            : previousChoice === "once"
              ? l("Autorisé")
              : pendingText,
        ),
      );
    }
    box.append(row);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && e.target === box) {
        e.preventDefault();
        buttons.deny.click();
      }
    });
    return box;
  }

  const ctlGroup = $("ctl-group");
  const modelChip = $("model-chip");
  const cfgBtn = $("cfg-btn");
  const modelPop = $("model-pop");
  const cfgPop = $("cfg-pop");
  const modelFilter = $("model-filter");
  const modelList = $("model-list");
  const modelInput = $("model-input");
  const effortInput = $("effort");
  let ctl = null;
  let levels = [];
  let query = "";
  let active = -1;
  let visible = [];
  let optNodes = [];
  let openPop = null;
  const resizer = new ResizeObserver(() => {
    if (openPop) place(openPop.pop, openPop.chip);
  });
  function place(pop, anchor) {
    pop.style.setProperty("--jn-maxh", "9999px");
    const r = anchor.getBoundingClientRect();
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    const p = UI.placePopover(
      { left: r.left, top: r.top, bottom: r.bottom },
      { width: pop.offsetWidth, height: pop.offsetHeight },
      viewport,
    );
    pop.style.setProperty("--jn-maxh", `${p.maxHeight}px`);
    // La hauteur finale peut changer après rétraction de la liste ou retour à la ligne.
    const height = pop.offsetHeight;
    const y = p.side === "above" ? r.top - 6 - height : p.y;
    pop.style.setProperty("--jn-x", `${p.x}px`);
    pop.style.setProperty("--jn-y", `${Math.max(8, Math.round(y))}px`);
    pop.classList.add("placed");
  }
  function wirePop(pop, chip, { render: render2, focus }) {
    pop.addEventListener("beforetoggle", (e) => {
      if (e.newState === "open" && chip.getAttribute("aria-disabled") === "true")
        e.preventDefault();
    });
    pop.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      chip.setAttribute("aria-expanded", String(open));
      if (open) {
        render2();
        place(pop, chip);
        openPop = { pop, chip };
        resizer.observe(document.body);
        resizer.observe(pop);
        focus();
        return;
      }
      pop.classList.remove("placed");
      if (openPop?.pop === pop) {
        resizer.disconnect();
        openPop = null;
      }
      const a = document.activeElement;
      if (!a || a === document.body || pop.contains(a)) chip.focus();
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [
        ...pop.querySelectorAll('button, input, select, [role="button"][tabindex="0"]'),
      ].filter((n) => !n.disabled && !n.hidden && !n.closest("[hidden]"));
      const t = UI.tabTarget(items.length, items.indexOf(document.activeElement), e.shiftKey);
      if (t >= 0) {
        e.preventDefault();
        items[t].focus();
      }
    });
  }
  const modelEntries = () => [
    {
      value: null,
      label: t("Modèle par défaut"),
      description: t("Réglage warband.model, sinon le modèle du binaire."),
    },
    ...(ctl?.models ?? []),
  ];
  function paintActive() {
    optNodes.forEach((n, i) => {
      n.classList.toggle("active", i === active);
    });
    const node = optNodes[active];
    if (node) {
      modelFilter.setAttribute("aria-activedescendant", node.id);
      node.scrollIntoView({ block: "nearest" });
    } else modelFilter.removeAttribute("aria-activedescendant");
  }
  function pick(entry) {
    if (!ctl || ctl.locked) return;
    if (entry.value !== ctl.model) vscode.postMessage({ type: "setModel", model: entry.value });
    modelPop.hidePopover();
  }
  function renderModelList(preferCurrent) {
    visible = UI.filterModels(UI.groupModels(modelEntries(), ctl.provider), query);
    optNodes = [];
    const nodes = [];
    let group = null;
    let kind = null;
    visible.forEach((m, i) => {
      const k = m.group;
      if (k !== kind) {
        kind = k;
        group = el("div", "grp");
        group.setAttribute("role", "group");
        const name = m.providerLabel;
        group.setAttribute("aria-label", name);
        const head = el("div", "grp-head", name);
        head.setAttribute("aria-hidden", "true");
        group.append(head);
        nodes.push(group);
      }
      const o = el("div", "opt");
      o.id = `opt-${i}`;
      o.setAttribute("role", "option");
      const current = m.value === ctl.model;
      o.setAttribute("aria-selected", String(current));
      o.title = [m.value, m.description].filter(Boolean).join(" — ");
      const mark = svg("check", "ico opt-check");
      o.append(mark, el("span", "opt-label", m.label));
      const badges = el("span", "model-badges");
      if (m.free) {
        const badge = el("span", "badge model-free", t("Gratuit"));
        badge.title = t("Modèle annoncé « Free » par le fournisseur.");
        badges.append(badge);
      }
      if (current) badges.append(el("span", "sr-only", t("actuel")));
      o.append(badges);
      if (m.value !== null) o.append(el("span", "opt-desc model-source", m.value));
      if (m.description) o.append(el("span", "opt-desc", m.description));
      o.addEventListener("click", () => pick(m));
      group.append(o);
      optNodes.push(o);
    });
    if (visible.length === 0) {
      nodes.push(
        el(
          "div",
          "empty",
          ctl.modelsStatus === "loading"
            ? t("Chargement de la liste…")
            : t("Aucun modèle ne correspond."),
        ),
      );
    }
    modelList.replaceChildren(...nodes);
    const cur = visible.findIndex((m) => m.value === ctl.model);
    active =
      preferCurrent && cur >= 0
        ? cur
        : UI.listboxKey(
            { active: -1 },
            "Home",
            visible.map(() => ({ disabled: false })),
          ).active;
    paintActive();
  }
  function renderControls(c) {
    ctlGroup.hidden = !c;
    $("roe").hidden = !c;
    ctl = c;
    if (!c) {
      for (const p of [modelPop, cfgPop]) if (p.matches(":popover-open")) p.hidePopover();
      document.body.classList.remove("learning");
      $("learning-badge").hidden = true;
      return;
    }
    if (!lastCapabilities) $("provider").value = c.provider;
    $("provider").disabled = c.locked;
    $("provider-connect").disabled = c.locked;
    modelChip.setAttribute("aria-disabled", String(c.locked));
    const known = c.models?.find((m) => m.value === c.model);
    const name = c.model === null ? t("Modèle par défaut") : (known?.label ?? c.model);
    $("model-chip-label").textContent = name;
    modelChip.title = t`Modèle : ${name} (utilisé pour le message suivant)`;
    const free = c.models === null;
    const loading = c.modelsStatus === "loading";
    const message =
      c.modelsMessage ||
      (loading
        ? t("Récupération des modèles… Vous pouvez relancer si le chargement ne répond pas.")
        : c.modelsStatus === "unavailable"
          ? t("Liste indisponible. Vérifiez la connexion au fournisseur, puis réessayez.")
          : "");
    $("models-status").textContent = message;
    $("models-status").hidden = !message;
    $("models-connect").hidden = loading || !message;
    $("models-connect").disabled = c.locked;
    modelFilter.hidden = modelList.hidden = free;
    if (modelFilter.parentElement) modelFilter.parentElement.hidden = free;
    modelInput.hidden = !free || loading;
    modelInput.disabled = c.locked;
    $("models-refresh").disabled = c.locked;
    $("models-refresh-label").textContent = loading
      ? t("Relancer le chargement")
      : t("Actualiser la liste");
    if (free) {
      if (document.activeElement !== modelInput) modelInput.value = c.model ?? "";
    } else if (modelPop.matches(":popover-open")) renderModelList(false);
    levels =
      c.provider === "claude"
        ? c.levels.filter((level) => level.enabled)
        : [{ value: null, label: t("Auto") }, ...c.reasoningVariants];
    const choice = c.provider === "claude" ? c.effort : c.variant;
    const auto = choice === null;
    $("effort-auto").hidden = auto;
    $("effort-auto").disabled = c.locked || c.effortDisabled;
    effortInput.classList.toggle("auto", auto);
    effortInput.max = String(Math.max(levels.length - 1, 0));
    const idx = auto
      ? c.provider === "claude"
        ? Math.floor(levels.length / 2)
        : 0
      : Math.max(
          levels.findIndex((l) => l.value === choice),
          0,
        );
    effortInput.value = String(idx);
    const scale = $("effort-scale");
    scale.classList.remove("is-dragging");
    scale.style.setProperty("--jn-progress", String(idx / Math.max(levels.length - 1, 1)));
    scale.classList.toggle("auto", auto);
    shownLevel = auto ? -1 : idx;
    effortInput.disabled = c.locked || c.effortDisabled;
    const disabledTip =
      c.provider === "claude"
        ? t("Ce modèle n'a pas d'effort réglable.")
        : t(
            "Aucune variante de raisonnement connue pour ce modèle. Actualisez la liste des modèles.",
          );
    effortInput.title = c.effortDisabled ? disabledTip : c.effortTip;
    effortInput.setAttribute(
      "aria-valuetext",
      `${auto ? t("Auto") : (levels[idx]?.label ?? c.effortLabel)} : ${c.effortTip}`,
    );
    const shown = auto ? t("Auto") : (levels[idx]?.label ?? c.effortLabel);
    $("effort-label").textContent = shown;
    $("effort-tip").textContent = c.effortDisabled ? disabledTip : c.effortTip;
    $("effort-tip").title = $("effort-tip").textContent;
    $("cfg-level").textContent = shown;
    $("effort-model-label").textContent = name;
    $("effort-model").disabled = c.locked;
    paintNotches(idx);
    scale.classList.toggle("is-disabled", effortInput.disabled);
    cfgBtn.title = t`Configurer : effort ${c.effortLabel}`;
    document.body.classList.toggle("learning", c.learning === true);
    $("learning-badge").hidden = c.learning !== true;
    learningSwitch.setAttribute("aria-checked", String(c.learning === true));
    learningSwitch.setAttribute("aria-disabled", String(c.locked));
    renderBypass();
  }
  wirePop(modelPop, modelChip, {
    render() {
      query = "";
      modelFilter.value = "";
      if (ctl && ctl.models !== null) renderModelList(true);
    },
    focus() {
      (ctl?.models === null ? modelInput : modelFilter).focus();
    },
  });
  const composerMenu = $("composer-menu");
  const composerMenuBtn = $("composer-menu-btn");
  let lastCapabilities = null;
  const skillLabels = {
    mentor: "Mentor",
    "bug-bounty": "Bug bounty",
    "out-of-box": "Out of the box",
    "red-team": "Red team",
    htb: "HTB / CTF",
  };
  const mcpLabels = {
    playwright: "Playwright",
    filesystem: "Filesystem",
    markitdown: "MarkItDown",
    reptor: "Reptor",
    serena: "Serena",
    semgrep: "Semgrep",
    trivy: "Trivy",
    bloodhound: "BloodHound",
    ghidra: "Ghidra",
    wiremcp: "WireMCP",
    burp: "Burp Suite",
  };
  function closeComposer() {
    if (composerMenu.matches(":popover-open")) composerMenu.hidePopover();
  }
  function renderCapabilities(caps, view = lastView) {
    lastCapabilities = caps ?? null;
    const target = $("composer-resources");
    const chips = $("selected-resources");
    const focusedChoice = [...target.querySelectorAll(".resource-toggle")].indexOf(
      document.activeElement,
    );
    if (!caps) {
      target.replaceChildren();
      chips.hidden = true;
      return;
    }
    const select = $("provider");
    const selected = caps.provider;
    select.replaceChildren(
      ...caps.providers.map((p) => {
        const option = el("option", "", p.label);
        option.value = p.id;
        return option;
      }),
    );
    if (!caps.providers.length || !selected) {
      const placeholder = el("option", "", t("Choisir un fournisseur"));
      placeholder.value = "";
      select.prepend(placeholder);
    }
    select.value = selected ?? "";
    const learning = view?.controls?.learning === true;
    const locked = !!view?.busy || !!view?.readonly || learning;
    const rows = [];
    const heading = (text) => rows.push(el("p", "composer-section", t(text)));
    const choice = (label, checked, apply, radio = false, unavailable = false) => {
      const row = el("button", "resource-toggle composer-choice", label);
      row.type = "button";
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", String(checked));
      row.disabled = locked || unavailable;
      row.addEventListener("click", () => {
        const selection = {
          ...lastCapabilities.selection,
          integrations: [...lastCapabilities.selection.integrations],
        };
        apply(selection, radio ? true : !checked);
        lastCapabilities = { ...lastCapabilities, selection };
        vscode.postMessage({ type: "setSelection", selection });
        const index = rows.indexOf(row);
        renderCapabilities(lastCapabilities, view);
        $("composer-resources").children[index]?.focus();
      });
      rows.push(row);
    };
    if (caps.skills.length) {
      heading("Skills / méthodes");
      choice(
        t("Méthode générale"),
        caps.selection.profile === null,
        (s) => {
          s.profile = null;
        },
        true,
      );
      for (const id of caps.skills)
        choice(
          skillLabels[id] ?? id,
          caps.selection.profile === id,
          (s) => {
            s.profile = id;
          },
          true,
        );
    }
    if (caps.integrations.length || caps.burp) {
      heading("Connecteurs MCP");
      for (const id of caps.integrations)
        choice(
          mcpLabels[id] ?? id,
          caps.selection.integrations.includes(id),
          (s, on) => {
            s.integrations = on ? [...s.integrations, id] : s.integrations.filter((v) => v !== id);
          },
          false,
          caps.selection.integrations.length >= 4 && !caps.selection.integrations.includes(id),
        );
      if (caps.burp)
        choice("Burp Suite", caps.selection.burp, (s, on) => {
          s.burp = on;
        });
    }
    if (caps.settings?.webSearch) {
      heading("Recherche");
      choice(t("Recherche web"), caps.selection.webSearch, (s, on) => {
        s.webSearch = on;
      });
    }
    rows.push(
      el(
        "p",
        "tip",
        t(
          learning
            ? "Le mode Apprentissage utilise seulement les cours et les terminaux en lecture."
            : "Ces choix s’appliquent à cette conversation. Les actions restent soumises aux approbations.",
        ),
      ),
    );
    target.replaceChildren(...rows);
    if (focusedChoice >= 0) target.querySelectorAll(".resource-toggle")[focusedChoice]?.focus();
    const names = [
      caps.selection.profile ? skillLabels[caps.selection.profile] : null,
      ...caps.selection.integrations.map((id) => mcpLabels[id] ?? id),
      caps.selection.burp ? "Burp Suite" : null,
      caps.selection.webSearch ? t("Recherche web") : null,
    ].filter(Boolean);
    chips.replaceChildren(
      ...names.map((name) => el("span", "badge", learning ? `${name} · ${t("en pause")}` : name)),
    );
    chips.hidden = !names.length;
  }
  wirePop(composerMenu, composerMenuBtn, {
    render() {
      renderCapabilities(lastCapabilities);
    },
    focus() {
      composerMenu.querySelector("button:not(:disabled),input:not(:disabled)")?.focus();
    },
  });
  composerMenu.addEventListener("click", (event) => {
    if (event.target.closest(".composer-action")) closeComposer();
  });
  $("composer-settings").addEventListener("click", () =>
    vscode.postMessage({ type: "openSystem" }),
  );
  const bypassSwitch = $("bypass-switch");
  const learningSwitch = $("learning-switch");
  function toggleLearning() {
    if (!ctl || ctl.locked) return;
    vscode.postMessage({ type: "setLearning", enabled: ctl.learning !== true });
  }
  learningSwitch.addEventListener("click", toggleLearning);
  const bypassState = $("bypass-state");
  const bypassBadge = $("bypass-badge");
  let bypassCtx = { push: null, previous: null, userOff: false };
  let bypassUserOff = false;
  // Mode de supervision : jauge à trois crans dans l'en-tête.
  function paintRoe() {
    const roe = $("roe");
    const learning = document.body.classList.contains("learning");
    const pending = !learning && document.body.classList.contains("bypass-pending");
    const level = learning ? 1 : document.body.classList.contains("bypass-on") || pending ? 3 : 2;
    const label = learning
      ? t("Apprentissage")
      : pending
        ? t("Bypass · en attente")
        : level === 3
          ? t("Bypass")
          : t("Supervisé");
    roe.dataset.level = String(level);
    roe.classList.toggle("is-pending", pending);
    $("roe-label").textContent = label;
    roe.setAttribute("aria-label", t`Mode de supervision : ${label}. Ouvrir Configurer`);
  }
  // Affichage seulement : l’échéance et la décision restent celles du moteur.
  const BYPASS_MAX_MS = 2 * 60 * 60 * 1000;
  const BYPASS_ENDING_MS = 10 * 60 * 1000;
  let bypassTimer = 0;
  function paintBypassClock() {
    clearTimeout(bypassTimer);
    bypassTimer = 0;
    const roe = $("roe");
    const expiresAt = bypassCtx.push?.expiresAt;
    const on = document.body.classList.contains("bypass-on") && Number.isFinite(expiresAt);
    const ms = on ? Math.max(0, expiresAt - Date.now()) : 0;
    document.body.classList.toggle("bypass-ending", on && ms > 0 && ms <= BYPASS_ENDING_MS);
    if (!on || ms === 0) {
      roe.style.removeProperty("--jn-left");
      $("roe-left").textContent = "";
      return;
    }
    const minutes = Math.ceil(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const left =
      hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
    roe.style.setProperty("--jn-left", String(Math.min(1, ms / BYPASS_MAX_MS)));
    $("roe-left").textContent = left;
    roe.setAttribute(
      "aria-label",
      t`Mode de supervision : Bypass, reste ${left}. Ouvrir Configurer`,
    );
    if (!document.hidden) bypassTimer = setTimeout(renderBypass, Math.min(15000, ms));
  }
  // Le texte complet reste disponible sans changer le fournisseur sélectionné.
  const providerHelp = $("provider-help");
  const toggleProviderHelp = () => {
    const open = providerHelp.getAttribute("aria-expanded") !== "true";
    providerHelp.setAttribute("aria-expanded", String(open));
    providerHelp.title = open ? t("Réduire le texte") : t("Afficher tout le texte");
  };
  providerHelp.addEventListener("click", toggleProviderHelp);
  providerHelp.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleProviderHelp();
  });
  function renderBypass() {
    paintRoe();
    const learning = ctl?.learning === true;
    bypassSwitch.setAttribute("aria-disabled", String(learning));
    if (learning) {
      bypassSwitch.setAttribute("aria-checked", "false");
      bypassState.textContent = t("Inopérant en mode Apprentissage");
      bypassState.title = bypassState.textContent;
      document.body.classList.remove("bypass-on", "bypass-pending");
      bypassBadge.hidden = true;
      bypassBadge.replaceChildren();
      paintRoe();
      paintBypassClock();
      return;
    }
    const v = UI.bypassView(bypassCtx.push, bypassCtx.previous, bypassCtx.userOff, Date.now());
    bypassSwitch.setAttribute("aria-checked", String(v.checked));
    bypassState.textContent = v.text;
    bypassState.title = v.text;
    document.body.classList.toggle("bypass-on", v.state === "on");
    document.body.classList.toggle("bypass-pending", v.state === "pending");
    paintRoe();
    paintBypassClock();
    bypassBadge.hidden = v.badge === null;
    if (v.badge) {
      bypassBadge.replaceChildren(
        el("span", "bp-word", v.badge.word),
        el("span", "bp-time", ` · ${v.badge.time}`),
      );
      bypassBadge.title = t`Bypass actif jusqu'à ${v.until} : désactivable dans Configurer ou la barre d'état`;
    } else bypassBadge.replaceChildren();
  }
  function toggleBypass() {
    if (ctl?.learning === true) return;
    const last = bypassCtx.push;
    const enabled = !(last?.on === true || last?.armed === true);
    if (!enabled) bypassUserOff = true;
    vscode.postMessage({ type: "setBypass", enabled });
  }
  bypassSwitch.addEventListener("click", toggleBypass);
  function resetConversation() {
    bypassUserOff = true;
    vscode.postMessage({ type: "reset" });
  }
  wirePop(cfgPop, cfgBtn, {
    render() {
      renderBypass();
    },
    focus() {
      [...cfgPop.querySelectorAll('input, button, select, [role="button"][tabindex="0"]')]
        .find((n) => !n.disabled && !n.hidden)
        ?.focus();
    },
  });
  const slashPop = $("slash-pop");
  const slashBtn = $("slash-btn");
  $("monitor-btn").addEventListener("click", () => vscode.postMessage({ type: "openMonitor" }));
  $("killchain-btn").addEventListener("click", () => vscode.postMessage({ type: "openKillchain" }));
  const mentionBtn = $("mention-btn");
  const hashBtn = $("hash-btn");
  wirePop(slashPop, slashBtn, {
    render() {},
    focus() {
      slashPop.querySelector("button:not(:disabled)")?.focus();
    },
  });
  $("cmd-clear").addEventListener("click", () => {
    slashPop.hidePopover();
    resetConversation();
  });
  const mentionPop = $("mention-pop");
  const mentionList = $("mention-list");
  const mentionEmpty = $("mention-empty");
  let containers = [];
  let terminals = [];
  let mentionActive = 0;
  let mentionShown = [];
  let mentionSigil = "@";
  function mentionOpen() {
    return mentionPop.matches(":popover-open");
  }
  function closeMention() {
    if (mentionOpen()) mentionPop.hidePopover();
  }
  mentionPop.addEventListener("toggle", (e) => {
    const open = e.newState === "open";
    mentionBtn.setAttribute("aria-expanded", String(open && mentionSigil === "@"));
    hashBtn.setAttribute("aria-expanded", String(open && mentionSigil === "#"));
  });
  function paintMention() {
    const buttons = [...mentionList.querySelectorAll("button")];
    buttons.forEach((btn, i) => {
      const on = i === mentionActive;
      btn.setAttribute("aria-selected", String(on));
      if (on) btn.scrollIntoView({ block: "nearest" });
    });
  }
  function renderMentions() {
    const cursor = input.selectionStart ?? input.value.length;
    const hash = UI.hashSpan(input.value, cursor);
    const at = UI.mentionSpan(input.value, cursor);
    const span = hash ?? at;
    mentionSigil = hash ? "#" : "@";
    mentionShown = !span
      ? []
      : hash
        ? UI.filterTerminals(terminals, span.query).map((item) => ({
            name: item.token,
            // Jeton exact (#htb1, #htb1-2) : deux shells du même conteneur restent distincts.
            label: `#${item.token}`,
            desc: item.hint ? `$ ${item.hint}` : t("terminal ouvert"),
          }))
        : UI.filterContainers(containers, span.query).map((item) => ({
            name: item.name,
            desc: item.state === "running" ? t("en cours") : t("arrêté"),
          }));
    if (mentionActive >= mentionShown.length) mentionActive = 0;
    mentionEmpty.hidden = mentionShown.length > 0;
    mentionEmpty.textContent = hash
      ? t("Aucun terminal RedWidow ouvert. Alt+J T pour en ouvrir un.")
      : t("Aucun conteneur");
    mentionPop.setAttribute("aria-label", hash ? t("Terminaux") : t("Conteneurs"));
    mentionList.replaceChildren(
      ...mentionShown.map((item, i) => {
        const btn = el("button", "cmd-opt");
        btn.type = "button";
        btn.setAttribute("role", "option");
        btn.append(el("span", "cmd", item.label || item.name), el("span", "cmd-desc", item.desc));
        btn.addEventListener("click", () => pickMention(item.name));
        if (i === mentionActive) btn.setAttribute("aria-selected", "true");
        return btn;
      }),
    );
  }
  let lastTerminalsAsk = 0;
  function openMention() {
    const cursor = input.selectionStart ?? input.value.length;
    if (UI.hashSpan(input.value, cursor) && Date.now() - lastTerminalsAsk > 1e3) {
      lastTerminalsAsk = Date.now();
      vscode.postMessage({ type: "refreshTerminals" });
    }
    renderMentions();
    if (!mentionOpen()) mentionPop.showPopover();
    place(mentionPop, input);
  }
  function pickMention(name) {
    const cursor = input.selectionStart ?? input.value.length;
    const span = UI.hashSpan(input.value, cursor) ?? UI.mentionSpan(input.value, cursor);
    if (!span) return;
    const next = `${input.value.slice(0, span.start)}${mentionSigil}${name} ${input.value.slice(cursor)}`;
    input.value = next;
    const pos = span.start + 1 + name.length + 1;
    input.setSelectionRange(pos, pos);
    closeMention();
    grow();
    input.focus();
  }
  function sigilClick(sigil, spanOf) {
    closeComposer();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (!spanOf(input.value, start)) input.setRangeText(sigil, start, end, "end");
    grow();
    input.focus();
    openMention();
  }
  mentionBtn.addEventListener("click", () => sigilClick("@", UI.mentionSpan));
  hashBtn.addEventListener("click", () => sigilClick("#", UI.hashSpan));
  modelFilter.addEventListener("input", () => {
    query = modelFilter.value;
    renderModelList(false);
    place(modelPop, modelChip);
  });
  modelFilter.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      active = UI.listboxKey(
        { active },
        e.key,
        visible.map(() => ({ disabled: false })),
      ).active;
      paintActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = visible[active];
      if (entry) pick(entry);
    }
  });
  const commitFree = () => {
    const v = modelInput.value.trim();
    if (ctl && v !== (ctl.model ?? ""))
      vscode.postMessage({ type: "setModel", model: v === "" ? null : v });
  };
  modelInput.addEventListener("change", commitFree);
  modelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFree();
      modelPop.hidePopover();
    }
  });
  $("models-refresh").addEventListener("click", () =>
    vscode.postMessage({ type: "refreshModels" }),
  );
  $("models-connect").addEventListener("click", () => {
    if (!ctl?.locked) vscode.postMessage({ type: "addProvider" });
  });
  function postReasoningChoice(value) {
    if (!ctl || ctl.locked || ctl.effortDisabled) return;
    vscode.postMessage(
      ctl.provider === "claude"
        ? { type: "setEffort", effort: value }
        : { type: "setVariant", variant: value },
    );
  }
  $("effort-auto").addEventListener("click", () => postReasoningChoice(null));
  $("effort-model").addEventListener("click", () => {
    if (!ctl || ctl.locked) return;
    cfgPop.hidePopover();
    modelPop.showPopover();
  });
  // Curseur d'effort : suit le pointeur en continu, puis se cale sur le niveau
  // le plus proche au relâchement. Le clavier passe d'un niveau à l'autre.
  const effortScale = $("effort-scale");
  let shownLevel = -1;
  const lastLevel = () => Math.max(levels.length - 1, 1);
  function paintNotches(position) {
    const box = effortScale.querySelector(".effort-notches");
    if (box.childElementCount !== levels.length) {
      box.replaceChildren(
        ...levels.map((_, i) => {
          const notch = el("span", "effort-notch");
          notch.style.setProperty("--jn-at", String(i / lastLevel()));
          return notch;
        }),
      );
    }
    effortScale.classList.toggle("is-max", levels.length > 1 && position >= lastLevel() - 0.02);
    [...box.children].forEach((notch, i) => {
      notch.classList.toggle("is-on", i <= position + 0.001);
    });
  }
  function showLevel(index) {
    const level = levels[index];
    if (!level) return;
    $("effort-label").textContent = level.label;
    effortInput.setAttribute("aria-valuetext", level.label);
    if (index !== shownLevel) {
      const label = $("effort-label");
      label.classList.remove("bump");
      void label.offsetWidth;
      label.classList.add("bump");
      shownLevel = index;
    }
  }
  const effortLocked = () => !ctl || ctl.locked || ctl.effortDisabled || levels.length === 0;
  function settleEffort(index, post) {
    const target = Math.min(Math.max(Math.round(index), 0), levels.length - 1);
    effortScale.classList.remove("is-dragging");
    effortInput.value = String(target);
    effortScale.style.setProperty("--jn-progress", String(target / lastLevel()));
    paintNotches(target);
    showLevel(target);
    if (post) postReasoningChoice(levels[target].value);
  }
  effortInput.addEventListener("pointerdown", () => {
    if (!effortLocked()) effortScale.classList.add("is-dragging", "is-pressed");
  });
  const release = () => effortScale.classList.remove("is-pressed");
  effortInput.addEventListener("pointerup", release);
  effortInput.addEventListener("pointercancel", release);
  effortInput.addEventListener("input", () => {
    if (effortLocked()) return;
    const raw = Number(effortInput.value);
    effortScale.classList.add("is-dragging");
    effortScale.style.setProperty("--jn-progress", String(raw / lastLevel()));
    paintNotches(raw);
    showLevel(Math.round(raw));
  });
  effortInput.addEventListener("change", () => {
    if (!effortLocked()) settleEffort(Number(effortInput.value), true);
  });
  effortInput.addEventListener("keydown", (event) => {
    if (effortLocked()) return;
    const current = Math.round(Number(effortInput.value));
    const next = {
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      PageDown: current - 1,
      PageUp: current + 1,
      Home: 0,
      End: levels.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = Math.min(Math.max(next, 0), levels.length - 1);
    if (target !== current || effortScale.classList.contains("auto")) settleEffort(target, true);
  });
  const historyPanel = $("history");
  const historyBtn = $("history-btn");
  let renaming = null;
  let historyRunning = false;
  let historyEntries = [];
  const projectFilter = el("select", "hist-project-filter");
  projectFilter.setAttribute("aria-label", t("Filtrer les conversations par projet"));
  historyList.before(projectFilter);
  projectFilter.addEventListener("change", () => renderHistory(historyEntries));
  function renderHistory(findings) {
    historyEntries = findings;
    const selected = projectFilter.value || "all";
    const projects = new Map(
      findings.map((h) => [h.projectKey || "none", h.projectLabel || t("Sans projet")]),
    );
    const option = (value, label) => {
      const node = el("option", "", label);
      node.value = value;
      return node;
    };
    projectFilter.replaceChildren(
      option("all", t("Tous les projets")),
      ...[...projects].map(([key, label]) => option(key, label)),
    );
    projectFilter.value = selected === "all" || projects.has(selected) ? selected : "all";
    const allEntries = findings;
    findings = findings.filter(
      (h) => projectFilter.value === "all" || (h.projectKey || "none") === projectFilter.value,
    );
    $("history-clear").title = t("Supprimer l’historique commun des chats, tous projets compris");
    $("history-clear").disabled = allEntries.length === 0;
    if (findings.length === 0) {
      historyList.replaceChildren(el("li", "hist-empty", t("Aucune conversation enregistrée.")));
      return;
    }
    historyList.replaceChildren(
      ...findings.map((h) => {
        const li = el("li", h.current ? "hist current" : "hist");
        const when = new Date(h.updatedAt).toLocaleString(
          globalThis.WarbandI18n?.getLocale() === "en" ? "en-GB" : "fr-FR",
        );
        const meta = `${h.projectLabel || t("Sans projet")} · ${when} · ${h.tools > 1 ? t`${h.tools} outils` : t`${h.tools} outil`} · ${h.provider} · ${h.model}`;
        if (renaming === h.id) {
          const field = el("input", "hist-rename");
          field.type = "text";
          field.value = h.title;
          field.maxLength = 120;
          field.setAttribute("aria-label", t("Nouveau titre"));
          const commit = () => {
            vscode.postMessage({ type: "historyRename", id: h.id, title: field.value });
            renaming = null;
          };
          field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.preventDefault();
              renaming = null;
              renderHistory(historyEntries);
            }
          });
          li.append(field, el("div", "hist-meta", meta));
          setTimeout(() => field.focus(), 0);
          return li;
        }
        const open = el("button", "hist-open", h.title);
        open.type = "button";
        open.title = t("Ouvrir en lecture seule");
        open.addEventListener("click", () => {
          vscode.postMessage({ type: "historyOpen", id: h.id });
          setHistoryOpen(false);
        });
        const actions = el("div", "hist-actions");
        const rename = el("button", "link", t("Renommer"));
        rename.type = "button";
        rename.addEventListener("click", () => {
          renaming = h.id;
          renderHistory(historyEntries);
        });
        const del = el("button", "link", t("Supprimer"));
        del.type = "button";
        del.addEventListener("click", () =>
          vscode.postMessage({ type: "historyDelete", id: h.id }),
        );
        actions.append(rename, del);
        const line = el("div", "hist-line");
        line.append(open);
        const badge = UI.historyBadge(h, historyRunning);
        if (badge) line.append(el("span", "badge", badge));
        li.append(line, el("div", "hist-meta", meta), actions);
        return li;
      }),
    );
  }
  function renderReadonly(info) {
    const bar = $("readonly");
    bar.hidden = !info;
    if (!info) return;
    let text = t`Lecture seule : ${info.title}`;
    if (info.invalid > 0) text += t` · ${info.invalid} ligne(s) du journal ignorée(s)`;
    if (info.truncated) text += t(" · journal tronqué");
    $("readonly-text").textContent = text;
    $("readonly-resume").textContent = info.canResume
      ? t("Reprendre")
      : t("Reprendre (nouvelle session)");
  }
  function setHistoryOpen(open) {
    historyPanel.hidden = !open;
    historyBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      vscode.postMessage({ type: "historyRefresh" });
      $("history-close").focus();
    } else if (historyPanel.contains(document.activeElement)) historyBtn.focus();
  }
  historyBtn.addEventListener("click", () => setHistoryOpen(historyPanel.hidden));
  $("history-close").addEventListener("click", () => setHistoryOpen(false));
  historyPanel.addEventListener("click", (e) => {
    if (e.target === historyPanel && e.clientX > historyPanel.getBoundingClientRect().right) {
      setHistoryOpen(false);
    }
  });
  historyPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) setHistoryOpen(false);
  });
  $("history-clear").addEventListener("click", () => vscode.postMessage({ type: "historyClear" }));
  $("readonly-resume").addEventListener("click", () =>
    vscode.postMessage({ type: "historyResume" }),
  );
  $("readonly-close").addEventListener("click", () => resetConversation());
  $("provider-connect").addEventListener("click", () => {
    if (!ctl?.locked) vscode.postMessage({ type: "addProvider" });
  });
  $("provider").addEventListener("change", (event) => {
    if (!ctl?.locked) vscode.postMessage({ type: "selectProvider", id: event.target.value });
  });
  $("no-provider-add").addEventListener("click", () => vscode.postMessage({ type: "addProvider" }));
  const monitorRowsEl = $("monitor-rows");
  const monitorEmpty = $("monitor-empty");
  const monitor = $("monitor");
  const monitorFollowBtn = $("monitor-follow");
  let monitorFollow = true;
  function followMonitorBottom() {
    for (const box of monitorRowsEl.querySelectorAll(".mon-out")) box.scrollTop = box.scrollHeight;
    monitor.scrollTop = monitor.scrollHeight;
  }
  monitorFollowBtn.addEventListener("click", () => {
    monitorFollow = !monitorFollow;
    monitorFollowBtn.setAttribute("aria-pressed", String(monitorFollow));
    monitorFollowBtn.title = monitorFollow
      ? t("Désactiver le suivi du bas pour défiler librement")
      : t("Activer le suivi et revenir en bas");
    if (monitorFollow) followMonitorBottom();
  });
  let watchId = "";
  function monitorLine(row) {
    const li = el("li", `mon-row tone-${row.tone}`);
    li.dataset.monitorId = row.id;
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
    li.append(cmd, meta);
    if (row.output !== "") {
      // Sortie numérotée : une ligne par élément, toujours insérée comme texte.
      const out = el("pre", "mon-out");
      const lines = row.output.replace(/\n$/, "").split("\n");
      if (row.numbered) out.append(...lines.map((line) => el("span", "mon-line", line)));
      else {
        out.textContent = row.output;
        out.classList.add("is-plain");
      }
      li.append(out);
    }
    if (row.truncated) li.append(el("p", "note", t("sortie tronquée")));
    if (mode === "monitor" && row.toolUseId) {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.title = t("Suivre la sortie");
      const toolUseId = row.toolUseId;
      const open = () => vscode.postMessage({ type: "watch", toolUseId });
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open();
      });
    }
    return li;
  }
  const monitorNodes = /* @__PURE__ */ new Map();
  // Frise : un trait par commande, coloré par son état ; un clic amène à l'entrée.
  let selectedMonitorRow = null;
  const stripTicks = /* @__PURE__ */ new Map();
  function paintStrip(rows) {
    const strip = $("monitor-strip");
    strip.hidden = rows.length === 0 || mode === "watch";
    const ids = new Set(rows.map((row) => row.id));
    for (const id of stripTicks.keys()) if (!ids.has(id)) stripTicks.delete(id);
    const ticks = rows.map((row, i) => {
      let tick = stripTicks.get(row.id);
      if (!tick) {
        tick = el("button", "mon-tick");
        tick.type = "button";
        tick.addEventListener("click", () => {
          const line = [...monitorRowsEl.children].find(
            (n) => n.dataset.monitorId === tick.dataset.rowId,
          );
          if (!line) return;
          selectedMonitorRow = tick.dataset.rowId;
          for (const [id, button] of stripTicks) {
            button.classList.toggle("is-selected", String(id) === selectedMonitorRow);
            button.setAttribute("aria-pressed", String(String(id) === selectedMonitorRow));
          }
          monitorFollow = false;
          monitorFollowBtn.setAttribute("aria-pressed", "false");
          const head = monitor.querySelector(".mon-head").getBoundingClientRect();
          const offset = line.getBoundingClientRect().top - head.bottom - 8;
          monitor.scrollTo({
            top: monitor.scrollTop + offset,
            behavior: motion.matches ? "auto" : "smooth",
          });
          line.classList.remove("is-flash");
          void line.offsetWidth;
          line.classList.add("is-flash");
        });
        stripTicks.set(row.id, tick);
      }
      tick.dataset.rowId = row.id;
      tick.className = `mon-tick tone-${row.tone}${String(row.id) === selectedMonitorRow ? " is-selected" : ""}`;
      tick.setAttribute("aria-pressed", String(String(row.id) === selectedMonitorRow));
      tick.setAttribute("aria-label", t`Commande ${i + 1} : ${row.command}, ${row.status}`);
      tick.title = `${row.command} · ${row.status}`;
      return tick;
    });
    const same =
      ticks.length === strip.children.length &&
      ticks.every((tick, i) => strip.children[i] === tick);
    if (!same) strip.replaceChildren(...ticks);
  }

  function renderMonitor(view) {
    const top = monitor.scrollTop;
    const positions = new Map(
      [...monitorRowsEl.children].map((line) => {
        const box = line.querySelector(".mon-out");
        return [line.dataset.monitorId, { top: box?.scrollTop ?? 0, left: box?.scrollLeft ?? 0 }];
      }),
    );
    let rows = UI.monitorRows(view);
    if (mode === "watch") {
      rows = rows.filter((row) => row.toolUseId === watchId);
      if (!rows.length && monitorNodes.size) return;
    }
    let numberBudget = 2000;
    rows = rows.map((row) => {
      const count = row.output.split("\n").length;
      const numbered = count <= Math.min(80, numberBudget);
      if (numbered) numberBudget -= count;
      return { ...row, numbered };
    });
    const ids = new Set(rows.map((row) => row.id));
    for (const id of monitorNodes.keys()) if (!ids.has(id)) monitorNodes.delete(id);
    monitorRowsEl.replaceChildren(
      ...rows.map((row) => {
        let cached = monitorNodes.get(row.id);
        if (!sameDisplay(cached?.row, row)) {
          cached = { row, node: monitorLine(row) };
          monitorNodes.set(row.id, cached);
        } else cached.row = row;
        return cached.node;
      }),
    );
    monitorEmpty.hidden = rows.length > 0;
    const waiting = rows.filter((r) => r.tone === "wait").length;
    const failed = rows.filter((r) => r.tone === "err").length;
    $("monitor-count").textContent =
      rows.length === 0
        ? ""
        : [
            rows.length > 1 ? t`${rows.length} commandes` : t`${rows.length} commande`,
            waiting ? t`${waiting} en attente` : "",
            failed ? t`${failed} en erreur` : "",
          ]
            .filter(Boolean)
            .join(" · ");
    document.body.classList.toggle("monitor-live", waiting > 0);
    paintStrip(rows);
    for (const line of monitorRowsEl.children) {
      const box = line.querySelector(".mon-out");
      const previous = positions.get(line.dataset.monitorId);
      if (box && previous) {
        box.scrollTop = previous.top;
        box.scrollLeft = previous.left;
      }
    }
    if (monitorFollow) followMonitorBottom();
    else monitor.scrollTop = top;
  }
  let mode = "conversation";
  const MANAGED = ["running", "waiting", "paused", "readonly", "reduce-motion"];
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let lastView = null;
  function applyBody() {
    if (!lastView) return;
    const want = UI.bodyClasses(lastView, {
      hidden: document.hidden,
      reducedMotion: motion.matches,
    });
    for (const c of MANAGED) document.body.classList.toggle(c, want.includes(c));
    paintClock();
  }
  // Horloge : temps écoulé depuis le début du tour actif (T+mm:ss).
  let missionStart = null;
  let missionTimer = 0;
  const pad2 = (n) => String(n).padStart(2, "0");
  function tickClock() {
    let text = "";
    if (missionStart !== null) {
      const total = Math.floor((Date.now() - missionStart) / 1e3);
      const h = Math.floor(total / 3600);
      text = `T+${h ? `${h}:` : ""}${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
    }
    $("mission-clock").textContent = text;
    $("thinking-clock").textContent = text;
  }
  function paintClock() {
    missionStart =
      lastView?.busy && Number.isFinite(lastView.turnStartedAt) ? lastView.turnStartedAt : null;
    if (missionStart === null || document.hidden) {
      clearInterval(missionTimer);
      missionTimer = 0;
    } else if (!missionTimer) missionTimer = setInterval(tickClock, 1000);
    tickClock();
  }
  window.addEventListener("pagehide", () => {
    clearInterval(missionTimer);
    clearTimeout(bypassTimer);
    approvalNodes.clear();
  });
  document.addEventListener("visibilitychange", applyBody);
  document.addEventListener("visibilitychange", renderBypass);
  motion.addEventListener("change", applyBody);
  let recall = { index: -1, draft: "" };
  let sent = [];
  let shownNodes = -1;
  const timeline = $("timeline");
  for (const direction of ["older", "newer", "latest"]) {
    $(`timeline-${direction}`).addEventListener("click", () => {
      if (direction === "latest") {
        monitorFollow = true;
        monitorFollowBtn.setAttribute("aria-pressed", "true");
        monitorFollowBtn.title = t("Désactiver le suivi du bas pour défiler librement");
      } else {
        monitorFollow = false;
        monitorFollowBtn.setAttribute("aria-pressed", "false");
        monitorFollowBtn.title = t("Activer le suivi du bas");
      }
      vscode.postMessage({ type: "timelinePage", direction });
    });
  }
  function renderPaging(paging) {
    timeline.hidden =
      mode === "watch" ||
      mode === "report" ||
      !paging ||
      (!paging.earlier && !paging.archived && !paging.error);
    $("timeline-older").disabled = !paging?.earlier || paging.loading;
    $("timeline-newer").hidden = !paging?.archived;
    $("timeline-newer").disabled = !!paging?.loading;
    $("timeline-latest").hidden = !paging?.archived;
    $("timeline-status").textContent = paging?.loading
      ? t("Chargement…")
      : (paging?.error ?? (paging?.archived ? t("Messages précédents") : ""));
  }
  let pageBefore = null;
  function render(view) {
    renderCapabilities(view.capabilities, view);
    paintMission(UI.conversationActivity(view));
    const nextBefore = view.paging?.before ?? null;
    const pageChanged = nextBefore !== pageBefore;
    pageBefore = nextBefore;
    if (pageChanged) {
      log.scrollTop = 0;
      monitor.scrollTop = 0;
    }
    renderPaging(view.paging);
    if (mode === "monitor" || mode === "watch") {
      renderMonitor(view);
      log.replaceChildren();
      itemNodes.clear();
      approvals.replaceChildren();
      lastView = view;
      applyBody();
      return;
    }
    const users = (view.items ?? []).filter((it) => it.kind === "user").map((it) => it.text);
    const nextSent = UI.syncRecallEntries(sent, users);
    if (nextSent.length < sent.length || nextSent[0] !== sent[0]) {
      recall = { index: -1, draft: "" };
    }
    sent = nextSent;
    renderControls(view.controls);
    historyRunning = view.busy && !view.readonly;
    renderHistory(view.history);
    renderReadonly(view.readonly);
    const atBottom = pageChanged
      ? nextBefore === null
      : log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const top = log.scrollTop;
    const nodes = view.items.length === 0 ? [welcome(view.sandbox)] : renderItems(view.items);
    const added = nodes.length - shownNodes;
    if (shownNodes >= 0 && added > 0 && added <= 3) {
      for (const n of nodes.slice(shownNodes)) n.classList.add("enter");
    }
    shownNodes = view.items.length === 0 ? 0 : nodes.length;
    log.replaceChildren(...nodes);
    const visible2 = mode === "monitor" || !Array.isArray(view.approvals) ? [] : view.approvals;
    let replacedCardFocus = null;
    const cards = visible2.map((card) => {
      let cached = approvalNodes.get(card.toolUseId);
      if (!sameDisplay(cached?.card, card)) {
        const previous = cached;
        const focused = document.activeElement;
        cached = { card, node: renderCard(card, !seenCards.has(card.toolUseId), cached) };
        if (previous?.node.contains(focused)) {
          const controls = [...previous.node.querySelectorAll("button, summary")];
          const index = controls.indexOf(focused);
          replacedCardFocus =
            index >= 0
              ? (cached.node.querySelectorAll("button, summary")[index] ?? cached.node)
              : cached.node;
        }
        approvalNodes.set(card.toolUseId, cached);
      }
      return cached.node;
    });
    const currentApprovals = new Set(visible2.map((card) => card.toolUseId));
    for (const id of approvalNodes.keys()) if (!currentApprovals.has(id)) approvalNodes.delete(id);
    if (
      cards.length !== approvals.children.length ||
      cards.some((card, index) => approvals.children[index] !== card)
    )
      approvals.replaceChildren(...cards);
    for (const binding of productBindings)
      if (!binding.node.isConnected) productBindings.delete(binding);
    const fresh = visible2.findIndex((c) => !seenCards.has(c.toolUseId));
    seenCards.clear();
    for (const c of visible2) seenCards.add(c.toolUseId);
    if (fresh >= 0) cards[fresh]?.focus();
    else replacedCardFocus?.focus({ preventScroll: true });
    const sb = $("sandbox");
    if (view.sandbox) {
      sb.textContent =
        view.sandboxNetwork === "bridge"
          ? t`Bac à sable : ${view.sandbox} · réseau activé`
          : t`Bac à sable : ${view.sandbox}`;
    } else sb.textContent = "";
    sb.hidden = !view.sandbox;
    document.body.classList.toggle("awaiting", approvals.childElementCount > 0);
    const noProvider = !!view.noProvider;
    $("no-provider").hidden = !noProvider;
    ctlGroup.hidden = !view.controls || noProvider;
    document.body.classList.toggle("no-provider", noProvider);
    send.disabled = view.busy || !!view.readonly || noProvider;
    input.disabled = !!view.readonly || noProvider;
    mentionBtn.disabled = input.disabled;
    hashBtn.disabled = input.disabled;
    stop.disabled = !view.busy;
    lastView = view;
    paintAttachments();
    applyBody();
    if (view.busy) $("thinking-label").textContent = UI.activityLabel(view);
    if (view.items.length === 0) toolStatus.clear();
    log.setAttribute("aria-busy", view.busy ? "true" : "false");
    log.scrollTop = atBottom ? log.scrollHeight : top;
  }
  // Une bascule ne réinitialise aucune conversation ni décision locale de la gate.
  function switchLocale(locale) {
    const i18n = globalThis.WarbandI18n;
    if (!i18n || (locale !== "fr" && locale !== "en")) return;
    const pathOf = (node) => {
      const path = [];
      while (node && node !== document.body) {
        const parent = node.parentElement;
        if (!parent) return null;
        path.unshift([...parent.children].indexOf(node));
        node = parent;
      }
      return path;
    };
    const atPath = (path) => path?.reduce((node, index) => node?.children[index], document.body);
    const focused = document.activeElement;
    const focusPath = pathOf(focused);
    const snapshots = [...document.querySelectorAll("[id], input, textarea, pre, .mon-out")].map(
      (node) => ({
        node,
        path: pathOf(node),
        top: node.scrollTop,
        left: node.scrollLeft,
        value: node.matches("input:not([type=file]), textarea") ? node.value : undefined,
        start: node.matches("input:not([type=file]), textarea") ? node.selectionStart : null,
        end: node.matches("input:not([type=file]), textarea") ? node.selectionEnd : null,
      }),
    );
    i18n.setLocale(locale);
    i18n.applyStatic(document);
    for (const binding of productBindings) {
      if (binding.node.isConnected) binding.paint();
      else productBindings.delete(binding);
    }
    // Les cartes conservent leurs nœuds et leurs verrous ; les messages et sorties sont reparcourus.
    itemNodes.clear();
    monitorNodes.clear();
    if (lastView) render(lastView);
    paintAttachments();
    if (mentionOpen()) renderMentions();
    providerHelp.title =
      providerHelp.getAttribute("aria-expanded") === "true"
        ? t("Réduire le texte")
        : t("Afficher tout le texte");
    projectFilter.setAttribute("aria-label", t("Filtrer les conversations par projet"));
    monitorFollowBtn.title = monitorFollow
      ? t("Désactiver le suivi du bas pour défiler librement")
      : t("Activer le suivi du bas");
    for (const snapshot of snapshots) {
      const node = snapshot.node.isConnected ? snapshot.node : atPath(snapshot.path);
      if (!node) continue;
      if (snapshot.value !== undefined && "value" in node) {
        node.value = snapshot.value;
        if (snapshot.start !== null && typeof node.setSelectionRange === "function")
          node.setSelectionRange(snapshot.start, snapshot.end);
      }
      node.scrollTop = snapshot.top;
      node.scrollLeft = snapshot.left;
    }
    const target = focused?.isConnected ? focused : atPath(focusPath);
    target?.focus({ preventScroll: true });
  }
  let chatId;
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "locale") {
      switchLocale(message.locale);
    } else if (message && message.type === "view") {
      if (
        (message.chatId !== void 0 && message.chatId !== chatId) ||
        message.view.conversation !== lastView?.conversation
      ) {
        const initialSend =
          pendingFiles &&
          lastView?.conversation?.startsWith("new:") &&
          message.chatId === chatId &&
          message.view.busy &&
          message.view.items.some(
            (item) =>
              item.kind === "user" &&
              (item.text === pendingFiles.display ||
                (pendingFiles.display.length > 100_000 &&
                  item.text === `${pendingFiles.display.slice(0, 100_000)}…`)),
          );
        if (!initialSend) resetAttachments();
        chatId = message.chatId;
        sent = [];
        recall = { index: -1, draft: "" };
        shownNodes = -1;
        pageBefore = null;
        approvalNodes.clear();
        stripTicks.clear();
        selectedMonitorRow = null;
        itemNodes.clear();
        monitorNodes.clear();
        openTools.clear();
        toolStatus.clear();
        log.replaceChildren();
        monitorRowsEl.replaceChildren();
      }
      render(message.view);
    } else if (message && message.type === "attachmentResult") {
      if (!pendingFiles || message.requestId !== pendingFiles.requestId) return;
      const pending = pendingFiles;
      pendingFiles = null;
      if (message.accepted === true) {
        draftFiles = draftFiles.filter((file) => !pending.ids.includes(file.id));
        if (input.value === pending.text) {
          input.value = "";
          grow();
        }
        attachmentStatus("");
      } else
        attachmentStatus(t("Envoi refusé ou interrompu. Les fichiers restent dans le brouillon."));
      paintAttachments();
    } else if (message && message.type === "role" && message.role === "monitor") {
      mode = "monitor";
      document.body.classList.add("mode-monitor");
      document.body.classList.remove("mode-watch");
      if (lastView) render(lastView);
    } else if (
      message &&
      message.type === "role" &&
      message.role === "watch" &&
      typeof message.toolUseId === "string"
    ) {
      mode = "watch";
      watchId = message.toolUseId;
      document.body.classList.add("mode-watch");
      document.body.classList.remove("mode-monitor");
      if (lastView) render(lastView);
    } else if (message && message.type === "role" && message.role === "report") {
      mode = "report";
      document.body.classList.add("mode-report");
      if (lastView) render(lastView);
    } else if (message && message.type === "title" && typeof message.text === "string") {
      const contextTitle = $("context-title");
      contextTitle.textContent = message.text.slice(0, 120);
      contextTitle.title = contextTitle.textContent;
      contextTitle.hidden = contextTitle.textContent.length === 0;
    } else if (message && message.type === "containers") {
      containers = UI.safeContainers(message.items);
      paintAttachments();
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "terminals") {
      terminals = UI.safeTerminals(message.items);
      paintAttachments();
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "bypass") {
      bypassCtx = { push: message, previous: bypassCtx.push, userOff: bypassUserOff };
      bypassUserOff = false;
      renderBypass();
    }
  });
  function grow() {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }
  function caretLine() {
    const value = input.value;
    const pos = input.selectionStart ?? 0;
    return {
      line: value.slice(0, pos).split("\n").length - 1,
      lines: value.split("\n").length,
    };
  }
  const fileInput = $("attachment-input");
  const attachBtn = $("attach-btn");
  let draftFiles = [];
  let pendingFiles = null;
  let fileEpoch = 0;
  let readingFiles = false;
  let fileSerial = 0;
  function attachmentStatus(text) {
    $("attachment-status").textContent = text;
    $("attachment-status").hidden = !text;
  }
  function resetAttachments() {
    fileEpoch++;
    readingFiles = false;
    draftFiles = [];
    pendingFiles = null;
    fileInput.value = "";
    attachmentStatus("");
    paintAttachments();
  }
  function paintAttachments() {
    const blocked =
      !lastView ||
      lastView.busy ||
      lastView.readonly ||
      lastView.noProvider ||
      !!pendingFiles ||
      readingFiles;
    attachBtn.disabled = !!blocked;
    fileInput.disabled = !!blocked;
    const list = $("attachment-list");
    list.replaceChildren(
      ...draftFiles.map((file) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = t`${file.name} · ${Math.ceil(file.bytes / 1024)} Kio`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost";
        remove.textContent = "×";
        remove.setAttribute("aria-label", t`Retirer ${file.name}`);
        remove.disabled = !!pendingFiles || readingFiles;
        remove.addEventListener("click", () => {
          draftFiles = draftFiles.filter((f) => f.id !== file.id);
          paintAttachments();
        });
        li.append(label, remove);
        return li;
      }),
    );
    list.hidden = draftFiles.length === 0;
    send.disabled =
      !lastView ||
      lastView.busy ||
      !!lastView.readonly ||
      !!lastView.noProvider ||
      !!pendingFiles ||
      readingFiles;
  }
  async function addFiles(files) {
    if (!lastView || attachBtn.disabled) return;
    const epoch = fileEpoch;
    readingFiles = true;
    paintAttachments();
    const added = [];
    try {
      if (draftFiles.length + files.length > Number(fileInput.dataset.count))
        throw Error(t("Maximum 10 fichiers joints."));
      let total = draftFiles.reduce((sum, f) => sum + f.bytes, 0);
      for (const file of files) {
        total += file.size;
        if (file.size > Number(fileInput.dataset.bytes) || total > Number(fileInput.dataset.total))
          throw Error(t("Limite : 64 Kio par fichier et 256 Kio au total."));
        if (!file.name.trim() || file.name.length > 180 || /[\\/\p{Cc}\p{Cf}]/u.test(file.name))
          throw Error(t("Nom de fichier invalide."));
        if (
          /\.(?:pdf|png|jpe?g|gif|webp|zip|gz|7z|exe|dll|so|bin|docx|xlsx|pptx)$/i.test(file.name)
        )
          throw Error(
            t(
              "Seuls les textes, logs et fichiers de code UTF-8 sont pris en charge. Images et PDF exclus.",
            ),
          );
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        } catch {
          throw Error(t("Impossible de lire ce fichier : un texte UTF-8 valide est requis."));
        }
        if (text.includes("\0") || text.startsWith("%PDF-"))
          throw Error(t("Ce fichier n’est pas un texte UTF-8 pris en charge."));
        added.push({ id: ++fileSerial, name: file.name, text, bytes: file.size });
      }
      if (epoch !== fileEpoch) return;
      draftFiles.push(...added);
      attachmentStatus(
        t(
          "Ces fichiers seront transmis au fournisseur et conservés dans le journal de conversation. N’ajoutez pas de secrets.",
        ),
      );
    } catch (error) {
      if (epoch === fileEpoch)
        attachmentStatus(error.message || t("Impossible de lire ces fichiers en UTF-8."));
    } finally {
      if (epoch === fileEpoch) {
        readingFiles = false;
        fileInput.value = "";
        paintAttachments();
      }
    }
  }
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => addFiles(Array.from(fileInput.files || [])));
  $("composer").addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  $("composer").addEventListener("drop", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  });
  function submit() {
    const text = input.value;
    if ((!text.trim() && !draftFiles.length) || send.disabled) return;
    if (text.length > 100_000) {
      attachmentStatus(t("La consigne dépasse la limite de 100 000 caractères."));
      return;
    }
    if (draftFiles.length) {
      const requestId = `files-${Date.now()}-${++fileSerial}`;
      pendingFiles = {
        requestId,
        ids: draftFiles.map((file) => file.id),
        text,
        display: `${text.trim() ? text : "Analyse les fichiers joints."}\n\nPièces jointes :\n${draftFiles.map((file) => `• ${file.name}`).join("\n")}`,
      };
      paintAttachments();
      vscode.postMessage({
        type: "send",
        text,
        attachments: draftFiles.map(({ name, text }) => ({ name, text })),
        requestId,
        conversation: lastView.conversation,
      });
      return;
    }
    sent = sent.concat(text);
    recall = { index: -1, draft: "" };
    input.value = "";
    grow();
    vscode.postMessage({ type: "send", text });
  }
  input.addEventListener("input", () => {
    grow();
    const cursor = input.selectionStart ?? input.value.length;
    if (UI.hashSpan(input.value, cursor) || UI.mentionSpan(input.value, cursor)) openMention();
    else closeMention();
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (e) => {
    if (mentionOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        mentionActive = UI.listboxKey(
          { active: mentionActive },
          e.key,
          mentionShown.map(() => ({ disabled: false })),
        ).active;
        if (mentionActive < 0) mentionActive = 0;
        paintMention();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = mentionShown[mentionActive];
        if (item) pickMention(item.name);
        return;
      }
    }
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const next = UI.inputRecall(
        { index: recall.index, draft: recall.draft, findings: sent, current: input.value },
        e.key === "ArrowUp" ? "up" : "down",
        caretLine(),
      );
      if (next) {
        e.preventDefault();
        recall = { index: next.index, draft: next.draft };
        input.value = next.value;
        const pos = e.key === "ArrowUp" ? 0 : input.value.length;
        input.setSelectionRange(pos, pos);
        grow();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  $("reset").addEventListener("click", () => resetConversation());
  vscode.postMessage({ type: "ready" });
})();
