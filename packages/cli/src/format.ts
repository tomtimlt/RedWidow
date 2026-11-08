import type { AuthInfo, AuthMode, EngineEvent } from "@warband/core";
import {
  DEFAULT_LOCALE,
  describeAuth,
  formatError,
  formatReason,
  type Locale,
  summarizeOutput,
} from "@warband/messages";
import { stripControl } from "./sanitize.js";

export { summarizeOutput };

export interface FormatOptions {
  color: boolean;
  locale?: Locale;
  /** Afficher chaque ligne de sortie des processus. */
  verbose: boolean;
}

const CODES = { dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36 } as const;
type Style = keyof typeof CODES;

export function colorEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return stream.isTTY === true;
}

/** Rend un événement en une ligne de terminal, ou `null` s'il est masqué. */
export function formatEvent(
  e: EngineEvent,
  { color, verbose, locale = DEFAULT_LOCALE }: FormatOptions,
): string | null {
  const t = (fr: string, en: string) => (locale === "en" ? en : fr);
  const paint = (style: Style, text: string) =>
    color ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text;
  const tag = (style: Style, label: string) => paint(style, label.padEnd(9));

  switch (e.kind) {
    case "mission.decision":
      return `${tag("dim", t("décision", "decision"))} ${stripControl(e.decision.objective)}`;
    case "research.status":
      return `${tag("dim", t("recherche", "research"))} ${e.status}`;
    case "audit.test":
      return `${e.kind} : ${e.claim.objective}`;
    case "audit.coverage":
      return `${e.kind} : ${e.cells.length} ${t("case(s)", "cell(s)")}`;
    case "run.started":
      return `${tag("dim", "run")} ${e.prompt} ${paint("dim", `(${e.cwd})`)}`;
    case "agent.text":
      return `${tag("blue", "agent")} ${e.text}`;
    case "user.message":
      return `${tag("green", "user")} ${stripControl(e.text)}`;
    case "tool.requested": {
      const detail = stripControl(
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input),
      );
      const nested = e.agentToolUseId ? "↳ " : "";
      return `${tag("magenta", "tool")} ${nested}${e.tool} ${paint("dim", detail)}`;
    }
    case "approval.decided":
      return `${tag(e.decision === "allow" ? "green" : "red", e.decision)} ${paint("dim", `[${e.source}] ${formatReason(e.reason, locale)}`)}`;
    case "bypass.changed":
      return `${tag(e.state === "on" ? "yellow" : "dim", "bypass")} ${paint("dim", formatReason(e.reason, locale))}`;
    case "program.state":
      return `${tag(e.state === "approved" ? "green" : "yellow", "program")} ${paint("dim", `${e.state} [${e.digest.slice(0, 12)}]`)}`;
    case "tool.result": {
      const more = e.truncated
        ? paint("dim", t(` [tronqué : ${e.bytes} octets]`, ` [truncated: ${e.bytes} bytes]`))
        : "";
      return `${tag(e.isError ? "red" : "dim", "result")} ${summarizeOutput(stripControl(e.output))}${more}`;
    }
    case "process.started":
      return `${tag("yellow", "exec")} ${stripControl(e.argv.join(" "))}`;
    case "process.output":
      if (!verbose) return null;
      return `${tag("dim", e.stream)} ${stripControl(e.line)}${e.truncated ? paint("dim", " […]") : ""}`;
    case "process.exited": {
      const dropped = e.droppedLines
        ? paint(
            "dim",
            t(
              ` · ${e.droppedLines} lignes non journalisées`,
              ` · ${e.droppedLines} lines not logged`,
            ),
          )
        : "";
      const cause = e.termination
        ? paint(
            "dim",
            ` · ${e.termination === "timeout" ? t("délai dépassé", "timed out") : t("annulé", "cancelled")}${e.forced ? " (SIGKILL)" : ""}`,
          )
        : "";
      return `${tag(e.code === 0 ? "yellow" : "red", "exit")} ${e.code ?? e.signal} ${paint("dim", `${e.durationMs} ms`)}${cause}${dropped}`;
    }
    case "run.finished": {
      const unhandled = Object.values(e.unhandledMessages ?? {}).reduce((n, c) => n + c, 0);
      const extra =
        unhandled > 0
          ? paint(
              "dim",
              t(` · ${unhandled} messages non traduits`, ` · ${unhandled} unhandled messages`),
            )
          : "";
      const sessionId = e.sessionId ? paint("dim", ` · session ${e.sessionId}`) : "";
      return `${tag(e.status === "success" ? "green" : "red", e.status)} ${e.turns} ${t("tours", "turns")} · $${e.costUsd.toFixed(4)}${sessionId}${extra}`;
    }
    case "error":
      return `${tag("red", "error")} ${stripControl(formatError(e, locale))}`;
    case "session.started":
      return `${tag("dim", "session")} ${e.model} ${paint("dim", `${e.sessionId} · ${e.tools.length} ${t("outils", "tools")}${e.auth ? ` · ${describeAuth(e.auth, locale)}` : ""}`)}`;
    case "auth.info":
      return `${tag("dim", "auth")} ${describeAuth(e, locale)}${e.tokenSource ? paint("dim", t(` · jeton : ${e.tokenSource}`, ` · token: ${e.tokenSource}`)) : ""}`;
    case "auth.status":
      return `${tag(e.error === undefined ? "yellow" : "red", "auth")} ${e.error ?? (e.isAuthenticating ? t("authentification en cours", "authenticating") : t("authentifié", "authenticated"))}`;
    case "approval.requested": {
      const detail = stripControl(
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input),
      );
      return `${tag("yellow", "ask")} ${e.tool} ${paint("dim", `${detail} · ${formatReason(e.verdict, locale)}`)}`;
    }
    case "turn.finished":
      return verbose
        ? `${tag("dim", "turn")} ${paint("dim", `${e.turns} ${t("tours", "turns")} · $${e.costUsd.toFixed(4)} · ${e.status}`)}`
        : null;
    case "context.usage":
      return verbose
        ? `${tag("dim", "contexte")} ${paint("dim", `${e.usedTokens}${e.windowTokens === undefined ? "" : ` / ${e.windowTokens}`} tokens`)}`
        : null;
    case "agent.thinking":
      return e.redacted
        ? `${tag("dim", "thinking")} ${paint("dim", t("(masquée)", "(hidden)"))}`
        : `${tag("dim", "thinking")} ${paint("dim", summarizeOutput(e.text))}`;
    case "permission.denied":
      return `${tag("red", "sdk-deny")} ${e.tool} ${paint("dim", e.message)}`;
    case "api.retry":
      return `${tag("yellow", "retry")} ${e.attempt}/${e.maxRetries} ${t("dans", "in")} ${e.delayMs} ms ${paint("dim", `${e.error}${e.errorStatus === null ? "" : ` (HTTP ${e.errorStatus})`}`)}`;
    case "task.updated": {
      const detail = e.description ?? e.summary ?? "";
      const status = e.status ? ` [${e.status}]` : "";
      return `${tag("cyan", "task")} ${e.phase}${status} ${paint("dim", detail)}`;
    }
    case "rate.limited":
      return `${tag(e.status === "rejected" ? "red" : "yellow", "limit")} ${e.status}${e.limitType ? ` · ${e.limitType}` : ""}${e.utilization === undefined ? "" : ` · ${Math.round(e.utilization * 100)} %`}`;
    case "pace.adjusted":
      return `${tag("yellow", "rythme")} ${stripControl(e.host)} ${e.fromRps} → ${e.toRps} req/s ${paint("dim", e.cause)}`;
    case "pace.halted":
      return `${tag("red", "rythme")} hôte arrêté ${stripControl(e.host)} ${paint("dim", e.cause)}`;
    case "sink.error":
      return `${tag("red", "sink")} ${e.message}`;
    case "sandbox.started":
      return `${tag("cyan", "sandbox")} ${stripControl(e.image)} ${paint("dim", `${stripControl(e.containerId.slice(0, 12))} · ${t("réseau", "network")} ${stripControl(e.network)}`)}`;
    case "sandbox.stopped":
      return `${tag("cyan", "sandbox")} ${t("arrêté", "stopped")} ${paint("dim", `${stripControl(e.containerId.slice(0, 12))} · ${stripControl(e.cause)}`)}`;
    case "journal.truncated":
      return `${tag("red", "journal")} ${t(`tronqué à ${e.limitBytes} octets · ${e.droppedEvents} événements perdus`, `truncated at ${e.limitBytes} bytes · ${e.droppedEvents} events lost`)}`;
  }
}

/**
 * Mode d'authentification attendu au lancement, d'après l'option `--auth` et
 * l'environnement (le mode effectif est confirmé par `session.started`/`auth.info`).
 */
export function describeAuthIntent(
  mode: AuthMode,
  env: NodeJS.ProcessEnv = process.env,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  const provider = (["BEDROCK", "VERTEX", "FOUNDRY"] as const).find(
    (name) => env[`CLAUDE_CODE_USE_${name}`],
  );
  const info: AuthInfo =
    mode === "subscription"
      ? { apiKeySource: "none" }
      : mode === "api-key" || hasKey
        ? { apiKeySource: "ANTHROPIC_API_KEY" }
        : provider
          ? { apiKeySource: "none", apiProvider: provider.toLowerCase() }
          : { apiKeySource: "none" };
  const label = describeAuth(info, locale);
  return mode === "auto" && hasKey
    ? `${label} (ANTHROPIC_API_KEY ${locale === "en" ? "set" : "définie"})`
    : label;
}

/** Une ligne par run d'un journal : identifiant, début, prompt, statut, nombre d'événements. */
export function formatRunList(
  runs: ReadonlyMap<string, readonly EngineEvent[]>,
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  return [...runs].map(([runId, events]) => {
    const started = events.find((e) => e.kind === "run.started");
    const finished = events.findLast((e) => e.kind === "run.finished");
    const prompt = started?.kind === "run.started" ? summarizeOutput(started.prompt, 60) : "?";
    const status =
      finished?.kind === "run.finished"
        ? finished.status
        : locale === "en"
          ? "incomplete"
          : "incomplet";
    return `${runId}\t${started?.ts ?? events[0]?.ts ?? ""}\t${status}\t${events.length} ${locale === "en" ? "events" : "événements"}\t${prompt}`;
  });
}
