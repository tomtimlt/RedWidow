import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renameWithRetry } from "../project.js";

/** Utilitaires de fichiers privés du module d'engagement (non exportés par l'index). */

export const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

export const readIfExists = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
};

export const readIfExistsSync = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
};

/** Écriture atomique (temporaire exclusif puis renommage), mode 0o600. */
export async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await renameWithRetry(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  await chmod(path, 0o600);
}
