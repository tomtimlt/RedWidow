import { constants } from "node:fs";
import { type FileHandle, lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultConfigDir } from "../approval/source.js";
import type { DockerToolSpec } from "../docker/tool-specs.js";
import { capOutput } from "../output.js";
import { CodedError } from "../reason.js";
import { type ConfineDeps, confinePath, isInside, resolveRoot } from "./confine.js";

export const COURS_SERVER_NAME = "cours";
export const COURS_TOOL_PREFIX = `mcp__${COURS_SERVER_NAME}__`;
export const COURS_SEARCH_TOOL = `${COURS_TOOL_PREFIX}chercher`;
export const COURS_READ_TOOL = `${COURS_TOOL_PREFIX}lire`;

/** Dossier des cours : sous-dossier de la configuration, jamais un paramètre d'outil. */
export function coursRoot(): string {
  return join(defaultConfigDir(), "cours");
}

/** Plafonds des outils (ajustables seulement par le code, pour les tests). */
export interface CoursLimits {
  /** `chercher` : nombre de lignes renvoyées. */
  maxResults: number;
  /** `chercher` : entrées visitées (fichiers de tout type et dossiers). */
  maxEntries: number;
  /** `chercher` : fichiers ouverts. */
  maxFiles: number;
  /** `chercher` : profondeur de dossiers (la racine vaut 0). */
  maxDepth: number;
  /** `chercher` : octets lus au total. */
  maxTotalBytes: number;
  /** `chercher` : octets lus par fichier. */
  maxFileBytes: number;
  /** `chercher` : longueur d'un extrait de ligne. */
  maxExcerpt: number;
  /** `lire` : octets lus sur le descripteur. */
  maxReadBytes: number;
  /** `lire` : octets de la sortie (`capOutput`). */
  maxOutputBytes: number;
}

export const DEFAULT_COURS_LIMITS: CoursLimits = {
  maxResults: 50,
  maxEntries: 5000,
  maxFiles: 500,
  maxDepth: 8,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxExcerpt: 200,
  maxReadBytes: 1024 * 1024,
  maxOutputBytes: 64 * 1024,
};

/** Réponse de `chercher` quand le dossier de cours est absent ou sans fiche. */
const NO_COURS =
  "Aucun cours installé. Active le téléchargement des cours ou lance la synchronisation.";

const TEXT_FILE = /\.(md|txt)$/i;

/** Ouverture sans blocage (FIFO) et sans suivre un lien final, quand la plateforme le permet. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/** Refuse un descripteur ouvert qui n'est pas le fichier visé (échange de lien entre-temps). */
async function assertSameFile(fh: FileHandle, path: string, rel: string, deps: ConfineDeps) {
  const wanted = await (deps.statPath ?? ((p: string) => lstat(p)))(path);
  const opened = await fh.stat();
  if (opened.dev !== wanted.dev || opened.ino !== wanted.ino) {
    throw new CodedError("path.outside", { path: rel });
  }
}

/** Lit au plus `max` octets depuis le début du descripteur. */
async function readBounded(fh: FileHandle, max: number): Promise<{ buf: Buffer; size: number }> {
  const { size } = await fh.stat();
  const buf = Buffer.alloc(Math.min(size, max));
  let off = 0;
  while (off < buf.length) {
    const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
    if (bytesRead === 0) break;
    off += bytesRead;
  }
  return { buf: buf.subarray(0, off), size };
}

/** Une recherche : parcours itératif, sans suivre aucun lien, sous plafonds. */
async function search(
  rootReal: string,
  needle: string,
  limits: CoursLimits,
  deps: ConfineDeps,
): Promise<string> {
  const query = needle.toLowerCase();
  const out: string[] = [];
  const stopped: string[] = [];
  let files = 0;
  let visited = 0;
  let total = 0;
  // Pile de dossiers (chemin relatif en segments), parcourue dans l'ordre alphabétique.
  const stack: { rel: string[]; depth: number }[] = [{ rel: [], depth: 0 }];

  walk: while (stack.length > 0) {
    const dir = stack.pop() as { rel: string[]; depth: number };
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(join(rootReal, ...dir.rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const subdirs: { rel: string[]; depth: number }[] = [];
    for (const entry of entries) {
      // Toute entrée compte (fichier non texte, dossier, lien) : borne la largeur du parcours.
      if (visited >= limits.maxEntries) {
        stopped.push("entrées");
        break walk;
      }
      visited++;
      // Les liens (même vers un fichier .md) ne sont jamais suivis.
      if (entry.isSymbolicLink()) continue;
      const rel = [...dir.rel, entry.name];
      if (entry.isDirectory()) {
        if (dir.depth < limits.maxDepth) subdirs.push({ rel, depth: dir.depth + 1 });
        else if (!stopped.includes("profondeur")) stopped.push("profondeur");
        continue;
      }
      if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
      if (files >= limits.maxFiles) {
        stopped.push("fichiers");
        break walk;
      }
      if (total >= limits.maxTotalBytes) {
        stopped.push("octets");
        break walk;
      }
      files++;
      let fh: FileHandle | undefined;
      try {
        const path = join(rootReal, ...rel);
        fh = await open(path, OPEN_FLAGS);
        await assertSameFile(fh, path, rel.join("/"), deps);
        const st = await fh.stat();
        if (!st.isFile()) continue;
        const { buf } = await readBounded(
          fh,
          Math.min(limits.maxFileBytes, limits.maxTotalBytes - total),
        );
        total += buf.length;
        const lines = buf.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] as string;
          if (!line.toLowerCase().includes(query)) continue;
          if (out.length >= limits.maxResults) {
            stopped.push("résultats");
            break walk;
          }
          const excerpt = line.trim().slice(0, limits.maxExcerpt);
          out.push(`${rel.join("/")}:${i + 1}: ${excerpt}`);
        }
      } catch {
        // Fichier illisible ou remplacé entre-temps : ignoré.
      } finally {
        await fh?.close();
      }
    }
    // Empilés à l'envers pour visiter les dossiers dans l'ordre alphabétique.
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i] as (typeof subdirs)[0]);
  }

  // Aucune fiche .md/.txt rencontrée : dossier vide, rien d'installé.
  if (files === 0 && out.length === 0 && stopped.length === 0) return NO_COURS;
  const lines = out.length > 0 ? out : ["aucun résultat"];
  if (stopped.length > 0)
    lines.push(`[recherche interrompue, plafond atteint : ${[...new Set(stopped)].join(", ")}]`);
  return lines.join("\n");
}

/** Lecture d'un fichier régulier confiné, bornée à l'octet sur le descripteur ouvert. */
async function readCourse(
  root: string,
  rel: string,
  debut: number,
  limits: CoursLimits,
  deps: ConfineDeps,
): Promise<string> {
  const { rootReal, real } = await confinePath(root, rel, deps);
  // Seuls les fichiers .md et .txt sont lisibles (même filtre que `chercher`), cible comprise.
  if (!TEXT_FILE.test(rel) || !TEXT_FILE.test(real)) {
    throw new CodedError("path.unsupported", { path: rel, form: "unresolvable" });
  }
  const fh = await open(real, OPEN_FLAGS);
  try {
    await assertSameFile(fh, real, rel, deps);
    const st = await fh.stat();
    if (!st.isFile()) throw new CodedError("path.unsupported", { path: rel, form: "unresolvable" });
    // Revérifie la cible après ouverture : réduit la fenêtre d'échange d'un lien.
    const again = await confinePath(root, rel, deps);
    if (again.real !== real || !isInside(rootReal, again.real, deps.platform ?? process.platform)) {
      throw new CodedError("path.outside", { path: rel });
    }
    const { buf, size } = await readBounded(fh, limits.maxReadBytes);
    const lines = buf.toString("utf8").split(/\r?\n/);
    const body = lines
      .slice(debut - 1)
      .map((l, i) => `${debut + i}: ${l}`)
      .join("\n");
    const capped = capOutput(body, limits.maxOutputBytes);
    const notes: string[] = [];
    if (size > buf.length)
      notes.push(`fichier lu partiellement : ${buf.length} octets sur ${size}`);
    if (capped.truncated)
      notes.push(`sortie tronquée à ${limits.maxOutputBytes} octets sur ${capped.bytes}`);
    return notes.length > 0 ? `${capped.output}\n[${notes.join(" ; ")}]` : capped.output;
  } finally {
    await fh.close();
  }
}

/**
 * Outils du serveur `cours`, en lecture seule, confinés à `root`. La racine est fixée par
 * le code appelant (`coursRoot()`), jamais par le modèle.
 */
export function coursToolSpecs(
  root: string,
  overrides: Partial<CoursLimits> = {},
  deps: ConfineDeps = {},
): DockerToolSpec[] {
  const limits = { ...DEFAULT_COURS_LIMITS, ...overrides };
  const chercherInput = {
    requete: z
      .string()
      .min(1)
      .max(200)
      .describe("Texte littéral à trouver (sans expression régulière)"),
  };
  const lireInput = {
    chemin: z.string().describe("Chemin relatif au dossier de cours, comme renvoyé par chercher"),
    debut: z.number().int().min(1).optional().describe("Première ligne à lire (défaut 1)"),
  };
  return [
    {
      name: "chercher",
      description:
        "Cherche un texte littéral (insensible à la casse) dans les fichiers .md et .txt des cours. " +
        "Renvoie des lignes chemin:numéro: extrait.",
      input: chercherInput,
      readOnly: true,
      async run(args) {
        const { requete } = z.object(chercherInput).parse(args);
        let rootReal: string;
        try {
          rootReal = await resolveRoot(root, deps.realpath);
        } catch (err) {
          if (err instanceof CodedError && err.code === "cours.absent") return NO_COURS;
          throw err;
        }
        return search(rootReal, requete, limits, deps);
      },
    },
    {
      name: "lire",
      description:
        "Lit un fichier de cours (chemin relatif) à partir d'une ligne. Les lignes sont numérotées ; la sortie est plafonnée.",
      input: lireInput,
      readOnly: true,
      async run(args) {
        const { chemin, debut } = z.object(lireInput).parse(args);
        return readCourse(root, chemin, debut ?? 1, limits, deps);
      },
    },
  ];
}
