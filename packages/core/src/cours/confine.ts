import { realpath as fsRealpath } from "node:fs/promises";
import { join } from "node:path";
import { CodedError } from "../reason.js";

/** Dépendances injectables (tests) : résolution des liens et plateforme (casse, séparateur). */
export interface ConfineDeps {
  realpath?: (path: string) => Promise<string>;
  platform?: NodeJS.Platform;
  /** Identité (`dev`/`ino`) d'un chemin sans suivre de lien final ; `lstat` par défaut. */
  statPath?: (path: string) => Promise<{ dev: number | bigint; ino: number | bigint }>;
}

/** Chemin confiné : `real` est la cible résolue, `rootReal` la racine résolue. */
export interface Confined {
  rootReal: string;
  real: string;
}

/**
 * Contrôle syntaxique d'un chemin relatif à la racine des cours (aucun accès au disque).
 * Renvoie les segments utiles ; lève `path.unsupported` ou `path.outside` sinon.
 * `\` est un séparateur sur toutes les plateformes ; `.` et les segments vides sont ignorés.
 */
export function checkRelativePath(rel: string): string[] {
  const unsupported = (form: string) => new CodedError("path.unsupported", { path: rel, form });
  if (typeof rel !== "string" || rel === "" || rel.includes("\0"))
    throw unsupported("unresolvable");
  if (rel.startsWith("\\\\") || rel.startsWith("//")) throw unsupported("unc");
  // Absolu sous toute forme : `/x`, `\x`, `C:\x` (lettre de lecteur).
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:/.test(rel)) {
    throw new CodedError("path.outside", { path: rel });
  }
  const segments = rel.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  for (const segment of segments) {
    if (segment === "..") throw new CodedError("path.outside", { path: rel });
    if (segment.includes(":")) throw unsupported("ads");
  }
  return segments;
}

/** Appartenance par préfixe AVEC séparateur (le frère `cours-secret` n'est pas dans `cours`). */
export function isInside(rootReal: string, real: string, platform: NodeJS.Platform): boolean {
  const win = platform === "win32";
  const fold = (p: string) => (win ? p.toLowerCase() : p);
  const sep = win ? "\\" : "/";
  const root = fold(rootReal);
  const target = fold(real);
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Confine `rel` dans `root` : contrôle syntaxique, puis `realpath` de la racine
 * et de la cible et appartenance par préfixe. Un lien sortant est refusé, un lien
 * interne accepté. La racine elle-même peut être un lien : on confine sur sa cible.
 */
export async function confinePath(
  root: string,
  rel: string,
  deps: ConfineDeps = {},
): Promise<Confined> {
  const segments = checkRelativePath(rel);
  const realpath = deps.realpath ?? fsRealpath;
  const platform = deps.platform ?? process.platform;
  const rootReal = await resolveRoot(root, realpath);
  let real: string;
  try {
    real = await realpath(join(rootReal, ...segments));
  } catch {
    throw new CodedError("path.unsupported", { path: rel, form: "unresolvable" });
  }
  if (!isInside(rootReal, real, platform)) throw new CodedError("path.outside", { path: rel });
  return { rootReal, real };
}

/**
 * Racine résolue. Dossier absent (`ENOENT`) : `cours.absent` (aucun cours installé, pas un
 * échec de confinement) ; toute autre erreur reste `path.unsupported`.
 */
export async function resolveRoot(
  root: string,
  realpath: (path: string) => Promise<string> = fsRealpath,
): Promise<string> {
  try {
    return await realpath(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
      throw new CodedError("cours.absent");
    throw new CodedError("path.unsupported", { path: root, form: "unresolvable" });
  }
}
