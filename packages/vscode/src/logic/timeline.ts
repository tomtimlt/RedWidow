import { type EngineEvent, promptForTargets } from "@warband/core";
import { createChatState } from "./chat.js";
import { parseUntrustedJournal } from "./history.js";
import type { JournalFiles } from "./historyStore.js";

/** Relit les journaux de CETTE conversation dans une fenêtre bornée, jamais dans un tableau global. */
export async function readConversationPage(
  files: JournalFiles,
  runIds: readonly string[],
  before: string | undefined,
  isCurrent: () => boolean,
) {
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
