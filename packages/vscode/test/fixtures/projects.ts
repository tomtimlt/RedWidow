import { createProject, setActiveProject } from "@warband/core";

/** Projet de test à dossier libre, lié à un conteneur puis activé (le code de production passe par un partage, ADR 0053). */
export async function createSelectedProject(
  configDir: string,
  name: string,
  workspace: string,
  container: string,
): Promise<string> {
  const project = await createProject(configDir, {
    name,
    workspace,
    containers: [container],
    primary: container,
  });
  await setActiveProject(configDir, project.id);
  return project.id;
}
