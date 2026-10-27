// Logique pure de l'interface du chat (aucun accès au DOM) : testée par vitest, chargée avant
// chat.js par un second <script nonce src> (design-chat-ui.md §5). Aucune dépendance.
((root) => {
  const enabled = (options, i) => i >= 0 && i < options.length && !options[i].disabled;

  /** Nom de l'outil d'exec Exegol (miroir de `EXEGOL_EXEC_TOOL`, vérifié par test). */
  const EXEC_TOOL = "mcp__exegol__exec";
  const KALI_PREFIX = "mcp__kali__";
  const MONITOR_MAX_ROWS = 300; // Même fenêtre que ChatState : aucune commande masquée dans une page.

  /** Famille visuelle d'un outil, sans interpréter son entrée ni sa sortie. */
  function toolIcon(tool) {
    if (typeof tool !== "string") return "tool";
    if (
      tool === EXEC_TOOL ||
      tool === "Bash" ||
      tool.startsWith(KALI_PREFIX) ||
      /^mcp__exegol__task_/.test(tool)
    )
      return "terminal";
    if (["Grep", "Glob", "WebSearch"].includes(tool)) return "search";
    if (["Read", "Write", "Edit", "MultiEdit"].includes(tool)) return "file";
    return "tool";
  }

  /** Badge d'une ligne d'historique : « en cours » seulement pour la conversation courante si elle tourne. */
  function historyBadge(entry, running) {
    if (!entry?.current) return null;
    return running ? "en cours" : "actuelle";
  }

  /** Éléments de la vue, tolérant à une vue incomplète. */
  const itemsOf = (view) => (view && Array.isArray(view.items) ? view.items : []);

  /** Statut lisible et tonalité d'un appel d'exec, d'après ce que porte la vue. */
  function execState(item) {
    if (item.status === "denied" || item.decision === "deny")
      return { status: "refusé", tone: "err" };
    if (item.status === "error") return { status: "erreur", tone: "err" };
    if (item.status === "ok" || item.decision === "allow")
      return { status: "approuvé", tone: "ok" };
    return { status: "en attente", tone: "wait" };
  }

  /** Argument de commande : tel quel, entre guillemets s'il contient un espace ou est vide. */
  const shellArg = (arg) => (/^[^\s"']+$/.test(arg) ? arg : JSON.stringify(arg));

  /**
   * Conteneur et commande. Exec Exegol : argv joint. Autre objet : le JSON stocké sans
   * `container`. Texte non JSON : affiché tel quel, conteneur vide.
   */
  function execCommand(raw) {
    try {
      const v = JSON.parse(raw);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const container = typeof v.container === "string" ? v.container : "";
        if (Array.isArray(v.argv) && v.argv.every((a) => typeof a === "string")) {
          return { container, command: v.argv.map(shellArg).join(" ") };
        }
        const rest = { ...v };
        delete rest.container;
        return { container, command: JSON.stringify(rest) };
      }
    } catch {
      // Entrée tronquée par le plafond de description : affichée telle quelle.
    }
    return { container: "", command: raw };
  }

  /**
   * Lignes du Monitor : un exec Exegol ou un outil Kali par ligne, les plus récents seulement. Méta limitée à
   * ce que la vue porte (statut ; ni durée ni volumétrie). `pending` : une autorisation attend, à
   * donner dans le chat.
   */
  function monitorRows(view) {
    const pending = new Set(
      view && Array.isArray(view.approvals) ? view.approvals.map((a) => a.toolUseId) : [],
    );
    const rows = itemsOf(view)
      .filter(
        (it) =>
          it &&
          it.kind === "tool" &&
          (it.tool === EXEC_TOOL ||
            (typeof it.tool === "string" && it.tool.startsWith(KALI_PREFIX))),
      )
      .map((it) => {
        const raw = typeof it.input === "string" ? it.input : "";
        const { container, command } = execCommand(raw);
        return {
          id: it.id,
          toolUseId: typeof it.toolUseId === "string" ? it.toolUseId : "",
          container,
          command,
          output: typeof it.output === "string" ? it.output : "",
          truncated: it.truncated === true,
          pending: pending.has(it.toolUseId),
          ...execState(it),
        };
      });
    return rows.slice(-MONITOR_MAX_ROWS);
  }

  /**
   * Navigation clavier d'une listbox. `state.active` : indice actif (-1 = aucun) ; `options` :
   * `[{ disabled? }]`. Les options désactivées sont sautées, la navigation boucle ; liste vide ou
   * entièrement désactivée : `active = -1`. Les autres touches laissent l'état inchangé.
   */
  function listboxKey(state, key, options) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < options.length; i++) {
      if (options[i].disabled) continue;
      if (first === -1) first = i;
      last = i;
    }
    if (first === -1) return { active: -1 };
    const cur = enabled(options, state.active) ? state.active : -1;
    if (key === "Home") return { active: first };
    if (key === "End") return { active: last };
    if (key === "ArrowDown" || key === "ArrowUp") {
      const step = key === "ArrowDown" ? 1 : -1;
      let i = cur === -1 ? (step === 1 ? -1 : options.length) : cur;
      for (let n = 0; n < options.length; n++) {
        i = (i + step + options.length) % options.length;
        if (enabled(options, i)) return { active: i };
      }
    }
    return { active: cur };
  }

  /** Filtre par sous-chaîne insensible à la casse (jamais de RegExp construite depuis la saisie). */
  function filterModels(models, query) {
    const q = String(query ?? "")
      .trim()
      .toLowerCase();
    if (q === "") return models.slice();
    return models.filter((m) =>
      [m.label, m.value, m.description, m.providerLabel, m.free ? "gratuit free" : ""].some(
        (s) => typeof s === "string" && s.toLowerCase().includes(q),
      ),
    );
  }

  /** Origine = préfixe runtime de l’identifiant, jamais déduite du nom commercial. */
  function groupModels(models, fallbackProvider) {
    const names = new Map([
      ["openai", "OpenAI"],
      ["opencode", "OpenCode"],
      ["anthropic", "Anthropic"],
      ["claude", "Claude"],
      ["google", "Google"],
      ["openrouter", "OpenRouter"],
    ]);
    const groups = new Map();
    for (const model of models) {
      const source = model.value === null ? "" : model.value.split("/")[0];
      const provider = model.value?.includes("/") ? source : fallbackProvider;
      const key = model.value === null ? "" : provider;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        ...model,
        group: key,
        providerLabel: model.value === null ? "Par défaut" : (names.get(provider) ?? provider),
        // Ce badge reprend uniquement une indication explicite du catalogue.
        free:
          model.value !== null && (/\bfree\s*$/i.test(model.label) || /:free$/i.test(model.value)),
      });
    }
    return [...groups.values()].flat();
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  /**
   * Placement d'un popover ancré. `anchor` : `{ left, top, bottom }`, `size` : `{ width, height }`
   * naturels, `viewport` : `{ width, height }`. Au-dessus par défaut, dessous si la place manque,
   * sinon du côté le plus spacieux (défilement interne via `maxHeight`). Jamais hors de l'écran.
   */
  function placePopover(anchor, size, viewport, margin = 8, gap = 6) {
    const width = Math.max(0, Math.min(size.width, viewport.width - 2 * margin));
    const above = Math.max(0, anchor.top - gap - margin);
    const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
    const side =
      size.height <= above
        ? "above"
        : size.height <= below
          ? "below"
          : above >= below
            ? "above"
            : "below";
    const room = side === "above" ? above : below;
    const used = Math.min(size.height, room);
    const x = clamp(anchor.left, margin, Math.max(margin, viewport.width - margin - width));
    const y = side === "above" ? anchor.top - gap - used : anchor.bottom + gap;
    return { x: Math.round(x), y: Math.round(y), side, maxHeight: Math.floor(room), width };
  }

  /** Remplissage (0-100) du curseur d'effort pour le cran `index` sur `count`. */
  function effortPct(index, count) {
    if (!(count > 1) || !(index > 0)) return 0;
    return Math.round((Math.min(index, count - 1) / (count - 1)) * 100);
  }

  /** Cran à focaliser pour un piège de focus (Tab / Maj+Tab cyclent). `current` : -1 si hors liste. */
  function tabTarget(count, current, shift) {
    if (count <= 0) return -1;
    if (current < 0) return shift ? count - 1 : 0;
    return (current + (shift ? -1 : 1) + count) % count;
  }

  /**
   * Classes de `body` pilotant les effets : `running` (un tour est en cours), `waiting` (carte
   * d'approbation en attente : tout est figé), `paused` (vue cachée), `readonly`, `reduce-motion`.
   */
  function bodyClasses(view, env) {
    const out = [];
    const readonly = !!view.readonly;
    const running = !!view.busy && !readonly;
    if (running) out.push("running");
    if (running && view.approvals.length > 0) out.push("waiting");
    if (env.hidden) out.push("paused");
    if (readonly) out.push("readonly");
    if (env.reducedMotion) out.push("reduce-motion");
    return out;
  }

  /** Libellé de l'indicateur « thinking » (texte brut, inséré par textContent). */
  function activityLabel(view) {
    if (!view.busy) return "";
    if (view.approvals.length > 0) return "En attente de votre accord";
    if (view.retry) return "Fournisseur indisponible · nouvelle tentative en attente";
    for (let i = view.items.length - 1; i >= 0; i--) {
      const it = view.items[i];
      if (it.kind === "tool" && it.status === "pending") return `Outil : ${it.label}`;
    }
    return "Réflexion";
  }

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

  /**
   * État effectif d'un message `bypass` (échec fermé) : « on » seulement avec `expiresAt` fini ;
   * « pending » si demandé mais non effectif ; « off » sinon, y compris pour un message mal formé.
   */
  function bypassEffective(push) {
    if (push === null || typeof push !== "object" || push.type !== "bypass") return "off";
    if (typeof push.on !== "boolean" || typeof push.armed !== "boolean") return "off";
    if (push.on) return isFiniteNumber(push.expiresAt) ? "on" : "off";
    return push.armed ? "pending" : "off";
  }

  /** Reste affiché : arrondi à la minute supérieure, comme `formatRemaining` de l'hôte. */
  function remainingText(ms) {
    const minutes = Math.max(0, Math.ceil(ms / 60_000));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
  }

  /**
   * Vue du Bypass, fonction pure. `push` : dernier message `bypass` reçu ; `previous` : le précédent
   * (ou null) ; `userOff` : l'utilisateur a demandé off ou `reset` depuis le message précédent ;
   * `now` : epoch ms (aucun minuteur, le reste est recalculé à chaque appel).
   * Passage à « off » sans `userOff` : « dropped » depuis « pending », « ended » depuis « on ».
   */
  function bypassView(push, previous, userOff, now) {
    const effective = bypassEffective(push);
    const before = bypassEffective(previous);
    let state = effective;
    if (effective === "off" && !userOff && before !== "off") {
      state = before === "on" ? "ended" : "dropped";
    }
    let text = "";
    let until = null;
    let badge = null;
    if (state === "pending") {
      text = "En attente : actif dès que l'agent le confirme.";
    } else if (state === "on") {
      until = new Date(push.expiresAt).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      text = `Actif jusqu'à ${until} (reste ${remainingText(push.expiresAt - now)}).`;
      badge = { word: "BYPASS", time: until };
    } else if (state === "dropped") {
      text = "Bypass désactivé avant confirmation.";
    } else if (state === "ended") {
      text = "Bypass terminé.";
    }
    return { checked: state === "on" || state === "pending", state, text, badge, until };
  }

  /**
   * Rappel des consignes déjà envoyées. `index` -1 = brouillon (`draft`).
   * Haut seulement sur la première ligne, Bas seulement sur la dernière.
   * `null` : la touche déplace le curseur, l'historique ne change pas.
   */
  function inputRecall(state, key, cursor) {
    if (key !== "up" && key !== "down") return null;
    if (!cursor || typeof cursor.line !== "number" || typeof cursor.lines !== "number") return null;
    if (key === "up" && cursor.line !== 0) return null;
    if (key === "down" && cursor.line !== cursor.lines - 1) return null;
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const index = Number.isInteger(state.index) ? state.index : -1;
    const draft = typeof state.draft === "string" ? state.draft : "";
    const current = typeof state.current === "string" ? state.current : "";
    const n = entries.length;
    if (key === "up") {
      if (n === 0) return null;
      if (index >= n - 1) return { index, draft, value: entries[0] };
      const next = index + 1;
      return {
        index: next,
        draft: index === -1 ? current : draft,
        value: entries[n - 1 - next],
      };
    }
    if (index < 0) return null;
    if (index === 0) return { index: -1, draft, value: draft };
    const next = index - 1;
    return { index: next, draft, value: entries[n - 1 - next] };
  }

  /**
   * Aligne l'historique local sur les consignes de la vue.
   * Garde une consigne envoyée pas encore renvoyée par la vue ; une vue vide ou différente remplace.
   */
  function syncRecallEntries(local, viewUsers) {
    const mine = Array.isArray(local) ? local : [];
    const theirs = Array.isArray(viewUsers) ? viewUsers : [];
    if (theirs.length === 0) return [];
    if (theirs.length >= mine.length && mine.every((text, i) => text === theirs[i]))
      return theirs.slice();
    if (mine.length === theirs.length + 1 && theirs.every((text, i) => text === mine[i]))
      return mine.slice();
    return theirs.slice();
  }

  /** Mention en cours de saisie : `@` collé au curseur. `null` sinon. */
  function mentionSpan(value, cursor) {
    return sigilSpan(value, cursor, "@");
  }

  /** Citation de terminal en cours de saisie : `#` collé au curseur. `null` sinon. */
  function hashSpan(value, cursor) {
    return sigilSpan(value, cursor, "#");
  }

  function sigilSpan(value, cursor, sigil) {
    const text = String(value ?? "");
    const pos = Math.max(0, Math.min(text.length, Number(cursor) || 0));
    const upto = text.slice(0, pos);
    const match = new RegExp(`(?:^|[\\s(])\\${sigil}([A-Za-z0-9_.-]*)$`).exec(upto);
    if (!match) return null;
    return { query: match[1], start: upto.lastIndexOf(sigil) };
  }

  /** Liste hôte → entrées affichables. Nom court seulement, état connu. */
  function safeContainers(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
      if (!it || typeof it.name !== "string") continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(it.name)) continue;
      if (it.state !== "running" && it.state !== "stopped") continue;
      out.push({ name: it.name, state: it.state });
    }
    return out;
  }

  const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

  /** Terminaux proposés par l'hôte. Deux shells du même conteneur restent deux lignes. */
  function safeTerminals(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
      if (!it || typeof it.token !== "string" || !TOKEN.test(it.token)) continue;
      const label = typeof it.label === "string" && TOKEN.test(it.label) ? it.label : it.token;
      const hint =
        typeof it.hint === "string" ? it.hint.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      out.push({ token: it.token, label, hint });
    }
    return out;
  }

  /** Terminaux dont le jeton, le libellé ou la commande contient la saisie. */
  function filterTerminals(items, query) {
    const q = String(query ?? "").toLowerCase();
    if (!Array.isArray(items)) return [];
    return items.filter((it) => {
      if (!it || typeof it.token !== "string") return false;
      const blob = `${it.token} ${it.label ?? ""} ${it.hint ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }

  /** Conteneurs dont le nom court contient la saisie, dans l'ordre reçu. */
  function filterContainers(items, query) {
    const q = String(query ?? "").toLowerCase();
    if (!Array.isArray(items)) return [];
    return items.filter(
      (it) => it && typeof it.name === "string" && it.name.toLowerCase().includes(q),
    );
  }

  const api = {
    EXEC_TOOL,
    toolIcon,
    bypassView,
    historyBadge,
    monitorRows,
    listboxKey,
    filterModels,
    groupModels,
    placePopover,
    effortPct,
    tabTarget,
    bodyClasses,
    activityLabel,
    inputRecall,
    syncRecallEntries,
    mentionSpan,
    hashSpan,
    filterContainers,
    safeContainers,
    filterTerminals,
    safeTerminals,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WarbandUI = api;
})(globalThis);
