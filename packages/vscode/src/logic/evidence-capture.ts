import { isAbsolute, relative, sep } from "node:path";
import { t } from "@warband/messages";

/** Une référence décrit un fichier du projet sans ouvrir de chemin transmis par la webview. */
export function evidenceEditorReference(workspace: string, file: string): string {
  const path = relative(workspace, file);
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error(t("La sélection doit appartenir au dossier du projet actif."));
  const reference = path.split(sep).join("/");
  if (/[\p{Cc}\\:]/u.test(reference)) throw new Error(t("Référence de fichier invalide."));
  return reference;
}

/** L’appartenance vient de l’allowlist du projet, jamais du terminal actif ou de son titre. */
export function evidenceTerminalAllowed(containers: readonly string[], container: string): boolean {
  return containers.includes(container);
}
