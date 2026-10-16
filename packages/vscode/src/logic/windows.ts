/** Panneaux de droite mémorisés (`workspaceState`, clé `john.windows`). */

export const WINDOW_KINDS = ["chat", "terminal", "monitor", "cockpit", "settings"] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface WindowEntry {
  kind: WindowKind;
  chatId?: string;
}

const CHAT_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** Plafond de la liste restaurée : au-delà, le reste est ignoré. */
export const WINDOW_CAP = 16;
const SINGLETONS = new Set<WindowKind>(["monitor", "cockpit", "settings"]);

/**
 * Liste validée. Entrée inconnue, clé en trop, chatId invalide ou singleton doublé : ignorés.
 * `john.layout` n'est pas lu ici.
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
    if (!keys.every((key) => key === "kind" || key === "chatId")) continue;
    if (typeof rec.kind !== "string" || !(WINDOW_KINDS as readonly string[]).includes(rec.kind)) {
      continue;
    }
    const kind = rec.kind as WindowKind;
    if (kind === "chat" || kind === "terminal") {
      if (typeof rec.chatId !== "string" || !CHAT_ID.test(rec.chatId) || rec.chatId === "sidebar") {
        continue;
      }
      out.push({ kind, chatId: rec.chatId });
      continue;
    }
    if (keys.includes("chatId") || seen.has(kind) || !SINGLETONS.has(kind)) continue;
    seen.add(kind);
    out.push({ kind });
  }
  return out;
}
