import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Correlation } from "../events.js";
import { CodedError, ValidationError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { LineSplitter } from "./lines.js";
import { spawnOptionsForTree, terminateProcessTree, trackProcessTree } from "./terminate.js";

const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TZ",
  "TMPDIR",
  "TERM",
  "XDG_RUNTIME_DIR",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  // Windows (comparés en majuscules)
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "SYSTEMDRIVE",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "USERNAME",
  "COMPUTERNAME",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "TEMP",
  "TMP",
]);

/**
 * Environnement minimal transmis aux processus enfants : liste blanche, pour
 * ne pas leur faire hériter `ANTHROPIC_API_KEY` ni les autres secrets du
 * processus parent.
 */
export function safeEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  // Windows : les clés sont insensibles à la casse (`Path`/`PATH`) ; une seule occurrence par clé.
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!(ENV_ALLOWLIST.has(upper) || upper.startsWith("LC_"))) continue;
    if (platform === "win32") {
      if (seen.has(upper)) continue;
      seen.add(upper);
    }
    out[name] = value;
  }
  return out;
}

export interface RunProcessOptions {
  recorder: Recorder;
  parentId?: string | null;
  cwd?: string;
  /** Environnement de l'enfant. Par défaut : `safeEnv()` (liste blanche, sans secrets). */
  env?: NodeJS.ProcessEnv;
  /** Annulation : termine l'enfant et ses descendants (SIGTERM, puis SIGKILL après `killGraceMs`). */
  signal?: AbortSignal;
  /** Durée maximale d'exécution (sans défaut) ; même terminaison que l'annulation. */
  timeoutMs?: number;
  /** Délai entre SIGTERM et SIGKILL lors d'une annulation ou d'un timeout. Défaut : 5000 ms. */
  killGraceMs?: number;
  /** Plafond de lignes conservées en mémoire dans le résultat (le journal reçoit tout). */
  maxCapturedLines?: number;
  /** Plafond de lignes de sortie émises dans le journal (au-delà : comptées dans `droppedLines`). Défaut : 10 000. */
  maxJournaledLines?: number;
  /** Longueur maximale d'une ligne de sortie (voir `LineSplitter`). */
  maxLineLength?: number;
  /** Fiabilité du rattachement à l'appel d'outil parent, consignée dans `process.started`. */
  correlation?: Correlation;
  /**
   * Texte écrit sur l'entrée standard, puis fermée. Absent : `stdio` vaut `ignore`,
   * comme si l'entrée n'était pas branchée.
   */
  stdin?: string;
}

export interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: string[];
  stderr: string[];
  durationMs: number;
  /** Cause de la terminaison demandée ; absent pour une fin naturelle. */
  termination?: "abort" | "timeout";
  /** Vrai si un SIGKILL a été nécessaire. */
  forced?: boolean;
}

/** CreateProcess : 32 767 caractères, NUL final compris. */
const WIN32_MAX_COMMAND_LINE = 32_766;

/**
 * Borne haute de la ligne de commande (unités UTF-16) sous Windows : guillemets, espace et un
 * caractère d'échappement par `\` et `"` majorent la mise entre guillemets de libuv. `null` hors
 * win32 : `ARG_MAX` dépend de l'environnement, on s'appuie alors sur E2BIG.
 */
export function commandLineLength(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): number | null {
  if (platform !== "win32") return null;
  let total = 0;
  for (const a of argv) total += a.length + 3 + (a.match(/[\\"]/g)?.length ?? 0);
  return total;
}

/**
 * Lance un binaire SANS shell (argv explicite) et publie son cycle de vie
 * sous forme d'événements. Ne rejette jamais sur un code de sortie ≠ 0 ;
 * rejette si le binaire est introuvable.
 */
export function runProcess(
  argv: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const [file, ...args] = argv;
  if (file === undefined) return Promise.reject(new ValidationError("process.emptyArgv"));
  const length = commandLineLength(argv);
  if (length !== null && length > WIN32_MAX_COMMAND_LINE)
    return Promise.reject(new ValidationError("process.commandTooLong", { length }));
  const {
    recorder,
    parentId = null,
    maxCapturedLines = 10_000,
    maxJournaledLines = 10_000,
    correlation,
    stdin,
  } = options;
  const started = performance.now();

  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<Writable | null, Readable, Readable>;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env ?? safeEnv(),
        ...spawnOptionsForTree(),
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        shell: false,
      }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    } catch (e) {
      // E2BIG / ENAMETOOLONG sont levées de façon synchrone ; aucun événement n'a été émis.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "E2BIG" || code === "ENAMETOOLONG")
        reject(new ValidationError("process.commandTooLong", { length: argv.join(" ").length }));
      else reject(e);
      return;
    }

    if (stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // EPIPE : l'enfant a fermé son entrée. Le code de sortie reste la référence.
      });
      child.stdin.end(stdin);
    }

    trackProcessTree(child);

    const startEvent = recorder.emit(
      {
        kind: "process.started",
        argv: [...argv],
        pid: child.pid ?? null,
        ...(correlation && { correlation }),
      },
      parentId,
    );
    const captured = { stdout: [] as string[], stderr: [] as string[] };
    let journaled = 0;
    let droppedLines = 0;
    const splitter = (stream: "stdout" | "stderr") =>
      new LineSplitter(
        (line, truncated) => {
          if (captured[stream].length < maxCapturedLines) captured[stream].push(line);
          if (journaled >= maxJournaledLines) {
            droppedLines++;
            return;
          }
          journaled++;
          recorder.emit(
            { kind: "process.output", stream, line, ...(truncated && { truncated }) },
            startEvent.id,
          );
        },
        options.maxLineLength === undefined ? {} : { maxLineLength: options.maxLineLength },
      );
    const out = splitter("stdout");
    const err = splitter("stderr");
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    let spawnError: Error | null = null;
    child.on("error", (e) => {
      spawnError = e;
    });

    let termination: "abort" | "timeout" | undefined;
    let terminating: Promise<{ forced: boolean }> | undefined;
    let closeSeen = false;
    let finished = false;

    const finish = (code: number | null, signal: string | null, forced: boolean) => {
      if (finished) return;
      finished = true;
      cleanup();
      out.end();
      err.end();
      const durationMs = Math.round(performance.now() - started);
      const extra = {
        ...(termination && { termination }),
        ...(forced && { forced }),
      };
      recorder.emit(
        {
          kind: "process.exited",
          code,
          signal,
          durationMs,
          ...(droppedLines > 0 && { droppedLines }),
          ...extra,
        },
        startEvent.id,
      );
      if (spawnError && (spawnError as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new CodedError("process.notFound", { binary: file }));
        return;
      }
      resolve({ code, signal, durationMs, ...captured, ...extra });
    };

    const terminate = (reason: "abort" | "timeout") => {
      if (terminating) return;
      termination = reason;
      terminating = terminateProcessTree(child, {
        ...(options.killGraceMs !== undefined && { graceMs: options.killGraceMs }),
      });
      // Filet : si la fermeture n'a jamais été signalée, on résout avec l'état connu de l'enfant.
      void terminating.then(({ forced }) => {
        if (!closeSeen && child.pid !== undefined) {
          finish(child.exitCode, child.signalCode, forced);
        }
      });
    };

    const onAbort = () => terminate("abort");
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => terminate("timeout"), options.timeoutMs);
    function cleanup() {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code, signal) => {
      closeSeen = true;
      void Promise.resolve(terminating).then((t) => finish(code, signal, t?.forced ?? false));
    });
  });
}
