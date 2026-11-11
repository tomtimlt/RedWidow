import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CodedError, type Reason, reason } from "../reason.js";
import { DEFAULT_POLICY, type Policy, parsePolicy } from "./policy.js";

/** Politique propre au dépôt de travail, lue seulement si son empreinte a été approuvée. */
export const REPO_POLICY_PATH = join(".warband", "policy.json");
export const USER_POLICY_FILE = "policy.json";
export const TRUST_STORE_FILE = "trusted-policies.json";

export type PolicyOrigin = "explicit" | "repository" | "user" | "builtin";

export interface LoadedPolicy {
  policy: Policy;
  /** Fichier d'origine ; `null` pour la politique intégrée (`origin: "builtin"`). */
  source: string | null;
  origin: PolicyOrigin;
  /** Présent quand un fichier du dépôt a été ignoré faute d'approbation. */
  warning?: Reason;
}

/** Répertoire de configuration utilisateur : XDG, `%APPDATA%` ou `~/.config`. */
export function defaultConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const base =
    env.XDG_CONFIG_HOME ??
    (platform === "win32"
      ? env.APPDATA || join(home, "AppData", "Roaming")
      : join(home, ".config"));
  return join(base, "warband");
}

export function policyDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type TrustStore = Record<string, string>;

async function readTrustStore(configDir: string): Promise<TrustStore> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(configDir, TRUST_STORE_FILE), "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Clé d'empreinte : `realpathSync.native` (casse canonique du disque sous Windows) ; chemin résolu si le fichier n'existe pas. */
const realPathOf = async (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

export interface TrustedPolicy {
  path: string;
  digest: string;
  policy: Policy;
}

/**
 * Enregistre l'empreinte actuelle d'un fichier de politique : il sera appliqué
 * tant que son contenu ne change pas. À appeler après que l'utilisateur l'a lu.
 */
export interface TrustPolicyOptions {
  /** Empreinte vue par l'humain avant d'approuver : refus si le fichier a changé depuis. */
  expectedDigest?: string | undefined;
}

export async function trustPolicy(
  path: string,
  configDir: string,
  options: TrustPolicyOptions = {},
): Promise<TrustedPolicy> {
  const text = await readFile(path, "utf8");
  const policy = parsePolicy(JSON.parse(text));
  const key = await realPathOf(path);
  const digest = policyDigest(text);
  if (options.expectedDigest !== undefined && options.expectedDigest !== digest)
    throw new CodedError("policy.repo.changedBeforeTrust", { path: key });
  const store = await readTrustStore(configDir);
  store[key] = digest;
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, TRUST_STORE_FILE), `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { path: key, digest, policy };
}

export interface LoadPolicyOptions {
  /** Chemin passé explicitement (`--policy`) : choisi par l'utilisateur, donc de confiance. */
  explicit?: string | undefined;
  cwd: string;
  configDir?: string;
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * Résolution par ordre de confiance :
 * 1. chemin explicite ; 2. `.warband/policy.json` du dépôt SI son empreinte
 * est approuvée ; 3. politique utilisateur ; 4. politique intégrée.
 *
 * Un dépôt cloné ne peut donc pas s'octroyer des droits : son fichier n'est
 * jamais appliqué avant `trustPolicy`, et plus du tout s'il change ensuite.
 */
export async function loadPolicy({
  explicit,
  cwd,
  configDir = defaultConfigDir(),
}: LoadPolicyOptions): Promise<LoadedPolicy> {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    return {
      policy: parsePolicy(JSON.parse(await readFile(path, "utf8"))),
      source: path,
      origin: "explicit",
    };
  }

  let warning: Reason | undefined;
  const repoPath = resolve(cwd, REPO_POLICY_PATH);
  const repoText = await readIfExists(repoPath);
  if (repoText !== null) {
    const digest = policyDigest(repoText);
    const trusted = (await readTrustStore(configDir))[await realPathOf(repoPath)];
    if (trusted === digest) {
      return { policy: parsePolicy(JSON.parse(repoText)), source: repoPath, origin: "repository" };
    }
    warning = reason(trusted === undefined ? "policy.repo.untrusted" : "policy.repo.modified", {
      path: repoPath,
      digest: digest.slice(0, 12),
    });
  }

  const userPath = join(configDir, USER_POLICY_FILE);
  const userText = await readIfExists(userPath);
  if (userText !== null) {
    return {
      policy: parsePolicy(JSON.parse(userText)),
      source: userPath,
      origin: "user",
      ...(warning && { warning }),
    };
  }
  return {
    policy: DEFAULT_POLICY,
    source: null,
    origin: "builtin",
    ...(warning && { warning }),
  };
}
