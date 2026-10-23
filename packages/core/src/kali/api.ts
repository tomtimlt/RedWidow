import { setTimeout as sleep } from "node:timers/promises";
import {
  assertArgsPrefix,
  assertBinary,
  assertOperand,
  type CallOptions,
} from "../docker/client.js";
import { resolveBinary } from "../process/resolve.js";
import { type ProcessResult, runProcess } from "../process/run.js";
import { CodedError, ValidationError } from "../reason.js";
import type { Recorder } from "../recorder.js";

/** Délai d'un `docker exec` vers l'API, le même que l'exec Exegol. */
export const KALI_EXEC_TIMEOUT_MS = 600_000;

/** Lectures de `/health` après l'unique démarrage. */
const HEALTH_TRIES = 10;

/** Attente entre deux lectures, le serveur venant d'être lancé. */
const DEFAULT_HEALTH_PAUSE_MS = 200;

/**
 * Script fixe : lit un JSON sur stdin (`method`, `path`, `body`) et appelle
 * `http://127.0.0.1:5000` + chemin. Aucune donnée d'appel n'y est interpolée.
 * Le délai de 300 secondes est celui de `client.py`.
 */
export const KALI_HTTP_SCRIPT = [
  "import json, sys, urllib.request, urllib.error",
  "req = json.load(sys.stdin)",
  'path = req["path"]',
  'method = req.get("method") or "GET"',
  'body = req.get("body", None)',
  "data = None if body is None else json.dumps(body).encode()",
  'headers = {} if data is None else {"Content-Type": "application/json"}',
  'url = "http://127.0.0.1:5000" + path',
  "request = urllib.request.Request(url, data=data, headers=headers, method=method)",
  "try:",
  "    with urllib.request.urlopen(request, timeout=300) as resp:",
  "        sys.stdout.buffer.write(resp.read())",
  "except urllib.error.HTTPError as err:",
  '    sys.stdout.buffer.write(err.read() or b"")',
  "except urllib.error.URLError:",
  '    sys.stderr.write("connect")',
  "    sys.exit(2)",
].join("\n");

const KALI_PATHS = new Set([
  "/health",
  "/api/tools/nmap",
  "/api/tools/gobuster",
  "/api/tools/dirb",
  "/api/tools/nikto",
  "/api/tools/sqlmap",
  "/api/tools/metasploit",
  "/api/tools/hydra",
  "/api/tools/john",
  "/api/tools/wpscan",
  "/api/tools/enum4linux",
  "/api/command",
]);

export interface KaliApiOptions {
  recorder: Recorder;
  /** Binaire docker : nom nu ou chemin absolu. Défaut : `docker`. */
  binary?: string;
  /** Préfixe d'arguments réservé au code (tests). Voir `DockerClientOptions`. */
  argsPrefix?: readonly string[];
  /** Attente entre deux lectures de `/health` après démarrage. Défaut : 200 ms. */
  pauseMs?: number;
}

export interface KaliHttpRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

/** Appels HTTP vers l'API du conteneur. Ce n'est pas une méthode de `DockerClient`. */
export interface KaliApi {
  call(container: string, request: KaliHttpRequest, call?: CallOptions): Promise<string[]>;
}

export function createKaliApi({
  recorder,
  binary = "docker",
  argsPrefix = [],
  pauseMs = DEFAULT_HEALTH_PAUSE_MS,
}: KaliApiOptions): KaliApi {
  assertBinary(binary);
  const prefix = assertArgsPrefix(argsPrefix);

  const exec = (
    argv: readonly string[],
    call: CallOptions,
    stdin?: string,
  ): Promise<ProcessResult> => {
    const file = resolveBinary(binary);
    if (file === null) return Promise.reject(new CodedError("process.notFound", { binary }));
    return runProcess([file, ...prefix, ...argv], {
      recorder,
      parentId: call.parentId === undefined ? null : call.parentId,
      timeoutMs: call.timeoutMs ?? KALI_EXEC_TIMEOUT_MS,
      ...(call.signal && { signal: call.signal }),
      ...(call.correlation && { correlation: call.correlation }),
      ...(stdin !== undefined && { stdin }),
    });
  };

  const httpArgv = (name: string): string[] => [
    "exec",
    "--interactive",
    "--workdir",
    "/workspace",
    name,
    "python3",
    "-c",
    KALI_HTTP_SCRIPT,
  ];

  const probe = (name: string, call: CallOptions) =>
    exec(httpArgv(name), call, JSON.stringify({ method: "GET", path: "/health" }));

  /**
   * Un conteneur créé avant le montage n'a pas `/workspace`. `mkdir -p` sans
   * `--workdir` : le nom est celui déjà résolu, rien n'est publié ni privilégié.
   */
  const ensureWorkspace = async (name: string, call: CallOptions): Promise<void> => {
    const made = await exec(["exec", "-u", "root", name, "mkdir", "-p", "/workspace"], call);
    if (made.code !== 0) throw new CodedError("kali.unavailable", { name });
  };

  const ensure = async (name: string, call: CallOptions): Promise<void> => {
    await ensureWorkspace(name, call);
    const first = await probe(name, call);
    if (first.code === 0) return;
    const started = await exec(
      [
        "exec",
        "--detach",
        "--workdir",
        "/workspace",
        name,
        "kali-server-mcp",
        "--ip",
        "127.0.0.1",
        "--port",
        "5000",
      ],
      call,
    );
    if (started.code !== 0) throw new CodedError("kali.unavailable", { name });
    for (let i = 0; i < HEALTH_TRIES; i++) {
      if (i > 0 && pauseMs > 0) {
        await sleep(pauseMs, undefined, call.signal ? { signal: call.signal } : {});
      }
      const health = await probe(name, call);
      if (health.code === 0) return;
    }
    throw new CodedError("kali.unavailable", { name });
  };

  return {
    async call(container, request, call = {}) {
      const name = assertOperand(container, "container");
      if (request.method !== "GET" && request.method !== "POST") {
        throw new ValidationError("docker.invalidArgument", { field: "method", reason: "unknown" });
      }
      if (!KALI_PATHS.has(request.path)) {
        throw new ValidationError("docker.invalidArgument", { field: "path", reason: "unknown" });
      }
      await ensure(name, call);
      const stdin = JSON.stringify({
        method: request.method,
        path: request.path,
        ...(request.body !== undefined && { body: request.body }),
      });
      const result = await exec(httpArgv(name), call, stdin);
      if (result.code !== 0) throw new CodedError("kali.unavailable", { name });
      return result.stdout;
    },
  };
}
