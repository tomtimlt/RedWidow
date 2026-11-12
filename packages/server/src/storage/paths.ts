import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** Emplacements du volume de données. */
export interface DataPaths {
  readonly root: string;
  readonly state: string;
  readonly secrets: string;
  readonly projects: string;
  readonly runs: string;
}

export function dataPaths(dataDir: string): DataPaths {
  return {
    root: dataDir,
    state: join(dataDir, "state.json"),
    secrets: join(dataDir, "secrets.json"),
    projects: join(dataDir, "projects"),
    runs: join(dataDir, "runs"),
  };
}

/** Crée le dossier de données et ses sous-dossiers en 0700 (idempotent). */
export async function ensureDataDir(dataDir: string): Promise<DataPaths> {
  const p = dataPaths(dataDir);
  for (const dir of [p.root, p.projects, p.runs]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Le mode de mkdir est filtré par l'umask et ignoré si le dossier existe déjà.
    await chmod(dir, 0o700).catch(() => undefined);
  }
  return p;
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
