/** Panneaux de droite mémorisés (`workspaceState`, clé `warband.windows`). */

export const WINDOW_KINDS = [
  "chat",
  "terminal",
  "monitor",
  "cockpit",
  "settings",
  "killchain",
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface WindowEntry {
  kind: WindowKind;
  chatId?: string;
  container?: string;
}

const CHAT_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/;
const CONTAINER_NAME_MAX = 256;
/** Plafond de la liste restaurée : au-delà, le reste est ignoré. */
export const WINDOW_CAP = 16;
const SINGLETONS = new Set<WindowKind>(["monitor", "cockpit", "settings", "killchain"]);

/**
 * Liste validée. Entrée inconnue, clé en trop, chatId ou container invalides, singleton doublé : ignorés.
 * `warband.layout` n'est pas lu ici.
 */
export function parseWindows(raw: unknown): WindowEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WindowEntry[] = [];
  const seen = new Set<WindowKind>();
  for (const item of raw) {
    if (out.length >= WINDOW_CAP) break;
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (typeof rec.kind !== "string" || !(WINDOW_KINDS as readonly string[]).includes(rec.kind)) {
      continue;
    }
    const kind = rec.kind as WindowKind;
    if (kind === "chat") {
      if (keys.length !== 2 || !keys.includes("chatId")) continue;
      if (typeof rec.chatId !== "string" || !CHAT_ID.test(rec.chatId) || rec.chatId === "sidebar") {
        continue;
      }
      out.push({ kind, chatId: rec.chatId });
      continue;
    }
    if (kind === "terminal") {
      if (keys.length !== 2 || !keys.includes("container") || keys.includes("chatId")) continue;
      if (
        typeof rec.container !== "string" ||
        rec.container.length < 1 ||
        rec.container.length > CONTAINER_NAME_MAX ||
        !CONTAINER_NAME.test(rec.container)
      ) {
        continue;
      }
      const same = out.filter((e) => e.kind === "terminal" && e.container === rec.container).length;
      if (same >= 4) continue;
      out.push({ kind: "terminal", container: rec.container });
      continue;
    }
    if (keys.length !== 1 || keys.includes("chatId") || keys.includes("container")) continue;
    if (seen.has(kind) || !SINGLETONS.has(kind)) continue;
    seen.add(kind);
    out.push({ kind });
  }
  return out;
}
