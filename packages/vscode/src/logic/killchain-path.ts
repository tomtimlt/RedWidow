import { activeProject, CodedError, readProjects, setFindingPathEdge } from "@warband/core";

/** L'hôte vérifie le projet courant ; le cœur fusionne l'annotation avec les écritures de l'agent. */
export async function setSelectedPathEdge(
  configDir: string,
  projectId: string,
  from: string,
  to: string,
  retained: boolean,
  isCurrent: () => boolean,
): Promise<void> {
  const validate = async () => {
    if (!isCurrent()) throw new CodedError("project.absent");
    const projects = await readProjects(configDir);
    if (projects === null || activeProject(projects)?.id !== projectId || !isCurrent())
      throw new CodedError("project.absent");
  };
  await validate();
  await setFindingPathEdge(configDir, projectId, from, to, retained, { beforeCommit: validate });
}
