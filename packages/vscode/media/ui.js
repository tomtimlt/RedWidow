// Logique pure de l'interface du chat (aucun accès au DOM) : testée par vitest, chargée avant
// chat.js par un second <script nonce src> (design-chat-ui.md §5). Aucune dépendance.
((root) => {
  const enabled = (options, i) => i >= 0 && i < options.length && !options[i].disabled;

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
      [m.label, m.value, m.description].some(
        (s) => typeof s === "string" && s.toLowerCase().includes(q),
      ),
    );
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
    for (let i = view.items.length - 1; i >= 0; i--) {
      const it = view.items[i];
      if (it.kind === "tool" && it.status === "pending") return `Outil : ${it.label}`;
    }
    return "Réflexion";
  }

  /** Le balayage de changement de modèle ne se joue que si la vue reçue change la valeur acceptée. */
  function shouldSweep(previous, next) {
    return previous !== undefined && previous !== next;
  }

  const api = {
    listboxKey,
    filterModels,
    placePopover,
    effortPct,
    tabTarget,
    bodyClasses,
    activityLabel,
    shouldSweep,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JohnUI = api;
})(globalThis);
