import { constants, type Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stripControl } from "@warband/core";

/** Source de cours affichée par l'Atlas : sous-dossier direct de la racine et sa licence déclarée. */
export interface CoursSource {
  name: string;
  /** Première ligne non vide du fichier de licence, sinon « licence absente ». */
  droits: string;
}

export const LICENSE_MISSING = "licence absente";
/** Octets lus au plus dans un fichier de licence. */
export const MAX_LICENSE_BYTES = 4096;
/** Sources listées au plus. */
export const MAX_SOURCES = 50;
const MAX_TEXT = 200;
const LICENSE_FILE = /^(license|licence|copying)/i;

const clean = (text: string): string => {
  const t = stripControl(text).trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
};

/** Première ligne non vide de la licence, lecture bornée sur le descripteur (fichier régulier seulement). */
async function firstLicenseLine(file: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // O_NOFOLLOW : un lien posé entre le listage et l'ouverture est refusé (absent sous Windows : sans effet).
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(MAX_LICENSE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_LICENSE_BYTES, 0);
    for (const line of buffer.toString("utf8", 0, bytesRead).split(/\r?\n/)) {
      const text = clean(line);
      if (text !== "") return text;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Liste les sources d'un dossier de cours (lecture seule) : un sous-dossier direct par source, liens
 * symboliques ignorés (dossiers comme fichiers de licence), 50 entrées au plus, triées par nom.
 * La racine vient de l'hôte (`coursRoot()`), jamais de la webview. Racine absente ou illisible : liste vide.
 */
export async function readSources(root: string): Promise<CoursSource[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_SOURCES);
  const out: CoursSource[] = [];
  for (const name of dirs) {
    let license: string | null = null;
    try {
      const files = (await readdir(join(root, name), { withFileTypes: true }))
        .filter((e) => e.isFile() && !e.isSymbolicLink() && LICENSE_FILE.test(e.name))
        .map((e) => e.name)
        .sort();
      for (const file of files) {
        license = await firstLicenseLine(join(root, name, file));
        if (license !== null) break;
      }
    } catch {
      license = null;
    }
    out.push({ name: clean(name), droits: license ?? LICENSE_MISSING });
  }
  return out;
}
