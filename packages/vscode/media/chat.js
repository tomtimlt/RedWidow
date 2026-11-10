(() => {
  const vscode = acquireVsCodeApi();
  const t = (...args) => globalThis.WarbandI18n?.t(...args) ?? fallbackText(...args);
  const fallbackText = (key, ...values) =>
    typeof key === "string"
      ? key
      : key.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const savedUi = vscode.getState?.();
  const validSavedUi =
    savedUi &&
    typeof savedUi === "object" &&
    Object.keys(savedUi).length === 2 &&
    typeof savedUi.historyOpen === "boolean" &&
    Number.isFinite(savedUi.top) &&
    savedUi.top >= 0 &&
    savedUi.top <= 10000000;
  let restoreUi = validSavedUi ? { top: savedUi.top, historyOpen: savedUi.historyOpen } : null;
  window.addEventListener("pagehide", () => {
    const top = log.scrollTop;
    if (Number.isFinite(top) && top >= 0 && top <= 10000000)
      vscode.setState?.({ top, historyOpen: !historyPanel.hidden });
  });
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
    interrupted: t("interrompu ou état inconnu"),
    ok: t("réussi"),
    error: t("erreur"),
    denied: t("refusé"),
  });
  const ICON = { interrupted: "ban", pending: "clock", ok: "check", error: "close", denied: "ban" };
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
  // L’araignée remplace le viseur de secours sans changer les contrôles du chat.
  const spiderMark = (className) =>
    globalThis.WarbandSpider?.createMini(`brand rw-spider rw-mini ${className}`) ?? null;
  for (const [selector, className] of [
    ["#title .brand", "rw-title"],
    ["#thinking .thinking-mark", "thinking-mark"],
  ]) {
    const previous = document.querySelector(selector);
    const mark = previous && spiderMark(className);
    if (mark) previous.replaceWith(mark);
  }
  // Les réponses de l'agent sont signées du logo.
  function agentMark() {
    const spider = spiderMark("msg-avatar");
    if (spider) return spider;
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
  // Progression de la mission : rail de phases sous l'en-tête.
  $("link-container").addEventListener("click", () => vscode.postMessage({ type: "openCockpit" }));
  let linkedContainerCount = null;
  const paintContainerWarning = (missing) => {
    $("container-warning").hidden = !missing;
  };
  function paintContainerLinks(items) {
    $("container-links").replaceChildren(
      ...(Array.isArray(items) ? items : []).slice(0, 8).flatMap((item) => {
        if (typeof item.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.name))
          return [];
        const card = el("div", "container-link-card");
        card.append(el("p", "", t("Lier {0} à ce projet ?", { 0: item.name })));
        if (typeof item.message === "string") card.append(el("p", "hint", item.message));
        for (const [type, label] of [
          ["linkMention", "Lier"],
          ["ignoreLinkMention", "Ignorer"],
        ]) {
          const button = el("button", "ghost", t(label));
          button.addEventListener("click", () => vscode.postMessage({ type, name: item.name }));
          card.append(button);
        }
        return [card];
      }),
    );
  }
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
    if (cached) node.classList.add("no-enter");
    if (item.source) node.dataset.source = item.source;
    if (item.kind === "user" || item.kind === "agent") node.dataset.exchangeId = String(item.id);
    credential.node = node;
    itemNodes.set(item.id, credential);
    return node;
  }
  const toolGroups = new Map();
  function stableChildren(parent, nodes) {
    const wanted = new Set(nodes);
    for (const child of [...parent.children]) if (!wanted.has(child)) child.remove();
    let next = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.parentNode !== parent || node.nextElementSibling !== next)
        parent.insertBefore(node, next);
      next = node;
    }
  }
  function renderItems(items) {
    const nodes = [];
    let group = null;
    let grouped = [];
    const activeGroups = new Set();
    const finishGroup = () => {
      if (group) stableChildren(group, grouped);
    };
    for (const item of items) {
      if (item.kind === "tool") {
        if (!group) {
          group = toolGroups.get(item.id) ?? el("div", "tool-group");
          toolGroups.set(item.id, group);
          activeGroups.add(item.id);
          grouped = [];
          nodes.push(group);
        }
        grouped.push(renderItem(item));
        continue;
      }
      finishGroup();
      group = null;
      nodes.push(renderItem(item));
    }
    finishGroup();
    for (const id of toolGroups.keys()) if (!activeGroups.has(id)) toolGroups.delete(id);
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
    // Encadrement : liste fermée, gelée pendant un tour comme l'effort.
    const supervisionTips = {
      light: "Léger : moins de relances du moteur.",
      standard: "Standard : réglage par défaut.",
      strict:
        "Strict : relances dès le premier signal et point de contrôle toutes les 8 actions, conseillé pour les petits modèles.",
      relentless:
        "Acharné : relances automatiques, pas de point de contrôle, conseillé pour les longues missions.",
    };
    const level = Object.hasOwn(supervisionTips, c.supervision) ? c.supervision : "standard";
    $("supervision").value = level;
    $("supervision").disabled = c.locked;
    $("supervision-tip").textContent = t(supervisionTips[level]);
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
    "out-of-box": "Pentest",
    "red-team": "Red Team — Expert",
    htb: "Hack The Box / CTF",
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
    const researchNext = $("research-next");
    researchNext.disabled =
      learning || !!view?.busy || !!view?.readonly || !caps.selection.webSearch;
    if (learning || !caps.selection.webSearch) researchNext.setAttribute("aria-pressed", "false");
    const locked = !!view?.busy || !!view?.readonly || learning;
    const rows = [];
    const heading = (text) => rows.push(el("p", "composer-section", t(text)));
    // Chaque capacité est une bascule activer/désactiver : l'hôte écrit l'ajout ou le retrait dans `chat.*`.
    const choice = (label, checked, apply, toggle, unavailable = false) => {
      const row = el(
        "button",
        "resource-toggle composer-choice",
        `${label} · ${checked ? t("Activé") : t("Désactivé")}`,
      );
      row.type = "button";
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", String(checked));
      row.disabled = locked || unavailable;
      row.addEventListener("click", () => {
        const selection = {
          ...lastCapabilities.selection,
          integrations: [...lastCapabilities.selection.integrations],
        };
        apply(selection, !checked);
        lastCapabilities = { ...lastCapabilities, selection };
        vscode.postMessage({ type: "setCapability", ...toggle, enabled: !checked });
        const index = rows.indexOf(row);
        renderCapabilities(lastCapabilities, view);
        $("composer-resources").children[index]?.focus();
      });
      rows.push(row);
    };
    if (caps.available.skills.length) {
      heading("Skills / méthodes");
      for (const id of caps.available.skills)
        choice(
          skillLabels[id] ?? id,
          caps.selection.profile === id,
          (s, on) => {
            s.profile = on ? id : s.profile === id ? null : s.profile;
          },
          { kind: "skill", id },
        );
    }
    if (caps.available.integrations.length || caps.available.burp) {
      heading("Connecteurs MCP");
      for (const id of caps.available.integrations)
        choice(
          mcpLabels[id] ?? id,
          caps.selection.integrations.includes(id),
          (s, on) => {
            s.integrations = on ? [...s.integrations, id] : s.integrations.filter((v) => v !== id);
          },
          { kind: "integration", id },
          caps.selection.integrations.length >= 4 && !caps.selection.integrations.includes(id),
        );
      if (caps.available.burp)
        choice(
          "Burp Suite",
          caps.selection.burp,
          (s, on) => {
            s.burp = on;
          },
          { kind: "burp" },
        );
    }
    heading("Recherche");
    choice(
      t("Recherche web"),
      caps.selection.webSearch,
      (s, on) => {
        s.webSearch = on;
      },
      { kind: "webSearch" },
    );
    rows.push(
      el(
        "p",
        "tip",
        t(
          learning
            ? "Le mode Apprentissage utilise seulement les cours et les terminaux en lecture."
            : "Activer ou désactiver ici met aussi à jour les réglages. Les actions restent soumises aux approbations.",
        ),
      ),
    );
    target.replaceChildren(...rows);
    if (focusedChoice >= 0) target.querySelectorAll(".resource-toggle")[focusedChoice]?.focus();
    const names = [
      skillLabels[caps.selection.profile ?? "out-of-box"],
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
  $("export-chat-btn")?.addEventListener("click", () => vscode.postMessage({ type: "exportChat" }));
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
    lastMentionQuery = null;
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
        : mentionEntries(span.query);
    if (!mentionShown[mentionActive] || mentionShown[mentionActive].disabled)
      mentionActive = Math.max(
        0,
        mentionShown.findIndex((item) => !item.disabled),
      );
    mentionEmpty.hidden = mentionShown.length > 0;
    mentionEmpty.textContent = hash
      ? t`Aucun terminal RedWidow ouvert. ${document.body.dataset.terminalShortcut || "Alt+J T"} pour en ouvrir un.`
      : t("Aucun conteneur");
    mentionPop.setAttribute(
      "aria-label",
      hash ? t("Terminaux") : t("Conteneurs, fichiers et contexte"),
    );
    mentionList.replaceChildren(
      ...mentionShown.map((item, i) => {
        const btn = el("button", "cmd-opt");
        btn.type = "button";
        btn.setAttribute("role", "option");
        // Les chemins et noms viennent de l'hôte : rendus par textContent uniquement (el).
        btn.append(el("span", "cmd", item.label || item.name), el("span", "cmd-desc", item.desc));
        if (item.disabled) {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
        } else btn.addEventListener("click", () => pickMention(item));
        if (i === mentionActive) btn.setAttribute("aria-selected", "true");
        return btn;
      }),
    );
  }
  /** Entrées du menu `@` : contexte spécial, conteneurs, puis fichiers trouvés par l'hôte. */
  function mentionEntries(query) {
    const q = query.toLowerCase();
    const entries = [];
    if (mentionData) {
      const special = (kind, label, ok, off) =>
        label.toLowerCase().includes(q) &&
        entries.push({
          kind,
          name: kind,
          label: `@${label}`,
          desc: ok.available ? ok.text : off[ok.why],
          disabled: !ok.available,
        });
      special(
        "killchain",
        "killchain",
        { ...mentionData.killchain, text: t("Notes Kill Chain du projet actif") },
        {
          "no-project": t("Aucun projet actif"),
          empty: t("Aucune note dans le projet actif"),
        },
      );
      special(
        "sortie",
        "sortie",
        { ...mentionData.sortie, text: t("Dernière sortie d’outil de la session") },
        {
          "no-project": t("Aucune sortie d’outil dans cette session"),
          empty: t("Aucune sortie d’outil dans cette session"),
        },
      );
    }
    for (const item of UI.filterContainers(containers, query))
      entries.push({
        kind: "container",
        name: item.name,
        desc: item.state === "running" ? t("en cours") : t("arrêté"),
      });
    if (mentionData)
      for (const file of mentionData.files)
        entries.push({ kind: "file", name: file.path, label: file.label, desc: t("fichier") });
    return entries;
  }
  let mentionData = null;
  let mentionTimer = 0;
  let lastMentionQuery = null;
  /** Demande à l'hôte les fichiers et entrées spéciales ; groupée pour ne pas inonder pendant la frappe. */
  function askMentions(query) {
    if (query === lastMentionQuery) return;
    lastMentionQuery = query;
    clearTimeout(mentionTimer);
    mentionTimer = setTimeout(() => vscode.postMessage({ type: "mentionQuery", query }), 120);
  }
  let pendingMention = null;
  function attachMention(item) {
    if (!lastView || attachBtn.disabled) return;
    const requestId = `mention-${Date.now()}-${++fileSerial}`;
    pendingMention = { requestId, epoch: fileEpoch };
    vscode.postMessage({
      type: "mentionAttach",
      requestId,
      kind: item.kind,
      ...(item.kind === "file" && { path: item.name }),
    });
  }
  /** Pièce jointe fournie par l'hôte (déjà relue et revalidée) ; mêmes plafonds que les fichiers manuels. */
  function addMention(message) {
    if (!pendingMention || message.requestId !== pendingMention.requestId) return;
    const { epoch } = pendingMention;
    pendingMention = null;
    if (epoch !== fileEpoch || typeof message.name !== "string" || typeof message.text !== "string")
      return;
    const key =
      message.kind === "file" ? `file:${message.name}:${message.text.length}` : message.kind;
    const bytes = new TextEncoder().encode(message.text).length;
    const others = draftFiles.filter((f) => f.mentionKey !== key);
    const total = others.filter((f) => !f.mimeType).reduce((sum, f) => sum + f.bytes, 0) + bytes;
    if (others.length + 1 > Number(fileInput.dataset.count)) {
      attachmentStatus(t("Maximum 10 fichiers joints."));
      return;
    }
    if (bytes > Number(fileInput.dataset.bytes) || total > Number(fileInput.dataset.total)) {
      attachmentStatus(t("Limite : 64 Kio par fichier et 256 Kio au total."));
      return;
    }
    draftFiles = [
      ...others,
      { id: ++fileSerial, name: message.name, text: message.text, bytes, mentionKey: key },
    ];
    attachmentStatus(
      t(
        "Ces fichiers seront transmis au fournisseur. Seuls leurs noms apparaissent dans la conversation. N’ajoutez pas de secrets.",
      ),
    );
    paintAttachments();
  }
  const MENTION_REFUSALS = {
    path: () => t("Fichier refusé : chemin sensible ou hors de l’espace de travail."),
    missing: () => t("Fichier introuvable."),
    size: () => t("Fichier trop volumineux : 64 Kio au maximum."),
    binary: () => t("Ce fichier n’est pas un texte UTF-8 pris en charge."),
    empty: () => t("Rien à joindre."),
    invalid: () => t("Mention invalide."),
  };
  function refuseMention(message) {
    if (!pendingMention || message.requestId !== pendingMention.requestId) return;
    pendingMention = null;
    const key = Object.hasOwn(MENTION_REFUSALS, message.reason) ? message.reason : "invalid";
    attachmentStatus(MENTION_REFUSALS[key]());
  }
  let lastTerminalsAsk = 0;
  function openMention() {
    const cursor = input.selectionStart ?? input.value.length;
    if (UI.hashSpan(input.value, cursor) && Date.now() - lastTerminalsAsk > 1e3) {
      lastTerminalsAsk = Date.now();
      vscode.postMessage({ type: "refreshTerminals" });
    }
    if (!UI.hashSpan(input.value, cursor)) {
      const at = UI.mentionSpan(input.value, cursor);
      if (at) askMentions(at.query);
    }
    renderMentions();
    if (!mentionOpen()) mentionPop.showPopover();
    place(mentionPop, input);
  }
  function pickMention(item) {
    const name = item.name;
    const cursor = input.selectionStart ?? input.value.length;
    const span = UI.hashSpan(input.value, cursor) ?? UI.mentionSpan(input.value, cursor);
    if (!span) return;
    if (item.kind === "file" || item.kind === "killchain" || item.kind === "sortie") {
      // Pièce jointe : le texte `@…` tapé est retiré, l'hôte relit et revalide la cible.
      input.value = `${input.value.slice(0, span.start)}${input.value.slice(cursor)}`;
      input.setSelectionRange(span.start, span.start);
      closeMention();
      grow();
      input.focus();
      attachMention(item);
      return;
    }
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
  $("supervision").addEventListener("change", (event) => {
    if (ctl?.locked) return;
    vscode.postMessage({ type: "setSupervision", supervision: event.target.value });
  });
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
      renderHistory(historyEntries);
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
  let exchangePosition = null;
  let exchangeRevision = 0;
  for (const event of ["wheel", "touchstart", "pointerdown"]) {
    log.addEventListener(
      event,
      () => {
        exchangePosition = null;
      },
      { passive: true },
    );
  }
  function readingExchange() {
    if (exchangePosition?.isConnected) return exchangePosition;
    const rows = [...log.querySelectorAll("[data-exchange-id]")];
    const top = log.getBoundingClientRect().top;
    return rows.find((row) => row.getBoundingClientRect().bottom > top) ?? rows.at(-1);
  }
  for (const direction of ["older", "newer", "latest"]) {
    $(`timeline-${direction}`).addEventListener("click", () => {
      if (direction === "latest") {
        exchangePosition = null;
        vscode.postMessage({ type: "timelinePage", direction });
        return;
      }
      const row = readingExchange();
      if (row)
        vscode.postMessage({
          type: "timelineExchange",
          direction,
          id: Number(row.dataset.exchangeId),
          ...(row.dataset.source && { source: row.dataset.source }),
        });
    });
  }
  function renderPaging(paging, view) {
    $("timeline-older").firstElementChild.textContent = t("Échange précédent");
    $("timeline-newer").firstElementChild.textContent = t("Échange suivant");
    const hasMessages = (view.items ?? []).some(
      (item) => item.kind === "user" || item.kind === "agent",
    );
    timeline.hidden =
      !paging || (!hasMessages && !paging.earlier && !paging.archived && !paging.error);
    $("timeline-older").disabled = !!paging?.loading || !hasMessages;
    $("timeline-newer").hidden = false;
    $("timeline-newer").disabled = !!paging?.loading || !hasMessages;
    $("timeline-latest").hidden = !paging?.archived && !exchangePosition;
    $("timeline-status").textContent = paging?.loading
      ? t("Chargement…")
      : (paging?.error ?? (paging?.archived ? t("Messages précédents") : ""));
  }
  let pageBefore = null;
  let resourcesFingerprint;
  let historyFingerprint;
  /** Jauge de contexte : valeurs du moteur uniquement, « — » tant qu'il n'a rien annoncé. */
  function paintGauge(context) {
    const gauge = $("context-gauge");
    const state = UI.contextGauge(context);
    gauge.textContent = state.text;
    gauge.dataset.level = state.level;
    if (state.title) gauge.title = state.title;
    else gauge.removeAttribute("title");
  }
  function render(view) {
    paintGauge(view.context);
    paintContainerWarning(
      linkedContainerCount === null ? view.noContainer === true : linkedContainerCount === 0,
    );
    const resourceKey = JSON.stringify([
      view.capabilities,
      view.busy,
      !!view.readonly,
      view.controls?.learning,
      document.documentElement.lang,
    ]);
    if (resourceKey !== resourcesFingerprint) {
      resourcesFingerprint = resourceKey;
      renderCapabilities(view.capabilities, view);
    }
    paintMission(UI.conversationActivity(view));
    const nextBefore = view.paging?.before ?? null;
    const pageChanged = nextBefore !== pageBefore;
    pageBefore = nextBefore;
    if (pageChanged) log.scrollTop = 0;
    renderPaging(view.paging, view);
    const users = (view.items ?? []).filter((it) => it.kind === "user").map((it) => it.text);
    const nextSent = UI.syncRecallEntries(sent, users);
    if (nextSent.length < sent.length || nextSent[0] !== sent[0]) {
      recall = { index: -1, draft: "" };
    }
    sent = nextSent;
    renderControls(view.controls);
    historyRunning = view.busy && !view.readonly;
    historyEntries = view.history;
    const historyKey = JSON.stringify([
      view.history,
      historyRunning,
      document.documentElement.lang,
    ]);
    if (!historyPanel.hidden && historyKey !== historyFingerprint) {
      historyFingerprint = historyKey;
      renderHistory(view.history);
    }
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
    stableChildren(log, nodes);
    const visible2 = Array.isArray(view.approvals) ? view.approvals : [];
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
    stableChildren(approvals, cards);
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
    if (restoreUi) {
      log.scrollTop = restoreUi.top;
      if (restoreUi.historyOpen) setHistoryOpen(true);
      restoreUi = null;
    }
    if (view.exchangeTarget && view.exchangeTarget.revision !== exchangeRevision) {
      exchangeRevision = view.exchangeTarget.revision;
      const target = [...log.querySelectorAll("[data-exchange-id]")].find((node) =>
        view.exchangeTarget.source
          ? node.dataset.source === view.exchangeTarget.source
          : Number(node.dataset.exchangeId) === view.exchangeTarget.id,
      );
      if (target) {
        exchangePosition = target;
        target.scrollIntoView({ block: "start" });
        $("timeline-latest").hidden = false;
      }
    }
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
    const snapshots = [...document.querySelectorAll("[id], input, textarea, pre")].map((node) => ({
      node,
      path: pathOf(node),
      top: node.scrollTop,
      left: node.scrollLeft,
      value: node.matches("input:not([type=file]), textarea") ? node.value : undefined,
      start: node.matches("input:not([type=file]), textarea") ? node.selectionStart : null,
      end: node.matches("input:not([type=file]), textarea") ? node.selectionEnd : null,
    }));
    i18n.setLocale(locale);
    i18n.applyStatic(document);
    for (const binding of productBindings) {
      if (binding.node.isConnected) binding.paint();
      else productBindings.delete(binding);
    }
    // Les cartes conservent leurs nœuds et leurs verrous ; les messages et sorties sont reparcourus.
    itemNodes.clear();
    if (lastView) render(lastView);
    paintAttachments();
    if (mentionOpen()) renderMentions();
    providerHelp.title =
      providerHelp.getAttribute("aria-expanded") === "true"
        ? t("Réduire le texte")
        : t("Afficher tout le texte");
    projectFilter.setAttribute("aria-label", t("Filtrer les conversations par projet"));
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
  let pendingViewMessage = null;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pendingViewMessage) {
      const data = pendingViewMessage;
      pendingViewMessage = null;
      window.dispatchEvent(new MessageEvent("message", { data }));
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "locale") {
      switchLocale(message.locale);
    } else if (message && message.type === "view") {
      // Une vue cachée conserve seulement le dernier état, sans reconstruire son DOM.
      if (document.hidden) {
        pendingViewMessage = message;
        return;
      }
      pendingViewMessage = null;
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
        itemNodes.clear();
        openTools.clear();
        toolStatus.clear();
        log.replaceChildren();
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
    } else if (message && message.type === "title" && typeof message.text === "string") {
      const contextTitle = $("context-title");
      contextTitle.textContent = message.text.slice(0, 120);
      contextTitle.title = contextTitle.textContent;
      contextTitle.hidden = contextTitle.textContent.length === 0;
    } else if (message && message.type === "containerLinks") {
      paintContainerLinks(message.items);
    } else if (message && message.type === "containers") {
      if (Number.isInteger(message.linkedCount)) {
        linkedContainerCount = message.linkedCount;
        paintContainerWarning(linkedContainerCount === 0);
      }
      containers = UI.safeContainers(message.items);
      paintAttachments();
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "mentionResults") {
      const span = UI.mentionSpan(input.value, input.selectionStart ?? input.value.length);
      if (span && span.query === message.query && mentionOpen()) {
        mentionData = UI.safeMentionResults(message);
        renderMentions();
      }
    } else if (message && message.type === "mentionAttached") {
      addMention(message);
    } else if (message && message.type === "mentionRefused") {
      refuseMention(message);
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
        if (file.mimeType) {
          const preview = document.createElement("img");
          preview.src = `data:${file.mimeType};base64,${file.data}`;
          preview.alt = file.name;
          preview.width = 40;
          preview.height = 40;
          li.append(preview);
        }
        li.append(label, remove);
        return li;
      }),
    );
    list.hidden = draftFiles.length === 0;
    const warning = $("attachment-vision-warning");
    const selected = lastView?.controls;
    warning.hidden = !draftFiles.some((f) => f.mimeType) || selected?.supportsImages === true;
    warning.textContent =
      selected?.supportsImages === false
        ? t("Ce modèle ne prend pas les images en charge.")
        : t("La prise en charge des images par ce modèle est inconnue.");
    send.disabled =
      !lastView ||
      lastView.busy ||
      !!lastView.readonly ||
      !!lastView.noProvider ||
      !!pendingFiles ||
      readingFiles ||
      (selected?.supportsImages === false && draftFiles.some((f) => f.mimeType));
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
      let total = draftFiles.filter((f) => !f.mimeType).reduce((sum, f) => sum + f.bytes, 0);
      let imageTotal = draftFiles.filter((f) => f.mimeType).reduce((sum, f) => sum + f.bytes, 0);
      for (const file of files) {
        const extensions = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        };
        const extension = file.name.toLowerCase().split(".").pop();
        const mimeType = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)
          ? file.type
          : !file.type || file.type === "application/octet-stream"
            ? extensions[extension]
            : undefined;
        if (mimeType) {
          imageTotal += file.size;
          if (file.size > 5 * 1024 * 1024 || imageTotal > 12 * 1024 * 1024)
            throw Error(t("Limite des images : 5 Mio par image et 12 Mio au total."));
          if (!file.name.trim() || file.name.length > 180 || /[\\/\p{Cc}\p{Cf}]/u.test(file.name))
            throw Error(t("Nom de fichier invalide."));
          const bytes = new Uint8Array(await file.arrayBuffer());
          const signature =
            mimeType === "image/png"
              ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
              : mimeType === "image/jpeg"
                ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                : mimeType === "image/gif"
                  ? ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))
                  : String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
                    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
          if (!signature) throw Error(t("La signature de l’image ne correspond pas à son format."));
          let binary = "";
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          added.push({
            id: ++fileSerial,
            name: file.name,
            mimeType,
            data: btoa(binary),
            bytes: file.size,
          });
          continue;
        }
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
              "Seuls les textes UTF-8 et les images PNG, JPEG, GIF ou WebP sont pris en charge. Les PDF et binaires sont refusés.",
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
          "Ces fichiers seront transmis au fournisseur. Seuls leurs noms apparaissent dans la conversation. N’ajoutez pas de secrets.",
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
  input.addEventListener("paste", (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = Array.from(clipboard.files || []);
    if (!files.length)
      for (const item of Array.from(clipboard.items || [])) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    if (files.length) addFiles(files);
  });
  $("research-next").addEventListener("click", () => {
    const button = $("research-next");
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
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
        attachments: draftFiles.map(({ name, text, mimeType, data }) =>
          mimeType ? { name, mimeType, data } : { name, text },
        ),
        requestId,
        conversation: lastView.conversation,
        research: $("research-next").getAttribute("aria-pressed") === "true",
      });
      $("research-next").setAttribute("aria-pressed", "false");
      return;
    }
    sent = sent.concat(text);
    recall = { index: -1, draft: "" };
    input.value = "";
    grow();
    vscode.postMessage({
      type: "send",
      text,
      research: $("research-next").getAttribute("aria-pressed") === "true",
    });
    $("research-next").setAttribute("aria-pressed", "false");
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
          mentionShown.map((item) => ({ disabled: !!item.disabled })),
        ).active;
        if (mentionActive < 0) mentionActive = 0;
        paintMention();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = mentionShown[mentionActive];
        if (item && !item.disabled) pickMention(item);
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
