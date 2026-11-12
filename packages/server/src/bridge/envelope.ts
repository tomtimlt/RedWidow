/**
 * Enveloppe des messages de la WebSocket (ADR 0052, point 2) : `{ v: 1, view, frame, msg }`.
 * Entrée non fiable : forme exacte ou rejet. La taille est déjà bornée par `ws` (`WS_MAX_PAYLOAD`).
 */

export const ENVELOPE_VERSION = 1;

/**
 * Liste fermée des vues. Branchées : `chat` (une conversation), `shell` (coquille : approbations,
 * confirmations, arrêt d'urgence, Bypass, configuration), `program`, `engagement`, `cockpit`, `sessions`.
 * Les autres (`studio`, `killchain`, `viewer`, `term`) sont acceptées par l'enveloppe, mais le canal les
 * ignore et les compte tant qu'elles ne sont pas branchées.
 */
export const VIEWS = [
  "chat",
  "cockpit",
  "sessions",
  "program",
  "engagement",
  "studio",
  "killchain",
  "viewer",
  "shell",
  "term",
] as const;
export type View = (typeof VIEWS)[number];

/** Identifiant de cadre : chaîne bornée, sans séparateur de chemin ni caractère de contrôle. */
export const FRAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const isFrameId = (value: unknown): value is string =>
  typeof value === "string" && FRAME_PATTERN.test(value);

export interface Envelope {
  v: typeof ENVELOPE_VERSION;
  view: View;
  frame: string;
  msg: Record<string, unknown>;
}

const isView = (value: unknown): value is View =>
  typeof value === "string" && (VIEWS as readonly string[]).includes(value);

/** Valide une enveloppe déjà décodée (JSON) : `null` si la forme n'est pas exacte. */
export function parseEnvelope(raw: unknown): Envelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const keys = Object.keys(e);
  if (keys.length !== 4 || !["v", "view", "frame", "msg"].every((k) => keys.includes(k)))
    return null;
  if (e.v !== ENVELOPE_VERSION || !isView(e.view) || !isFrameId(e.frame)) return null;
  const msg = e.msg;
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return null;
  return { v: ENVELOPE_VERSION, view: e.view, frame: e.frame, msg: msg as Record<string, unknown> };
}

/** Décode un message de socket (texte JSON) puis le valide. Binaire ou JSON invalide : `null`. */
export function decodeEnvelope(data: unknown): Envelope | null {
  if (typeof data !== "string") return null;
  try {
    return parseEnvelope(JSON.parse(data));
  } catch {
    return null;
  }
}

/** Enveloppe sortante, sérialisée (même forme que l'entrée). */
export function encodeEnvelope(view: View, frame: string, msg: Record<string, unknown>): string {
  return JSON.stringify({ v: ENVELOPE_VERSION, view, frame, msg });
}
