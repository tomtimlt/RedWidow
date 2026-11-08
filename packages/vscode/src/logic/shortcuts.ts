/**
 * Raccourcis d'accès rapide (accord « J » : Alt+J sous Windows et Linux, Ctrl+J sous macOS).
 * Table unique, alignée sur `keybindings` du manifeste (un test garde cette égalité) : le lanceur
 * et les infobulles en dérivent leurs libellés au lieu de les coder en dur.
 */

export type ShortcutId =
  | "launcher"
  | "focusChat"
  | "openChat"
  | "openTerminal"
  | "openCockpit"
  | "openMonitor"
  | "openKillchain"
  | "openStudio"
  | "openSessions";

/** Identifiant → commande du manifeste et touche suivant l'accord (`null` : l'accord seul, doublé). */
export const SHORTCUTS: Readonly<Record<ShortcutId, { command: string; key: string | null }>> = {
  launcher: { command: "warband.launcher", key: null },
  focusChat: { command: "warband.focusChat", key: "c" },
  openChat: { command: "warband.openChat", key: "n" },
  openTerminal: { command: "warband.openTerminal", key: "t" },
  openCockpit: { command: "warband.openCockpit", key: "k" },
  openMonitor: { command: "warband.openMonitor", key: "m" },
  openKillchain: { command: "warband.openKillchain", key: "g" },
  openStudio: { command: "warband.openStudio", key: "s" },
  openSessions: { command: "warband.openSessions", key: "e" },
};

/** Libellé affiché, par exemple « Alt+J C », « Ctrl+J C » ou « Alt+J Alt+J ». */
export function shortcutLabel(id: ShortcutId, platform: string = process.platform): string {
  const modifier = platform === "darwin" ? "Ctrl" : "Alt";
  const entry = SHORTCUTS[id];
  return entry.key === null
    ? `${modifier}+J ${modifier}+J`
    : `${modifier}+J ${entry.key.toUpperCase()}`;
}
