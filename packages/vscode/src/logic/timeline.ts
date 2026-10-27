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
