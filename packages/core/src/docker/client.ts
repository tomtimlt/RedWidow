import { isAbsolute } from "node:path";
import type { Correlation } from "../events.js";
import { type ProcessResult, runProcess } from "../process/run.js";
import { CodedError, type ReasonParams, ValidationError } from "../reason.js";
import type { Recorder } from "../recorder.js";

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

/** Échec d'une commande docker (code de sortie ≠ 0) : code `docker.failed`, résultat complet en plus. */
export class DockerError extends CodedError {
  constructor(
    params: ReasonParams,
    readonly result: ProcessResult,
  ) {
    super("docker.failed", params);
  }
}

/**
 * Lit une ligne non vide de `--format '{{json .}}'` : un objet JSON dont les
 * champs `required` sont des chaînes. Sinon (texte, tableau, format podman…),
 * `docker.unexpectedOutput` sans recopier le contenu de la ligne.
 */
function parseRow(
  command: string,
  line: string,
  lineNumber: number,
  required: readonly string[],
): Record<string, unknown> {
  const unexpected = () => new CodedError("docker.unexpectedOutput", { command, line: lineNumber });
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    throw unexpected();
  }
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw unexpected();
  const record = row as Record<string, unknown>;
  for (const key of required) if (typeof record[key] !== "string") throw unexpected();
  return record;
}

const str = (row: Record<string, unknown>, k: string) =>
  typeof row[k] === "string" ? (row[k] as string) : "";

/**
 * Parse la sortie de `docker ps --format '{{json .}}'` (un objet JSON par
 * ligne). Docker uniquement : une ligne non vide qui n'est pas un objet avec
 * `ID` et `Names` en chaîne lève `docker.unexpectedOutput` (podman non supporté).
 */
export function parseDockerPs(lines: readonly string[]): ContainerSummary[] {
  const out: ContainerSummary[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    const row = parseRow("ps", trimmed, i + 1, ["ID", "Names"]);
    out.push({
      id: str(row, "ID"),
      name: str(row, "Names"),
      image: str(row, "Image"),
      state: str(row, "State"),
      status: str(row, "Status"),
      ports: str(row, "Ports"),
    });
  });
  return out;
}

export interface ImageSummary {
  id: string;
  repository: string;
  tag: string;
  size: string;
}

/** Parse `docker images --format '{{json .}}'` (un objet JSON par ligne, `ID` et `Repository` en chaîne). */
export function parseDockerImages(lines: readonly string[]): ImageSummary[] {
  const out: ImageSummary[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    const row = parseRow("images", trimmed, i + 1, ["ID", "Repository"]);
    out.push({
      id: str(row, "ID"),
      repository: str(row, "Repository"),
      tag: str(row, "Tag"),
      size: str(row, "Size"),
    });
  });
  return out;
}

/** Délai maximal par défaut d'un appel docker : 30 minutes. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const OPERAND = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BARE_BINARY = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const PORT = /^(?:[0-9.]+:)?\d+(?:-\d+)?:\d+(?:-\d+)?(?:\/(?:tcp|udp))?$/;

/** Nature d'un opérande, clé de libellé (traduite par `@john-studio/messages`). */
export type DockerOperandLabel = "container" | "name" | "image" | "target" | "since";

/**
 * Refuse tout opérande (conteneur, image) pouvant être pris pour une option
 * docker ou contenir des espaces/caractères de contrôle.
 */
export function assertOperand(value: string, label: DockerOperandLabel): string {
  if (!OPERAND.test(value)) throw new ValidationError("docker.invalidOperand", { label, value });
  return value;
}

/** Limites des arguments de `docker run` (octets pour les tailles). */
const MAX_COMMAND_ITEMS = 256;
const MAX_COMMAND_BYTES = 32 * 1024;
const MAX_ENV_VALUE_BYTES = 32 * 1024;

/**
 * Le binaire est un nom nu (résolu par `PATH`) ou un chemin absolu : un chemin
 * relatif (`./docker`) pourrait désigner un fichier de l'espace de travail.
 */
function assertBinary(binary: string): void {
  const bare = BARE_BINARY.test(binary) && binary !== "." && binary !== "..";
  if (!bare && !(isAbsolute(binary) && !binary.includes("\0")))
    throw new ValidationError("docker.invalidBinary", { binary });
}

/** Valide `command` : au plus 256 éléments, 32 Kio au total, sans `\0` ; le contenu n'est pas filtré. */
function assertCommand(command: readonly string[]): void {
  const invalid = (reason: string) =>
    new ValidationError("docker.invalidArgument", { field: "command", reason });
  if (!Array.isArray(command) || command.some((c) => typeof c !== "string"))
    throw invalid("notStrings");
  if (command.length > MAX_COMMAND_ITEMS) throw invalid("tooMany");
  if (command.some((c) => c.includes("\0"))) throw invalid("nul");
  if (command.reduce((n, c) => n + Buffer.byteLength(c), 0) > MAX_COMMAND_BYTES)
    throw invalid("tooLarge");
}

/** Valide une valeur d'`env` sans jamais la recopier dans l'erreur. */
function assertEnvValue(key: string, value: string): void {
  const invalid = (reason: string) =>
    new ValidationError("docker.invalidArgument", { field: `env.${key}`, reason });
  if (typeof value !== "string") throw invalid("notString");
  if (value.includes("\0")) throw invalid("nul");
  if (Buffer.byteLength(value) > MAX_ENV_VALUE_BYTES) throw invalid("tooLarge");
}

/** Options communes à chaque appel. `parentId` remplace celui de la factory. */
export interface CallOptions {
  parentId?: string | null;
  signal?: AbortSignal;
  /** Durée maximale de cet appel (remplace celle du client). */
  timeoutMs?: number;
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
  /** Binaire docker : nom nu (résolu par `PATH`) ou chemin absolu. Podman n'est pas supporté. */
  binary?: string;
  parentId?: string | null;
  /** Durée maximale d'un appel (filet contre les blocages). Défaut : 30 minutes. */
  timeoutMs?: number;
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
}

export function createDockerClient({
  recorder,
  binary = "docker",
  parentId: defaultParent = null,
  timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
}: DockerClientOptions): DockerClient {
  assertBinary(binary);
  const exec = (
    args: readonly string[],
    { parentId, signal, correlation, timeoutMs }: CallOptions = {},
  ) =>
    runProcess([binary, ...args], {
      recorder,
      parentId: parentId === undefined ? defaultParent : parentId,
      timeoutMs: timeoutMs ?? defaultTimeoutMs,
      ...(signal && { signal }),
      ...(correlation && { correlation }),
    });

  const checked = async (what: string, args: readonly string[], options?: CallOptions) => {
    const result = await exec(args, options);
    if (result.code !== 0) {
      throw new DockerError(
        {
          binary,
          command: what,
          exitCode: result.code ?? "null",
          stderr: result.stderr.join("\n"),
        },
        result,
      );
    }
    return result;
  };

  return {
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
        if (!Number.isInteger(tail) || tail < 0)
          throw new ValidationError("docker.invalidTail", { value: tail });
        args.push("--tail", String(tail));
      }
      if (since !== undefined) args.push("--since", assertOperand(since, "since"));
      args.push(assertOperand(container, "container"));
      const r = await checked("logs", args, call);
      return [...r.stdout, ...r.stderr];
    },
    async inspect(target, call = {}) {
      const r = await checked("inspect", ["inspect", assertOperand(target, "target")], call);
      try {
        return JSON.parse(r.stdout.join("\n")) as unknown;
      } catch {
        throw new CodedError("docker.unexpectedOutput", { command: "inspect" });
      }
    },
    async run({ image, name, ports = [], env = {}, command = [], ...call }) {
      const args = ["run", "--detach"];
      if (name !== undefined) args.push("--name", assertOperand(name, "name"));
      for (const port of ports) {
        if (!PORT.test(port)) throw new ValidationError("docker.invalidPort", { value: port });
        args.push("--publish", port);
      }
      for (const [key, value] of Object.entries(env)) {
        if (!ENV_KEY.test(key)) throw new ValidationError("docker.invalidEnvKey", { key });
        assertEnvValue(key, value);
        args.push("--env", `${key}=${value}`);
      }
      assertCommand(command);
      args.push(assertOperand(image, "image"), ...command);
      const r = await checked("run", args, call);
      return r.stdout[0]?.trim() ?? "";
    },
    async start(container, call = {}) {
      await checked("start", ["start", assertOperand(container, "container")], call);
    },
    async stop(container, call = {}) {
      await checked("stop", ["stop", assertOperand(container, "container")], call);
    },
    async rm(container, { force = false, ...call } = {}) {
      await checked(
        "rm",
        ["rm", ...(force ? ["--force"] : []), assertOperand(container, "container")],
        call,
      );
    },
  };
}
