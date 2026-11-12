/**
 * Garde commune de l'API Fichiers (ADR 0055) : un client ne fournit jamais un chemin hôte, seulement un
 * chemin RELATIF à la racine du projet actif. Chaque opération le revalide : segments, absence de lien
 * symbolique (sur tout le chemin, cible comprise), appartenance à la racine réelle, `.git` et
 * `node_modules` jamais atteints. Aucun lien symbolique n'est suivi.
 */
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CodedError } from "@warband/core";

/** Plafonds d'un chemin relatif : total (octets UTF-8) et par segment. */
export const FS_MAX_PATH = 1024;
export const FS_MAX_SEGMENT = 255;

/** Politique du dépôt : écriture permise, mais l'empreinte approuvée ne correspond plus ensuite. */
export const POLICY_REL = ".warband/policy.json";

// biome-ignore lint/suspicious/noControlCharactersInRegex: refus volontaire des contrôles
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Échappements d'URL d'un point ou d'un séparateur : jamais décodés par le serveur, refusés par prudence. */
const ESCAPED = /%(2e|2f|5c)/i;
const DRIVE = /^[A-Za-z]:/;

/** Segment interdit dans tous les cas : le dépôt Git et les dépendances ne s'explorent ni ne s'éditent. */
const isProtected = (name: string): boolean => name === ".git" || name === "node_modules";

/** Nom de segment valide (aussi pour un nom créé : dossier, renommage, téléversement). */
export function validSegment(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !CONTROL.test(name) &&
    !ESCAPED.test(name) &&
    !DRIVE.test(name) &&
    Buffer.byteLength(name) <= FS_MAX_SEGMENT
  );
}

/**
 * Segments d'un chemin relatif venu du client. `""` est la racine (seulement si `allowRoot`). Refus
 * (`fs.invalidPath`) : non-chaîne, absolu, segment vide, `.` ou `..`, NUL ou contrôle, `\`, échappement
 * `%2e`/`%2f`/`%5c`, segment > 255 octets, total > 1024 octets ; (`fs.protected`) : `.git`, `node_modules`.
 */
export function splitPath(raw: unknown, allowRoot: boolean): string[] {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > FS_MAX_PATH)
    throw new CodedError("fs.invalidPath");
  if (raw === "") {
    if (allowRoot) return [];
    throw new CodedError("fs.invalidPath");
  }
  if (isAbsolute(raw)) throw new CodedError("fs.invalidPath");
  const parts = raw.split("/");
  for (const part of parts) {
    if (!validSegment(part)) throw new CodedError("fs.invalidPath");
    if (isProtected(part)) throw new CodedError("fs.protected");
  }
  return parts;
}

/** Nom créé (renommage, téléversement) : segment valide et non protégé. */
export function checkNewName(name: unknown): string {
  if (!validSegment(name)) throw new CodedError("fs.invalidPath");
  if (isProtected(name)) throw new CodedError("fs.protected");
  return name;
}

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Cible résolue : `st` est le `lstat` de la cible, `null` si elle n'existe pas encore. */
export interface Target {
  abs: string;
  /** Chemin relatif normalisé (séparateur `/`), `""` pour la racine. */
  rel: string;
  parts: string[];
  st: Stats | null;
}

const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Résout un chemin client sous `root` (chemin RÉEL du projet). Chaque composant existant est inspecté par
 * `lstat` : un lien symbolique (intermédiaire ou cible) est refusé (`fs.symlink`), un intermédiaire qui
 * n'est pas un dossier aussi (`fs.notDir`). Un composant intermédiaire absent : `fs.notFound`. Le dernier
 * peut manquer (création) sauf `mustExist`. Le parent réel est enfin comparé à la racine (défense en
 * profondeur contre une substitution pendant la marche).
 */
export async function resolveTarget(
  root: string,
  raw: unknown,
  options: { allowRoot?: boolean; mustExist?: boolean } = {},
): Promise<Target> {
  const parts = splitPath(raw, options.allowRoot === true);
  let current = root;
  let st: Stats | null = null;
  try {
    st = await lstat(root);
    for (const [i, part] of parts.entries()) {
      current = join(current, part);
      const last = i === parts.length - 1;
      try {
        st = await lstat(current);
      } catch (e) {
        if (!missing(e)) throw e;
        if (!last) throw new CodedError("fs.notFound");
        st = null;
        break;
      }
      if (st.isSymbolicLink()) throw new CodedError("fs.symlink");
      if (!last && !st.isDirectory()) throw new CodedError("fs.notDir");
    }
    const parent = parts.length === 0 ? root : dirname(current);
    if ((await realpath(parent)) !== parent || !within(root, parent))
      throw new CodedError("fs.symlink");
  } catch (e) {
    if (e instanceof CodedError) throw e;
    throw new CodedError(missing(e) ? "fs.notFound" : "fs.failed");
  }
  if (st === null && options.mustExist === true) throw new CodedError("fs.notFound");
  return { abs: current, rel: parts.join("/"), parts, st };
}

/** Empreinte de version d'un fichier (mtime + taille) : change dès que l'un des deux change. */
export const etagOf = (st: Pick<Stats, "mtimeMs" | "size">): string => `${st.mtimeMs}:${st.size}`;

/** Date de modification en millisecondes entières. */
export const mtimeOf = (st: Pick<Stats, "mtimeMs">): number => Math.trunc(st.mtimeMs);
