import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_POLICY, type Policy, parsePolicy } from "./policy.js";

/** Politique propre au dépôt de travail, lue seulement si son empreinte a été approuvée. */
export const REPO_POLICY_PATH = join(".john-studio", "policy.json");
export const USER_POLICY_FILE = "policy.json";
export const TRUST_STORE_FILE = "trusted-policies.json";

export type PolicyOrigin = "explicit" | "repository" | "user" | "builtin";

export interface LoadedPolicy {
  policy: Policy;
  /** Fichier d'origine, ou « intégrée ». */
  source: string;
  origin: PolicyOrigin;
  /** Présent quand un fichier du dépôt a été ignoré faute d'approbation. */
  warning?: string;
}

/** Répertoire de configuration utilisateur : XDG, `%APPDATA%` ou `~/.config`. */
export function defaultConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32")
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "john-studio");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "john-studio");
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

const realPathOf = (path: string) => realpath(path).catch(() => resolve(path));

export interface TrustedPolicy {
  path: string;
  digest: string;
  policy: Policy;
}

/**
 * Enregistre l'empreinte actuelle d'un fichier de politique : il sera appliqué
 * tant que son contenu ne change pas. À appeler après que l'utilisateur l'a lu.
 */
export async function trustPolicy(path: string, configDir: string): Promise<TrustedPolicy> {
  const text = await readFile(path, "utf8");
  const policy = parsePolicy(JSON.parse(text));
  const key = await realPathOf(path);
  const digest = policyDigest(text);
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
 * 1. chemin explicite ; 2. `.john-studio/policy.json` du dépôt SI son empreinte
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

  let warning: string | undefined;
  const repoPath = resolve(cwd, REPO_POLICY_PATH);
  const repoText = await readIfExists(repoPath);
  if (repoText !== null) {
    const digest = policyDigest(repoText);
    const trusted = (await readTrustStore(configDir))[await realPathOf(repoPath)];
    if (trusted === digest) {
      return { policy: parsePolicy(JSON.parse(repoText)), source: repoPath, origin: "repository" };
    }
    warning =
      trusted === undefined
        ? `politique du dépôt ignorée (non approuvée) : ${repoPath} [sha256 ${digest.slice(0, 12)}]. Après relecture : john policy trust`
        : `politique du dépôt ignorée (modifiée depuis son approbation) : ${repoPath} [sha256 ${digest.slice(0, 12)}]. Après relecture : john policy trust`;
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
    source: "intégrée",
    origin: "builtin",
    ...(warning && { warning }),
  };
}
