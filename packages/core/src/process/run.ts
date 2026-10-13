import { spawn } from "node:child_process";
import type { Recorder } from "../recorder.js";
import { LineSplitter } from "./lines.js";

export interface RunProcessOptions {
  recorder: Recorder;
  parentId?: string | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Plafond de lignes conservées en mémoire dans le résultat (le journal reçoit tout). */
  maxCapturedLines?: number;
}

export interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: string[];
  stderr: string[];
  durationMs: number;
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
  if (file === undefined) return Promise.reject(new Error("argv vide"));
  const { recorder, parentId = null, maxCapturedLines = 10_000 } = options;
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const startEvent = recorder.emit(
      { kind: "process.started", argv: [...argv], pid: child.pid ?? null },
      parentId,
    );
    const captured = { stdout: [] as string[], stderr: [] as string[] };
    const splitter = (stream: "stdout" | "stderr") =>
      new LineSplitter((line) => {
        if (captured[stream].length < maxCapturedLines) captured[stream].push(line);
        recorder.emit({ kind: "process.output", stream, line }, startEvent.id);
      });
    const out = splitter("stdout");
    const err = splitter("stderr");
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    let spawnError: Error | null = null;
    child.on("error", (e) => {
      spawnError = e;
    });

    child.on("close", (code, signal) => {
      out.end();
      err.end();
      const durationMs = Math.round(performance.now() - started);
      recorder.emit({ kind: "process.exited", code, signal, durationMs }, startEvent.id);
      if (spawnError && (spawnError as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`binaire introuvable : ${file}`));
        return;
      }
      resolve({ code, signal, durationMs, ...captured });
    });
  });
}
