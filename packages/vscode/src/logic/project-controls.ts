import {
  createManagedProject,
  createProject,
  readProjects,
  removeProject,
  renameProject,
  setActiveProject,
} from "@warband/core";
import { t } from "@warband/messages";

export interface ProjectChoices {
  activeId: string | null;
  projects: { id: string; name: string; workspace: string }[];
}

/** Liste réelle des projets ; les erreurs de lecture restent observables par l'hôte. */
export async function readProjectChoices(configDir: string): Promise<ProjectChoices> {
  const file = await readProjects(configDir);
  return {
    activeId: file?.activeId ?? null,
    projects: file?.projects.map(({ id, name, workspace }) => ({ id, name, workspace })) ?? [],
  };
}

/** L'id est validé et recherché par le cœur, sans cible d'exécution implicite. */
export async function activateSelectedProject(configDir: string, projectId: string): Promise<void> {
  await setActiveProject(configDir, projectId);
}

/** Le dossier doit provenir du dialogue natif de l'hôte, jamais de la webview. */
export async function createSelectedProject(
  configDir: string,
  name: string,
  workspace: string,
): Promise<string> {
  const project = await createProject(configDir, { name, workspace });
  await setActiveProject(configDir, project.id);
  return project.id;
}

/** L’extension ne demande que le nom ; la racine provient du réglage machine. */
export async function createManagedSelectedProject(
  configDir: string,
  name: string,
  root?: unknown,
) {
  const project = await createManagedProject(configDir, name, root);
  await activateSelectedProject(configDir, project.id);
  return project;
}

export interface ProjectManagementHost {
  isCurrent(): boolean;
  busy(): boolean;
  rename(name: string): Promise<string | undefined>;
  confirmRemove(name: string): Promise<boolean>;
}

/** Relecture après dialogue : une action périmée ne modifie jamais un autre projet. */
export async function manageSelectedProject(
  configDir: string,
  projectId: string,
  action: "rename" | "remove",
  host: ProjectManagementHost,
): Promise<boolean> {
  const file = await readProjects(configDir);
  const selected = file?.projects.find((project) => project.id === projectId);
  if (!selected) throw new Error(t("Ce projet n’existe plus."));
  if (host.busy() || !host.isCurrent()) return false;
  const name = action === "rename" ? await host.rename(selected.name) : undefined;
  if (action === "rename" && name === undefined) return false;
  if (action === "remove" && !(await host.confirmRemove(selected.name))) return false;
  const fresh = await readProjects(configDir);
  if (
    host.busy() ||
    !host.isCurrent() ||
    fresh?.activeId !== file?.activeId ||
    JSON.stringify(fresh?.projects.find((project) => project.id === projectId)) !==
      JSON.stringify(selected)
  )
    throw new Error(t("Le projet ou le travail en cours a changé. Recommencez l’action."));
  if (action === "rename") await renameProject(configDir, projectId, name?.trim() ?? "");
  else await removeProject(configDir, projectId);
  return true;
}
