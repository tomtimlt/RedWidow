import { createProject, readProjects, setActiveProject } from "@warband/core";

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
