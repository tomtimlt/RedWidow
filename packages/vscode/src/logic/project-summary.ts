import { activeProject, CodedError, readProjects, readSummary, writeSummary } from "@warband/core";

export interface ProjectSummaryView {
  projectId: string;
  projectName: string;
  text: string;
}

/** Absence de projet → null ; une erreur de lecture reste une erreur observable. */
export async function readProjectSummary(configDir: string): Promise<ProjectSummaryView | null> {
  const file = await readProjects(configDir);
  const project = file === null ? null : activeProject(file);
  if (project === null) return null;
  return {
    projectId: project.id,
    projectName: project.name,
    text: await readSummary(configDir, project.id),
  };
}

/** Le projet affiché doit encore être actif ; jamais de cible déduite d'un chemin de webview. */
export async function saveProjectSummary(
  configDir: string,
  projectId: string,
  text: string,
): Promise<void> {
  const file = await readProjects(configDir);
  const project = file === null ? null : activeProject(file);
  if (project === null || project.id !== projectId) throw new CodedError("project.absent");
  await writeSummary(configDir, project.id, text);
}
