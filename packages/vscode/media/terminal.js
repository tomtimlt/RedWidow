// Terminal latéral Exegol (design-exegol-ui.md §4 P3). Donnée : la même vue que le chat, reçue par
// `postMessage`. Texte en `textContent` seulement, aucun HTML dynamique, aucune ressource distante.
// Les fonctions pures sont publiées sur globalThis (testées par vitest, comme ui.js) ; le DOM n'est
// câblé que dans une webview (`acquireVsCodeApi` présent).
((root) => {
  /** Nom de l'outil d'exec Exegol dans la vue du chat (`EXEGOL_EXEC_TOOL` du cœur, vérifié par test). */
  const EXEC_TOOL = "mcp__exegol__exec";
  /** Plafond de lignes dans le DOM : au-delà, les plus anciennes sont retirées. */
  const MAX_LINES = 200;

  /** Plus grand identifiant d'élément de la vue (0 si aucun). */
  function maxId(items) {
    let max = 0;
    for (const it of items) if (it && typeof it.id === "number" && it.id > max) max = it.id;
    return max;
  }

  /** Éléments de la vue, tolérant à une vue incomplète. */
  function itemsOf(view) {
    return view && Array.isArray(view.items) ? view.items : [];
  }

  /**
   * Appels d'exec Exegol au-delà de `floor` (identifiant masqué par « Effacer »), les plus récents
   * seulement : au plus `max` éléments, dans l'ordre d'arrivée.
   */
  function execEntries(items, floor = 0, max = MAX_LINES) {
    const out = [];
    for (const it of items) {
      if (it && it.kind === "tool" && it.tool === EXEC_TOOL && it.id > floor) out.push(it);
    }
    return out.slice(-max);
  }

  /** Statut lisible et tonalité, d'après ce que porte la vue (aucun statut inventé). */
  function execStatus(item) {
    if (item.status === "denied" || item.decision === "deny")
      return { label: "refusé", tone: "err" };
    if (item.status === "error") return { label: "erreur", tone: "err" };
    if (item.status === "ok" || item.decision === "allow") return { label: "approuvé", tone: "ok" };
    return { label: "en attente", tone: "wait" };
  }

  /** Argument affiché tel quel, entre guillemets s'il contient un espace ou est vide. */
  const shellArg = (arg) => (/^[^\s"']+$/.test(arg) ? arg : JSON.stringify(arg));

  /**
   * Commande et conteneur d'un appel d'exec. L'entrée de la vue est un JSON (`{container, argv}`) ;
   * si elle est tronquée ou d'une autre forme, elle est affichée telle quelle.
   */
  function entryModel(item) {
    const raw = typeof item.input === "string" ? item.input : "";
    let container = "";
    let command = raw;
    try {
      const v = JSON.parse(raw);
      if (
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        Array.isArray(v.argv) &&
        v.argv.every((a) => typeof a === "string")
      ) {
        container = typeof v.container === "string" ? v.container : "";
        command = v.argv.map(shellArg).join(" ");
      }
    } catch {
      // Entrée tronquée par le plafond de description : affichée telle quelle.
    }
    return {
      container,
      command,
      output: typeof item.output === "string" ? item.output : "",
      truncated: item.truncated === true,
      ...execStatus(item),
    };
  }

  const api = { EXEC_TOOL, MAX_LINES, maxId, itemsOf, execEntries, execStatus, entryModel };
  root.JohnTerminal = api;

  if (typeof document === "undefined" || typeof acquireVsCodeApi !== "function") return;

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const out = $("out");
  const empty = $("empty");
  const containerEl = $("container");
  const clearBtn = $("clear");
  const openBtn = $("open-shell");
  const tabBtns = { agent: $("tab-agent"), shell: $("tab-shell") };
  const panels = { agent: $("panel-agent"), shell: $("panel-shell") };

  /** Dernière vue reçue, et identifiant sous lequel les éléments sont masqués (« Effacer »). */
  let lastView = null;
  let clearedBelow = 0;
  let container = null;

  function line(item) {
    const m = entryModel(item);
    const li = el("li", `line tone-${m.tone}`);
    const head = el("div", "cmd");
    if (m.container !== "") head.append(el("span", "prompt", m.container));
    head.append(el("span", "prompt", "$"), el("span", "cmd-text", m.command));
    head.append(el("span", "st", m.label));
    li.append(head);
    if (m.output !== "") li.append(el("pre", "out", m.output));
    if (m.truncated) li.append(el("p", "note", "sortie tronquée"));
    return li;
  }

  function render() {
    const items = itemsOf(lastView);
    if (maxId(items) < clearedBelow) clearedBelow = 0;
    const entries = execEntries(items, clearedBelow, MAX_LINES);
    out.replaceChildren(...entries.map(line));
    empty.hidden = entries.length > 0;
  }

  function setContainer(name) {
    container = typeof name === "string" && name !== "" ? name : null;
    containerEl.hidden = container === null;
    containerEl.textContent = container ?? "";
    openBtn.disabled = container === null;
    openBtn.setAttribute("aria-disabled", String(container === null));
  }

  function showTab(name) {
    for (const key of Object.keys(tabBtns)) {
      tabBtns[key].setAttribute("aria-selected", String(key === name));
      panels[key].hidden = key !== name;
    }
  }

  clearBtn.addEventListener("click", () => {
    clearedBelow = maxId(itemsOf(lastView));
    render();
  });
  openBtn.addEventListener("click", () => {
    if (container !== null) vscode.postMessage({ type: "openShell" });
  });
  tabBtns.agent.addEventListener("click", () => showTab("agent"));
  tabBtns.shell.addEventListener("click", () => showTab("shell"));

  window.addEventListener("message", (event) => {
    const m = event.data;
    if (m === null || typeof m !== "object") return;
    if (m.type === "view" && m.view !== null && typeof m.view === "object") {
      lastView = m.view;
      render();
    } else if (m.type === "context") {
      setContainer(m.container);
    }
  });

  setContainer(null);
  showTab("agent");
  render();
})(globalThis);
