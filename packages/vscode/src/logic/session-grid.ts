/**
 * Grille des sessions : tuiles des chats ouverts (latéral et éditeur), triées par urgence.
 * Logique pure, sans `vscode`. Ne décide rien : la grille ne répond à aucune approbation, elle
 * montre seulement qu'un chat attend et permet de l'ouvrir.
 */
import { cleanText } from "./approval.js";
import type { ChatView } from "./chat.js";

export type SessionTileState = "idle" | "busy" | "approval" | "error";
export type SessionLocation = "sidebar" | "editor";
export type SessionGridFilter = "all" | "awaiting";

/** Un chat ouvert tel que l'hôte le connaît : son emplacement et sa vue de session courante. */
export interface SessionGridChat {
  id: string;
  name: string;
  location: SessionLocation;
  view: Pick<ChatView, "busy" | "approvals" | "items" | "history">;
}

export interface SessionTile {
  id: string;
  name: string;
  /** Titre de la conversation courante (chaîne neutralisée), vide si aucune. */
  title: string;
  location: SessionLocation;
  state: SessionTileState;
  model: string;
  project: string;
  /** Date ISO de la dernière activité, `null` si la conversation n'est pas encore enregistrée. */
  updatedAt: string | null;
  approvals: number;
}

const TEXT_CAP = 120;

/** Le dernier élément du fil est une erreur de tour : tant que rien ne l'a suivi, le chat est en erreur. */
function hasTurnError(view: SessionGridChat["view"]): boolean {
  const last = view.items[view.items.length - 1];
  return last?.kind === "notice" && last.level === "error";
}

/** Approbation avant tout (le tour attend un humain), puis tour en cours, erreur, repos. */
function stateOf(view: SessionGridChat["view"]): SessionTileState {
  if (view.approvals.length > 0) return "approval";
  if (view.busy) return "busy";
  return hasTurnError(view) ? "error" : "idle";
}

const time = (tile: SessionTile): number => {
  if (tile.updatedAt === null) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(tile.updatedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * Tuiles triées : approbations d'abord (la plus ancienne en tête, d'après `waiting`, chats du plus
 * ancien au plus récent), puis erreurs, puis activité récente. À égalité, nom croissant.
 */
export function buildSessionGrid(
  chats: readonly SessionGridChat[],
  waiting: readonly string[] = [],
): SessionTile[] {
  const tiles = chats.map((chat): SessionTile => {
    const entry = chat.view.history.find((h) => h.current);
    return {
      id: chat.id,
      name: cleanText(chat.name, TEXT_CAP),
      title: cleanText(entry?.title ?? "", TEXT_CAP),
      location: chat.location,
      state: stateOf(chat.view),
      model: cleanText(entry?.model ?? "", TEXT_CAP),
      project: cleanText(entry?.projectLabel ?? "", TEXT_CAP),
      updatedAt: entry?.updatedAt ?? null,
      approvals: chat.view.approvals.length,
    };
  });
  const rank = (tile: SessionTile): number => {
    const at = waiting.indexOf(tile.id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  const group = (tile: SessionTile): number =>
    tile.state === "approval" ? 0 : tile.state === "error" ? 1 : 2;
  return tiles.sort((a, b) => {
    if (group(a) !== group(b)) return group(a) - group(b);
    if (a.state === "approval" && rank(a) !== rank(b)) return rank(a) - rank(b);
    if (time(a) !== time(b)) return time(b) - time(a);
    return a.name.localeCompare(b.name);
  });
}

/** Filtre « En attente de toi » : une approbation à répondre ou une erreur à regarder. */
export function filterSessionGrid(
  tiles: readonly SessionTile[],
  filter: SessionGridFilter,
): SessionTile[] {
  return filter === "awaiting"
    ? tiles.filter((tile) => tile.state === "approval" || tile.state === "error")
    : [...tiles];
}

/** Messages acceptés depuis la webview de la grille (non fiable) : prête, ou ouverture d'un chat. */
export type SessionsMessage = { type: "ready" } | { type: "open"; chatId: string };

const CHAT_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Aucune réponse d'approbation ne passe par ici : « open » ne fait que montrer le chat. */
export function parseSessionsMessage(raw: unknown): SessionsMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (m.type === "ready" && keys.length === 1) return { type: "ready" };
  if (
    m.type === "open" &&
    keys.length === 2 &&
    typeof m.chatId === "string" &&
    CHAT_ID.test(m.chatId)
  )
    return { type: "open", chatId: m.chatId };
  return null;
}
