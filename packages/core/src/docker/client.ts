import { type ProcessResult, runProcess } from "../process/run.js";
import type { Recorder } from "../recorder.js";

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

export class DockerError extends Error {
  constructor(
    message: string,
    readonly result: ProcessResult,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

/**
 * Parse la sortie de `docker ps --format '{{json .}}'` (un objet JSON par
 * ligne). Les lignes non JSON sont ignorées.
 */
export function parseDockerPs(lines: readonly string[]): ContainerSummary[] {
  const out: ContainerSummary[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
    out.push({
      id: str("ID"),
      name: str("Names"),
      image: str("Image"),
      state: str("State"),
      status: str("Status"),
      ports: str("Ports"),
    });
  }
  return out;
}

export interface DockerClientOptions {
  recorder: Recorder;
  /** Binaire docker (ou compatible : podman). */
  binary?: string;
  parentId?: string | null;
}

export interface DockerClient {
  ps(options?: { all?: boolean; signal?: AbortSignal }): Promise<ContainerSummary[]>;
  exec(args: readonly string[], options?: { signal?: AbortSignal }): Promise<ProcessResult>;
}

export function createDockerClient({
  recorder,
  binary = "docker",
  parentId = null,
}: DockerClientOptions): DockerClient {
  const exec = (args: readonly string[], signal?: AbortSignal) =>
    runProcess([binary, ...args], { recorder, parentId, ...(signal && { signal }) });

  return {
    exec: (args, options = {}) => exec(args, options.signal),
    async ps({ all = false, signal } = {}) {
      const result = await exec(
        ["ps", ...(all ? ["--all"] : []), "--format", "{{json .}}"],
        signal,
      );
      if (result.code !== 0) {
        throw new DockerError(
          `${binary} ps a échoué (code ${result.code}) : ${result.stderr.join("\n")}`,
          result,
        );
      }
      return parseDockerPs(result.stdout);
    },
  };
}
