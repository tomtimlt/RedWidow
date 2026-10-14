import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join } from "node:path";
import {
  assertArgsPrefix,
  CodedError,
  safeEnv,
  spawnOptionsForTree,
  terminateProcessTree,
  trackProcessTree,
} from "@john-studio/core";

/**
 * Variables réseau transmises au serveur en plus de `safeEnv` : proxys et
 * autorités de certification (sans elles OpenCode ne joint pas son
 * fournisseur derrière un proxy), et dossiers XDG (où il cherche `auth.json`).
 */
const NETWORK_ENV = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
]);

/**
 * Réglages d'environnement qui réduisent la surface du serveur lancé :
 * pas de configuration de projet (un `opencode.json` du dépôt peut déclarer
 * un serveur MCP local, donc une commande exécutée au démarrage — vérifié),
 * pas de plugins externes, pas de partage ni de mise à jour automatique.
 */
export const HARDENING_ENV: Readonly<Record<string, string>> = {
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_SHARE: "1",
};

export interface ServerEnvOptions {
  /** Environnement source (défaut : `process.env`). */
  processEnv?: NodeJS.ProcessEnv;
  /** Noms de variables copiées depuis `processEnv` (clés de fournisseurs…). */
  passEnv?: readonly string[];
  /** Variables posées telles quelles (priment sur le reste, sauf les réglages de sécurité). */
  env?: Readonly<Record<string, string>>;
  config: Record<string, unknown>;
  password: string;
}

/** Environnement du serveur lancé : liste blanche, jamais l'environnement complet. */
export function serverEnv({
  processEnv = process.env,
  passEnv = [],
  env = {},
  config,
  password,
}: ServerEnvOptions): NodeJS.ProcessEnv {
  const base = safeEnv(processEnv);
  for (const [name, value] of Object.entries(processEnv)) {
    if (value !== undefined && NETWORK_ENV.has(name.toUpperCase())) base[name] = value;
  }
  for (const name of passEnv) {
    const value = processEnv[name];
    if (value !== undefined) base[name] = value;
  }
  return {
    ...base,
    ...env,
    ...HARDENING_ENV,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_SERVER_PASSWORD: password,
  };
}

/** Chemin absolu du binaire (recherche dans `PATH`), ou `null` s'il est introuvable ou non exécutable. */
export function resolveBinary(
  binary = "opencode",
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const executable = (path: string) => {
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (binary.includes("/") || isAbsolute(binary)) return executable(binary) ? binary : null;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, binary);
    if (executable(candidate)) return candidate;
  }
  return null;
}

/** Port local libre (le serveur d'OpenCode retombe sinon sur 4096, partagé entre instances). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export interface LaunchOptions {
  /** Chemin du binaire (déjà résolu). */
  binary: string;
  /**
   * Arguments insérés entre le binaire et `serve` (≤ 8 éléments de 4 Kio, sans
   * `\0`). RÉSERVÉ AU CODE (tests : `process.execPath` + script `.mjs`) : ni CLI,
   * ni politique, ni configuration utilisateur ne doivent l'alimenter.
   */
  argsPrefix?: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Délai d'attente du démarrage, en ms (défaut : 30 s). */
  timeoutMs?: number;
}

export interface LaunchedServer {
  url: string;
  close(): Promise<void>;
}

const LISTENING = /opencode server listening on\s+(https?:\/\/\S+)/;

/**
 * Lance `opencode serve` lié à 127.0.0.1 sur un port libre et attend sa
 * ligne « listening ». Pas de shell, environnement fourni par l'appelant.
 */
export async function launchServer({
  binary,
  argsPrefix = [],
  cwd,
  env,
  signal,
  timeoutMs = 30_000,
}: LaunchOptions): Promise<LaunchedServer> {
  const prefix = assertArgsPrefix(argsPrefix);
  const port = await freePort();
  const child = spawn(binary, [...prefix, "serve", "--hostname=127.0.0.1", `--port=${port}`], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...spawnOptionsForTree(),
  });
  trackProcessTree(child);

  const close = async () => {
    await terminateProcessTree(child, { graceMs: 3000, killWaitMs: 1000 });
  };

  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new CodedError("opencode.serverTimeout", { seconds: Math.round(timeoutMs / 1000) }));
    }, timeoutMs);
    const onAbort = () => reject(signal.reason ?? new Error("annulé"));
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = LISTENING.exec(output);
      if (match?.[1]) {
        settle();
        resolve(match[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      settle();
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new CodedError("process.notFound", { binary })
          : new CodedError("opencode.serverFailed", { detail: error.message }),
      );
    });
    child.once("exit", (code) => {
      settle();
      reject(
        new CodedError("opencode.serverFailed", {
          detail: `code ${code ?? "null"} ${output.trim().slice(-500)}`.trim(),
        }),
      );
    });
  }).catch(async (error: unknown) => {
    await close();
    throw error;
  });

  // Les sorties suivantes ne sont plus lues : on les vide pour ne jamais bloquer le serveur.
  child.stdout.resume();
  child.stderr.resume();
  return { url, close };
}
