import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

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
