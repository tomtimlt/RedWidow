import type { EngineEvent } from "@john-studio/core";

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
      return `${tag("magenta", "tool")} ${e.tool} ${paint("dim", detail)}`;
    }
    case "approval.decided":
      return `${tag(e.decision === "allow" ? "green" : "red", e.decision)} ${paint("dim", `[${e.source}] ${e.reason}`)}`;
    case "tool.result":
      return `${tag(e.isError ? "red" : "dim", "result")} ${e.summary}`;
    case "process.started":
      return `${tag("yellow", "exec")} ${e.argv.join(" ")}`;
    case "process.output":
      if (!verbose) return null;
      return `${tag("dim", e.stream)} ${e.line}`;
    case "process.exited":
      return `${tag(e.code === 0 ? "yellow" : "red", "exit")} ${e.code ?? e.signal} ${paint("dim", `${e.durationMs} ms`)}`;
    case "run.finished":
      return `${tag(e.status === "success" ? "green" : "red", e.status)} ${e.turns} tours · $${e.costUsd.toFixed(4)}`;
    case "error":
      return `${tag("red", "error")} ${e.message}`;
  }
}
