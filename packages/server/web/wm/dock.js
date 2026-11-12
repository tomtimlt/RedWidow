// Dock : une entrée par fenêtre ouverte (titre court, indicateur minimisée ou en veille, pastille
// d'activité) et un menu « Ouvrir ». Au téléphone, le même élément devient la barre d'onglets du mode
// pile (mise en forme dans wm.css). Tout le texte passe par `textContent`. Les entrées gardent l'ordre
// d'ouverture et sont mises à jour sur place : un rendu n'avale pas un clic.
import { shortTitle } from "./types.js";

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {{ root: HTMLElement, items: HTMLElement, openButton: HTMLButtonElement, menu: HTMLElement }} options.refs
 * @param {{ name: string, title: string }[]} options.screens écrans natifs du menu « Ouvrir »
 * @param {(key: string) => void} options.onActivate focaliser ou restaurer
 * @param {(key: string) => void} options.onMinimize clic sur la fenêtre déjà focalisée (bureau)
 * @param {(name: string) => void} options.onOpenScreen
 */
export function createDock({ doc, refs, screens, onActivate, onMinimize, onOpenScreen }) {
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
    button.append(dot, label, badge);
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
  for (const screen of screens) {
    const entry = doc.createElement("button");
    entry.type = "button";
    entry.className = "dock-menu-item";
    entry.setAttribute("role", "menuitem");
    entry.textContent = screen.title;
    entry.addEventListener("click", () => {
      closeMenu();
      onOpenScreen(screen.name);
    });
    refs.menu.append(entry);
  }
  doc.addEventListener("pointerdown", (e) => {
    if (!refs.menu.hidden && !refs.root.contains(e.target)) closeMenu();
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !refs.menu.hidden) {
      closeMenu();
      refs.openButton.focus();
    }
  });

  return {
    /**
     * @param {object[]} snapshot fenêtres (`desktop.snapshot()`)
     * @param {{ badges?: Map<string, number>, mode?: string }} [options] pastilles par clé de fenêtre
     */
    render(snapshot, { badges = new Map(), mode: nextMode = "desktop" } = {}) {
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
        const [dot, label, badge] = button.children;
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
        const extra = count > 0 ? `, ${count} en attente` : "";
        button.title = `${item.title} (${stateText(item)}${extra})`;
        button.setAttribute("aria-label", button.title);
      }
    },
  };
}
