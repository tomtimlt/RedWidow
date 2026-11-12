// Dock : une entrée par fenêtre ouverte (titre court, indicateur minimisée ou en veille, pastille
// d'activité) et un menu « Ouvrir ». Au téléphone, le même élément devient la barre d'onglets du mode
// pile (mise en forme dans wm.css). Tout le texte passe par `textContent`. Les entrées gardent l'ordre
// d'ouverture et sont mises à jour sur place : un rendu n'avale pas un clic.
import { shortTitle } from "./types.js";

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {{ root: HTMLElement, items: HTMLElement, openButton: HTMLButtonElement, menu: HTMLElement }} options.refs
 * @param {{ title: string, entries: { action: string, title: string, hint?: string }[] }[]} options.groups groupes du menu « Ouvrir »
 * @param {(key: string) => void} options.onActivate focaliser ou restaurer
 * @param {(key: string) => void} options.onMinimize clic sur la fenêtre déjà focalisée (bureau)
 * @param {(action: string) => void} options.onOpenEntry entrée du menu « Ouvrir » choisie
 * @param {(name: string) => void} [options.onSpace] basculer vers l'espace de travail enregistré
 * @param {() => void} [options.onSpaceSave] « Enregistrer sous… » (saisie d'un nom dans la palette)
 */
export function createDock({
  doc,
  refs,
  groups,
  onActivate,
  onMinimize,
  onOpenEntry,
  onSpace = () => {},
  onSpaceSave = () => {},
}) {
  const buttons = new Map();
  let mode = "desktop";

  const stateText = (item) => {
    if (item.minimized) return "minimisée";
    if (item.alive === false) return "en veille";
    return item.focused ? "au premier plan" : "ouverte";
  };

  const build = (key) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "dock-item";
    button.dataset.key = key;
    const dot = doc.createElement("span");
    dot.className = "dock-dot";
    dot.hidden = true;
    const label = doc.createElement("span");
    label.className = "dock-label";
    const badge = doc.createElement("span");
    badge.className = "dock-badge";
    badge.hidden = true;
    // Pastille d'activité d'une mission : en cours (rouge) ou en attente d'une réponse (acier).
    const act = doc.createElement("span");
    act.className = "dock-act";
    act.hidden = true;
    button.append(dot, label, badge, act);
    button.addEventListener("click", () => {
      if (button.dataset.focused === "1" && mode === "desktop") onMinimize(key);
      else onActivate(key);
    });
    return button;
  };

  const closeMenu = () => {
    refs.menu.hidden = true;
    refs.openButton.setAttribute("aria-expanded", "false");
  };

  refs.openButton.setAttribute("aria-haspopup", "menu");
  refs.openButton.setAttribute("aria-expanded", "false");
  refs.openButton.addEventListener("click", () => {
    const willOpen = refs.menu.hidden;
    refs.menu.hidden = !willOpen;
    refs.openButton.setAttribute("aria-expanded", String(willOpen));
  });
  // Menu « Ouvrir » en groupes (Mission / Outils / Écrans) : un titre, puis une grille d'entrées.
  refs.menu.classList.add("dock-menu-grouped");
  for (const group of groups) {
    const section = doc.createElement("div");
    section.className = "dock-menu-group";
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", group.title);
    const heading = doc.createElement("div");
    heading.className = "dock-menu-title";
    heading.setAttribute("aria-hidden", "true");
    heading.textContent = group.title;
    const grid = doc.createElement("div");
    grid.className = "dock-menu-grid";
    for (const item of group.entries) {
      const entry = doc.createElement("button");
      entry.type = "button";
      entry.className = "dock-menu-item";
      entry.dataset.action = item.action;
      entry.setAttribute("role", "menuitem");
      const label = doc.createElement("span");
      label.textContent = item.title;
      entry.append(label);
      if (item.hint) {
        const kbd = doc.createElement("kbd");
        kbd.className = "pal-kbd dock-menu-kbd";
        kbd.textContent = item.hint;
        entry.append(kbd);
      }
      entry.addEventListener("click", () => {
        closeMenu();
        onOpenEntry(item.action);
      });
      grid.append(entry);
    }
    section.append(heading, grid);
    refs.menu.append(section);
  }
  doc.addEventListener("pointerdown", (e) => {
    if (!refs.menu.hidden && !refs.root.contains(e.target)) closeMenu();
    if (
      refs.spaceMenu &&
      !refs.spaceMenu.hidden &&
      !refs.spaceMenu.parentElement.contains(e.target)
    )
      closeSpaceMenu();
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !refs.menu.hidden) {
      closeMenu();
      refs.openButton.focus();
    }
    if (e.key === "Escape" && refs.spaceMenu && !refs.spaceMenu.hidden) {
      closeSpaceMenu();
      refs.spaceButton.focus();
    }
  });

  // Sélecteur d'espaces de travail : le bouton montre l'espace affiché, le menu liste les espaces
  // enregistrés. Reconstruit à chaque changement (liste courte, aucune donnée en HTML).
  function closeSpaceMenu() {
    refs.spaceMenu.hidden = true;
    refs.spaceButton.setAttribute("aria-expanded", "false");
  }
  if (refs.spaceButton && refs.spaceMenu) {
    refs.spaceButton.setAttribute("aria-haspopup", "menu");
    refs.spaceButton.setAttribute("aria-expanded", "false");
    refs.spaceButton.addEventListener("click", () => {
      const willOpen = refs.spaceMenu.hidden;
      refs.spaceMenu.hidden = !willOpen;
      refs.spaceButton.setAttribute("aria-expanded", String(willOpen));
    });
  }

  return {
    /**
     * @param {{ current: string, spaces: string[], disabled?: boolean }} view espace affiché et espaces enregistrés
     */
    renderSpaces({ current, spaces, disabled = false }) {
      if (!refs.spaceButton || !refs.spaceMenu) return;
      refs.spaceButton.textContent = "";
      const caption = doc.createElement("span");
      caption.className = "dock-space-cap";
      caption.textContent = "Espace";
      const name = doc.createElement("span");
      name.className = "dock-space-name";
      name.textContent = current;
      refs.spaceButton.append(caption, name);
      refs.spaceButton.disabled = disabled;
      refs.spaceButton.title = `Espace de travail : ${current}`;
      refs.spaceMenu.textContent = "";
      spaces.forEach((space, i) => {
        const entry = doc.createElement("button");
        entry.type = "button";
        entry.className = "dock-menu-item dock-space-item";
        entry.setAttribute("role", "menuitemradio");
        entry.setAttribute("aria-checked", String(space === current));
        entry.dataset.space = space;
        const label = doc.createElement("span");
        label.textContent = space;
        entry.append(label);
        if (i < 9) {
          const kbd = doc.createElement("kbd");
          kbd.className = "pal-kbd";
          kbd.textContent = `Ctrl Alt ${i + 1}`;
          entry.append(kbd);
        }
        entry.addEventListener("click", () => {
          closeSpaceMenu();
          onSpace(space);
        });
        refs.spaceMenu.append(entry);
      });
      const save = doc.createElement("button");
      save.type = "button";
      save.className = "dock-menu-item dock-space-save";
      save.setAttribute("role", "menuitem");
      save.textContent = "Enregistrer sous…";
      save.addEventListener("click", () => {
        closeSpaceMenu();
        onSpaceSave();
      });
      refs.spaceMenu.append(save);
    },
    /**
     * @param {object[]} snapshot fenêtres (`desktop.snapshot()`)
     * @param {{ badges?: Map<string, number>, mode?: string }} [options] pastilles par clé de fenêtre
     */
    render(
      snapshot,
      { badges = new Map(), activity = new Map(), mode: nextMode = "desktop" } = {},
    ) {
      mode = nextMode;
      refs.root.dataset.mode = mode;
      const present = new Set(snapshot.map((s) => s.key));
      for (const [key, button] of buttons) {
        if (!present.has(key)) {
          button.remove();
          buttons.delete(key);
        }
      }
      for (const item of snapshot) {
        let button = buttons.get(item.key);
        if (!button) {
          button = build(item.key);
          buttons.set(item.key, button);
          refs.items.append(button);
        }
        const count = badges.get(item.key) ?? 0;
        const [dot, label, badge, act] = button.children;
        const running = activity.get(item.key) ?? "";
        act.hidden = running === "";
        act.dataset.state = running;
        act.title = running === "running" ? "Mission en cours" : "Mission en attente";
        button.dataset.activity = running;
        label.textContent = shortTitle(item.title);
        badge.textContent = count > 9 ? "9+" : String(count);
        badge.hidden = count === 0;
        dot.hidden = !(item.minimized || item.alive === false);
        dot.dataset.kind = item.minimized ? "min" : "sleep";
        button.dataset.focused = item.focused ? "1" : "0";
        button.classList.toggle("is-focus", item.focused);
        button.classList.toggle("is-min", item.minimized);
        button.classList.toggle("is-sleep", item.alive === false);
        button.classList.toggle("has-badge", count > 0);
        button.setAttribute("aria-pressed", String(item.focused));
        const extra =
          (count > 0 ? `, ${count} en attente` : "") +
          (running === "running"
            ? ", mission en cours"
            : running === "waiting"
              ? ", mission en attente d'une réponse"
              : "");
        button.title = `${item.title} (${stateText(item)}${extra})`;
        button.setAttribute("aria-label", button.title);
      }
    },
  };
}
