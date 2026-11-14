import { isAbsolute } from "node:path";
import {
  associateContainer,
  CodedError,
  defaultConfigDir,
  dissociateContainer,
  type LabelPrefixContainer,
  moveProjectWorkspace,
  prepareRedwidowRoot,
  projectsParent,
  readProjects,
  setPrimaryContainer,
} from "@warband/core";
import { t } from "@warband/messages";
import { projectInSharedFolder } from "./shared-folder.js";

/** Dépendances de la relocalisation d'un projet « non associé », simulables en test. */
export interface RelocateProjectDeps {
  configDir?: string;
  /** Un tour ou un changement de projet est en cours : refus avant toute lecture. */
  busy(): boolean;
  /** Conteneurs relus côté hôte (docker), arrêtés compris ; jamais fournis par la webview. */
  listContainers(): Promise<readonly LabelPrefixContainer[]>;
  /** Confirmation modale native ; `false` : rien n'est déplacé. */
  confirm(info: {
    name: string;
    workspace: string;
    container: string;
    destination: string;
  }): Promise<boolean>;
  readProj?: typeof readProjects;
  prepare?: typeof prepareRedwidowRoot;
  move?: typeof moveProjectWorkspace;
  associate?: typeof associateContainer;
  setPrimary?: typeof setPrimaryContainer;
  dissociate?: typeof dissociateContainer;
}

/**
 * Déplace un projet sous `<partage du conteneur>/RedWidow/projects/` (ADR 0053, point 8) : la
 * destination est calculée, jamais choisie. Rien n'est écrit sans confirmation modale (`null` si
 * refusée). Après le déplacement, le conteneur est lié et affiché, et les liaisons aux autres
 * conteneurs qui ne voient plus le projet sont retirées. Un projet déjà dans le partage n'est pas
 * déplacé, seulement lié.
 */
export async function relocateProject(
  projectId: string,
  container: string,
  deps: RelocateProjectDeps,
): Promise<{ workspace: string } | null> {
  if (deps.busy()) throw new Error(t("Arrêtez les tours en cours avant de déplacer le projet."));
  const configDir = deps.configDir ?? defaultConfigDir();
  const file = await (deps.readProj ?? readProjects)(configDir);
  const project = file?.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  const rows = await deps.listContainers();
  const target = rows.find((row) => row.name === container);
  const share =
    target?.workspace !== undefined && isAbsolute(target.workspace) ? target.workspace : undefined;
  if (target === undefined || share === undefined)
    throw new CodedError("project.containerRequired");
  const alreadyInside = await projectInSharedFolder(share, project.workspace);
  const destination = projectsParent(share);
  if (
    !(await deps.confirm({
      name: project.name,
      workspace: project.workspace,
      container: target.name,
      destination,
    }))
  )
    return null;
  // Un tour a pu démarrer pendant la modale : rien n'est déplacé alors.
  if (deps.busy()) throw new Error(t("Arrêtez les tours en cours avant de déplacer le projet."));
  let workspace = project.workspace;
  if (!alreadyInside) {
    await (deps.prepare ?? prepareRedwidowRoot)(share);
    workspace = (await (deps.move ?? moveProjectWorkspace)(configDir, project.id, destination))
      .workspace;
  }
  await (deps.associate ?? associateContainer)(configDir, project.id, target.name, {
    listLabelPrefix: async () => rows as LabelPrefixContainer[],
  });
  await (deps.setPrimary ?? setPrimaryContainer)(configDir, project.id, target.name);
  for (const name of project.containers) {
    if (name === target.name) continue;
    const row = rows.find((candidate) => candidate.name === name);
    if (row === undefined || row.workspace === undefined || !isAbsolute(row.workspace)) continue;
    if (!(await projectInSharedFolder(row.workspace, workspace)))
      await (deps.dissociate ?? dissociateContainer)(configDir, project.id, name);
  }
  return { workspace };
}
