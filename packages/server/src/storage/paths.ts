import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isContainerRef } from "../docker/containers.js";

/** Emplacements du volume de données. */
export interface DataPaths {
  readonly root: string;
  readonly state: string;
  readonly secrets: string;
  /** Ancienne racine des projets (ADR 0052) : conservée seulement pour migrer (ADR 0056). */
  readonly projects: string;
  /** Racine unique des dossiers partagés : `containers/<nom>/` pour chaque conteneur (ADR 0056). */
  readonly containers: string;
  readonly runs: string;
}

export function dataPaths(dataDir: string): DataPaths {
  return {
    root: dataDir,
    state: join(dataDir, "state.json"),
    secrets: join(dataDir, "secrets.json"),
    projects: join(dataDir, "projects"),
    containers: join(dataDir, "containers"),
    runs: join(dataDir, "runs"),
  };
}

/** Crée le dossier de données et ses sous-dossiers en 0700 (idempotent). */
export async function ensureDataDir(dataDir: string): Promise<DataPaths> {
  const p = dataPaths(dataDir);
  for (const dir of [p.root, p.projects, p.containers, p.runs]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Le mode de mkdir est filtré par l'umask et ignoré si le dossier existe déjà.
    await chmod(dir, 0o700).catch(() => undefined);
  }
  return p;
}

/** Dossier partagé d'un conteneur : `<racine des conteneurs>/<nom>`. Nom invalide : `null`. Fonction pure. */
export function containerFolder(containersRoot: string, name: string): string | null {
  return isContainerRef(name) && !name.includes("..") && name !== "."
    ? join(containersRoot, name)
    : null;
}

let counter = 0;

/** Écriture atomique en 0600 : fichier temporaire voisin, fsync, puis rename. Jamais de fichier partiel. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${counter++}`;
  try {
    const fh = await open(tmp, "w", 0o600);
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
