// Palette de commandes : recherche floue, navigation au clavier, sous-listes (confirmation) et saisie d'un
// nom. Tout le texte reçu ou saisi passe par `textContent`, jamais en HTML. Les commandes ne font
// qu'appeler des fonctions du contexte (bureau, espaces, arrêt d'urgence) : aucune n'émet de réponse à une
// approbation, n'active un contournement ni ne révèle un secret.
import { SHORTCUT_LABELS } from "./shortcuts.js";

const MAX_SHOWN = 60;

/** Minuscules sans accents, pour comparer. */
export const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

/**
 * Correspondance floue d'un mot dans `text` (sous-suite, accents et casse ignorés). Score élevé = mieux :
 * bonus de début de mot, de caractères contigus, de préfixe. `indices` : positions des caractères trouvés
 * (dans le texte d'origine). `null` si le mot n'y est pas.
 */
export function fuzzyMatch(word, text) {
  const w = fold(word);
  const t = fold(text);
  if (w === "") return { score: 0, indices: [] };
  return fuzzyPlain(w, t);
}

function fuzzyPlain(w, t) {
  const sub = t.indexOf(w);
  if (sub >= 0) {
    const atWord = sub === 0 || /[^a-z0-9]/.test(t[sub - 1] ?? "");
    return {
      score: 100 + w.length * 4 + (sub === 0 ? 40 : atWord ? 25 : 0) - sub * 0.5,
      indices: Array.from({ length: w.length }, (_, i) => sub + i),
    };
  }
  const indices = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of w) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    const wordStart = at === 0 || /[^a-z0-9]/.test(t[at - 1] ?? "");
    score += 2 + (at === prev + 1 ? 6 : 0) + (wordStart ? 8 : 0) - Math.min(at - from, 6) * 0.3;
    indices.push(at);
    prev = at;
    from = at + 1;
  }
  return { score, indices };
}

/** Un mot de la requête par segment séparé d'espaces : tous doivent correspondre dans le titre ou les mots-clés. */
export function scoreItem(query, item) {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { score: 0, indices: [] };
  let score = 0;
  const hit = new Set();
  for (const word of words) {
    const inTitle = fuzzyMatch(word, item.title);
    if (inTitle !== null) {
      score += inTitle.score;
      for (const i of inTitle.indices) hit.add(i);
      continue;
    }
    // Groupe et mots-clés : correspondance exacte d'une sous-chaîne seulement (sinon trop de bruit).
    const extra = fold(`${item.group ?? ""} ${item.keywords ?? ""}`);
    if (!extra.includes(fold(word))) return null;
    score += 20;
  }
  return { score, indices: [...hit].sort((a, b) => a - b) };
}

/** Classe les commandes pour une requête ; requête vide : ordre d'origine. Retourne [{ item, indices }]. */
export function rank(items, query) {
  if (query.trim() === "") return items.map((item) => ({ item, indices: [] }));
  const scored = [];
  items.forEach((item, order) => {
    const s = scoreItem(query, item);
    if (s !== null) scored.push({ item, indices: s.indices, score: s.score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ item, indices }) => ({ item, indices }));
}

const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Titre découpé en segments (correspondances en évidence), sans HTML. */
function fillTitle(doc, node, title, indices) {
  node.textContent = "";
  const marked = new Set(indices);
  let run = "";
  let runMarked = false;
  const flush = () => {
    if (run === "") return;
    node.append(runMarked ? el(doc, "span", "pal-hit", run) : doc.createTextNode(run));
    run = "";
  };
  [...title].forEach((ch, i) => {
    const m = marked.has(i);
    if (m !== runMarked) flush();
    runMarked = m;
    run += ch;
  });
  flush();
}

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {{ root: HTMLElement, input: HTMLInputElement, list: HTMLElement, hint: HTMLElement }} options.refs
 * @param {() => object[]} options.getItems commandes courantes, relues à chaque ouverture
 * @param {() => void} [options.onOpen] appelé à l'ouverture (rafraîchir les listes du serveur)
 */
export function createPalette({ doc, refs, getItems, onOpen = () => {} }) {
  /** Pile de niveaux : { items, placeholder, prompt? }. */
  let levels = [];
  let shown = [];
  let active = 0;
  let opener = null;
  let message = "";

  const level = () => levels[levels.length - 1];
  const isOpen = () => !refs.root.hidden;

  const render = () => {
    const lv = level();
    refs.input.placeholder = lv.placeholder;
    refs.list.textContent = "";
    refs.input.setAttribute("aria-activedescendant", "");
    if (lv.prompt) {
      refs.list.setAttribute("aria-busy", "false");
      const row = el(doc, "div", "pal-note", message || lv.prompt.help || "Entrée pour valider");
      row.setAttribute("role", "status");
      if (message) row.classList.add("is-error");
      refs.list.append(row);
      return;
    }
    shown = rank(lv.items, refs.input.value).slice(0, MAX_SHOWN);
    active = Math.min(active, Math.max(0, shown.length - 1));
    if (shown.length === 0) {
      refs.list.append(el(doc, "div", "pal-note", "Aucune commande ne correspond."));
      return;
    }
    let lastGroup = null;
    shown.forEach(({ item, indices }, i) => {
      if (refs.input.value.trim() === "" && item.group !== lastGroup) {
        lastGroup = item.group;
        refs.list.append(el(doc, "div", "pal-group", item.group ?? ""));
      }
      const row = el(doc, "div", "pal-item");
      row.id = `pal-opt-${i}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === active));
      row.dataset.index = String(i);
      const title = el(doc, "span", "pal-title");
      fillTitle(doc, title, item.title, indices);
      row.append(title);
      if (item.detail) row.append(el(doc, "span", "pal-detail", item.detail));
      if (item.shortcut && Object.hasOwn(SHORTCUT_LABELS, item.shortcut)) {
        row.append(el(doc, "kbd", "pal-kbd", SHORTCUT_LABELS[item.shortcut]));
      } else if (item.shortcutText) {
        row.append(el(doc, "kbd", "pal-kbd", item.shortcutText));
      }
      if (refs.input.value.trim() !== "" && item.group) {
        row.append(el(doc, "span", "pal-tag", item.group));
      }
      if (i === active) row.classList.add("is-active");
      refs.list.append(row);
    });
    refs.input.setAttribute("aria-activedescendant", `pal-opt-${active}`);
  };

  const reveal = () => {
    const row = refs.list.querySelector(".pal-item.is-active");
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const setActive = (index) => {
    if (shown.length === 0) return;
    active = (index + shown.length) % shown.length;
    render();
    reveal();
  };

  const close = () => {
    if (!isOpen()) return;
    refs.root.hidden = true;
    refs.root.classList.remove("is-open");
    levels = [];
    refs.input.value = "";
    message = "";
    const back = opener;
    opener = null;
    if (back && typeof back.focus === "function" && doc.contains(back)) back.focus();
  };

  const enter = (lv) => {
    levels.push(lv);
    refs.input.value = "";
    active = 0;
    message = "";
    render();
  };

  /** Résultat d'une commande : rien (fermer), { next } (sous-liste) ou { prompt } (saisie). */
  const follow = (result) => {
    if (result && result.next) enter({ ...result.next });
    else if (result && result.prompt)
      enter({ placeholder: result.prompt.placeholder, prompt: result.prompt });
    else close();
  };

  const runActive = () => {
    const lv = level();
    if (lv.prompt) {
      const outcome = lv.prompt.submit(refs.input.value);
      if (typeof outcome === "string") {
        message = outcome;
        render();
      } else close();
      return;
    }
    const entry = shown[active];
    if (entry) follow(entry.item.run());
  };

  const back = () => {
    if (levels.length > 1) {
      levels.pop();
      refs.input.value = "";
      active = 0;
      message = "";
      render();
    } else close();
  };

  refs.input.addEventListener("input", () => {
    active = 0;
    message = "";
    render();
  });
  refs.input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive(active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(active - 1);
        break;
      case "PageDown":
        e.preventDefault();
        setActive(Math.min(shown.length - 1, active + 8));
        break;
      case "PageUp":
        e.preventDefault();
        setActive(Math.max(0, active - 8));
        break;
      case "Enter":
        e.preventDefault();
        if (!e.isComposing) runActive();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        back();
        break;
      case "Tab":
        // Le focus reste dans la saisie : la palette est modale.
        e.preventDefault();
        break;
      default:
        break;
    }
  });
  refs.list.addEventListener("mousemove", (e) => {
    const row = e.target instanceof Element ? e.target.closest(".pal-item") : null;
    if (!row) return;
    const index = Number(row.dataset.index);
    if (index !== active) {
      active = index;
      render();
    }
  });
  // `mousedown` : le focus ne quitte pas la saisie.
  refs.list.addEventListener("mousedown", (e) => e.preventDefault());
  refs.list.addEventListener("click", (e) => {
    const row = e.target instanceof Element ? e.target.closest(".pal-item") : null;
    if (!row) return;
    active = Number(row.dataset.index);
    runActive();
  });
  refs.root.addEventListener("mousedown", (e) => {
    if (e.target === refs.root) close();
  });

  return {
    isOpen,
    open() {
      if (isOpen()) return;
      opener = doc.activeElement;
      onOpen();
      levels = [{ items: getItems(), placeholder: "Rechercher une commande…" }];
      refs.input.value = "";
      active = 0;
      message = "";
      refs.root.hidden = false;
      render();
      // Relance l'animation d'entrée (≤ 150 ms, coupée par prefers-reduced-motion).
      void refs.root.offsetWidth;
      refs.root.classList.add("is-open");
      refs.input.focus();
    },
    /** Listes du serveur arrivées palette ouverte : la liste principale est recalculée (sans toucher une saisie). */
    refresh() {
      if (!isOpen() || levels.length !== 1 || levels[0].prompt) return;
      levels[0].items = getItems();
      render();
    },
    /** Ouvre directement une saisie de nom (sélecteur d'espaces du dock). */
    openPrompt(prompt) {
      if (!isOpen()) this.open();
      enter({ placeholder: prompt.placeholder, prompt });
    },
    close,
    toggle() {
      if (isOpen()) close();
      else this.open();
    },
  };
}

// ───────────────────────────── Commandes ─────────────────────────────

const TILES = [
  ["left", "Moitié gauche", "Ctrl+Alt+ArrowLeft"],
  ["right", "Moitié droite", "Ctrl+Alt+ArrowRight"],
  ["tl", "Quart haut gauche"],
  ["tr", "Quart haut droit"],
  ["bl", "Quart bas gauche"],
  ["br", "Quart bas droit"],
  ["full", "Plein écran", "Ctrl+Alt+ArrowUp"],
];

const KIND_LABELS = {
  mission: "mission",
  monitor: "monitor (run)",
  graph: "graphe de kill chain",
  report: "rapport",
  program: "programme",
  engagement: "engagement",
};

/**
 * Commandes de la palette à partir d'un contexte (voir shell.js). Fonction pure : le contexte fournit les
 * actions, la liste des fenêtres et les espaces ; elle ne touche ni au DOM ni au canal.
 * @param {object} ctx
 * @param {object[]} ctx.windows `desktop.snapshot()`
 * @param {string|null} ctx.activeKey
 * @param {{ name: string }[]} ctx.spaces espaces enregistrés
 * @param {string} ctx.spaceName espace affiché
 * @param {boolean} ctx.phone espaces et tuiles indisponibles
 * @param {{ kind: string, id: string }[]} ctx.known identités connues (missions, programmes, runs)
 * @param {{ name: string, title: string }[]} ctx.screens écrans natifs
 * @param {{ kind: string, id: string, title: string }[]} ctx.fixed vues sans instance (cockpit…)
 * @param {{ open(spec: object): void, focus(key: string): void, tile(key: string, kind: string): void, tileAll(): void }} ctx.actions
 * @param {(kind: string, id: string) => object|null} ctx.spec
 */
export function buildCommands(ctx) {
  const items = [];
  const a = ctx.actions;

  // Conversation : une nouvelle mission (identifiant généré par la coquille), en tête de liste.
  items.push({
    id: "new-mission",
    group: "Mission",
    title: "Nouvelle mission",
    detail: "discuter avec l'agent",
    keywords: "conversation chat agent démarrer créer",
    shortcut: "Alt+J N",
    run: () => a.newMission(),
  });
  // Vues d'une mission déjà ouverte : kill chain et rapport (les autres s'ouvrent par identifiant).
  for (const w of ctx.windows) {
    if (w.type !== "mission" || typeof w.frame !== "string") continue;
    for (const [kind, label] of [
      ["graph", "Kill chain"],
      ["report", "Rapport"],
    ]) {
      items.push({
        id: `open:${kind}:${w.frame}`,
        group: "Mission",
        title: `${label} : ${w.frame}`,
        keywords: `${KIND_LABELS[kind]} mission ${w.frame}`,
        run: () => a.open(ctx.spec(kind, w.frame)),
      });
    }
  }
  for (const f of ctx.fixed) {
    items.push({
      id: `open:${f.kind}:${f.id}`,
      group: "Outils",
      title: f.title,
      keywords: f.keywords,
      shortcutText: f.shortcutText,
      run: () => a.open(ctx.spec(f.kind, f.id)),
    });
  }

  for (const w of ctx.windows) {
    items.push({
      id: `focus:${w.key}`,
      group: "Aller à",
      title: w.title,
      detail: w.minimized ? "minimisée" : w.key === ctx.activeKey ? "au premier plan" : "",
      keywords: "fenêtre focaliser",
      run: () => a.focus(w.key),
    });
  }

  for (const screen of ctx.screens) {
    items.push({
      id: `open:native:${screen.name}`,
      group: "Ouvrir",
      title: screen.title,
      keywords: "écran fenêtre",
      shortcut:
        screen.name === "approvals"
          ? "Ctrl+Alt+A"
          : screen.name === "terminal"
            ? "Ctrl+Alt+T"
            : undefined,
      run: () => a.open(ctx.spec("native", screen.name)),
    });
  }
  for (const k of ctx.known) {
    const spec = ctx.spec(k.kind, k.id);
    if (spec === null) continue;
    items.push({
      id: `open:${k.kind}:${k.id}`,
      group: "Ouvrir",
      // Titre et détail lisibles fournis par les listes du serveur (mission, projet, run).
      title: k.title ?? spec.title,
      detail: k.detail,
      keywords: `${KIND_LABELS[k.kind] ?? k.kind} ${k.id}`,
      run: () => a.open(spec),
    });
  }
  for (const kind of Object.keys(KIND_LABELS)) {
    items.push({
      id: `open-id:${kind}`,
      group: "Ouvrir",
      title: `Ouvrir un ${KIND_LABELS[kind]} par identifiant…`,
      keywords: kind,
      run: () => ({
        prompt: {
          placeholder: `Identifiant du ${KIND_LABELS[kind]}`,
          help: "Lettres, chiffres, « - » et « _ » (64 au plus). Entrée pour ouvrir.",
          submit(text) {
            const spec = ctx.spec(kind, text.trim());
            if (spec === null) return "Identifiant refusé.";
            a.open(spec);
            return undefined;
          },
        },
      }),
    });
  }

  if (!ctx.phone) {
    for (const [kind, label, shortcut] of TILES) {
      items.push({
        id: `tile:${kind}`,
        group: "Tuiler",
        title: `Fenêtre active : ${label.toLowerCase()}`,
        keywords: "tuile aimanter disposer",
        shortcut,
        run: () => {
          if (ctx.activeKey) a.tile(ctx.activeKey, kind);
        },
      });
    }
    items.push({
      id: "tile:all",
      group: "Tuiler",
      title: "Tuiler toutes les fenêtres ouvertes",
      keywords: "grille mosaïque",
      run: () => a.tileAll(),
    });

    ctx.spaces.forEach((space, i) => {
      items.push({
        id: `space:apply:${space.name}`,
        group: "Espace",
        title: `Basculer vers « ${space.name} »`,
        detail: space.name === ctx.spaceName ? "actif" : "",
        keywords: "espace de travail disposition",
        shortcutText: i < 9 ? `Ctrl Alt ${i + 1}` : undefined,
        run: () => a.applySpace(space.name),
      });
    });
    if (ctx.spaces.some((s) => s.name === ctx.spaceName)) {
      items.push({
        id: "space:update",
        group: "Espace",
        title: `Enregistrer l'espace « ${ctx.spaceName} »`,
        keywords: "sauvegarder mettre à jour",
        run: () => a.saveSpace(ctx.spaceName),
      });
    }
    items.push({
      id: "space:save",
      group: "Espace",
      title: "Enregistrer l'espace actuel sous…",
      keywords: "nouvel espace de travail disposition sauvegarder",
      run: () => ({
        prompt: {
          placeholder: "Nom de l'espace (40 caractères au plus)",
          help: "Entrée pour enregistrer. Un nom existant est remplacé.",
          submit: (text) => a.saveSpaceAs(text),
        },
      }),
    });
    for (const space of ctx.spaces) {
      items.push({
        id: `space:delete:${space.name}`,
        group: "Espace",
        title: `Supprimer l'espace « ${space.name} »`,
        keywords: "effacer retirer",
        run: () => ({
          next: {
            placeholder: `Supprimer « ${space.name} » ?`,
            items: [
              {
                id: "confirm",
                group: "Confirmer",
                title: `Oui, supprimer « ${space.name} »`,
                run: () => a.deleteSpace(space.name),
              },
              { id: "cancel", group: "Confirmer", title: "Annuler", run: () => undefined },
            ],
          },
        }),
      });
    }
  }

  items.push({
    id: "halt",
    group: "Urgence",
    title: "Arrêt d'urgence",
    detail: "stoppe tous les agents",
    keywords: "halt stop kill",
    run: () => a.halt(),
  });
  return items;
}
