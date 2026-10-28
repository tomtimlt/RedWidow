(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const approvals = $("approvals");
  const historyList = $("history-list");
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  const UI = globalThis.WarbandUI;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  const EXAMPLES = ["Prépare une maquette pour le projet", "Améliore la navigation de cet espace", "Propose une palette plus lisible"];
  const STATUS = { pending: "en cours", ok: "réussi", error: "erreur", denied: "refusé" };
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
      button.textContent = "Copié";
    } catch {
      button.textContent = "Échec";
    }
    setTimeout(() => {
      button.textContent = "Copier";
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
      const btn = el("button", "copy", "Copier");
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
  function renderTool(item, reference) {
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
      el("span", "tool-name", item.label)
    );
    if (item.summary) sum.append(el("span", "tool-summary", item.summary));
    sum.append(icon, el("span", "tool-state", STATUS[item.status] ?? item.status));
    box.append(sum);
    let body;
    const paintBody = () => {
      if (!box.open) {
        body?.remove();
        body = void 0;
        return;
      }
      if (body) return;
      const current = reference.item;
      body = el("div", "tool-body");
      body.append(el("div", "label", "Entrée"), el("pre", "", current.input));
      if (current.output)
        body.append(
          el("div", "label", "Sortie"),
          el("pre", "", current.truncated ? `${current.output}
[…tronqué]` : current.output)
        );
      box.append(body);
    };
    box.addEventListener("toggle", paintBody);
    paintBody();
    return box;
  }
  function copyButton(text) {
    const btn = el("button", "msg-copy", "Copier");
    btn.type = "button";
    btn.title = "Copier le message";
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
  const SEVERITY = [
    ["critical", "Critique"],
    ["high", "Élevée"],
    ["medium", "Moyenne"],
    ["low", "Faible"],
    ["info", "Info"]
  ];
  function renderReport(item) {
    const findings = Array.isArray(item.findings) ? item.findings : [];
    const box = el("section", "report");
    box.setAttribute("aria-label", item.title || "Rapport");
    const head = el("div", "report-head");
    head.append(svg("file", "ico report-ico"), el("h3", "report-title", item.title || "Rapport"));
    head.append(el("span", "report-count", `${findings.length} constat${findings.length > 1 ? "s" : ""}`));
    const bar = el("div", "report-bar");
    bar.setAttribute("aria-hidden", "true");
    const summary = el("p", "report-summary");
    const parts = [];
    for (const [key, label] of SEVERITY) {
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
      const known = SEVERITY.find(([key]) => key === f.severity) ?? SEVERITY[4];
      const li = el("li", `report-item sev-${known[0]}`);
      li.append(el("span", "report-sev", known[1]));
      const body = el("div", "report-body");
      body.append(el("span", "report-label", f.label ?? ""));
      if (f.detail) body.append(el("span", "report-detail", f.detail));
      li.append(body);
      list.append(li);
    }
    box.append(head, bar, summary, list);
    return box;
  }
  // Progression de la mission : rail de phases sous l'en-tête.
  function paintMission(mission) {
    const nav = $("mission");
    const phases = Array.isArray(mission?.phases) ? mission.phases : [];
    nav.hidden = phases.length === 0;
    const STATE = { done: "terminée", current: "en cours", wait: "en attente d'accord", todo: "à venir" };
    $("mission-steps").replaceChildren(
      ...phases.map((phase, i) => {
        const li = el("li", `mission-step is-${phase.state}`);
        if (phase.state === "current" || phase.state === "wait") li.setAttribute("aria-current", "step");
        const mark = el("span", "mission-mark");
        mark.setAttribute("aria-hidden", "true");
        if (phase.state === "done") mark.append(svg("check", "ico"));
        else mark.textContent = String(i + 1);
        li.append(mark, el("span", "mission-label", phase.label), el("span", "sr-only", ` : ${STATE[phase.state] ?? phase.state}`));
        return li;
      })
    );
  }
  const itemNodes = /* @__PURE__ */ new Map();
  const sameDisplay = (a, b) => a && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((key) => key === "blocks" || key === "findings" || a[key] === b[key]);
  function renderItem(item) {
    const cached = itemNodes.get(item.id);
    if (sameDisplay(cached?.item, item)) {
      cached.item = item;
      return cached.node;
    }
    const reference = { item, node: null };
    let node;
    if (item.kind === "tool") node = renderTool(item, reference);
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
    reference.node = node;
    itemNodes.set(item.id, reference);
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
      items.filter((item) => item.kind === "tool").map((item) => item.toolUseId)
    );
    for (const id of toolStatus.keys()) if (!tools.has(id)) toolStatus.delete(id);
    for (const id of openTools) if (!tools.has(id)) openTools.delete(id);
    return nodes;
  }
  function welcome(sandbox) {
    const box = el("div", "welcome");
    const mark = document.querySelector("#title .brand")?.cloneNode(true);
    if (mark) {
      mark.setAttribute("class", "brand welcome-mark");
      mark.removeAttribute("width");
      mark.removeAttribute("height");
      box.append(mark);
    }
    box.append(
      el("h2", "", "On commence par où ?"),
      el("p", "hint", "Décris la cible. Chaque action sensible demande ton accord.")
    );
    const list = el("div", "examples");
    for (const text of EXAMPLES) {
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
      box.append(el("p", "hint", `Bac à sable actif : les commandes tournent dans ${sandbox}.`));
    }
    return box;
  }
  const seenCards = /* @__PURE__ */ new Set();
  // Caractéristiques de la demande (pas une estimation de sécurité) : ce que
  // l'outil fait, d'après les champs de la demande elle-même.
  function cardTraits(card) {
    const traits = [];
    if (UI.toolIcon(card.tool) === "terminal") traits.push(["terminal", "Exécution"]);
    if (card.networkActive) traits.push(["link", "Réseau"]);
    if (card.canRemember) traits.push(["history", "Mémorisable"]);
    return traits;
  }
  function renderCard(card, isNew) {
    const box = el("div", isNew ? "card enter" : "card");
    box.tabIndex = -1;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `Demande d'autorisation : ${card.label}`);
    const risks = cardTraits(card);
    const head = el("div", "card-head");
    const icon = svg("shield", "ico card-icon");
    icon.setAttribute("aria-hidden", "true");
    head.append(icon, el("div", "card-title", "Autorisation requise"));
    const chips = el("div", "card-risks");
    for (const [name, label] of risks) {
      const chip = el("span", "card-risk");
      chip.append(svg(name, "ico"), document.createTextNode(label));
      chips.append(chip);
    }
    const grid = el("div", "card-grid");
    const outil = el("div", "card-val", card.label);
    if (card.networkActive) outil.append(document.createTextNode(" · réseau activé"));
    grid.append(
      el("span", "card-key", "Outil"),
      outil,
      el("span", "card-key", "Action"),
      el("code", "card-summary", card.summary || card.tool),
      el("span", "card-key", "Raison"),
      el("div", "card-val card-reason", card.reason)
    );
    const det = el("details", "card-details");
    det.append(el("summary", "", "Détails"), el("pre", "", card.detail));
    box.append(head);
    if (risks.length) box.append(chips);
    box.append(grid, det);
    const row = el("div", "card-buttons");
    const buttons = {};
    const decide = (choice) => {
      box.classList.add(choice === "deny" ? "is-denied" : "is-locked");
      row.replaceChildren(el("span", "badge", choice === "deny" ? "Refusé" : "Autorisé"));
      vscode.postMessage({ type: "approve", toolUseId: card.toolUseId, choice });
    };
    const button = (label, choice, css) => {
      const b = el("button", css, label);
      b.type = "button";
      b.addEventListener("click", () => decide(choice));
      buttons[choice] = b;
      row.append(b);
    };
    button("Autoriser une fois", "once", "primary");
    button("Refuser", "deny", "danger");
    if (card.canRemember) button("Toujours", "always", "link");
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
    const p = UI.placePopover(
      { left: r.left, top: r.top, bottom: r.bottom },
      { width: pop.offsetWidth, height: pop.offsetHeight },
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }
    );
    pop.style.setProperty("--jn-x", `${p.x}px`);
    pop.style.setProperty("--jn-y", `${p.y}px`);
    pop.style.setProperty("--jn-maxh", `${p.maxHeight}px`);
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
      const items = [...pop.querySelectorAll("button, input")].filter(
        (n) => !n.disabled && !n.hidden && !n.closest("[hidden]")
      );
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
      label: "Modèle par défaut",
      description: "Réglage warband.model, sinon le modèle du binaire."
    },
    ...ctl?.models ?? []
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
        const badge = el("span", "badge model-free", "Gratuit");
        badge.title = "Modèle annoncé « Free » par le fournisseur.";
        badges.append(badge);
      }
      if (current) badges.append(el("span", "sr-only", "actuel"));
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
          ctl.modelsStatus === "loading" ? "Chargement de la liste…" : "Aucun modèle ne correspond."
        )
      );
    }
    modelList.replaceChildren(...nodes);
    const cur = visible.findIndex((m) => m.value === ctl.model);
    active = preferCurrent && cur >= 0 ? cur : UI.listboxKey(
      { active: -1 },
      "Home",
      visible.map(() => ({ disabled: false }))
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
    $("provider").value = c.provider;
    $("provider").disabled = c.locked;
    $("provider-connect").disabled = c.locked;
    modelChip.setAttribute("aria-disabled", String(c.locked));
    const known = c.models?.find((m) => m.value === c.model);
    const name = c.model === null ? "Modèle par défaut" : known?.label ?? c.model;
    $("model-chip-label").textContent = name;
    modelChip.title = `Modèle : ${name} (utilisé pour le message suivant)`;
    const free = c.models === null;
    const loading = c.modelsStatus === "loading";
    const message = c.modelsMessage || (loading ? "Récupération des modèles… Vous pouvez relancer si le chargement ne répond pas." : c.modelsStatus === "unavailable" ? "Liste indisponible. Vérifiez la connexion au fournisseur, puis réessayez." : "");
    $("models-status").textContent = message;
    $("models-status").hidden = !message;
    $("models-connect").hidden = loading || !message;
    $("models-connect").disabled = c.locked;
    modelFilter.hidden = modelList.hidden = free;
    modelInput.hidden = !free || loading;
    modelInput.disabled = c.locked;
    $("models-refresh").disabled = c.locked;
    $("models-refresh-label").textContent = loading ? "Relancer le chargement" : "Actualiser la liste";
    if (free) {
      if (document.activeElement !== modelInput) modelInput.value = c.model ?? "";
    } else if (modelPop.matches(":popover-open")) renderModelList(false);
    levels = c.provider === "demo" ? c.levels.filter((level) => level.enabled) : [{ value: null, label: "Auto" }, ...c.reasoningVariants];
    const choice = c.provider === "demo" ? c.effort : c.variant;
    const auto = choice === null;
    $("effort-auto").hidden = auto;
    $("effort-auto").disabled = c.locked || c.effortDisabled;
    effortInput.classList.toggle("auto", auto);
    effortInput.max = String(Math.max(levels.length - 1, 0));
    const idx = auto ? c.provider === "demo" ? Math.floor(levels.length / 2) : 0 : Math.max(
      levels.findIndex((l) => l.value === choice),
      0
    );
    effortInput.value = String(idx);
    const scale = $("effort-scale");
    scale.classList.remove("is-dragging");
    scale.style.setProperty("--jn-progress", String(idx / Math.max(levels.length - 1, 1)));
    scale.classList.toggle("auto", auto);
    shownLevel = auto ? -1 : idx;
    effortInput.disabled = c.locked || c.effortDisabled;
    const disabledTip = c.provider === "demo" ? "Ce modèle n'a pas d'effort réglable." : "Aucune variante de raisonnement connue pour ce modèle. Actualisez la liste des modèles.";
    effortInput.title = c.effortDisabled ? disabledTip : c.effortTip;
    effortInput.setAttribute("aria-valuetext", `${auto ? "Auto" : levels[idx]?.label ?? c.effortLabel} : ${c.effortTip}`);
    const shown = auto ? "Auto" : levels[idx]?.label ?? c.effortLabel;
    $("effort-label").textContent = shown;
    $("effort-tip").textContent = c.effortDisabled ? disabledTip : c.effortTip;
    $("effort-tip").title = $("effort-tip").textContent;
    $("cfg-level").textContent = shown;
    $("effort-model-label").textContent = name;
    $("effort-model").disabled = c.locked;
    paintNotches(idx);
    scale.classList.toggle("is-disabled", effortInput.disabled);
    cfgBtn.title = `Configurer : effort ${c.effortLabel}`;
    document.body.classList.toggle("learning", c.learning === true);
    $("learning-badge").hidden = c.learning !== true;
    learningSwitch.setAttribute("aria-checked", String(c.learning === true));
    learningSwitch.setAttribute("aria-disabled", String(c.locked));
    renderAutomatique();
  }
  wirePop(modelPop, modelChip, {
    render() {
      query = "";
      modelFilter.value = "";
      if (ctl && ctl.models !== null) renderModelList(true);
    },
    focus() {
      (ctl?.models === null ? modelInput : modelFilter).focus();
    }
  });
  const automaticSwitch = $("automatic-switch");
  const learningSwitch = $("learning-switch");
  function toggleLearning() {
    if (!ctl || ctl.locked) return;
    vscode.postMessage({ type: "setLearning", enabled: ctl.learning !== true });
  }
  learningSwitch.addEventListener("click", toggleLearning);
  const automaticState = $("automatic-state");
  const automaticBadge = $("automatic-badge");
  let automaticCtx = { push: null, previous: null, userOff: false };
  let automaticUserOff = false;
  // Règles d'engagement : jauge à trois crans dans l'en-tête.
  function paintRoe() {
    const roe = $("roe");
    const level = document.body.classList.contains("learning") ? 1 : document.body.classList.contains("automatic-on") ? 3 : 2;
    const pending = document.body.classList.contains("bypass-pending");
    const label = level === 3 ? "Bypass" : level === 1 ? "Apprentissage" : pending ? "Bypass · en attente" : "Supervisé";
    roe.dataset.level = String(level === 2 && pending ? 3 : level);
    roe.classList.toggle("is-pending", level === 2 && pending);
    $("roe-label").textContent = label;
    roe.setAttribute("aria-label", `Règles d'engagement : ${label}. Ouvrir Configurer`);
  }
  // Compte à rebours du bypass : l'échéance vient de l'outil (expiresAt) ; la
  // jauge se vide sur 2 h au plus et pulse dans les 10 dernières minutes.
  const BYPASS_MAX_MS = 72e5;
  const BYPASS_ENDING_MS = 6e5;
  let bypassTimer = 0;
  function leftText(ms) {
    const minutes = Math.ceil(ms / 6e4);
    if (minutes <= 0) return "0 min";
    const h = Math.floor(minutes / 60);
    return h > 0 ? `${h} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
  }
  function paintBypassClock() {
    const push = automaticCtx.push;
    const on = document.body.classList.contains("automatic-on") && Number.isFinite(push?.expiresAt);
    const roe = $("roe");
    if (!on) {
      clearInterval(bypassTimer);
      bypassTimer = 0;
      document.body.classList.remove("bypass-ending");
      roe.style.removeProperty("--jn-left");
      $("roe-left").textContent = "";
      return;
    }
    const ms = Math.max(0, push.expiresAt - Date.now());
    roe.style.setProperty("--jn-left", String(Math.min(1, ms / BYPASS_MAX_MS)));
    $("roe-left").textContent = leftText(ms);
    document.body.classList.toggle("bypass-ending", ms <= BYPASS_ENDING_MS);
    if (!bypassTimer) bypassTimer = setInterval(paintBypassClock, 15e3);
  }
  // Texte du fournisseur : deux lignes, dépliable au clic ou au clavier.
  const providerHelp = $("provider-help");
  const toggleProviderHelp = () => {
    const open = providerHelp.getAttribute("aria-expanded") !== "true";
    providerHelp.setAttribute("aria-expanded", String(open));
    providerHelp.title = open ? "Réduire le texte" : "Afficher tout le texte";
  };
  providerHelp.addEventListener("click", toggleProviderHelp);
  providerHelp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleProviderHelp();
  });
  function renderAutomatique() {
    paintRoe();
    const learning = ctl?.learning === true;
    automaticSwitch.setAttribute("aria-disabled", String(learning));
    if (learning) {
      automaticSwitch.setAttribute("aria-checked", "false");
      automaticState.textContent = "Inopérant en mode Apprentissage";
      document.body.classList.remove("automatic-on", "bypass-pending");
      automaticBadge.hidden = true;
      automaticBadge.replaceChildren();
      paintRoe();
      paintBypassClock();
      return;
    }
    const v = UI.automaticView(automaticCtx.push, automaticCtx.previous, automaticCtx.userOff, Date.now());
    automaticSwitch.setAttribute("aria-checked", String(v.checked));
    automaticState.textContent = v.text;
    document.body.classList.toggle("automatic-on", v.state === "on");
    document.body.classList.toggle("bypass-pending", v.state === "pending");
    paintRoe();
    paintBypassClock();
    automaticBadge.hidden = v.badge === null;
    if (v.badge) {
      automaticBadge.replaceChildren(
        el("span", "bp-word", v.badge.word),
        el("span", "bp-time", ` · ${v.badge.time}`)
      );
      automaticBadge.title = `Bypass actif jusqu'à ${v.until} : désactivable dans Configurer ou la barre d'état`;
    } else automaticBadge.replaceChildren();
  }
  function toggleAutomatique() {
    if (ctl?.learning === true) return;
    const last = automaticCtx.push;
    const enabled = !(last?.on === true || last?.armed === true);
    if (!enabled) automaticUserOff = true;
    vscode.postMessage({ type: "setAutomatique", enabled });
  }
  automaticSwitch.addEventListener("click", toggleAutomatique);
  function resetConversation() {
    automaticUserOff = true;
    vscode.postMessage({ type: "reset" });
  }
  wirePop(cfgPop, cfgBtn, {
    render() {
      renderAutomatique();
    },
    focus() {
      [...cfgPop.querySelectorAll("input, button")].find((n) => !n.disabled && !n.hidden)?.focus();
    }
  });
  const slashPop = $("slash-pop");
  const slashBtn = $("slash-btn");
  $("monitor-btn").addEventListener("click", () => vscode.postMessage({ type: "openMonitor" }));
  $("graph-btn").addEventListener("click", () => vscode.postMessage({ type: "openGraph" }));
  const mentionBtn = $("mention-btn");
  const hashBtn = $("hash-btn");
  wirePop(slashPop, slashBtn, {
    render() {
    },
    focus() {
      slashPop.querySelector("button:not(:disabled)")?.focus();
    }
  });
  $("cmd-clear").addEventListener("click", () => {
    slashPop.hidePopover();
    resetConversation();
  });
  const mentionPop = $("mention-pop");
  const mentionList = $("mention-list");
  const mentionEmpty = $("mention-empty");
  let spaces = [];
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
    mentionShown = !span ? [] : hash ? UI.filterTerminals(terminals, span.query).map((item) => ({
      name: item.token,
      // Jeton exact (#htb1, #htb1-2) : deux shells du même espace restent distincts.
      label: `#${item.token}`,
      desc: item.hint ? `$ ${item.hint}` : "terminal ouvert"
    })) : UI.filterSpaces(spaces, span.query).map((item) => ({
      name: item.name,
      desc: item.state === "running" ? "en cours" : "arrêté"
    }));
    if (mentionActive >= mentionShown.length) mentionActive = 0;
    mentionEmpty.hidden = mentionShown.length > 0;
    mentionEmpty.textContent = hash ? "Aucun terminal Warband ouvert. Alt+J T pour en ouvrir un." : "Aucun espace";
    mentionPop.setAttribute("aria-label", hash ? "Terminaux" : "Espaces");
    mentionList.replaceChildren(
      ...mentionShown.map((item, i) => {
        const btn = el("button", "cmd-opt");
        btn.type = "button";
        btn.setAttribute("role", "option");
        btn.append(el("span", "cmd", item.label || item.name), el("span", "cmd-desc", item.desc));
        btn.addEventListener("click", () => pickMention(item.name));
        if (i === mentionActive) btn.setAttribute("aria-selected", "true");
        return btn;
      })
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
        visible.map(() => ({ disabled: false }))
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
  $("models-refresh").addEventListener(
    "click",
    () => vscode.postMessage({ type: "refreshModels" })
  );
  $("models-connect").addEventListener("click", () => {
    if (!ctl?.locked) vscode.postMessage({ type: "addProvider" });
  });
  function postReasoningChoice(value) {
    if (!ctl || ctl.locked || ctl.effortDisabled) return;
    vscode.postMessage(
      ctl.provider === "demo" ? { type: "setEffort", effort: value } : { type: "setVariant", variant: value }
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
        })
      );
    }
    [...box.children].forEach((notch, i) => notch.classList.toggle("is-on", i <= position + 0.001));
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
    const next = { ArrowLeft: current - 1, ArrowDown: current - 1, ArrowRight: current + 1, ArrowUp: current + 1, PageDown: current - 1, PageUp: current + 1, Home: 0, End: levels.length - 1 }[event.key];
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
  projectFilter.setAttribute("aria-label", "Filtrer les conversations par projet");
  historyList.before(projectFilter);
  projectFilter.addEventListener("change", () => renderHistory(historyEntries));
  function renderHistory(entries) {
    historyEntries = entries;
    const selected = projectFilter.value || "all";
    const projects = new Map(
      entries.map((h) => [h.projectKey || "none", h.projectLabel || "Sans projet"])
    );
    const option = (value, label) => {
      const node = el("option", "", label);
      node.value = value;
      return node;
    };
    projectFilter.replaceChildren(
      option("all", "Tous les projets"),
      ...[...projects].map(([key, label]) => option(key, label))
    );
    projectFilter.value = selected === "all" || projects.has(selected) ? selected : "all";
    const allEntries = entries;
    entries = entries.filter(
      (h) => projectFilter.value === "all" || (h.projectKey || "none") === projectFilter.value
    );
    $("history-clear").title = "Supprimer toutes les conversations de ce chat, tous projets compris";
    $("history-clear").disabled = allEntries.length === 0;
    if (entries.length === 0) {
      historyList.replaceChildren(el("li", "hist-empty", "Aucune conversation enregistrée."));
      return;
    }
    historyList.replaceChildren(
      ...entries.map((h) => {
        const li = el("li", h.current ? "hist current" : "hist");
        const when = new Date(h.updatedAt).toLocaleString();
        const meta = `${h.projectLabel || "Sans projet"} · ${when} · ${h.tools} outil${h.tools > 1 ? "s" : ""} · ${h.provider} · ${h.model}`;
        if (renaming === h.id) {
          const field = el("input", "hist-rename");
          field.type = "text";
          field.value = h.title;
          field.maxLength = 120;
          field.setAttribute("aria-label", "Nouveau titre");
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
        open.title = "Ouvrir en lecture seule";
        open.addEventListener("click", () => {
          vscode.postMessage({ type: "historyOpen", id: h.id });
          setHistoryOpen(false);
        });
        const actions = el("div", "hist-actions");
        const rename = el("button", "link", "Renommer");
        rename.type = "button";
        rename.addEventListener("click", () => {
          renaming = h.id;
          renderHistory(historyEntries);
        });
        const del = el("button", "link", "Supprimer");
        del.type = "button";
        del.addEventListener(
          "click",
          () => vscode.postMessage({ type: "historyDelete", id: h.id })
        );
        actions.append(rename, del);
        const line = el("div", "hist-line");
        line.append(open);
        const badge = UI.historyBadge(h, historyRunning);
        if (badge) line.append(el("span", "badge", badge));
        li.append(line, el("div", "hist-meta", meta), actions);
        return li;
      })
    );
  }
  function renderReadonly(info) {
    const bar = $("readonly");
    bar.hidden = !info;
    if (!info) return;
    let text = `Lecture seule : ${info.title}`;
    if (info.invalid > 0) text += ` · ${info.invalid} ligne(s) du journal ignorée(s)`;
    if (info.truncated) text += " · journal tronqué";
    $("readonly-text").textContent = text;
    $("readonly-resume").textContent = info.canResume ? "Reprendre" : "Reprendre (nouvelle session)";
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
  $("readonly-resume").addEventListener(
    "click",
    () => vscode.postMessage({ type: "historyResume" })
  );
  $("readonly-close").addEventListener("click", () => resetConversation());
  $("provider-connect").addEventListener("click", () => {
    if (!ctl?.locked) vscode.postMessage({ type: "addProvider" });
  });
  $("provider").addEventListener("change", (event) => {
    if (!ctl?.locked) vscode.postMessage({ type: "setProvider", provider: event.target.value });
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
    monitorFollowBtn.title = monitorFollow ? "Désactiver le suivi du bas pour défiler librement" : "Activer le suivi et revenir en bas";
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
    if (row.space !== "") {
      const tag = el("span", "prompt mon-space", row.space);
      // Une teinte stable par espace (jeu Multicolore) : somme des caractères modulo 6.
      tag.dataset.hue = String([...row.space].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6 + 1);
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
      out.append(...lines.map((line) => el("span", "mon-line", line)));
      li.append(out);
    }
    if (row.truncated) li.append(el("p", "note", "sortie tronquée"));
    if (mode === "monitor" && row.toolUseId) {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.title = "Suivre la sortie";
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
          const line = [...monitorRowsEl.children].find((n) => n.dataset.monitorId === tick.dataset.rowId);
          if (!line) return;
          monitorFollow = false;
          monitorFollowBtn.setAttribute("aria-pressed", "false");
          const head = monitor.querySelector(".mon-head").getBoundingClientRect();
          const offset = line.getBoundingClientRect().top - head.bottom - 8;
          monitor.scrollTo({ top: monitor.scrollTop + offset, behavior: motion.matches ? "auto" : "smooth" });
          line.classList.remove("is-flash");
          void line.offsetWidth;
          line.classList.add("is-flash");
        });
        stripTicks.set(row.id, tick);
      }
      tick.dataset.rowId = row.id;
      tick.className = `mon-tick tone-${row.tone}`;
      tick.setAttribute("aria-label", `Commande ${i + 1} : ${row.command}, ${row.status}`);
      tick.title = `${row.command} · ${row.status}`;
      return tick;
    });
    const same = ticks.length === strip.children.length && ticks.every((tick, i) => strip.children[i] === tick);
    if (!same) strip.replaceChildren(...ticks);
  }

  function renderMonitor(view) {
    const top = monitor.scrollTop;
    const positions = new Map(
      [...monitorRowsEl.children].map((line) => {
        const box = line.querySelector(".mon-out");
        return [line.dataset.monitorId, { top: box?.scrollTop ?? 0, left: box?.scrollLeft ?? 0 }];
      })
    );
    let rows = UI.monitorRows(view);
    if (mode === "watch") {
      rows = rows.filter((row) => row.toolUseId === watchId);
      if (!rows.length && monitorNodes.size) return;
    }
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
      })
    );
    monitorEmpty.hidden = rows.length > 0;
    const waiting = rows.filter((r) => r.tone === "wait").length;
    const failed = rows.filter((r) => r.tone === "err").length;
    $("monitor-count").textContent = rows.length === 0 ? "" : [
      `${rows.length} commande${rows.length > 1 ? "s" : ""}`,
      waiting ? `${waiting} en attente` : "",
      failed ? `${failed} en erreur` : ""
    ].filter(Boolean).join(" · ");
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
      reducedMotion: motion.matches
    });
    for (const c of MANAGED) document.body.classList.toggle(c, want.includes(c));
    paintClock();
  }
  // Horloge de mission : temps écoulé depuis le début de l'activité (T+mm:ss).
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
    const running = document.body.classList.contains("running");
    if (running && missionStart === null) missionStart = Date.now();
    if (!running) {
      missionStart = null;
      clearInterval(missionTimer);
      missionTimer = 0;
    } else if (!missionTimer) missionTimer = setInterval(tickClock, 1e3);
    tickClock();
  }
  document.addEventListener("visibilitychange", applyBody);
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
        monitorFollowBtn.title = "Désactiver le suivi du bas pour défiler librement";
      } else {
        monitorFollow = false;
        monitorFollowBtn.setAttribute("aria-pressed", "false");
        monitorFollowBtn.title = "Activer le suivi du bas";
      }
      vscode.postMessage({ type: "timelinePage", direction });
    });
  }
  function renderPaging(paging) {
    timeline.hidden = mode === "watch" || !paging || !paging.earlier && !paging.archived && !paging.error;
    $("timeline-older").disabled = !paging?.earlier || paging.loading;
    $("timeline-newer").hidden = !paging?.archived;
    $("timeline-newer").disabled = !!paging?.loading;
    $("timeline-latest").hidden = !paging?.archived;
    $("timeline-status").textContent = paging?.loading ? "Chargement…" : paging?.error ?? (paging?.archived ? "Messages précédents" : "");
  }
  let pageBefore = null;
  function render(view) {
    paintMission(view.mission);
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
    const atBottom = pageChanged ? nextBefore === null : log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const top = log.scrollTop;
    const nodes = view.items.length === 0 ? [welcome(view.sandbox)] : renderItems(view.items);
    const added = nodes.length - shownNodes;
    if (shownNodes >= 0 && added > 0 && added <= 3) {
      for (const n of nodes.slice(shownNodes)) n.classList.add("enter");
    }
    shownNodes = view.items.length === 0 ? 0 : nodes.length;
    log.replaceChildren(...nodes);
    const visible2 = mode === "monitor" || !Array.isArray(view.approvals) ? [] : view.approvals;
    const cards = visible2.map((c) => renderCard(c, !seenCards.has(c.toolUseId)));
    approvals.replaceChildren(...cards);
    const fresh = visible2.findIndex((c) => !seenCards.has(c.toolUseId));
    seenCards.clear();
    for (const c of visible2) seenCards.add(c.toolUseId);
    if (fresh >= 0) cards[fresh]?.focus();
    const sb = $("sandbox");
    if (view.sandbox) {
      sb.textContent = view.sandboxNetwork === "bridge" ? `Bac à sable : ${view.sandbox} · réseau activé` : `Bac à sable : ${view.sandbox}`;
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
    applyBody();
    if (view.busy) $("thinking-label").textContent = UI.activityLabel(view);
    if (view.items.length === 0) toolStatus.clear();
    log.setAttribute("aria-busy", view.busy ? "true" : "false");
    log.scrollTop = atBottom ? log.scrollHeight : top;
  }
  let chatId;
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "view") {
      if (message.chatId !== void 0 && message.chatId !== chatId || message.view.conversation !== lastView?.conversation) {
        chatId = message.chatId;
        sent = [];
        recall = { index: -1, draft: "" };
        shownNodes = -1;
        pageBefore = null;
        itemNodes.clear();
        monitorNodes.clear();
        openTools.clear();
        toolStatus.clear();
        log.replaceChildren();
        monitorRowsEl.replaceChildren();
      }
      render(message.view);
    } else if (message && message.type === "role" && message.role === "monitor") {
      mode = "monitor";
      document.body.classList.add("mode-monitor");
      document.body.classList.remove("mode-watch");
      if (lastView) render(lastView);
    } else if (message && message.type === "role" && message.role === "watch" && typeof message.toolUseId === "string") {
      mode = "watch";
      watchId = message.toolUseId;
      document.body.classList.add("mode-watch");
      document.body.classList.remove("mode-monitor");
      if (lastView) render(lastView);
    } else if (message && message.type === "palette" && typeof message.palette === "string" && /^[a-z]{1,16}$/.test(message.palette)) {
      document.body.dataset.palette = message.palette;
    } else if (message && message.type === "title" && typeof message.text === "string") {
      const brandName = document.querySelector("#title .brand-name");
      if (brandName) brandName.textContent = message.text.slice(0, 120);
      else $("title").textContent = message.text.slice(0, 120);
    } else if (message && message.type === "spaces") {
      spaces = UI.safeSpaces(message.items);
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "terminals") {
      terminals = UI.safeTerminals(message.items);
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "automatic") {
      automaticCtx = { push: message, previous: automaticCtx.push, userOff: automaticUserOff };
      automaticUserOff = false;
      renderAutomatique();
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
      lines: value.split("\n").length
    };
  }
  function submit() {
    const text = input.value;
    if (text.trim() === "" || send.disabled) return;
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
          mentionShown.map(() => ({ disabled: false }))
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
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const next = UI.inputRecall(
        { index: recall.index, draft: recall.draft, entries: sent, current: input.value },
        e.key === "ArrowUp" ? "up" : "down",
        caretLine()
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
