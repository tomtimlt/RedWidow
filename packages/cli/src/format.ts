import type { AuthInfo, AuthMode, EngineEvent } from "@john-studio/core";
import { describeAuth, formatError, formatReason, summarizeOutput } from "@john-studio/messages";
import { stripControl } from "./sanitize.js";

export { summarizeOutput };

export interface FormatOptions {
  color: boolean;
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
export function formatEvent(e: EngineEvent, { color, verbose }: FormatOptions): string | null {
  const paint = (style: Style, text: string) =>
    color ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text;
  const tag = (style: Style, label: string) => paint(style, label.padEnd(9));

  switch (e.kind) {
    case "run.started":
      return `${tag("dim", "run")} ${e.prompt} ${paint("dim", `(${e.cwd})`)}`;
    case "agent.text":
      return `${tag("blue", "agent")} ${e.text}`;
    case "tool.requested": {
      const detail = stripControl(
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input),
      );
      const nested = e.agentToolUseId ? "↳ " : "";
      return `${tag("magenta", "tool")} ${nested}${e.tool} ${paint("dim", detail)}`;
    }
    case "approval.decided":
      return `${tag(e.decision === "allow" ? "green" : "red", e.decision)} ${paint("dim", `[${e.source}] ${formatReason(e.reason)}`)}`;
    case "tool.result": {
      const more = e.truncated ? paint("dim", ` [tronqué : ${e.bytes} octets]`) : "";
      return `${tag(e.isError ? "red" : "dim", "result")} ${summarizeOutput(stripControl(e.output))}${more}`;
    }
    case "process.started":
      return `${tag("yellow", "exec")} ${stripControl(e.argv.join(" "))}`;
    case "process.output":
      if (!verbose) return null;
      return `${tag("dim", e.stream)} ${stripControl(e.line)}${e.truncated ? paint("dim", " […]") : ""}`;
    case "process.exited": {
      const dropped = e.droppedLines
        ? paint("dim", ` · ${e.droppedLines} lignes non journalisées`)
        : "";
      const cause = e.termination
        ? paint(
            "dim",
            ` · ${e.termination === "timeout" ? "délai dépassé" : "annulé"}${e.forced ? " (SIGKILL)" : ""}`,
          )
        : "";
      return `${tag(e.code === 0 ? "yellow" : "red", "exit")} ${e.code ?? e.signal} ${paint("dim", `${e.durationMs} ms`)}${cause}${dropped}`;
    }
    case "run.finished": {
      const unhandled = Object.values(e.unhandledMessages ?? {}).reduce((n, c) => n + c, 0);
      const extra = unhandled > 0 ? paint("dim", ` · ${unhandled} messages non traduits`) : "";
      const sessionId = e.sessionId ? paint("dim", ` · session ${e.sessionId}`) : "";
      return `${tag(e.status === "success" ? "green" : "red", e.status)} ${e.turns} tours · $${e.costUsd.toFixed(4)}${sessionId}${extra}`;
    }
    case "error":
      return `${tag("red", "error")} ${stripControl(formatError(e))}`;
    case "session.started":
      return `${tag("dim", "session")} ${e.model} ${paint("dim", `${e.sessionId} · ${e.tools.length} outils${e.auth ? ` · ${describeAuth(e.auth)}` : ""}`)}`;
    case "auth.info":
      return `${tag("dim", "auth")} ${describeAuth(e)}${e.tokenSource ? paint("dim", ` · jeton : ${e.tokenSource}`) : ""}`;
    case "auth.status":
      return `${tag(e.error === undefined ? "yellow" : "red", "auth")} ${e.error ?? (e.isAuthenticating ? "authentification en cours" : "authentifié")}`;
    case "approval.requested": {
      const detail = stripControl(
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input),
      );
      return `${tag("yellow", "ask")} ${e.tool} ${paint("dim", `${detail} · ${formatReason(e.verdict)}`)}`;
    }
    case "turn.finished":
      return verbose
        ? `${tag("dim", "turn")} ${paint("dim", `${e.turns} tours · $${e.costUsd.toFixed(4)} · ${e.status}`)}`
        : null;
    case "agent.thinking":
      return e.redacted
        ? `${tag("dim", "thinking")} ${paint("dim", "(masquée)")}`
        : `${tag("dim", "thinking")} ${paint("dim", summarizeOutput(e.text))}`;
    case "permission.denied":
      return `${tag("red", "sdk-deny")} ${e.tool} ${paint("dim", e.message)}`;
    case "api.retry":
      return `${tag("yellow", "retry")} ${e.attempt}/${e.maxRetries} dans ${e.delayMs} ms ${paint("dim", `${e.error}${e.errorStatus === null ? "" : ` (HTTP ${e.errorStatus})`}`)}`;
    case "task.updated": {
      const detail = e.description ?? e.summary ?? "";
      const status = e.status ? ` [${e.status}]` : "";
      return `${tag("cyan", "task")} ${e.phase}${status} ${paint("dim", detail)}`;
    }
    case "rate.limited":
      return `${tag(e.status === "rejected" ? "red" : "yellow", "limit")} ${e.status}${e.limitType ? ` · ${e.limitType}` : ""}${e.utilization === undefined ? "" : ` · ${Math.round(e.utilization * 100)} %`}`;
    case "sink.error":
      return `${tag("red", "sink")} ${e.message}`;
    case "sandbox.started":
      return `${tag("cyan", "sandbox")} ${e.image} ${paint("dim", `${e.containerId.slice(0, 12)} · réseau ${e.network}`)}`;
    case "sandbox.stopped":
      return `${tag("cyan", "sandbox")} arrêté ${paint("dim", `${e.containerId.slice(0, 12)} · ${e.cause}`)}`;
    case "journal.truncated":
      return `${tag("red", "journal")} tronqué à ${e.limitBytes} octets · ${e.droppedEvents} événements perdus`;
  }
}

/**
 * Mode d'authentification attendu au lancement, d'après l'option `--auth` et
 * l'environnement (le mode effectif est confirmé par `session.started`/`auth.info`).
 */
export function describeAuthIntent(mode: AuthMode, env: NodeJS.ProcessEnv = process.env): string {
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
  const label = describeAuth(info);
  return mode === "auto" && hasKey ? `${label} (ANTHROPIC_API_KEY définie)` : label;
}

/** Une ligne par run d'un journal : identifiant, début, prompt, statut, nombre d'événements. */
export function formatRunList(runs: ReadonlyMap<string, readonly EngineEvent[]>): string[] {
  return [...runs].map(([runId, events]) => {
    const started = events.find((e) => e.kind === "run.started");
    const finished = events.findLast((e) => e.kind === "run.finished");
    const prompt = started?.kind === "run.started" ? summarizeOutput(started.prompt, 60) : "?";
    const status = finished?.kind === "run.finished" ? finished.status : "incomplet";
    return `${runId}\t${started?.ts ?? events[0]?.ts ?? ""}\t${status}\t${events.length} événements\t${prompt}`;
  });
}
