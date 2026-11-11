import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CodedError,
  loadPolicy,
  parsePolicy,
  policyDigest,
  REPO_POLICY_PATH,
  trustPolicy,
} from "@warband/core";
import { t } from "@warband/messages";

/** État affiché dans Réglages › Projet ; l'empreinte est tronquée à 12 caractères. */
export type RepoPolicyState =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "untrusted" | "trusted" | "modified"; digest: string };

/** Chemin fixé par l'hôte : jamais fourni par une webview. */
export const repoPolicyPath = (cwd: string): string => join(cwd, REPO_POLICY_PATH);

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Lecture seule : s'appuie sur `loadPolicy`, qui reste l'unique juge de l'approbation. */
export async function repoPolicyState(cwd: string, configDir: string): Promise<RepoPolicyState> {
  let text: string;
  try {
    text = await readFile(repoPolicyPath(cwd), "utf8");
  } catch (error) {
    if (isMissing(error)) return { state: "absent" };
    return { state: "invalid" };
  }
  const digest = policyDigest(text).slice(0, 12);
  try {
    const loaded = await loadPolicy({ cwd, configDir });
    if (loaded.origin === "repository") return { state: "trusted", digest };
    if (loaded.warning?.code === "policy.repo.modified") return { state: "modified", digest };
    if (loaded.warning?.code === "policy.repo.untrusted") return { state: "untrusted", digest };
  } catch {
    // Fichier du dépôt ou politique utilisateur illisible : pas d'état fiable.
  }
  return { state: "invalid" };
}

export interface RepoPolicyTrustDeps {
  /** `vscode.workspace.isTrusted`. */
  isWorkspaceTrusted: () => boolean;
  /** Ouvre le fichier en lecture seule (aperçu) pour que l'humain le relise. */
  show: (path: string) => Promise<void>;
  /** Modale native ; `true` seulement sur le geste « Approuver ». */
  confirm: (text: string) => Promise<boolean>;
  configDir: string;
}

export type RepoPolicyTrustResult =
  | { status: "untrustedWorkspace" }
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | { status: "cancelled" }
  | { status: "changed" }
  | { status: "trusted"; digest: string };

/**
 * Approuve la politique du dépôt après relecture et confirmation humaine.
 * Aucun paramètre venu de la webview : le chemin se déduit du dossier de la fenêtre.
 */
export async function trustRepoPolicy(
  cwd: string,
  deps: RepoPolicyTrustDeps,
): Promise<RepoPolicyTrustResult> {
  if (!deps.isWorkspaceTrusted()) return { status: "untrustedWorkspace" };
  const path = repoPolicyPath(cwd);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { status: "absent" };
    return { status: "invalid", message: error instanceof Error ? error.message : String(error) };
  }
  try {
    parsePolicy(JSON.parse(text));
  } catch (error) {
    return { status: "invalid", message: error instanceof Error ? error.message : String(error) };
  }
  const digest = policyDigest(text);
  await deps.show(path);
  const confirmed = await deps.confirm(
    t`Approuver la politique du dépôt ${path} ? Empreinte : ${digest.slice(0, 12)}. Elle s'appliquera aux prochains runs de ce dossier tant que son contenu ne change pas.`,
  );
  if (!confirmed) return { status: "cancelled" };
  try {
    await trustPolicy(path, deps.configDir, { expectedDigest: digest });
  } catch (error) {
    if (error instanceof CodedError && error.code === "policy.repo.changedBeforeTrust")
      return { status: "changed" };
    throw error;
  }
  return { status: "trusted", digest: digest.slice(0, 12) };
}
