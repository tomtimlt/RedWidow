import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, parse, relative, sep } from "node:path";
import { mountExposesSensitive, type PathOptions } from "@warband/core";
import { t } from "@warband/messages";

/**
 * Valide un dossier choisi comme dossier partagé d'un conteneur (ADR 0050) et renvoie son chemin
 * réel. Refus (texte clair, rien n'est mémorisé) : chemin relatif, absent, pas un dossier, lien
 * symbolique, ou montage qui exposerait un chemin sensible (racine d'un disque, dossier personnel).
 * Ces refus ne sont pas contournables : le montage est une action humaine directe.
 */
export async function validateSharedFolder(
  path: string,
  options: Partial<PathOptions> = {},
): Promise<string> {
  if (typeof path !== "string" || path === "" || !isAbsolute(path))
    throw new Error(t("Le dossier partagé doit être un chemin absolu."));
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    throw new Error(t("Le dossier partagé est introuvable."));
  }
  if (info.isSymbolicLink())
    throw new Error(t("Le dossier partagé ne peut pas être un lien symbolique."));
  if (!info.isDirectory()) throw new Error(t("Le dossier partagé doit être un dossier."));
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new Error(t("Le dossier partagé est introuvable."));
  }
  // Racine d'un disque (« / », « C:\\ ») : toujours refusée, même si aucun secret connu n'y est trouvé.
  if (parse(real).root === real || mountExposesSensitive(real, { ...options, cwd: real }) !== null)
    throw new Error(t("Ce dossier ne peut pas être partagé : il expose des données sensibles."));
  return real;
}

/** Vrai si le dossier du projet est le dossier partagé ou s'y trouve (chemins réels). */
export async function projectInSharedFolder(shared: string, workspace: string): Promise<boolean> {
  let root: string;
  let project: string;
  try {
    root = await realpath(shared);
    project = await realpath(workspace);
  } catch {
    return false;
  }
  const rel = relative(root, project);
  return !(isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`));
}

/**
 * Source du montage d'une création, d'après le seul dossier mémorisé par l'hôte (jamais un texte
 * de la webview ni le dossier du projet). Revalide juste avant la création. `link` : la liaison au
 * projet actif n'est tentée que si son dossier est dans le dossier partagé (ADR 0050).
 */
export async function resolveCreationFolder(
  remembered: string | undefined,
  project?: { workspace: string },
  options: Partial<PathOptions> = {},
): Promise<{ source: string; link: boolean }> {
  if (remembered === undefined) throw new Error(t("Choisissez le dossier partagé."));
  const source = await validateSharedFolder(remembered, options);
  if (source !== remembered)
    throw new Error(t("Le dossier partagé a changé. Choisissez-le à nouveau."));
  return {
    source,
    link: project !== undefined && (await projectInSharedFolder(source, project.workspace)),
  };
}

/**
 * Source du montage selon le mode de création (ADR 0052). Mode « project » : le dossier du projet
 * actif, relu par l'hôte et revalidé comme tout dossier partagé ; le dossier mémorisé est ignoré
 * et la liaison est attendue. Mode « multi » : comportement de `resolveCreationFolder`.
 */
export async function resolveCreationShare(
  mode: "project" | "multi",
  remembered: string | undefined,
  project?: { workspace: string },
  options: Partial<PathOptions> = {},
): Promise<{ source: string; link: boolean }> {
  if (mode === "multi") return await resolveCreationFolder(remembered, project, options);
  if (project === undefined)
    throw new Error(t("Choisissez un projet avant de créer son conteneur."));
  return { source: await validateSharedFolder(project.workspace, options), link: true };
}
