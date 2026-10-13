/**
 * Analyse statique minimale d'une ligne de commande POSIX, suffisante pour
 * décider d'une approbation. Ne tente PAS d'évaluer le shell : tout ce qui
 * ne peut pas être résolu statiquement est signalé via `hazards`.
 */

export type ShellHazard =
  | "substitution" // $(…), `…`, <(…), >(…)
  | "expansion" // $VAR, ${…}, globs et accolades non quotés, ~
  | "redirect" // >, <, >>, 2>&1…
  | "assignment" // FOO=bar cmd
  | "background" // cmd &
  | "indirection"; // bash -c, env, xargs, find -exec… : exécute une autre commande

export interface ParsedCommand {
  /** Commandes simples séparées par ; && || | & ou saut de ligne. */
  segments: string[][];
  hazards: Set<ShellHazard>;
}

export type ParseResult = { ok: true; value: ParsedCommand } | { ok: false; error: string };

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function parseShell(input: string): ParseResult {
  const segments: string[][] = [];
  const hazards = new Set<ShellHazard>();
  let segment: string[] = [];
  let token = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;

  const pushToken = () => {
    if (!inToken) return;
    if (segment.length === 0 && ASSIGNMENT.test(token)) hazards.add("assignment");
    segment.push(token);
    token = "";
    inToken = false;
  };
  const pushSegment = () => {
    pushToken();
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i] as string;
    const next = input[i + 1];

    if (quote === "'") {
      if (c === "'") quote = null;
      else token += c;
      continue;
    }

    if (quote === '"') {
      if (c === '"') {
        quote = null;
      } else if (c === "\\" && next !== undefined && '$`"\\\n'.includes(next)) {
        if (next !== "\n") token += next;
        i++;
      } else {
        if (c === "`" || (c === "$" && next === "(")) hazards.add("substitution");
        else if (c === "$" && next !== undefined && /[A-Za-z_{0-9@*#?$!-]/.test(next))
          hazards.add("expansion");
        token += c;
      }
      continue;
    }

    switch (c) {
      case "'":
      case '"':
        quote = c;
        inToken = true;
        break;
      case "\\":
        if (next === undefined) return { ok: false, error: "backslash final" };
        if (next !== "\n") {
          token += next;
          inToken = true;
        }
        i++;
        break;
      case " ":
      case "\t":
        pushToken();
        break;
      case "\n":
      case ";":
        pushSegment();
        break;
      case "|":
        pushSegment();
        if (next === "|") i++;
        break;
      case "&":
        if (next === "&") {
          i++;
        } else if (input[i - 1] !== ">" && next !== ">") {
          hazards.add("background");
        }
        pushSegment();
        break;
      case ">":
      case "<":
        if (next === "(") hazards.add("substitution");
        else hazards.add("redirect");
        pushToken();
        break;
      case "`":
        hazards.add("substitution");
        token += c;
        inToken = true;
        break;
      case "$":
        if (next === "(") hazards.add("substitution");
        else if (next === "'" || next === '"')
          hazards.add("expansion"); // $'\x72m', $"…"
        else if (next !== undefined && /[A-Za-z_{0-9@*#?$!-]/.test(next)) hazards.add("expansion");
        token += c;
        inToken = true;
        break;
      case "#":
        if (!inToken) {
          while (i < input.length && input[i] !== "\n") i++;
          i--;
          break;
        }
        token += c;
        break;
      case "*":
      case "?":
      case "[":
      case "{":
        hazards.add("expansion");
        token += c;
        inToken = true;
        break;
      case "~":
        if (!inToken) hazards.add("expansion");
        token += c;
        inToken = true;
        break;
      default:
        token += c;
        inToken = true;
    }
  }

  if (quote !== null) return { ok: false, error: `guillemet ${quote} non fermé` };
  pushSegment();
  if (segments.some(runsOtherCommand)) hazards.add("indirection");
  return { ok: true, value: { segments, hazards } };
}

/** Commandes dont le rôle est d'en exécuter une autre : l'analyse statique ne voit pas la vraie. */
const WRAPPERS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "env",
  "xargs",
  "eval",
  "exec",
  "command",
  "builtin",
  "nohup",
  "timeout",
  "nice",
  "time",
  "watch",
  "su",
  "sudo",
  "doas",
  "setsid",
  "stdbuf",
  "script",
]);
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete"]);

/** Nom de base d'un programme, `/usr/bin/env` → `env`. */
export function programName(word: string | undefined): string {
  return (
    (word ?? "")
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase()
      .replace(/\.exe$/, "") ?? ""
  );
}

function runsOtherCommand(argv: readonly string[]): boolean {
  const name = programName(argv[0]);
  if (WRAPPERS.has(name)) return true;
  return name === "find" && argv.some((a) => FIND_EXEC.has(a));
}

/**
 * Motif de commande : jetons séparés par des espaces. `*` en milieu de motif
 * accepte exactement un argument ; `*` final accepte zéro ou plusieurs
 * arguments. Sans `*` final, la correspondance est exacte.
 *
 *   "docker ps"          → docker ps
 *   "docker logs *"      → docker logs, docker logs -f web, …
 *   "docker * --help"    → docker run --help, docker ps --help
 */
export function matchCommand(pattern: string, argv: readonly string[]): boolean {
  const parts = pattern.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const trailing = parts[parts.length - 1] === "*";
  const fixed = trailing ? parts.slice(0, -1) : parts;
  if (trailing ? argv.length < fixed.length : argv.length !== fixed.length) return false;
  return fixed.every((p, i) => p === "*" || p === argv[i]);
}
