import type { AuthInfo, EngineEvent } from "@john-studio/core";
import { DEFAULT_LOCALE, type Locale } from "./catalog.js";
import { formatError, formatReason, MESSAGES } from "./format.js";

/** Résumé d'une sortie sur une ligne (le journal garde le texte complet). */
export function summarizeOutput(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** `subscriptionType` est repris tel que le moteur le donne (`pro`, `max`…). */
const CLOUD_PROVIDERS = new Set(["bedrock", "vertex", "foundry", "anthropicAws", "mantle"]);
/** Valeurs de `apiKeySource` qui désignent une connexion d'abonnement (OAuth) plutôt qu'une clé. */
const SUBSCRIPTION_SOURCES = new Set(["none", "oauth"]);

/**
 * Mode d'authentification en clair : « abonnement pro », « clé API »,
 * « fournisseur cloud (bedrock) »… `subscriptionType: null` est ignoré.
 */
export function describeAuth(auth: AuthInfo, locale: Locale = DEFAULT_LOCALE): string {
  const t = MESSAGES[locale].events;
  if (auth.apiProvider !== undefined && CLOUD_PROVIDERS.has(auth.apiProvider)) {
    return `${t.authCloud} (${auth.apiProvider})`;
  }
  if (auth.subscriptionType) return `${t.authSubscription} ${auth.subscriptionType}`;
  if (auth.apiKeySource === undefined) return t.authUnknown;
  return SUBSCRIPTION_SOURCES.has(auth.apiKeySource) ? t.authSubscription : t.authApiKey;
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
    case "user.message":
      return clip(`${t.user} : ${e.text}`);
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
      return `exit ${e.code ?? e.signal} · ${e.durationMs} ms${e.termination ? ` · ${e.termination}` : ""}${e.forced ? " · SIGKILL" : ""}`;
    case "run.finished":
      return `${e.status} · ${e.turns} ${t.turns} · $${e.costUsd.toFixed(4)}`;
    case "error":
      return clip(formatError(e, locale));
    case "sink.error":
      return clip(e.message);
    case "session.started":
      return clip(
        `${t.session} ${e.model} · ${e.tools.length} ${t.tools}${e.auth ? ` · ${describeAuth(e.auth, locale)}` : ""}`,
      );
    case "auth.info":
      return clip(`${t.authentication} : ${describeAuth(e, locale)}`);
    case "auth.status":
      return clip(
        e.error !== undefined
          ? `${t.authentication} : ${e.error}`
          : `${t.authentication} : ${e.isAuthenticating ? t.authenticating : "ok"}`,
      );
    case "approval.requested": {
      const detail =
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input);
      return clip(`${t.approvalRequested} : ${e.tool} ${detail}`);
    }
    case "turn.finished":
      return `${t.turn} ${e.turns} · ${e.status} · $${e.costUsd.toFixed(4)}`;
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
    case "sandbox.started":
      return clip(`${t.sandbox} : ${e.image} · ${e.network}`);
    case "sandbox.stopped":
      return `${t.sandbox} : ${e.cause}`;
    case "journal.truncated":
      return `${t.journalTruncated} · ${e.droppedEvents} ${t.lostEvents}`;
  }
}
