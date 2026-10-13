import type { Correlation } from "../events.js";
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

export interface ImageSummary {
  id: string;
  repository: string;
  tag: string;
  size: string;
}

/** Parse `docker images --format '{{json .}}'` (un objet JSON par ligne). */
export function parseDockerImages(lines: readonly string[]): ImageSummary[] {
  const out: ImageSummary[] = [];
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
      repository: str("Repository"),
      tag: str("Tag"),
      size: str("Size"),
    });
  }
  return out;
}

const OPERAND = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PORT = /^(?:[0-9.]+:)?\d+(?:-\d+)?:\d+(?:-\d+)?(?:\/(?:tcp|udp))?$/;

/**
 * Refuse tout opérande (conteneur, image) pouvant être pris pour une option
 * docker ou contenir des espaces/caractères de contrôle.
 */
export function assertOperand(value: string, label: string): string {
  if (!OPERAND.test(value)) throw new RangeError(`${label} invalide : « ${value} »`);
  return value;
}

/** Options communes à chaque appel. `parentId` remplace celui de la factory. */
export interface CallOptions {
  parentId?: string | null;
  signal?: AbortSignal;
  /** Fiabilité du rattachement de `parentId` à l'appel d'outil, consignée dans `process.started`. */
  correlation?: Correlation;
}

export interface RunContainerOptions extends CallOptions {
  image: string;
  name?: string;
  /** `[ip:]hôte:conteneur[/proto]` */
  ports?: readonly string[];
  env?: Readonly<Record<string, string>>;
  /** Commande et arguments passés après l'image. */
  command?: readonly string[];
}

export interface DockerClientOptions {
  recorder: Recorder;
  /** Binaire docker (ou compatible : podman). */
  binary?: string;
  parentId?: string | null;
}

export interface DockerClient {
  ps(options?: CallOptions & { all?: boolean }): Promise<ContainerSummary[]>;
  images(options?: CallOptions): Promise<ImageSummary[]>;
  /** Lignes stdout puis stderr (docker logs relaie les deux flux du conteneur). */
  logs(
    container: string,
    options?: CallOptions & { tail?: number; since?: string },
  ): Promise<string[]>;
  inspect(target: string, options?: CallOptions): Promise<unknown>;
  /** Démarre toujours en arrière-plan ; renvoie l'identifiant du conteneur. */
  run(options: RunContainerOptions): Promise<string>;
  start(container: string, options?: CallOptions): Promise<void>;
  stop(container: string, options?: CallOptions): Promise<void>;
  rm(container: string, options?: CallOptions & { force?: boolean }): Promise<void>;
  exec(args: readonly string[], options?: CallOptions): Promise<ProcessResult>;
}

export function createDockerClient({
  recorder,
  binary = "docker",
  parentId: defaultParent = null,
}: DockerClientOptions): DockerClient {
  const exec = (args: readonly string[], { parentId, signal, correlation }: CallOptions = {}) =>
    runProcess([binary, ...args], {
      recorder,
      parentId: parentId === undefined ? defaultParent : parentId,
      ...(signal && { signal }),
      ...(correlation && { correlation }),
    });

  const checked = async (what: string, args: readonly string[], options?: CallOptions) => {
    const result = await exec(args, options);
    if (result.code !== 0) {
      throw new DockerError(
        `${binary} ${what} a échoué (code ${result.code}) : ${result.stderr.join("\n")}`,
        result,
      );
    }
    return result;
  };

  return {
    exec,
    async ps({ all = false, ...call } = {}) {
      const r = await checked(
        "ps",
        ["ps", ...(all ? ["--all"] : []), "--format", "{{json .}}"],
        call,
      );
      return parseDockerPs(r.stdout);
    },
    async images(call = {}) {
      const r = await checked("images", ["images", "--format", "{{json .}}"], call);
      return parseDockerImages(r.stdout);
    },
    async logs(container, { tail, since, ...call } = {}) {
      const args = ["logs"];
      if (tail !== undefined) {
        if (!Number.isInteger(tail) || tail < 0) throw new RangeError(`tail invalide : ${tail}`);
        args.push("--tail", String(tail));
      }
      if (since !== undefined) args.push("--since", assertOperand(since, "since"));
      args.push(assertOperand(container, "conteneur"));
      const r = await checked("logs", args, call);
      return [...r.stdout, ...r.stderr];
    },
    async inspect(target, call = {}) {
      const r = await checked("inspect", ["inspect", assertOperand(target, "cible")], call);
      return JSON.parse(r.stdout.join("\n")) as unknown;
    },
    async run({ image, name, ports = [], env = {}, command = [], ...call }) {
      const args = ["run", "--detach"];
      if (name !== undefined) args.push("--name", assertOperand(name, "nom"));
      for (const port of ports) {
        if (!PORT.test(port)) throw new RangeError(`port invalide : « ${port} »`);
        args.push("--publish", port);
      }
      for (const [key, value] of Object.entries(env)) {
        if (!ENV_KEY.test(key)) throw new RangeError(`variable invalide : « ${key} »`);
        args.push("--env", `${key}=${value}`);
      }
      args.push(assertOperand(image, "image"), ...command);
      const r = await checked("run", args, call);
      return r.stdout[0]?.trim() ?? "";
    },
    async start(container, call = {}) {
      await checked("start", ["start", assertOperand(container, "conteneur")], call);
    },
    async stop(container, call = {}) {
      await checked("stop", ["stop", assertOperand(container, "conteneur")], call);
    },
    async rm(container, { force = false, ...call } = {}) {
      await checked(
        "rm",
        ["rm", ...(force ? ["--force"] : []), assertOperand(container, "conteneur")],
        call,
      );
    },
  };
}
