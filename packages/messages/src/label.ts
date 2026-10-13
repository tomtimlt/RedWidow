import type { EngineEvent } from "@john-studio/core";
import { DEFAULT_LOCALE, type Locale } from "./catalog.js";
import { formatError, formatReason, MESSAGES } from "./format.js";

/** Résumé d'une sortie sur une ligne (le journal garde le texte complet). */
export function summarizeOutput(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface LabelOptions {
  /** Longueur maximale des libellés qui reprennent du texte libre (défaut : 80). */
  maxLength?: number;
  locale?: Locale;
}

/** Libellé court d'un événement, en texte brut (l'échappement est à la charge du rendu). */
export function eventLabel(e: EngineEvent, options: LabelOptions = {}): string {
  const { maxLength = 80, locale = DEFAULT_LOCALE } = options;
  const t = MESSAGES[locale].events;
  const clip = (text: string) => summarizeOutput(text, maxLength);

  switch (e.kind) {
    case "run.started":
      return clip(`${t.run} : ${e.prompt}`);
    case "agent.text":
      return clip(e.text);
    case "tool.requested": {
      const detail =
        typeof e.input.command === "string"
          ? e.input.command
          : Object.keys(e.input).length > 0
            ? JSON.stringify(e.input)
            : "";
      return clip(`${e.tool} ${detail}`);
    }
    case "approval.decided":
      return clip(`${e.decision} (${e.source}) : ${formatReason(e.reason, locale)}`);
    case "tool.result":
      return clip(e.output);
    case "process.started":
      return clip(e.argv.join(" "));
    case "process.output":
      return clip(e.line);
    case "process.exited":
      return `exit ${e.code ?? e.signal} · ${e.durationMs} ms`;
    case "run.finished":
      return `${e.status} · ${e.turns} ${t.turns} · $${e.costUsd.toFixed(4)}`;
    case "error":
      return clip(formatError(e, locale));
    case "sink.error":
      return clip(e.message);
    case "session.started":
      return clip(`${t.session} ${e.model} · ${e.tools.length} ${t.tools}`);
    case "agent.thinking":
      return e.redacted ? t.thinkingMasked : clip(`${t.thinking} : ${e.text}`);
    case "permission.denied":
      return clip(`${t.deniedBySdk} : ${e.tool} · ${e.message}`);
    case "api.retry":
      return `${t.retry} ${e.attempt}/${e.maxRetries} · ${e.error}`;
    case "task.updated":
      return clip(`${t.task} ${e.phase} : ${e.description ?? e.summary ?? e.taskId}`);
    case "rate.limited":
      return clip(`${t.rateLimit} : ${e.status}`);
    case "journal.truncated":
      return `${t.journalTruncated} · ${e.droppedEvents} ${t.lostEvents}`;
  }
}
