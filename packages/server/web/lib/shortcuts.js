// Raccourcis clavier de la coquille (pur, sans DOM hors `attach`). Les pages en `iframe` ne propagent pas
// le clavier : `bridge.js` relaie à la coquille la même liste fermée (`RELAYED_KEYS`, frames.js). Les
// raccourcis ne pilotent que le bureau et la palette : aucun ne répond à une demande d'approbation,
// n'active un mode de contournement ni ne ferme une fenêtre.
import { RELAYED_KEYS } from "./frames.js";

/** Identifiants reconnus → libellé affiché (palette, aide). */
export const SHORTCUT_LABELS = {
  "Ctrl+K": "Ctrl K",
  "Ctrl+Shift+K": "Ctrl Maj K",
  "Ctrl+Alt+ArrowLeft": "Ctrl Alt ←",
  "Ctrl+Alt+ArrowRight": "Ctrl Alt →",
  "Ctrl+Alt+ArrowUp": "Ctrl Alt ↑",
  "Ctrl+Alt+ArrowDown": "Ctrl Alt ↓",
  "Ctrl+Alt+`": "Ctrl Alt `",
  "Ctrl+Alt+T": "Ctrl Alt T",
  "Ctrl+Alt+A": "Ctrl Alt A",
  "Alt+J N": "Alt J N",
  "Alt+J K": "Alt J K",
  "Alt+J S": "Alt J S",
  "Alt+J T": "Alt J T",
};

/** Délai (ms) pour taper la lettre après `Alt+J` (comme l'extension). */
export const CHORD_MS = 1500;
const CHORD_CODES = { KeyN: "Alt+J N", KeyK: "Alt+J K", KeyS: "Alt+J S", KeyT: "Alt+J T" };
const MODIFIER_CODES = /^(Alt|Control|Shift|Meta)(Left|Right)$/;

/**
 * Accord à deux frappes `Alt+J` puis N, K, S ou T (liste fermée, la même que `bridge.js`). `feed(event)`
 * rend `{ id, consume }` : `consume` vrai pour `Alt+J` et la lettre qui suit (l'appelant les retient), `id`
 * non nul quand l'accord est complet. Ctrl, Méta et AltGr ne participent jamais ; une autre touche désarme.
 */
export function createChord(now = () => Date.now()) {
  let armedAt = Number.NEGATIVE_INFINITY;
  return {
    feed(e) {
      const none = { id: null, consume: false };
      if (e.ctrlKey || e.metaKey) {
        armedAt = Number.NEGATIVE_INFINITY;
        return none;
      }
      if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return none;
      const code = typeof e.code === "string" ? e.code : "";
      if (MODIFIER_CODES.test(code)) return none;
      const armed = now() - armedAt <= CHORD_MS;
      armedAt = Number.NEGATIVE_INFINITY;
      if (armed && !e.shiftKey && Object.hasOwn(CHORD_CODES, code)) {
        return { id: CHORD_CODES[code], consume: true };
      }
      if (e.altKey && !e.shiftKey && code === "KeyJ") {
        armedAt = now();
        return { id: null, consume: true };
      }
      return none;
    },
  };
}

/** `Ctrl+Alt+<n>` : numéro de l'espace de travail (1 à 9), ou `null`. */
export function spaceIndexOf(id) {
  const m = /^Ctrl\+Alt\+([1-9])$/.exec(id);
  return m ? Number(m[1]) - 1 : null;
}

/**
 * Identifiant du raccourci d'un événement clavier, ou `null`. Les touches mortes, AltGr (qui produit des
 * caractères à saisir) et Méta ne sont jamais des raccourcis. Les touches se lisent par `code` (clavier
 * français compris), sauf `K` lue par `key`.
 */
export function shortcutOf(e) {
  if (!e.ctrlKey || e.metaKey) return null;
  if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return null;
  let id = null;
  if (!e.altKey) {
    if (typeof e.key === "string" && e.key.toLowerCase() === "k") {
      id = e.shiftKey ? "Ctrl+Shift+K" : "Ctrl+K";
    }
  } else if (!e.shiftKey) {
    const code = typeof e.code === "string" ? e.code : "";
    if (/^Arrow(Left|Right|Up|Down)$/.test(code)) id = `Ctrl+Alt+${code}`;
    else if (/^Digit[1-9]$/.test(code)) id = `Ctrl+Alt+${code.slice(5)}`;
    else if (code === "Backquote") id = "Ctrl+Alt+`";
    else if (code === "KeyT") id = "Ctrl+Alt+T";
    else if (code === "KeyA") id = "Ctrl+Alt+A";
  }
  return id !== null && RELAYED_KEYS.includes(id) ? id : null;
}

/**
 * Exécute un raccourci. `source` : "shell" (clavier de la coquille) ou "frame" (relayé par un pont).
 * `Ctrl+K` reste au terminal quand il a le focus (`terminalFocused()`) : seule la variante Maj ouvre alors
 * la palette. Renvoie `true` si le raccourci est consommé (l'appelant empêche alors l'action par défaut).
 * @param {string} id
 * @param {object} actions
 * @param {() => void} actions.palette ouvre ou ferme la palette
 * @param {() => boolean} actions.terminalFocused
 * @param {(kind: string) => void} actions.tile `left`, `right`
 * @param {() => void} actions.maximize
 * @param {() => void} actions.lower restaurer, puis minimiser
 * @param {(index: number) => void} actions.space
 * @param {() => void} actions.cycle
 * @param {() => void} actions.terminal
 * @param {() => void} actions.approvals
 * @param {() => void} actions.newMission nouvelle mission (Alt J N)
 * @param {() => void} actions.cockpit
 * @param {() => void} actions.studio
 * @param {"shell"|"frame"} [source]
 */
export function runShortcut(id, actions, source = "shell") {
  if (id === "Ctrl+K") {
    if (source === "shell" && actions.terminalFocused()) return false;
    actions.palette();
    return true;
  }
  if (id === "Ctrl+Shift+K") {
    actions.palette();
    return true;
  }
  const space = spaceIndexOf(id);
  if (space !== null) {
    actions.space(space);
    return true;
  }
  switch (id) {
    case "Ctrl+Alt+ArrowLeft":
      actions.tile("left");
      return true;
    case "Ctrl+Alt+ArrowRight":
      actions.tile("right");
      return true;
    case "Ctrl+Alt+ArrowUp":
      actions.maximize();
      return true;
    case "Ctrl+Alt+ArrowDown":
      actions.lower();
      return true;
    case "Ctrl+Alt+`":
      actions.cycle();
      return true;
    case "Ctrl+Alt+T":
    case "Alt+J T":
      actions.terminal();
      return true;
    case "Alt+J N":
      actions.newMission();
      return true;
    case "Alt+J K":
      actions.cockpit();
      return true;
    case "Alt+J S":
      actions.studio();
      return true;
    case "Ctrl+Alt+A":
      actions.approvals();
      return true;
    default:
      return false;
  }
}

/**
 * Écoute le clavier de la coquille. `onShortcut(id, event)` décide ; `true` empêche l'action par défaut.
 * `chordEnabled()` faux (palette ouverte, terminal focalisé) : `Alt+J` n'arme rien et reste à la page.
 */
export function attachShortcuts(doc, onShortcut, chordEnabled = () => true) {
  const chord = createChord();
  const handler = (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (chordEnabled()) {
      const step = chord.feed(event);
      if (step.consume) {
        event.preventDefault();
        event.stopPropagation();
        if (step.id !== null) onShortcut(step.id, event);
        return;
      }
    }
    const id = shortcutOf(event);
    if (id === null) return;
    if (onShortcut(id, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  doc.addEventListener("keydown", handler, true);
  return () => doc.removeEventListener("keydown", handler, true);
}
