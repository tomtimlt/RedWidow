import { type EngineEvent, parseJournal, promptForTargets, stripControl } from "@warband/core";
import type { ChatState } from "./chat.js";
import { type EffortChoice, isProvider, type Provider, parseEffortChoice } from "./effort.js";
import { isModelId } from "./models.js";

/**
 * Historique des conversations (ADR 0005, F4). Logique pure : un journal relu est une entrée NON FIABLE
 * (le disque peut avoir été modifié) ; rien de son contenu ne construit un chemin ni n'est exécuté.
 */

/** Forme d'un identifiant de run ou de conversation (UUID) : seul ce motif peut former un nom de fichier. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRunId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
export const isConversationId = isRunId;

export const MAX_CONVERSATIONS = 100;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_TITLE_CHARS = 120;
/** Limites de relecture d'un journal. */
export const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
export const MAX_JOURNAL_LINES = 50_000;
export const MAX_LINE_CHARS = 1_000_000;
const MAX_RUNS_PER_CONVERSATION = 500;

/** Entrée de l'index (stockée dans `workspaceState`, donc revalidée à chaque lecture). */
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: Provider;
  model: string | null;
  effort: EffortChoice | null;
  sessionId: string | null;
  runIds: string[];
  tools: number;
  /** Affichage seulement : jamais utilisé par le moteur, exec, politique ou gate. */
  projectId?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Titre affichable : contrôles retirés, espaces réduits, tronqué. `null` si vide. */
export function cleanTitle(raw: unknown, max = MAX_TITLE_CHARS): string | null {
  if (typeof raw !== "string") return null;
  const t = stripControl(raw).replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Titre d'une conversation : sa première consigne, tronquée. */
export const titleFrom = (firstPrompt: string): string =>
  cleanTitle(firstPrompt, 80) ?? "Conversation";

/** Relit l'index stocké : entrées mal formées ou doublons écartés, bornes appliquées. */
export function parseIndex(raw: unknown): ConversationMeta[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ConversationMeta[] = [];
  for (const item of raw.slice(0, MAX_CONVERSATIONS * 2)) {
    if (!isObj(item) || !isConversationId(item.id) || seen.has(item.id)) continue;
    if (item.provider !== undefined && !isProvider(item.provider)) continue;
    const title = cleanTitle(item.title);
    if (title === null || !isIso(item.createdAt) || !isIso(item.updatedAt)) continue;
    if (!Array.isArray(item.runIds)) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      ...(isRunId(item.projectId) && { projectId: item.projectId }),
      title,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      provider: isProvider(item.provider) ? item.provider : "claude",
      model: isModelId(item.model) ? item.model : null,
      effort: parseEffortChoice(item.effort),
      sessionId:
        typeof item.sessionId === "string" && item.sessionId.length <= 200 ? item.sessionId : null,
      runIds: item.runIds.filter(isRunId).slice(0, MAX_RUNS_PER_CONVERSATION),
      tools:
        typeof item.tools === "number" && Number.isInteger(item.tools) && item.tools >= 0
          ? item.tools
          : 0,
    });
  }
  return out;
}

/** Plus récentes d'abord. */
export const sortRecent = (list: readonly ConversationMeta[]): ConversationMeta[] =>
  [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

/** Métadonnées de projet destinées seulement au rangement des conversations. */
export interface HistoryProjects {
  activeId: string | null;
  projects: readonly { id: string; name: string }[];
}

/** Les ids orphelins restent distincts pour ne pas perdre leur association. */
export function historyProject(
  conversation: Pick<ConversationMeta, "projectId">,
  projects: HistoryProjects["projects"],
): { key: string; label: string } {
  if (!conversation.projectId) return { key: "none", label: "Sans projet" };
  const project = projects.find((p) => p.id === conversation.projectId);
  return {
    key: conversation.projectId,
    label: project ? (cleanTitle(project.name) ?? "Projet") : "Projet inconnu",
  };
}

export function groupHistoryByProject(
  conversations: readonly ConversationMeta[],
  projects: HistoryProjects["projects"],
): { key: string; label: string; conversations: ConversationMeta[] }[] {
  const groups = new Map<
    string,
    { key: string; label: string; conversations: ConversationMeta[] }
  >();
  for (const conversation of sortRecent(conversations)) {
    const project = historyProject(conversation, projects);
    const group = groups.get(project.key) ?? { ...project, conversations: [] };
    group.conversations.push(conversation);
    groups.set(project.key, group);
  }
  return [...groups.values()];
}

export interface RetentionOptions {
  maxCount?: number;
  maxBytes?: number;
  /** Conversation en cours : jamais purgée. */
  protect?: string | undefined;
}

/**
 * Rétention : on garde les plus récentes tant que le nombre et la taille cumulée respectent les plafonds.
 * `sizes` : octets des journaux par conversation.
 */
export function applyRetention(
  list: readonly ConversationMeta[],
  sizes: ReadonlyMap<string, number>,
  { maxCount = MAX_CONVERSATIONS, maxBytes = MAX_TOTAL_BYTES, protect }: RetentionOptions = {},
): { keep: ConversationMeta[]; drop: ConversationMeta[] } {
  const keep: ConversationMeta[] = [];
  const drop: ConversationMeta[] = [];
  let total = 0;
  for (const c of sortRecent(list)) {
    const size = sizes.get(c.id) ?? 0;
    if (c.id === protect || (keep.length < maxCount && total + size <= maxBytes)) {
      keep.push(c);
      total += size;
    } else {
      drop.push(c);
    }
  }
  return { keep, drop };
}

export interface ParsedJournal {
  events: EngineEvent[];
  /** Lignes ignorées : JSON invalide, événement inconnu, hors limites, ou d'un autre run. */
  invalid: number;
  /** Le journal dépassait les limites de taille ou de lignes : il n'est lu qu'en partie. */
  truncated: boolean;
}

/**
 * Parse un journal non fiable : chaque ligne passe par `validateEvent` (via `parseJournal`) ; les lignes
 * trop longues, au-delà du plafond de lignes ou portant un autre `runId` sont ignorées et comptées.
 */
export function parseUntrustedJournal(text: string, runId: string): ParsedJournal {
  let truncated = false;
  let invalid = 0;
  let source = text;
  if (source.length > MAX_JOURNAL_BYTES) {
    // Coupe sur la dernière ligne complète.
    source = source.slice(0, Math.max(source.lastIndexOf("\n", MAX_JOURNAL_BYTES), 0));
    truncated = true;
  }
  const lines = source.split("\n");
  if (lines.length > MAX_JOURNAL_LINES) {
    lines.length = MAX_JOURNAL_LINES;
    truncated = true;
  }
  const kept = lines.filter((line) => {
    if (line.length <= MAX_LINE_CHARS) return true;
    invalid++;
    return false;
  });
  const parsed = parseJournal(kept.join("\n"));
  invalid += parsed.issues.length;
  const events = parsed.events.filter((e) => {
    if (e.runId === runId) return true;
    invalid++;
    return false;
  });
  return { events, invalid, truncated };
}

/**
 * Rejoue des événements dans un état de chat vierge, en mode lecture : jamais de carte d'approbation
 * (seul `approval.decided` est relu), jamais d'action. Les journaux de la CLI (sans `user.message`)
 * montrent la consigne de `run.started`.
 */
export function replayEvents(state: ChatState, events: readonly EngineEvent[]): void {
  const withUser = new Set(events.filter((e) => e.kind === "user.message").map((e) => e.runId));
  for (const e of events) {
    if (e.kind === "user.message") state.user(promptForTargets(e.text));
    else if (e.kind === "run.started") {
      const shown = promptForTargets(e.prompt);
      if (shown !== "" && !withUser.has(e.runId)) state.user(shown);
    } else state.event(e);
  }
  state.approvals.clear();
  state.setBusy(false);
}
