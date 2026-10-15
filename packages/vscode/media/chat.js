// Webview de chat (ADR 0004). Tout texte venant du modèle ou des outils est inséré par
// `textContent` (jamais de HTML) ; il a déjà été neutralisé côté extension. Aucun appel réseau.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const approvals = $("approvals");
  const input = $("input");
  const send = $("send");
  const stop = $("stop");

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const STATUS = { pending: "en cours", ok: "terminé", error: "erreur", denied: "refusé" };

  function renderItem(item) {
    if (item.kind === "tool") {
      const box = el("details", `item tool ${item.status}`);
      box.append(el("summary", "", `${item.tool} · ${STATUS[item.status] ?? item.status}`));
      box.append(el("pre", "input", item.input));
      if (item.output) {
        box.append(
          el("pre", "output", item.truncated ? `${item.output}\n[…tronqué]` : item.output),
        );
      }
      return box;
    }
    const css = item.kind === "notice" ? `item notice ${item.level}` : `item ${item.kind}`;
    return el("div", css, item.text);
  }

  function renderCard(card) {
    const box = el("div", "card");
    box.append(el("div", "card-title", `Autoriser l'outil « ${card.tool} » ?`));
    box.append(el("pre", "card-detail", card.detail));
    box.append(el("div", "card-reason", card.reason));
    const row = el("div", "card-buttons");
    const button = (label, choice, css) => {
      const b = el("button", css, label);
      b.type = "button";
      b.addEventListener("click", () => {
        for (const other of row.querySelectorAll("button")) other.disabled = true;
        vscode.postMessage({ type: "approve", toolUseId: card.toolUseId, choice });
      });
      row.append(b);
    };
    button("Autoriser une fois", "once", "primary");
    if (card.canRemember) button("Toujours", "always", "");
    button("Refuser", "deny", "danger");
    box.append(row);
    return box;
  }

  function render(view) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...view.items.map(renderItem));
    approvals.replaceChildren(...view.approvals.map(renderCard));
    $("sandbox").textContent = view.sandbox ? `Bac à sable : ${view.sandbox}` : "";
    send.disabled = view.busy;
    stop.disabled = !view.busy;
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "view") render(message.view);
  });

  function submit() {
    const text = input.value;
    if (text.trim() === "" || send.disabled) return;
    input.value = "";
    vscode.postMessage({ type: "send", text });
  }
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  $("reset").addEventListener("click", () => vscode.postMessage({ type: "reset" }));
  vscode.postMessage({ type: "ready" });
})();
