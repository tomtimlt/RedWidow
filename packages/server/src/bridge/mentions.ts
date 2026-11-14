/**
 * Mentions `@` du chat web : fichiers du dossier du projet actif (lot M4, décision 1). Le client ne donne
 * jamais un chemin hôte : il reçoit et renvoie des chemins RELATIFS à la racine du projet, que le serveur
 * revalide à chaque lecture (segments, lien symbolique, racine, règles de chemins sensibles du cœur).
 *
 * - La racine est le dossier du projet actif ; elle doit rester sous la racine des conteneurs du serveur
 *   (`<données>/containers`, ADR 0056 ; chemins réels comparés) : sinon aucune mention.
 * - Parcours borné (profondeur, entrées visitées), sans suivre aucun lien symbolique, sans `.git`,
 *   `node_modules` ni fichier caché (sauf `.warband/`).
 * - Lecture : mêmes plafonds que les pièces jointes manuelles (`resolveMentionFile`, 64 Kio, UTF-8).
 */
import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  type MentionFile,
  type MentionResolved,
  mentionPathAllowed,
  resolveMentionFile,
} from "@warband/vscode/logic/mentions";

/** Fichiers renvoyés au menu `@`. */
export const MENTION_FILE_LIMIT = 50;
/** Entrées (fichiers et dossiers) visitées au plus par une recherche. */
export const MENTION_SCAN_LIMIT = 4000;
/** Profondeur maximale du parcours. */
export const MENTION_MAX_DEPTH = 8;
/** Plafond d'un chemin relatif accepté d'un client. */
export const MENTION_MAX_PATH = 1024;

/** Dossier ou fichier proposé : ni `.git`, ni `node_modules`, ni caché (`.warband` excepté). */
export function allowedSegment(name: string): boolean {
  if (name === "" || name === "." || name === ".." || name === ".git" || name === "node_modules")
    return false;
  if (name.includes("\0") || name.includes("\\")) return false;
  return !name.startsWith(".") || name === ".warband";
}

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * Racine des mentions : chemin réel du dossier du projet, à condition qu'il soit sous la racine réelle des
 * conteneurs du serveur. `null` : dossier absent, illisible ou hors racine. L'ancienne racine
 * `<données>/projects` n'est jamais admise ici : elle ne sert qu'à migrer (`workspaces.ts`).
 */
export async function mentionRoot(
  workspace: string,
  containersRoot: string,
): Promise<string | null> {
  try {
    const [real, base] = await Promise.all([realpath(workspace), realpath(containersRoot)]);
    return within(base, real) ? real : null;
  } catch {
    return null;
  }
}

/** Score d'un libellé pour une requête (plus petit = meilleur) ; `null` si les lettres n'y figurent pas dans l'ordre. */
export function fuzzyScore(label: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return label.split("/").length * 100 + label.length;
  const text = label.toLowerCase();
  const name = text.slice(text.lastIndexOf("/") + 1);
  const direct = name.indexOf(q);
  if (direct !== -1) return direct * 2 + name.length;
  const whole = text.indexOf(q);
  if (whole !== -1) return 1000 + whole + text.length;
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = text.indexOf(ch, at + 1);
    if (next === -1) return null;
    gaps += next - at - 1;
    at = next;
  }
  return 5000 + gaps + text.length;
}

/**
 * Fichiers de la racine proposés pour `query` (filtre flou), au plus `MENTION_FILE_LIMIT`. Les liens
 * symboliques ne sont pas suivis (fichiers comme dossiers) ; un chemin sensible pour le cœur est absent.
 */
export async function listProjectFiles(root: string, query: string): Promise<MentionFile[]> {
  const found: { label: string; score: number }[] = [];
  let visited = 0;
  let level: string[] = [""];
  for (let depth = 0; depth <= MENTION_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, dir), { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++visited > MENTION_SCAN_LIMIT) break;
        if (!allowedSegment(entry.name) || entry.isSymbolicLink()) continue;
        const label = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory()) next.push(label);
        else if (entry.isFile()) {
          const score = fuzzyScore(label, query);
          if (score !== null) found.push({ label, score });
        }
      }
      if (visited > MENTION_SCAN_LIMIT) break;
    }
    level = next;
    if (visited > MENTION_SCAN_LIMIT) break;
  }
  found.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  const out: MentionFile[] = [];
  for (const { label } of found) {
    if (out.length >= MENTION_FILE_LIMIT) break;
    if (!mentionPathAllowed(join(root, label), [root])) continue;
    out.push({ path: label, label });
  }
  return out;
}

/**
 * Lit un fichier désigné par un chemin relatif venu du client. Refus (`path`) pour : chemin absolu, segment
 * vide, `.` ou `..`, `.git`, `node_modules`, fichier caché, caractère de contrôle, et pour tout chemin dont la
 * résolution réelle sort de la racine (lien symbolique sortant) ou passe par un segment interdit.
 */
export async function resolveProjectFile(root: string, raw: unknown): Promise<MentionResolved> {
  if (typeof raw !== "string" || raw === "" || raw.length > MENTION_MAX_PATH)
    return { ok: false, reason: "invalid" };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refus volontaire des contrôles
  if (isAbsolute(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: "path" };
  const parts = raw.split("/");
  if (!parts.every(allowedSegment)) return { ok: false, reason: "path" };
  let real: string;
  try {
    real = await realpath(join(root, ...parts));
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!within(root, real)) return { ok: false, reason: "path" };
  if (!relative(root, real).split(sep).every(allowedSegment)) return { ok: false, reason: "path" };
  return resolveMentionFile(real, [root]);
}
