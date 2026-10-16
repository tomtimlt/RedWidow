import { isAbsolute } from "node:path";
import type { Correlation } from "../events.js";
import { resolveBinary } from "../process/resolve.js";
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

export interface ContainerInspectMount {
  type: string;
  source: string;
  destination: string;
  rw: boolean;
}

export interface ContainerInspectSummary {
  id: string;
  name: string;
  running: boolean;
  labels: Record<string, string>;
  mounts: ContainerInspectMount[];
}

export interface LabelPrefixContainer {
  state: "running" | "stopped";
  name: string;
  image: string;
  workspace?: string;
}

/** Format `docker inspect --format` pour `listLabelPrefix` (filtre côté démon, sans valeur de label). */
export const DOCKER_LABEL_PREFIX_INSPECT_FORMAT = [
  "{{$keep := false}}{{range $k, $v := .Config.Labels}}",
  '{{if and (ge (len $k) 11) (eq (slice $k 0 11) "org.exegol.")}}{{$keep = true}}{{end}}{{end}}',
  '{{if $keep}}{{$ws := ""}}{{range .Mounts}}',
  '{{if and (eq $ws "") (eq .Destination "/workspace") (ne .Source "")}}{{$ws = .Source}}{{end}}{{end}}',
  '{"state":"{{if eq .State.Status "running"}}running{{else}}stopped{{end}}"',
  ',"name":{{json .Name}},"image":{{json .Config.Image}}',
  '{{if ne $ws ""}},"workspace":{{json $ws}}{{end}}}{{println}}{{end}}',
].join("");

const LABEL_PREFIX_ALLOWED_KEYS = new Set(["state", "name", "image", "workspace"]);

/**
 * Parse la sortie de `docker inspect --format` de `listLabelPrefix` (un objet JSON par ligne).
 * Seules les clés `state`, `name`, `image` et éventuellement `workspace` sont acceptées.
 */
export function parseDockerLabelPrefixInspect(
  lines: readonly string[],
  command = "inspect",
): LabelPrefixContainer[] {
  const out: LabelPrefixContainer[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    const unexpected = () => new CodedError("docker.unexpectedOutput", { command, line: i + 1 });
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      throw unexpected();
    }
    if (typeof row !== "object" || row === null || Array.isArray(row)) throw unexpected();
    const record = row as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!LABEL_PREFIX_ALLOWED_KEYS.has(key)) throw unexpected();
    }
    let state: LabelPrefixContainer["state"];
    if (record.state === "running") state = "running";
    else if (record.state === "stopped") state = "stopped";
    else throw unexpected();
    if (typeof record.name !== "string" || record.name === "") throw unexpected();
    const name = record.name.startsWith("/") ? record.name.slice(1) : record.name;
    if (name === "") throw unexpected();
    if (typeof record.image !== "string" || record.image === "") throw unexpected();
    const image = record.image;
    if ("workspace" in record) {
      if (typeof record.workspace !== "string" || record.workspace === "") throw unexpected();
      out.push({ state, name, image, workspace: record.workspace });
    } else {
      out.push({ state, name, image });
    }
  });
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Projette le JSON déjà parsé de `docker inspect` (tableau d'un seul conteneur).
 * Toute forme invalide lève `docker.unexpectedOutput` avec `{ command: "inspect" }`
 * sans recopier le document.
 */
export function parseDockerInspect(raw: unknown): ContainerInspectSummary {
  const unexpected = () => new CodedError("docker.unexpectedOutput", { command: "inspect" });
  if (!Array.isArray(raw) || raw.length !== 1) throw unexpected();
  const doc = raw[0];
  if (!isPlainObject(doc)) throw unexpected();

  const id = doc.Id;
  if (typeof id !== "string" || id === "") throw unexpected();

  const nameField = doc.Name;
  if (typeof nameField !== "string" || !nameField.startsWith("/") || nameField.length < 2)
    throw unexpected();
  const name = nameField.slice(1);

  const state = doc.State;
  if (!isPlainObject(state) || typeof state.Running !== "boolean") throw unexpected();
  const running = state.Running;

  const config = doc.Config;
  if (!isPlainObject(config)) throw unexpected();

  let labelsRaw: unknown = config.Labels;
  if (labelsRaw === null) labelsRaw = {};
  if (!isPlainObject(labelsRaw)) throw unexpected();
  const labels = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(labelsRaw)) {
    if (typeof value !== "string") throw unexpected();
    labels[key] = value;
  }

  const mountsRaw = doc.Mounts;
  if (mountsRaw === null || mountsRaw === undefined || !Array.isArray(mountsRaw))
    throw unexpected();
  const mounts: ContainerInspectMount[] = [];
  for (const entry of mountsRaw) {
    if (!isPlainObject(entry)) throw unexpected();
    const type = entry.Type;
    const source = entry.Source;
    const destination = entry.Destination;
    const rw = entry.RW;
    if (typeof type !== "string" || type === "") throw unexpected();
    if (typeof source !== "string") throw unexpected();
    if (typeof destination !== "string" || destination === "") throw unexpected();
    if (typeof rw !== "boolean") throw unexpected();
    mounts.push({ type, source, destination, rw });
  }

  return { id, name, running, labels, mounts };
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
export function assertBinary(binary: string): void {
  const bare = BARE_BINARY.test(binary) && binary !== "." && binary !== "..";
  if (!bare && !(isAbsolute(binary) && !binary.includes("\0")))
    throw new ValidationError("docker.invalidBinary", { binary });
}

/** Bornes de `argsPrefix` : au plus 8 éléments de 4 Kio, sans `\0`. */
const MAX_ARGS_PREFIX_ITEMS = 8;
const MAX_ARGS_PREFIX_ITEM_BYTES = 4 * 1024;

/**
 * Valide un préfixe d'arguments (insérés entre le binaire et les arguments de
 * la commande). Option réservée au CODE (tests : `process.execPath` + script
 * `.mjs`) : jamais exposée par la CLI, la politique ni la configuration
 * utilisateur. Renvoie une copie.
 */
export function assertArgsPrefix(argsPrefix: readonly string[]): string[] {
  const invalid = (reason: string) =>
    new ValidationError("docker.invalidArgument", { field: "argsPrefix", reason });
  if (!Array.isArray(argsPrefix) || argsPrefix.some((a) => typeof a !== "string"))
    throw invalid("notStrings");
  if (argsPrefix.length > MAX_ARGS_PREFIX_ITEMS) throw invalid("tooMany");
  if (argsPrefix.some((a) => a.includes("\0"))) throw invalid("nul");
  if (argsPrefix.some((a) => Buffer.byteLength(a) > MAX_ARGS_PREFIX_ITEM_BYTES))
    throw invalid("tooLarge");
  return [...argsPrefix];
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
  /**
   * Arguments insérés entre le binaire et ceux de la commande (≤ 8 éléments de
   * 4 Kio, sans `\0`). RÉSERVÉ AU CODE (tests : `process.execPath` + script) :
   * ni CLI, ni politique, ni configuration utilisateur ne doivent l'alimenter.
   */
  argsPrefix?: readonly string[];
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
  /** Conteneurs dont un label a le préfixe `org.exegol.`. Aucune valeur de label ne sort du démon. */
  listLabelPrefix(options?: CallOptions): Promise<LabelPrefixContainer[]>;
  /**
   * `docker exec` figé : interactif, répertoire `/workspace`, argv direct.
   * Aucune option d'hôte (utilisateur, volume, réseau, privilèges).
   */
  execWorkspace(
    container: string,
    command: readonly string[],
    options?: CallOptions,
  ): Promise<string[]>;
}

export function createDockerClient({
  recorder,
  binary = "docker",
  argsPrefix = [],
  parentId: defaultParent = null,
  timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
}: DockerClientOptions): DockerClient {
  assertBinary(binary);
  const prefix = assertArgsPrefix(argsPrefix);
  const exec = (
    args: readonly string[],
    { parentId, signal, correlation, timeoutMs }: CallOptions = {},
  ) => {
    // Chemin absolu avant `spawn` : jamais de recherche implicite (cwd, PATH relatif, .cmd).
    const file = resolveBinary(binary);
    if (file === null) return Promise.reject(new CodedError("process.notFound", { binary }));
    return runProcess([file, ...prefix, ...args], {
      recorder,
      parentId: parentId === undefined ? defaultParent : parentId,
      timeoutMs: timeoutMs ?? defaultTimeoutMs,
      ...(signal && { signal }),
      ...(correlation && { correlation }),
    });
  };

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
    async listLabelPrefix(call = {}) {
      const psResult = await checked("ps", ["ps", "--all", "--quiet"], call);
      const ids: string[] = [];
      psResult.stdout.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return;
        if (!OPERAND.test(trimmed)) {
          throw new CodedError("docker.unexpectedOutput", { command: "ps", line: i + 1 });
        }
        ids.push(trimmed);
      });
      if (ids.length === 0) return [];
      const r = await checked(
        "inspect",
        [
          "inspect",
          "--format",
          DOCKER_LABEL_PREFIX_INSPECT_FORMAT,
          ...ids.map((id) => assertOperand(id, "container")),
        ],
        call,
      );
      return parseDockerLabelPrefixInspect(r.stdout);
    },
    async execWorkspace(container, command, call = {}) {
      assertOperand(container, "container");
      assertCommand(command);
      const program = command[0];
      if (program === undefined || program === "" || program.startsWith("-")) {
        throw new ValidationError("docker.invalidArgument", {
          field: "command",
          reason: "program",
        });
      }
      const r = await checked(
        "exec",
        ["exec", "--interactive", "--workdir", "/workspace", container, ...command],
        call,
      );
      return [...r.stdout, ...r.stderr];
    },
  };
}
