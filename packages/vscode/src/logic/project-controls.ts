import { basename } from "node:path";
import {
  adoptProjectDirectory,
  CodedError,
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

/** Le conteneur et son dossier partagé sont relus par l’hôte (ADR 0053), jamais fournis par la webview. */
export async function createManagedSelectedProject(
  configDir: string,
  name: string,
  target: { container: string; share: string },
) {
  const project = await createManagedProject(configDir, name, target);
  await activateSelectedProject(configDir, project.id);
  return project;
}

/** Choix de création venu de la webview : aucun chemin, seulement un nom et, au plus, un conteneur. */
export type ProjectCreationChoice =
  | { kind: "newFolder"; name: string }
  | { kind: "existing"; name: string }
  | { kind: "container"; name: string; container: string };

/** Dialogues et relectures de l'hôte : c'est lui seul qui fournit les chemins (ADR 0050, 0052). */
export interface ProjectCreationHost {
  /** Sélecteur natif de dossier, sans dossier par défaut ; `undefined` si annulé. */
  pickFolder(purpose: "parent" | "existing"): Promise<string | undefined>;
  /** Nom proposé puis éventuellement modifié ; `undefined` si annulé. */
  askName(proposed: string): Promise<string | undefined>;
  /** Montage /workspace d'un conteneur connu, relu côté hôte ; `undefined` s'il est inconnu ou sans montage. */
  containerMount(container: string): Promise<string | undefined>;
}

/** Ce qu'il reste à écrire une fois les dialogues terminés ; aucune écriture n'a eu lieu. */
export type ProjectCreationPlan =
  | { kind: "create"; name: string; container: string; share: string }
  | { kind: "adopt"; name: string; folder: string; container: string; share: string };

/** Nom de base du dossier, borné comme un nom de projet. */
export function proposedProjectName(folder: string): string {
  return basename(folder)
    .replace(/[\0\r\n]/g, " ")
    .trim()
    .slice(0, 80);
}

/** Une annulation d'un dialogue renvoie `undefined` : rien n'est créé. */
export async function planProjectCreation(
  choice: ProjectCreationChoice,
  host: ProjectCreationHost,
): Promise<ProjectCreationPlan | undefined> {
  // ADR 0053 : un projet n'existe que dans un conteneur ; l'interface des cibles libres est refaite à part.
  if (choice.kind !== "container") throw new CodedError("project.containerRequired");
  const share = await host.containerMount(choice.container);
  if (share === undefined) throw new CodedError("project.parentInvalid");
  return { kind: "create", name: choice.name, container: choice.container, share };
}

/** Crée ou reprend le dossier, puis active le projet. Les contrôles de chemin restent ceux du cœur. */
export async function applyProjectPlan(configDir: string, plan: ProjectCreationPlan) {
  if (plan.kind === "create")
    return createManagedSelectedProject(configDir, plan.name, {
      container: plan.container,
      share: plan.share,
    });
  const project = await adoptProjectDirectory(configDir, plan.name, plan.folder, {
    container: plan.container,
    share: plan.share,
  });
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
