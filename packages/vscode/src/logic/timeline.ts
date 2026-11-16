import { type EngineEvent, promptForTargets } from "@warband/core";
import { cleanText } from "./approval.js";
import { createChatState, type ItemAgent } from "./chat.js";
import { type ConversationAgents, parseUntrustedJournal } from "./history.js";
import type { JournalFiles } from "./historyStore.js";

/** Relit les journaux de CETTE conversation dans une fenêtre bornée, jamais dans un tableau global. */
export async function readConversationPage(
  files: JournalFiles,
  runIds: readonly string[],
  before: string | undefined,
  isCurrent: () => boolean,
  agents?: ConversationAgents,
) {
  if (agents && runIds.some((runId) => agents[runId] !== undefined))
    return await readCampaignConversation(files, runIds, before, isCurrent, agents);
  const state = createChatState(before);
  let invalid = 0;
  let missing = 0;
  let truncated = false;
  for (const runId of runIds) {
    if (!isCurrent()) return null;
    let fallback: { text: string; source: string } | undefined;
    const visit = (event: EngineEvent) => {
      if (!isCurrent()) return false;
      const source = `${event.runId}/${event.id}`;
      if (event.kind === "run.started") fallback = { text: promptForTargets(event.prompt), source };
      else if (event.kind === "user.message") {
        fallback = undefined;
        state.user(promptForTargets(event.text), source);
      } else {
        if (fallback && ["agent.text", "tool.requested", "run.finished"].includes(event.kind)) {
          if (fallback.text) state.user(fallback.text, fallback.source);
          fallback = undefined;
        }
        state.event(event);
      }
      return true;
    };
    if (files.scan) {
      const result = await files.scan(runId, visit);
      invalid += result.invalid;
      if (result.missing) missing++;
    } else {
      // Compatibilité avec les hôtes/tests qui fournissent l'ancien contrat de lecture bornée.
      const text = await files.read(runId);
      if (text === null) {
        missing++;
        continue;
      }
      const result = parseUntrustedJournal(text, runId);
      invalid += result.invalid;
      truncated ||= result.truncated;
      for (const event of result.events) if (!visit(event)) return null;
    }
    if (fallback?.text) state.user(fallback.text, fallback.source);
  }
  if (!isCurrent()) return null;
  state.approvals.clear();
  state.setBusy(false);
  return { state, invalid, missing, truncated };
}

/** Lit un journal complet (événements validés), par `scan` ou par l'ancien contrat `read`. */
async function readEvents(
  files: JournalFiles,
  runId: string,
  visit: (event: EngineEvent) => boolean,
): Promise<{ invalid: number; missing: boolean; truncated: boolean }> {
  if (files.scan) {
    const result = await files.scan(runId, visit);
    return { ...result, truncated: false };
  }
  const text = await files.read(runId);
  if (text === null) return { invalid: 0, missing: true, truncated: false };
  const result = parseUntrustedJournal(text, runId);
  for (const event of result.events) if (!visit(event)) break;
  return { invalid: result.invalid, missing: false, truncated: result.truncated };
}

/** Événements `campaign.*` d'un journal de campagne relu (non fiable), ou `null` s'il est absent. */
export async function readCampaignJournal(
  files: JournalFiles,
  runId: string,
): Promise<EngineEvent[] | null> {
  const events: EngineEvent[] = [];
  const result = await readEvents(files, runId, (event) => {
    if (event.kind.startsWith("campaign.")) events.push(event);
    return true;
  });
  return result.missing ? null : events;
}

/**
 * Conversation de campagne (ADR 0054) : les journaux du planificateur et des workers sont fondus dans
 * l'ordre chronologique (horodatage, puis ordre des runs, puis rang), chaque élément porte son agent.
 * Le journal de campagne n'est pas une transcription : il donne l'objectif (consigne de l'utilisateur)
 * et le titre de l'intention de chaque worker.
 */
async function readCampaignConversation(
  files: JournalFiles,
  runIds: readonly string[],
  before: string | undefined,
  isCurrent: () => boolean,
  agents: ConversationAgents,
) {
  type Entry = {
    ts: number;
    run: number;
    seq: number;
    user?: { text: string; source: string };
    event?: EngineEvent;
    runId?: string;
  };
  const entries: Entry[] = [];
  let invalid = 0;
  let missing = 0;
  let truncated = false;
  /** `workerRunId` → titre de l'intention qu'il traitait (lu dans le journal de campagne). */
  const workerTitle = new Map<string, string>();
  const at = (ts: string): number => {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  for (const [run, runId] of runIds.entries()) {
    if (!isCurrent()) return null;
    const agent = agents[runId];
    let fallback: { text: string; source: string; ts: number; seq: number } | undefined;
    const titles = new Map<string, string>();
    const visit = (event: EngineEvent) => {
      if (!isCurrent()) return false;
      const source = `${event.runId}/${event.id}`;
      const base = { ts: at(event.ts), run, seq: event.seq };
      if (agent?.role === "campaign") {
        if (event.kind === "campaign.started" && event.resumedFrom === undefined)
          entries.push({ ...base, user: { text: promptForTargets(event.objective), source } });
        else if (event.kind === "campaign.intent.opened") titles.set(event.intentId, event.title);
        else if (event.kind === "campaign.intent.claimed") {
          const title = titles.get(event.intentId);
          if (title !== undefined) workerTitle.set(event.workerRunId, title);
        }
        return true;
      }
      if (agent !== undefined) {
        entries.push({ ...base, event, runId });
        return true;
      }
      // Run ordinaire de la même conversation : même repli que la lecture simple.
      if (event.kind === "run.started") {
        fallback = { text: promptForTargets(event.prompt), source, ...base };
      } else if (event.kind === "user.message") {
        fallback = undefined;
        entries.push({ ...base, user: { text: promptForTargets(event.text), source } });
      } else {
        if (fallback && ["agent.text", "tool.requested", "run.finished"].includes(event.kind)) {
          if (fallback.text)
            entries.push({
              ts: fallback.ts,
              run,
              seq: fallback.seq,
              user: { text: fallback.text, source: fallback.source },
            });
          fallback = undefined;
        }
        entries.push({ ...base, event });
      }
      return true;
    };
    const result = await readEvents(files, runId, visit);
    invalid += result.invalid;
    if (result.missing) missing++;
    truncated ||= result.truncated;
    if (fallback?.text)
      entries.push({
        ts: fallback.ts,
        run,
        seq: fallback.seq,
        user: { text: fallback.text, source: fallback.source },
      });
  }
  if (!isCurrent()) return null;
  entries.sort((a, b) => a.ts - b.ts || a.run - b.run || a.seq - b.seq);
  const state = createChatState(before);
  for (const entry of entries) {
    if (entry.user) {
      state.user(entry.user.text, entry.user.source);
      continue;
    }
    if (!entry.event) continue;
    const info = entry.runId === undefined ? undefined : agents[entry.runId];
    if (entry.runId === undefined || info === undefined || info.role === "campaign") {
      state.event(entry.event);
      continue;
    }
    const intent = workerTitle.get(entry.runId);
    const label: ItemAgent = {
      role: info.role,
      index: info.index,
      ...(intent !== undefined && { intent: cleanText(intent, 200) }),
    };
    state.event(entry.event, label);
  }
  state.approvals.clear();
  state.setBusy(false);
  return { state, invalid, missing, truncated };
}

/** Trouve un échange adjacent par lecture séquentielle, sans stocker les événements. */
export async function findAdjacentExchange(
  files: JournalFiles,
  runIds: readonly string[],
  anchor: string,
  direction: "older" | "newer",
  isCurrent: () => boolean,
) {
  type Exchange = { source: string; before?: string };
  let last: Exchange | undefined;
  let target: Exchange | undefined;
  let found = false;
  let done = false;
  const exchange = (source: string) => {
    if (direction === "older" && source === anchor) {
      target = last;
      found = true;
      done = true;
    } else if (direction === "newer" && found && !target) {
      target = { source };
    } else if (source === anchor) found = true;
    last = { source };
  };
  for (const runId of runIds) {
    if (!isCurrent()) return null;
    let fallback: { source: string; text: string } | undefined;
    const visit = (event: EngineEvent) => {
      if (!isCurrent()) return false;
      const source = `${event.runId}/${event.id}`;
      if (event.kind !== "run.started") {
        if (last && !last.before) last.before = source;
        if (target && !target.before && target.source !== source) target.before = source;
        if (direction === "newer" && target?.before) {
          done = true;
          return false;
        }
      }
      if (event.kind === "run.started") fallback = { source, text: promptForTargets(event.prompt) };
      else if (event.kind === "user.message") {
        fallback = undefined;
        exchange(source);
      } else {
        if (fallback && ["agent.text", "tool.requested", "run.finished"].includes(event.kind)) {
          if (fallback.text) {
            exchange(fallback.source);
            if (last) last.before = source;
            if (target && target.source === fallback.source) target.before = source;
          }
          fallback = undefined;
        }
        if (!done && event.kind === "agent.text" && event.text.trim()) exchange(source);
      }
      return !done;
    };
    if (files.scan) {
      await files.scan(runId, visit);
    } else {
      const text = await files.read(runId);
      if (text !== null) {
        const parsed = parseUntrustedJournal(text, runId);
        for (const event of parsed.events) if (!visit(event)) break;
      }
    }
    if (fallback?.text && !done) exchange(fallback.source);
    if (done) break;
  }
  return isCurrent() ? { found, target } : null;
}
