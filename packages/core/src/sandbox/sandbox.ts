import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { assertArgsPrefix, assertBinary, assertOperand, DockerError } from "../docker/client.js";
import { resolveBinary } from "../process/resolve.js";
import { type ProcessResult, runProcess, safeEnv } from "../process/run.js";
import { CodedError, ValidationError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { type SandboxRecord, SandboxRegistry } from "./registry.js";

/** Utilisateur du conteneur (nobody) : fixe, jamais root pour les exécutions de l'agent. */
export const SANDBOX_USER = "65534:65534";
/** Label de nettoyage (`john sandbox prune`) : falsifiable, il n'autorise RIEN. */
export const SANDBOX_LABEL = "io.john-studio.sandbox";
export const SANDBOX_WORKDIR = "/work";
/** Limites fixes (ADR 0003, Q5). */
export const SANDBOX_LIMITS = { pidsLimit: 512, memory: "2g", cpus: 2 } as const;

const DEFAULT_MAX_TIMEOUT_SEC = 600;
const ABSOLUTE_MAX_TIMEOUT_SEC = 1800;
const DEFAULT_CALL_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_ARGV_ITEMS = 256;
const MAX_ARGV_BYTES = 16 * 1024;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;

export interface SandboxContextOptions {
  recorder: Recorder;
  /** Registre partagé ; par défaut, un registre neuf. */
  registry?: SandboxRegistry;
  /** Binaire docker (nom nu ou chemin absolu). */
  binary?: string;
  /** Réservé au code (tests), comme pour `createDockerClient`. */
  argsPrefix?: readonly string[];
  parentId?: string | null;
  /** Délai des appels de cycle de vie (create, inspect, restart, rm). Défaut : 2 minutes. */
  timeoutMs?: number;
  /** Plafond opérateur de `timeoutSec` d'une exécution (défaut 600, maximum 1800). */
  maxTimeoutSec?: number;
}

export interface SandboxContext {
  readonly recorder: Recorder;
  readonly registry: SandboxRegistry;
  readonly binary: string;
  readonly argsPrefix: readonly string[];
  readonly parentId: string | null;
  readonly timeoutMs: number;
  readonly maxTimeoutSec: number;
}

/** Construit le contexte (validations incluses). Image, réseau et limites ne viennent d'aucun outil. */
export function createSandboxContext(options: SandboxContextOptions): SandboxContext {
  const binary = options.binary ?? "docker";
  assertBinary(binary);
  const maxTimeoutSec = options.maxTimeoutSec ?? DEFAULT_MAX_TIMEOUT_SEC;
  if (!(maxTimeoutSec > 0 && maxTimeoutSec <= ABSOLUTE_MAX_TIMEOUT_SEC))
    throw new ValidationError("sandbox.invalidArgument", {
      field: "maxTimeoutSec",
      reason: "range",
    });
  return {
    recorder: options.recorder,
    registry: options.registry ?? new SandboxRegistry(),
    binary,
    argsPrefix: assertArgsPrefix(options.argsPrefix ?? []),
    parentId: options.parentId ?? null,
    timeoutMs: options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    maxTimeoutSec,
  };
}

interface Call {
  parentId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Lance `docker <args>` : args construits par le code seulement (jamais d'option issue d'une entrée). */
function docker(
  ctx: SandboxContext,
  args: readonly string[],
  call: Call = {},
): Promise<ProcessResult> {
  const file = resolveBinary(ctx.binary);
  if (file === null)
    return Promise.reject(new CodedError("process.notFound", { binary: ctx.binary }));
  return runProcess([file, ...ctx.argsPrefix, ...args], {
    recorder: ctx.recorder,
    parentId: call.parentId === undefined ? ctx.parentId : call.parentId,
    timeoutMs: call.timeoutMs ?? ctx.timeoutMs,
    ...(call.signal && { signal: call.signal }),
  });
}

/** Comme `docker`, mais un code de sortie ≠ 0 lève `DockerError`. */
async function dockerChecked(
  ctx: SandboxContext,
  what: string,
  args: readonly string[],
  call?: Call,
): Promise<ProcessResult> {
  const result = await docker(ctx, args, call);
  if (result.code !== 0)
    throw new DockerError(
      {
        binary: ctx.binary,
        command: what,
        exitCode: result.code ?? "null",
        stderr: result.stderr.join("\n"),
      },
      result,
    );
  return result;
}

const unknownContainer = () => new CodedError("sandbox.unknownContainer");

/** Enregistrement d'un identifiant, ou refus : le registre est l'unique autorité. */
function requireRecord(ctx: SandboxContext, id: string): SandboxRecord {
  const record = typeof id === "string" ? ctx.registry.get(id) : undefined;
  if (record === undefined) throw unknownContainer();
  return record;
}

function parseJsonArray(result: ProcessResult, command: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(result.stdout.join("\n"));
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // traité ci-dessous
  }
  throw new CodedError("docker.unexpectedOutput", { command });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

/** Argv fixe de `docker run` (ADR 0003, B) : seuls `runId` et `image`, validés, varient. */
const containerName = (runId: string) => `john-sbx-${runId.slice(0, 12)}`;

/**
 * Appels de nettoyage (restart, rm) : jamais le signal de l'appelant. Un signal déjà annulé tuerait
 * aussitôt le processus de nettoyage (processus de l'agent survivants, entrée encore exécutable).
 */
const CLEANUP_TIMEOUT_MS = 30_000;
const cleanupCall = (call: Call): Call => {
  const { signal: _signal, ...rest } = call;
  return { timeoutMs: CLEANUP_TIMEOUT_MS, ...rest };
};

function runArgs(runId: string, image: string): string[] {
  return [
    "run",
    "-d",
    "--pull",
    "never",
    "--init",
    "--label",
    `${SANDBOX_LABEL}=${runId}`,
    "--name",
    containerName(runId),
    "--user",
    SANDBOX_USER,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--network",
    "none",
    "--pids-limit",
    String(SANDBOX_LIMITS.pidsLimit),
    "--memory",
    SANDBOX_LIMITS.memory,
    "--memory-swap",
    SANDBOX_LIMITS.memory,
    "--cpus",
    String(SANDBOX_LIMITS.cpus),
    "--restart",
    "no",
    "--stop-timeout",
    "2",
    "--log-driver",
    "none",
    "--workdir",
    SANDBOX_WORKDIR,
    "--entrypoint",
    "sleep",
    image,
    "infinity",
  ];
}

/**
 * Crée le bac à sable du run : image locale uniquement (`--pull never`), argv durci
 * fixe, réseau `none`, vérification `inspect` puis initialisation de `/work` par le
 * code. Renvoie l'identifiant complet, enregistré dès la création (filet de sortie).
 * Toute erreur supprime le conteneur déjà créé avant de la propager.
 */
export async function createSandbox(
  ctx: SandboxContext,
  { image, ...call }: { image: string | undefined } & Call,
): Promise<string> {
  const runId = ctx.recorder.runId;
  if (!RUN_ID.test(runId))
    throw new ValidationError("sandbox.invalidArgument", { field: "runId", reason: "format" });
  if (image === undefined || image === "")
    throw new CodedError("sandbox.imageUnsupported", { reason: "missing" });
  assertOperand(image, "image");

  const inspected = await docker(ctx, ["image", "inspect", image], call);
  if (inspected.code !== 0) throw new CodedError("sandbox.imageUnsupported", { reason: "absent" });
  const info = parseJsonArray(inspected, "image inspect")[0];
  const digests = isObject(info) ? info.RepoDigests : undefined;
  const digest =
    Array.isArray(digests) && typeof digests[0] === "string"
      ? digests[0]
      : isObject(info) && typeof info.Id === "string"
        ? info.Id
        : null;

  const started = await docker(ctx, runArgs(runId, image), call);
  if (started.code !== 0) {
    const stderr = started.stderr.join("\n");
    if (/executable file not found|no such file or directory/i.test(stderr))
      throw new CodedError("sandbox.imageUnsupported", { reason: "noSleep" });
    throw new DockerError(
      { binary: ctx.binary, command: "run", exitCode: started.code ?? "null", stderr },
      started,
    );
  }
  const id = started.stdout[0]?.trim() ?? "";
  if (!CONTAINER_ID.test(id)) {
    // Le conteneur existe peut-être sans être inscrit : suppression par son nom (construit par le code).
    await docker(ctx, rmArgs(containerName(runId)), cleanupCall(call)).catch(() => {});
    throw new CodedError("docker.unexpectedOutput", { command: "run" });
  }

  const record: SandboxRecord = {
    id,
    runId,
    unavailable: false,
    removeSync: () => {
      const file = resolveBinary(ctx.binary);
      if (file === null) return;
      const done = spawnSync(file, [...ctx.argsPrefix, ...rmArgs(id)], {
        shell: false,
        env: safeEnv(),
        stdio: "ignore",
        windowsHide: true,
        timeout: 10_000,
      });
      // Échec : rien n'est annoncé, `john sandbox prune` rattrape le conteneur.
      if (done.status !== 0) return;
      try {
        ctx.recorder.emit(
          { kind: "sandbox.stopped", containerId: id, cause: "exit" },
          ctx.parentId,
        );
      } catch {
        // le journal peut déjà être fermé à la sortie.
      }
    },
  };
  ctx.registry.add(record);

  try {
    await inspectSandbox(ctx, id, call);
    for (const step of [
      ["mkdir", "-p", SANDBOX_WORKDIR],
      ["chown", SANDBOX_USER, SANDBOX_WORKDIR],
    ]) {
      const done = await docker(ctx, ["exec", "-u", "0", id, ...step], call);
      if (done.code !== 0) throw new CodedError("sandbox.imageUnsupported", { reason: "init" });
    }
  } catch (err) {
    await removeSandbox(ctx, id, "error", call).catch(() => {});
    throw err;
  }

  ctx.recorder.emit(
    {
      kind: "sandbox.started",
      containerId: id,
      image,
      imageDigest: digest,
      network: "none",
      limits: { ...SANDBOX_LIMITS },
    },
    call.parentId === undefined ? ctx.parentId : call.parentId,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Vérification (ADR 0003, A)
// ---------------------------------------------------------------------------

/**
 * Vérifie avant chaque usage que le conteneur est bien celui créé, durci et
 * inchangé. Tout écart (ou toute forme inattendue de `docker inspect`) lève
 * `sandbox.tampered` : fail-closed, non mémorisable. Identifiant hors registre :
 * `sandbox.unknownContainer` sans même appeler docker.
 */
export async function inspectSandbox(
  ctx: SandboxContext,
  id: string,
  call: Call = {},
): Promise<void> {
  const record = requireRecord(ctx, id);
  if (record.unavailable) throw new CodedError("sandbox.unavailable");
  const result = await dockerChecked(ctx, "inspect", ["container", "inspect", id], call);
  const docs = parseJsonArray(result, "inspect");
  const doc = docs[0];

  const tampered = (field: string) => new CodedError("sandbox.tampered", { field });
  if (docs.length !== 1 || !isObject(doc)) throw tampered("inspect");
  const section = (parent: Record<string, unknown>, name: string) => {
    const v = parent[name];
    if (!isObject(v)) throw tampered(name);
    return v;
  };
  /** Liste de chaînes ; `null`/absent = vide (forme de Docker) ; autre forme = altération. */
  const list = (parent: Record<string, unknown>, name: string, field: string): string[] => {
    const v = parent[name];
    if (v === null || v === undefined) return [];
    if (Array.isArray(v) && v.every((i) => typeof i === "string")) return v as string[];
    throw tampered(field);
  };
  const expect = (ok: boolean, field: string) => {
    if (!ok) throw tampered(field);
  };

  const host = section(doc, "HostConfig");
  const config = section(doc, "Config");
  const state = section(doc, "State");
  const labels = config.Labels;

  expect(doc.Id === id, "Id");
  expect(isObject(labels) && labels[SANDBOX_LABEL] === record.runId, "Config.Labels");
  expect(state.Running === true, "State.Running");
  expect(host.Privileged === false, "HostConfig.Privileged");
  expect(list(host, "CapAdd", "HostConfig.CapAdd").length === 0, "HostConfig.CapAdd");
  expect(list(host, "CapDrop", "HostConfig.CapDrop").includes("ALL"), "HostConfig.CapDrop");
  const security = list(host, "SecurityOpt", "HostConfig.SecurityOpt");
  // Liste blanche stricte : toute autre entrée (seccomp, apparmor, systempaths, label…) est une altération.
  expect(
    security.length > 0 && security.every((o) => /^no-new-privileges([:=]true)?$/.test(o)),
    "HostConfig.SecurityOpt",
  );
  expect(list(host, "Binds", "HostConfig.Binds").length === 0, "HostConfig.Binds");
  expect(
    doc.Mounts === null ||
      doc.Mounts === undefined ||
      (Array.isArray(doc.Mounts) && doc.Mounts.length === 0),
    "Mounts",
  );
  expect(
    host.Devices === null ||
      host.Devices === undefined ||
      (Array.isArray(host.Devices) && host.Devices.length === 0),
    "HostConfig.Devices",
  );
  expect(host.NetworkMode === "none", "HostConfig.NetworkMode");
  for (const key of ["PidMode", "IpcMode", "UTSMode", "UsernsMode"])
    expect(host[key] !== "host", `HostConfig.${key}`);
  expect(config.User === SANDBOX_USER, "Config.User");
}

// ---------------------------------------------------------------------------
// Exécution, redémarrage, suppression
// ---------------------------------------------------------------------------

export interface SandboxExecInput {
  argv: readonly string[];
  /** Absolu POSIX sous `/work` (défaut `/work`). */
  cwd?: string;
  /** Plafonné par l'opérateur (`maxTimeoutSec`) ; défaut : ce plafond. */
  timeoutSec?: number;
}

export interface SandboxExecResult extends ProcessResult {
  /** Présent après un délai ou une annulation : le conteneur a-t-il été redémarré ? */
  restarted?: boolean;
}

function validateExec(ctx: SandboxContext, input: SandboxExecInput) {
  const invalid = (field: string, reason: string) =>
    new ValidationError("sandbox.invalidArgument", { field, reason });
  const { argv } = input;
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string"))
    throw invalid("argv", "notStrings");
  if (argv.length === 0 || argv[0] === "") throw invalid("argv", "empty");
  if (argv.length > MAX_ARGV_ITEMS) throw invalid("argv", "tooMany");
  if (argv.some((a) => a.includes("\0"))) throw invalid("argv", "nul");
  if (argv.reduce((n, a) => n + Buffer.byteLength(a), 0) > MAX_ARGV_BYTES)
    throw invalid("argv", "tooLarge");

  const rawCwd = input.cwd ?? SANDBOX_WORKDIR;
  if (typeof rawCwd !== "string" || rawCwd.includes("\0")) throw invalid("cwd", "nul");
  if (!rawCwd.startsWith("/")) throw invalid("cwd", "notAbsolute");
  const cwd = posix.normalize(rawCwd).replace(/(?<=.)\/$/, "");
  if (
    rawCwd.split("/").includes("..") ||
    !(cwd === SANDBOX_WORKDIR || cwd.startsWith(`${SANDBOX_WORKDIR}/`))
  )
    throw invalid("cwd", "outside");

  const timeoutSec = input.timeoutSec ?? ctx.maxTimeoutSec;
  if (typeof timeoutSec !== "number" || !(timeoutSec > 0 && timeoutSec <= ctx.maxTimeoutSec))
    throw invalid("timeoutSec", "range");
  return { argv: [...argv], cwd, timeoutSec };
}

/**
 * Exécute `argv` (sans shell) dans le bac à sable `id` : `docker exec --user
 * 65534:65534 --workdir <cwd> <id> <argv…>`, stdin fermé, aucune option issue de
 * l'entrée. Vérifie d'abord le conteneur (`inspectSandbox`). Sur délai ou
 * annulation, redémarre le conteneur (les processus de l'agent survivraient à
 * l'arrêt de la CLI hôte) ; si le redémarrage échoue, le bac à sable est supprimé
 * et marqué hors service. Ne sérialise pas les appels (file FIFO : couche outil).
 */
export async function execInSandbox(
  ctx: SandboxContext,
  id: string,
  input: SandboxExecInput,
  call: Call = {},
): Promise<SandboxExecResult> {
  requireRecord(ctx, id);
  const { argv, cwd, timeoutSec } = validateExec(ctx, input);
  await inspectSandbox(ctx, id, call);
  const result = await docker(
    ctx,
    ["exec", "--user", SANDBOX_USER, "--workdir", cwd, id, ...argv],
    { ...call, timeoutMs: timeoutSec * 1000 },
  );
  if (result.termination === undefined) return result;
  const restarted = await restartSandbox(ctx, id, cleanupCall(call)).then(
    () => true,
    () => false,
  );
  return { ...result, restarted };
}

/**
 * `docker restart -t 2` : tue tous les processus du conteneur en gardant son
 * système de fichiers, sans dépendre d'un `kill` dans l'image. Échec : bac à
 * sable marqué hors service puis supprimé, `sandbox.unavailable`.
 */
export async function restartSandbox(
  ctx: SandboxContext,
  id: string,
  call: Call = {},
): Promise<void> {
  const record = requireRecord(ctx, id);
  if (record.unavailable) throw new CodedError("sandbox.unavailable");
  try {
    await dockerChecked(ctx, "restart", ["restart", "-t", "2", id], cleanupCall(call));
  } catch {
    record.unavailable = true;
    await removeSandbox(ctx, id, "error", call).catch(() => {});
    throw new CodedError("sandbox.unavailable");
  }
}

const rmArgs = (id: string) => ["rm", "--force", id];

/** `docker rm --force` d'un bac à sable du registre (jamais d'un autre conteneur) ; journalise `sandbox.stopped`. */
export async function removeSandbox(
  ctx: SandboxContext,
  id: string,
  cause: "runEnd" | "abort" | "error" = "runEnd",
  call: Call = {},
): Promise<void> {
  const record = requireRecord(ctx, id);
  // Hors service dès maintenant : si le rm échoue, l'entrée ne reste pas exécutable.
  record.unavailable = true;
  const result = await docker(ctx, rmArgs(id), cleanupCall(call));
  // Déjà supprimé par ailleurs : l'objectif est atteint ; toute autre erreur laisse l'entrée au filet de sortie.
  if (result.code !== 0 && !/no such container/i.test(result.stderr.join("\n")))
    throw new DockerError(
      {
        binary: ctx.binary,
        command: "rm",
        exitCode: result.code ?? "null",
        stderr: result.stderr.join("\n"),
      },
      result,
    );
  ctx.registry.delete(id);
  ctx.recorder.emit(
    { kind: "sandbox.stopped", containerId: id, cause },
    call.parentId === undefined ? ctx.parentId : call.parentId,
  );
}
