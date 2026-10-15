// Webview de chat (ADR 0004). Tout texte venant du modèle ou des outils est inséré par
// `textContent` / createTextNode (jamais de HTML) ; il a déjà été neutralisé côté extension.
// Le Markdown arrive déjà analysé en arbre (src/logic/markdown.ts) : ici on ne construit que
// des nœuds d'une liste blanche. Aucun appel réseau.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const approvals = $("approvals");
  const input = $("input");
  const send = $("send");
  const stop = $("stop");
  const activity = $("activity");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const EXAMPLES = [
    "Liste les fichiers du projet et explique son organisation",
    "Trouve les TODO dans le code et résume-les",
    "Lis le README et propose des améliorations",
  ];
  const STATUS = { pending: "en cours", ok: "réussi", error: "erreur", denied: "refusé" };
  const ICON = { pending: "", ok: "✓", error: "✕", denied: "⊘" };
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
        nodes.push(el("div", "msg user", item.text));
      } else if (item.kind === "agent") {
        const m = el("div", "msg agent");
        for (const b of item.blocks) m.append(renderBlock(b));
        nodes.push(m);
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
      el("h2", "", "Que puis-je faire pour vous ?"),
      el(
        "p",
        "hint",
        "Décrivez une tâche sur votre projet. Chaque action sensible demande votre accord.",
      ),
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

  function renderCard(card) {
    const box = el("div", "card");
    box.tabIndex = -1;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `Demande d'autorisation : ${card.label}`);
    const head = el("div", "card-title");
    head.append(el("span", "", `${card.label} : `), el("strong", "", card.summary || card.tool));
    box.append(head, el("div", "card-reason", card.reason));
    const det = el("details", "card-details");
    det.append(el("summary", "", "Détails"), el("pre", "", card.detail));
    box.append(det);
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
    button("Refuser", "deny", "");
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

  // --- Sélecteurs de modèle et d'effort : tout est revalidé par l'extension, ici on ne fait qu'afficher ---
  const controls = $("controls");
  const modelSelect = $("model-select");
  const modelInput = $("model-input");
  const effortInput = $("effort");
  const effortLabel = $("effort-label");
  const ticks = $("effort-ticks");
  let levels = [];

  function renderControls(c) {
    controls.hidden = !c;
    if (!c) return;
    controls.classList.toggle("locked", c.locked);
    const list = c.models !== null;
    modelSelect.hidden = !list;
    modelInput.hidden = list;
    modelSelect.disabled = modelInput.disabled = c.locked;
    $("models-refresh").disabled = c.locked || c.modelsStatus === "loading";
    $("models-refresh").textContent = c.modelsStatus === "loading" ? "Chargement…" : "Actualiser";
    if (list) {
      const opts = [el("option", "", "Modèle par défaut")];
      opts[0].value = "";
      for (const m of c.models) {
        const o = el("option", "", m.label);
        o.value = m.value;
        o.title = m.description;
        opts.push(o);
      }
      modelSelect.replaceChildren(...opts);
      modelSelect.value = c.model ?? "";
    } else if (document.activeElement !== modelInput) {
      modelInput.value = c.model ?? "";
    }
    levels = c.levels;
    effortInput.max = String(Math.max(levels.length - 1, 0));
    effortInput.value = String(levels.findIndex((l) => l.value === c.effort));
    effortInput.disabled = c.locked || c.effortDisabled;
    effortInput.title = c.effortDisabled ? "Ce modèle n'a pas d'effort réglable." : c.effortTip;
    effortInput.setAttribute("aria-valuetext", `${c.effortLabel} : ${c.effortTip}`);
    effortLabel.textContent = c.effortLabel;
    ticks.replaceChildren(
      ...levels.map((l) => {
        const t = el("span", l.value === c.effort ? "on" : l.enabled ? "" : "off", l.label);
        if (!l.enabled) t.title = "Non pris en charge par ce modèle";
        return t;
      }),
    );
  }

  modelSelect.addEventListener("change", () =>
    vscode.postMessage({
      type: "setModel",
      model: modelSelect.value === "" ? null : modelSelect.value,
    }),
  );
  modelInput.addEventListener("change", () => {
    const v = modelInput.value.trim();
    vscode.postMessage({ type: "setModel", model: v === "" ? null : v });
  });
  $("models-refresh").addEventListener("click", () =>
    vscode.postMessage({ type: "refreshModels" }),
  );
  effortInput.addEventListener("change", () => {
    const level = levels[Number(effortInput.value)];
    if (level) vscode.postMessage({ type: "setEffort", effort: level.value });
  });

  function render(view) {
    renderControls(view.controls);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const top = log.scrollTop;
    log.replaceChildren(
      ...(view.items.length === 0 ? [welcome(view.sandbox)] : renderItems(view.items)),
    );
    const cards = view.approvals.map(renderCard);
    approvals.replaceChildren(...cards);
    const fresh = view.approvals.findIndex((c) => !seenCards.has(c.toolUseId));
    seenCards.clear();
    for (const c of view.approvals) seenCards.add(c.toolUseId);
    if (fresh >= 0) cards[fresh]?.focus();
    const sb = $("sandbox");
    sb.textContent = view.sandbox ? `Bac à sable : ${view.sandbox}` : "";
    sb.hidden = !view.sandbox;
    send.disabled = view.busy;
    stop.disabled = !view.busy;
    activity.hidden = !view.busy;
    log.setAttribute("aria-busy", view.busy ? "true" : "false");
    log.scrollTop = atBottom ? log.scrollHeight : top;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "view") render(message.view);
  });

  function grow() {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }
  function submit() {
    const text = input.value;
    if (text.trim() === "" || send.disabled) return;
    input.value = "";
    grow();
    vscode.postMessage({ type: "send", text });
  }
  input.addEventListener("input", grow);
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  $("reset").addEventListener("click", () => vscode.postMessage({ type: "reset" }));
  vscode.postMessage({ type: "ready" });
})();
