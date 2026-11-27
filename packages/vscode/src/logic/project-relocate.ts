import {
  CodedError,
  type CommonRoot,
  defaultConfigDir,
  moveProjectWorkspace,
  readProjects,
} from "@warband/core";
import { t } from "@warband/messages";
import { projectInSharedFolder } from "./shared-folder.js";

/** Dépendances du déplacement d'un projet vers la racine commune, simulables en test. */
export interface RelocateProjectDeps {
  configDir?: string;
  /** Un tour ou un changement de projet est en cours : refus avant toute lecture. */
  busy(): boolean;
  /** Racine commune demandée par l'hôte (`ensureRoot`) ; `undefined` si annulée : rien n'est écrit. */
  root(): Promise<CommonRoot | undefined>;
  /** Confirmation modale native ; `false` : rien n'est déplacé. */
  confirm(info: { name: string; workspace: string; destination: string }): Promise<boolean>;
  readProj?: typeof readProjects;
  move?: typeof moveProjectWorkspace;
}

/**
 * Déplace un projet sous `<racine>/projets` (ADR 0054, point 5) : la destination est calculée,
 * jamais choisie, et aucune association ni `primary` n'est posé (les conteneurs qui voient la
 * racine le verront). Rien n'est écrit sans confirmation modale (`null` si refusée ou si la racine
 * est annulée). Un projet déjà sous la racine est refusé sans écriture. Les contrôles de chemin
 * (absolu, chemin réel, sans lien symbolique, montage sensible) restent ceux du cœur.
 */
export async function relocateProject(
  projectId: string,
  deps: RelocateProjectDeps,
): Promise<{ workspace: string } | null> {
  if (deps.busy()) throw new Error(t("Arrêtez les tours en cours avant de déplacer le projet."));
  const configDir = deps.configDir ?? defaultConfigDir();
  const file = await (deps.readProj ?? readProjects)(configDir);
  const project = file?.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  const common = await deps.root();
  if (common === undefined) return null;
  if (await projectInSharedFolder(common.projects, project.workspace))
    throw new Error(t("Le projet est déjà dans la racine commune."));
  if (
    !(await deps.confirm({
      name: project.name,
      workspace: project.workspace,
      destination: common.projects,
    }))
  )
    return null;
  // Un tour a pu démarrer pendant la modale : rien n'est déplacé alors.
  if (deps.busy()) throw new Error(t("Arrêtez les tours en cours avant de déplacer le projet."));
  const moved = await (deps.move ?? moveProjectWorkspace)(configDir, project.id, common.projects);
  return { workspace: moved.workspace };
}
