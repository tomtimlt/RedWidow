import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { readProjectChoices } from "./project-controls.js";

export interface ProjectWorkspaceHost {
  folders(): readonly string[];
  hasUnsavedDocuments(): boolean;
  attempted(): string | undefined;
  rememberAttempt(path: string | undefined): PromiseLike<void>;
  openFolder(path: string, newWindow: boolean): PromiseLike<void>;
}

/** Une fenêtre conservée pour ses brouillons ne doit pas exécuter le projet d'une autre fenêtre. */
export async function matchesActiveProjectWorkspace(
  configDir: string,
  cwd: string,
): Promise<boolean> {
  const choices = await readProjectChoices(configDir);
  const project = choices.projects.find((entry) => entry.id === choices.activeId);
  return project === undefined || relative(project.workspace, cwd) === "";
}

/** L'ouverture native garde les contrôles de confiance ; aucun dossier n'est ajouté au workspace. */
export async function openActiveProjectWorkspace(
  configDir: string,
  host: ProjectWorkspaceHost,
  reason: "startup" | "selection",
): Promise<boolean> {
  const folders = host.folders();
  // Une fenêtre déjà occupée n'est jamais détournée au démarrage.
  if (reason === "startup" && folders.length > 0) return false;
  const choices = await readProjectChoices(configDir);
  const project = choices.projects.find((entry) => entry.id === choices.activeId);
  if (!project) return false;
  const path = resolve(project.workspace);
  const first = folders[0];
  if (folders.length === 1 && first !== undefined && relative(first, path) === "") return false;
  // Écrit avant openFolder : un refus, une erreur ou un rechargement ne relance pas la boucle.
  if (reason === "startup" && host.attempted() === path) return false;
  if (!(await stat(path)).isDirectory()) throw new Error("Le dossier du projet est introuvable.");
  await host.rememberAttempt(path);
  await host.openFolder(path, host.hasUnsavedDocuments());
  return true;
}
