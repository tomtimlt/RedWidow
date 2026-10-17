// Webview de chat (ADR 0004). Tout texte venant du modèle ou des outils est inséré par
// `textContent` / createTextNode (jamais de HTML) ; il a déjà été neutralisé côté extension.
// Le Markdown arrive déjà analysé en arbre (src/logic/markdown.ts) : ici on ne construit que
// des nœuds d'une liste blanche. Aucun appel réseau.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const approvals = $("approvals");
  const historyList = $("history-list");
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  // Logique pure (media/ui.js, chargé avant) : navigation clavier, placement, classes d'état.
  const UI = globalThis.JohnUI;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const EXAMPLES = [
    "Fais un nmap peu verbeux et résume les ports ouverts",
    "Parmi les services trouvés, lesquels valent un test en premier ?",
    "Cherche les pages qui prennent un paramètre et sentent l'injection",
  ];
  const STATUS = { pending: "en cours", ok: "réussi", error: "erreur", denied: "refusé" };
  const ICON = { pending: "◌", ok: "✓", error: "✕", denied: "⊘" };
  const DECISION = { allow: "Autorisé", deny: "Refusé" };

  // --- Markdown : arbre -> nœuds DOM (balises en liste blanche, texte par createTextNode) ---
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

  // --- Éléments du fil ---
  const openTools = new Set();
  // Dernier état vu de chaque outil : l'icône ne « se pose » (animation unique) qu'au changement d'état.
  const toolStatus = new Map();

  function renderTool(item) {
    const box = el("details", `tool ${item.status}`);
    box.open = openTools.has(item.toolUseId);
    box.addEventListener("toggle", () => {
      if (box.open) openTools.add(item.toolUseId);
      else openTools.delete(item.toolUseId);
    });
    const sum = el("summary");
    const icon = el("span", "icon", ICON[item.status] ?? "");
    icon.setAttribute("aria-hidden", "true");
    const before = toolStatus.get(item.toolUseId);
    if (before !== undefined && before !== item.status) icon.classList.add("settled");
    toolStatus.set(item.toolUseId, item.status);
    sum.append(icon, el("span", "tool-name", item.label));
    if (item.summary) sum.append(el("span", "tool-summary", item.summary));
    if (item.status === "denied") sum.append(el("span", "badge", DECISION.deny));
    else if (item.decision === "allow") sum.append(el("span", "badge", DECISION.allow));
    sum.append(el("span", "sr-only", ` (${STATUS[item.status] ?? item.status})`));
    box.append(sum);
    const body = el("div", "tool-body");
    body.append(el("div", "label", "Entrée"), el("pre", "", item.input));
    if (item.output) {
      body.append(
        el("div", "label", "Sortie"),
        el("pre", "", item.truncated ? `${item.output}\n[…tronqué]` : item.output),
      );
    }
    box.append(body);
    return box;
  }

  function copyButton(text) {
    const btn = el("button", "msg-copy", "Copier");
    btn.type = "button";
    btn.title = "Copier le message";
    btn.addEventListener("click", () => copy(text, btn));
    return btn;
  }

  function messageShell(kind, text, body) {
    const row = el("div", `msg-row ${kind}`);
    row.append(body, copyButton(text));
    return row;
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
        group.append(renderTool(item));
        continue;
      }
      group = null;
      if (item.kind === "user") {
        nodes.push(messageShell("user", item.text, el("div", "msg user", item.text)));
      } else if (item.kind === "agent") {
        const m = el("div", "msg agent");
        for (const b of item.blocks) m.append(renderBlock(b));
        nodes.push(messageShell("agent", item.text, m));
      } else {
        const n = el("div", `notice ${item.level}`, item.text);
        if (item.level === "error") n.setAttribute("role", "alert");
        nodes.push(n);
      }
    }
    return nodes;
  }

  function welcome(sandbox) {
    const box = el("div", "welcome");
    box.append(
      el("h2", "", "On commence par où ?"),
      el("p", "hint", "Décris la cible. Chaque action sensible demande ton accord."),
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

  // --- Cartes d'approbation ---
  const seenCards = new Set();

  function renderCard(card, isNew) {
    const box = el("div", isNew ? "card enter" : "card");
    box.tabIndex = -1;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `Demande d'autorisation : ${card.label}`);
    // En-tête : icône décorative (aria-hidden) et titre fixe.
    const head = el("div", "card-head");
    const icon = el("span", "card-icon", "!");
    icon.setAttribute("aria-hidden", "true");
    head.append(icon, el("div", "card-title", "Autorisation requise"));
    // Grille clé/valeur compacte : outil, résumé, raison. Aucune ligne d'environnement (donnée absente).
    const grid = el("div", "card-grid");
    const outil = el("div", "card-val", card.label);
    if (card.networkActive) outil.append(document.createTextNode(" · réseau activé"));
    grid.append(
      el("span", "card-key", "Outil"),
      outil,
      el("span", "card-key", "Action"),
      el("code", "card-summary", card.summary || card.tool),
      el("span", "card-key", "Raison"),
      el("div", "card-val card-reason", card.reason),
    );
    const det = el("details", "card-details");
    det.append(el("summary", "", "Détails"), el("pre", "", card.detail));
    box.append(head, grid, det);
    const row = el("div", "card-buttons");
    const buttons = {};
    const button = (label, choice, css) => {
      const b = el("button", css, label);
      b.type = "button";
      b.addEventListener("click", () => {
        row.replaceChildren(el("span", "badge", choice === "deny" ? "Refusé" : "Autorisé"));
        vscode.postMessage({ type: "approve", toolUseId: card.toolUseId, choice });
      });
      buttons[choice] = b;
      row.append(b);
    };
    button("Autoriser une fois", "once", "primary");
    button("Refuser", "deny", "danger");
    // « Toujours » seulement si mémorisable ; la modale native le confirme côté extension.
    if (card.canRemember) button("Toujours", "always", "link");
    box.append(row);
    // Échap sur la carte (pas dans un champ) : refuser.
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && e.target === box) {
        e.preventDefault();
        buttons.deny.click();
      }
    });
    return box;
  }

  // --- Modèle, Configurer : tout est revalidé par l'extension, ici on ne fait qu'afficher ---
  const ctlGroup = $("ctl-group");
  const modelChip = $("model-chip");
  const cfgBtn = $("cfg-btn");
  const modelPop = $("model-pop");
  const cfgPop = $("cfg-pop");
  const modelFilter = $("model-filter");
  const modelList = $("model-list");
  const modelInput = $("model-input");
  const effortInput = $("effort");
  const ticks = $("effort-ticks");
  const sweep = document.querySelector(".sweep");
  let ctl = null;
  let levels = [];
  let lastModel;
  let flip = false;
  let query = "";
  let active = -1;
  let visible = [];
  let optNodes = [];

  /** Rejoue les effets de changement de modèle (E2, E3) : on alterne deux classes, sans reflow forcé. */
  function modelFx() {
    flip = !flip;
    for (const [node, base] of [
      [sweep, "sweep"],
      [modelChip, "pop"],
    ]) {
      node.classList.remove(`${base}-${flip ? "b" : "a"}`);
      node.classList.add(`${base}-${flip ? "a" : "b"}`);
    }
  }

  // Placement d'un popover : mesures seulement à l'ouverture et pendant qu'il est ouvert.
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
        height: document.documentElement.clientHeight,
      },
    );
    pop.style.setProperty("--jn-x", `${p.x}px`);
    pop.style.setProperty("--jn-y", `${p.y}px`);
    pop.style.setProperty("--jn-maxh", `${p.maxHeight}px`);
    pop.classList.add("placed");
  }

  /** Popover natif (light dismiss, Échap) : ouverture refusée si la pastille est verrouillée ; focus rendu à la fermeture. */
  function wirePop(pop, chip, { render, focus }) {
    pop.addEventListener("beforetoggle", (e) => {
      if (e.newState === "open" && chip.getAttribute("aria-disabled") === "true")
        e.preventDefault();
    });
    pop.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      chip.setAttribute("aria-expanded", String(open));
      if (open) {
        render();
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
    // Piège de focus : Tab et Maj+Tab cyclent dans le popover.
    pop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [...pop.querySelectorAll("button, input")].filter(
        (n) => !n.disabled && !n.hidden && !n.closest("[hidden]"),
      );
      const t = UI.tabTarget(items.length, items.indexOf(document.activeElement), e.shiftKey);
      if (t >= 0) {
        e.preventDefault();
        items[t].focus();
      }
    });
  }

  // Liste des modèles : listbox ARIA avec filtre (aria-activedescendant, le focus reste dans le champ).
  const modelEntries = () => [
    {
      value: null,
      label: "Modèle par défaut",
      description: "Réglage john.model, sinon le modèle du binaire.",
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
    visible = UI.filterModels(modelEntries(), query);
    optNodes = [];
    const nodes = [];
    let group = null;
    let kind = null;
    visible.forEach((m, i) => {
      const k = m.value === null ? "def" : "mod";
      if (k !== kind) {
        kind = k;
        group = el("div", "grp");
        group.setAttribute("role", "group");
        const name = k === "def" ? "Par défaut" : "Modèles disponibles";
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
      if (m.description) o.title = m.description;
      o.append(el("span", "opt-label", m.label));
      if (current) o.append(el("span", "badge", "actuel"));
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
            ? "Chargement de la liste…"
            : "Aucun modèle ne correspond.",
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
    ctl = c;
    if (!c) {
      for (const p of [modelPop, cfgPop]) if (p.matches(":popover-open")) p.hidePopover();
      return;
    }
    modelChip.setAttribute("aria-disabled", String(c.locked));
    const known = c.models?.find((m) => m.value === c.model);
    const name = c.model === null ? "Modèle par défaut" : (known?.label ?? c.model);
    $("model-chip-label").textContent = name;
    modelChip.title = `Modèle : ${name} (utilisé pour le message suivant)`;
    if (UI.shouldSweep(lastModel, c.model)) modelFx();
    lastModel = c.model;

    const free = c.models === null;
    modelFilter.hidden = modelList.hidden = free;
    modelInput.hidden = !free;
    modelInput.disabled = c.locked;
    $("models-refresh").disabled = c.locked || c.modelsStatus === "loading";
    $("models-refresh").textContent =
      c.modelsStatus === "loading" ? "Chargement…" : "Actualiser la liste";
    if (free) {
      if (document.activeElement !== modelInput) modelInput.value = c.model ?? "";
    } else if (modelPop.matches(":popover-open")) renderModelList(false);

    levels = c.levels;
    const auto = c.effort === null;
    $("effort-auto").hidden = auto;
    $("effort-auto").disabled = c.locked;
    effortInput.classList.toggle("auto", auto);
    effortInput.max = String(Math.max(levels.length - 1, 0));
    const idx = auto
      ? Math.floor(levels.length / 2)
      : Math.max(
          levels.findIndex((l) => l.value === c.effort),
          0,
        );
    effortInput.value = String(idx);
    const scale = $("effort-scale");
    scale.style.setProperty("--jn-n", String(Math.max(levels.length, 1)));
    scale.style.setProperty("--jn-i", String(idx));
    scale.classList.toggle("auto", auto);
    effortInput.disabled = c.locked || c.effortDisabled;
    effortInput.title = c.effortDisabled ? "Ce modèle n'a pas d'effort réglable." : c.effortTip;
    effortInput.setAttribute("aria-valuetext", `${c.effortLabel} : ${c.effortTip}`);
    $("effort-label").textContent = c.effortLabel;
    $("effort-tip").textContent = c.effortDisabled
      ? "Ce modèle n'a pas d'effort réglable."
      : c.effortTip;
    $("cfg-level").textContent = c.effortLabel;
    cfgBtn.title = `Configurer : effort ${c.effortLabel}`;
    ticks.replaceChildren(
      ...levels.map((l) => {
        const t = el("span", l.value === c.effort ? "on" : l.enabled ? "" : "off", l.label);
        if (!l.enabled) t.title = "Non pris en charge par ce modèle";
        else
          t.addEventListener("click", () => {
            if (ctl && !ctl.locked && !ctl.effortDisabled)
              vscode.postMessage({ type: "setEffort", effort: l.value });
          });
        return t;
      }),
    );
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
  // --- Bypass des approbations (ADR 0006, lot B1) : l'affichage ne reflète que le dernier message `bypass`.
  // Aucune écriture hors de renderBypass (appelée par le gestionnaire `message` et à l'ouverture de Configurer).
  const bypassSwitch = $("bypass-switch");
  const bypassState = $("bypass-state");
  const bypassBadge = $("bypass-badge");
  /** Dernier message reçu, le précédent, et le drapeau « off ou reset demandé » qui l'a précédé. */
  let bypassCtx = { push: null, previous: null, userOff: false };
  /** Demande d'arrêt faite depuis la webview, consommée par le message `bypass` suivant. */
  let bypassUserOff = false;

  function renderBypass() {
    const v = UI.bypassView(bypassCtx.push, bypassCtx.previous, bypassCtx.userOff, Date.now());
    bypassSwitch.setAttribute("aria-checked", String(v.checked));
    bypassState.textContent = v.text;
    document.body.classList.toggle("bypass-on", v.state === "on");
    bypassBadge.hidden = v.badge === null;
    if (v.badge) {
      bypassBadge.replaceChildren(
        el("span", "bp-word", v.badge.word),
        el("span", "bp-time", ` · ${v.badge.time}`),
      );
      bypassBadge.title = `Bypass actif jusqu'à ${v.until} : désactivable dans Configurer ou la barre d'état`;
    } else bypassBadge.replaceChildren();
  }

  // Le clic n'écrit rien dans le DOM : il envoie le booléen calculé sur le dernier message reçu.
  bypassSwitch.addEventListener("click", () => {
    const last = bypassCtx.push;
    const enabled = !(last?.on === true || last?.armed === true);
    if (!enabled) bypassUserOff = true;
    vscode.postMessage({ type: "setBypass", enabled });
  });

  /** Envoi de `reset` : mémorisé pour que l'avis de retombée ne prétende aucune cause. */
  function resetConversation() {
    bypassUserOff = true;
    vscode.postMessage({ type: "reset" });
  }

  wirePop(cfgPop, cfgBtn, {
    render() {
      renderBypass();
    },
    focus() {
      [...cfgPop.querySelectorAll("input, button")].find((n) => !n.disabled && !n.hidden)?.focus();
    },
  });

  // Menu « / » : seulement /clear. /start reste reconnu à la saisie, absent du menu.
  const slashPop = $("slash-pop");
  const slashBtn = $("slash-btn");
  const mentionBtn = $("mention-btn");
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
  // Menu « @ » (conteneurs) et « # » (terminaux ouverts). Un seul popover, le sigil au curseur décide.
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
    mentionBtn.setAttribute("aria-expanded", String(e.newState === "open"));
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
            desc: item.hint ? `$ ${item.hint}` : "terminal ouvert",
          }))
        : UI.filterContainers(containers, span.query).map((item) => ({
            name: item.name,
            desc: item.state === "running" ? "en cours" : "arrêté",
          }));
    if (mentionActive >= mentionShown.length) mentionActive = 0;
    mentionEmpty.hidden = mentionShown.length > 0;
    mentionEmpty.textContent = hash
      ? "Aucun terminal John ouvert. Alt+J T ou /start <conteneur> pour en ouvrir un."
      : "Aucun conteneur";
    mentionPop.setAttribute("aria-label", hash ? "Terminaux" : "Conteneurs");
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
    // Menu « # » : liste fraîche (dernière commande de chaque terminal), au plus une demande par seconde.
    const cursor = input.selectionStart ?? input.value.length;
    if (UI.hashSpan(input.value, cursor) && Date.now() - lastTerminalsAsk > 1000) {
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
  mentionBtn.addEventListener("click", () => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (!UI.mentionSpan(input.value, start)) input.setRangeText("@", start, end, "end");
    grow();
    input.focus();
    openMention();
  });

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
  $("effort-auto").addEventListener("click", () =>
    vscode.postMessage({ type: "setEffort", effort: null }),
  );
  effortInput.addEventListener("change", () => {
    const level = levels[Number(effortInput.value)];
    if (level) vscode.postMessage({ type: "setEffort", effort: level.value });
  });

  // --- Historique : liste des conversations (chaînes déjà neutralisées par l'extension) ---
  const historyPanel = $("history");
  const historyBtn = $("history-btn");
  let renaming = null;
  // Vrai si la conversation courante tourne (badge « en cours » seulement dans ce cas).
  let historyRunning = false;

  function renderHistory(entries) {
    $("history-clear").disabled = entries.length === 0;
    if (entries.length === 0) {
      historyList.replaceChildren(el("li", "hist-empty", "Aucune conversation enregistrée."));
      return;
    }
    historyList.replaceChildren(
      ...entries.map((h) => {
        const li = el("li", h.current ? "hist current" : "hist");
        const when = new Date(h.updatedAt).toLocaleString();
        const meta = `${when} · ${h.tools} outil${h.tools > 1 ? "s" : ""} · ${h.provider} · ${h.model}`;
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
              renderHistory(entries);
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
          renderHistory(entries);
        });
        const del = el("button", "link", "Supprimer");
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
    let text = `Lecture seule : ${info.title}`;
    if (info.invalid > 0) text += ` · ${info.invalid} ligne(s) du journal ignorée(s)`;
    if (info.truncated) text += " · journal tronqué";
    $("readonly-text").textContent = text;
    $("readonly-resume").textContent = info.canResume
      ? "Reprendre"
      : "Reprendre (nouvelle session)";
  }

  // Historique : tiroir à gauche. Fermeture par ✕, Échap, clic sur le voile ou choix d'une conversation.
  function setHistoryOpen(open) {
    historyPanel.hidden = !open;
    historyBtn.setAttribute("aria-expanded", String(open));
    if (open) $("history-close").focus();
    else if (historyPanel.contains(document.activeElement)) historyBtn.focus();
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

  // --- Monitor (lecture seule) : lignes pures de ui.js (monitorRows), texte en textContent ---
  const monitorRowsEl = $("monitor-rows");
  const monitorEmpty = $("monitor-empty");

  let watchId = "";

  function monitorLine(row) {
    const li = el("li", `mon-row tone-${row.tone}`);
    const cmd = el("div", "mon-cmd");
    if (row.container !== "") cmd.append(el("span", "prompt", row.container));
    cmd.append(el("span", "prompt", "$"), el("code", "mon-text", row.command));
    const meta = el("div", "mon-meta");
    meta.append(el("span", "badge", row.status));
    li.append(cmd, meta);
    if (row.output !== "") li.append(el("pre", "mon-out", row.output));
    if (row.truncated) li.append(el("p", "note", "sortie tronquée"));
    if (mode === "monitor" && row.toolUseId) {
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.title = "Suivre la sortie";
      const open = () => vscode.postMessage({ type: "watch", toolUseId: row.toolUseId });
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open();
      });
    }
    return li;
  }

  function renderMonitor(view) {
    let rows = UI.monitorRows(view);
    if (mode === "watch") rows = rows.filter((row) => row.toolUseId === watchId);
    monitorRowsEl.replaceChildren(...rows.map(monitorLine));
    monitorEmpty.hidden = rows.length > 0;
    if (mode === "watch") {
      const box = monitorRowsEl.querySelector(".mon-out");
      if (box) box.scrollTop = box.scrollHeight;
    }
  }

  // Monitor : panneau éditeur seul. Le chat rend toujours ses propres cartes.
  let mode = "conversation";

  // Classes de body (running, waiting, paused, readonly, reduce-motion) : les effets CSS n'en dépendent que par elles.
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
  }
  // La vue a retainContextWhenHidden : on fige les animations quand elle est cachée.
  document.addEventListener("visibilitychange", applyBody);
  motion.addEventListener("change", applyBody);

  // Rappel des consignes (comme un terminal) : index -1 = brouillon.
  let recall = { index: -1, draft: "" };
  let sent = [];
  let shownNodes = -1;
  function render(view) {
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
    if (mode === "monitor" || mode === "watch") renderMonitor(view);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const top = log.scrollTop;
    const nodes = view.items.length === 0 ? [welcome(view.sandbox)] : renderItems(view.items);
    // Entrée animée des seuls nœuds ajoutés depuis le rendu précédent (pas au chargement d'un historique).
    const added = nodes.length - shownNodes;
    if (shownNodes >= 0 && added > 0 && added <= 3) {
      for (const n of nodes.slice(shownNodes)) n.classList.add("enter");
    }
    shownNodes = view.items.length === 0 ? 0 : nodes.length;
    log.replaceChildren(...nodes);
    const visible = mode === "monitor" || !Array.isArray(view.approvals) ? [] : view.approvals;
    const cards = visible.map((c) => renderCard(c, !seenCards.has(c.toolUseId)));
    approvals.replaceChildren(...cards);
    const fresh = visible.findIndex((c) => !seenCards.has(c.toolUseId));
    seenCards.clear();
    for (const c of visible) seenCards.add(c.toolUseId);
    if (fresh >= 0) cards[fresh]?.focus();
    const sb = $("sandbox");
    if (view.sandbox) {
      sb.textContent =
        view.sandboxNetwork === "bridge"
          ? `Bac à sable : ${view.sandbox} · réseau activé`
          : `Bac à sable : ${view.sandbox}`;
    } else sb.textContent = "";
    sb.hidden = !view.sandbox;
    // Bordure orange du composer tant qu'une demande d'autorisation attend la réponse.
    document.body.classList.toggle("awaiting", approvals.childElementCount > 0);
    send.disabled = view.busy || !!view.readonly;
    input.disabled = !!view.readonly;
    mentionBtn.disabled = input.disabled;
    stop.disabled = !view.busy;
    lastView = view;
    applyBody();
    if (view.busy) $("thinking-label").textContent = UI.activityLabel(view);
    if (view.items.length === 0) toolStatus.clear();
    log.setAttribute("aria-busy", view.busy ? "true" : "false");
    log.scrollTop = atBottom ? log.scrollHeight : top;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "view") render(message.view);
    else if (message && message.type === "role" && message.role === "monitor") {
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
    } else if (message && message.type === "title" && typeof message.text === "string") {
      $("title").textContent = message.text.slice(0, 120);
    } else if (message && message.type === "containers") {
      containers = UI.safeContainers(message.items);
      if (mentionOpen()) renderMentions();
    } else if (message && message.type === "terminals") {
      terminals = UI.safeTerminals(message.items);
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
        { index: recall.index, draft: recall.draft, entries: sent, current: input.value },
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
