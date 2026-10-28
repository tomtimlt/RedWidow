import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
export const MISSION_FOLDERS = ["notes", "scripts", "resultats", "preuves", "rapports"] as const;
/** Aucun écrasement et aucun suivi d’un lien pour créer les dossiers de mission. */
export async function prepareMissionFolder(root: string): Promise<void> {
  if (!(await lstat(root)).isDirectory())
    throw Error("Le dossier de projet doit être un dossier réel.");
  for (const name of MISSION_FOLDERS) {
    const path = join(root, name);
    try {
      const st = await lstat(path);
      if (!st.isDirectory() || st.isSymbolicLink())
        throw Error(`Chemin de mission incompatible : ${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(path, { mode: 0o700 });
    }
  }
}
