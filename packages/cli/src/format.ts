import type { EngineEvent } from "@john-studio/core";
import { formatError, formatReason, summarizeOutput } from "@john-studio/messages";

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
      const detail =
        typeof e.input.command === "string" ? e.input.command : JSON.stringify(e.input);
      const nested = e.agentToolUseId ? "↳ " : "";
      return `${tag("magenta", "tool")} ${nested}${e.tool} ${paint("dim", detail)}`;
    }
    case "approval.decided":
      return `${tag(e.decision === "allow" ? "green" : "red", e.decision)} ${paint("dim", `[${e.source}] ${formatReason(e.reason)}`)}`;
    case "tool.result": {
      const more = e.truncated ? paint("dim", ` [tronqué : ${e.bytes} octets]`) : "";
      return `${tag(e.isError ? "red" : "dim", "result")} ${summarizeOutput(e.output)}${more}`;
    }
    case "process.started":
      return `${tag("yellow", "exec")} ${e.argv.join(" ")}`;
    case "process.output":
      if (!verbose) return null;
      return `${tag("dim", e.stream)} ${e.line}${e.truncated ? paint("dim", " […]") : ""}`;
    case "process.exited": {
      const dropped = e.droppedLines
        ? paint("dim", ` · ${e.droppedLines} lignes non journalisées`)
        : "";
      return `${tag(e.code === 0 ? "yellow" : "red", "exit")} ${e.code ?? e.signal} ${paint("dim", `${e.durationMs} ms`)}${dropped}`;
    }
    case "run.finished": {
      const unhandled = Object.values(e.unhandledMessages ?? {}).reduce((n, c) => n + c, 0);
      const extra = unhandled > 0 ? paint("dim", ` · ${unhandled} messages non traduits`) : "";
      return `${tag(e.status === "success" ? "green" : "red", e.status)} ${e.turns} tours · $${e.costUsd.toFixed(4)}${extra}`;
    }
    case "error":
      return `${tag("red", "error")} ${formatError(e)}`;
    case "session.started":
      return `${tag("dim", "session")} ${e.model} ${paint("dim", `${e.sessionId} · ${e.tools.length} outils`)}`;
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
    case "journal.truncated":
      return `${tag("red", "journal")} tronqué à ${e.limitBytes} octets · ${e.droppedEvents} événements perdus`;
  }
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
