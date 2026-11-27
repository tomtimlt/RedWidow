import { basename, resolve } from "node:path";
import {
  adoptProjectDirectory,
  CodedError,
  type CommonRoot,
  type ContainerMount,
  createManagedProject,
  projectContainerPath,
  readProjects,
  removeProject,
  renameProject,
  rowMounts,
  type StoredProject,
  setActiveProject,
  setPrimaryContainer,
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

/** Crée le projet sous `<racine>/projets` sans conteneur ni `primary` (ADR 0054), puis l'active. */
export async function createManagedSelectedProject(
  configDir: string,
  name: string,
  root: string,
): Promise<StoredProject> {
  const project = await createManagedProject(configDir, name, root);
  await activateSelectedProject(configDir, project.id);
  return project;
}

/** Choix de création venu de la webview : aucun chemin ni conteneur, seulement un nom (ADR 0054). */
export type ProjectCreationChoice =
  | { kind: "create"; name: string }
  /** `name` vide : l'hôte propose le nom de base du dossier choisi. */
  | { kind: "adopt"; name: string };

/** Dialogues et relectures de l'hôte : c'est lui seul qui fournit les chemins (ADR 0050, 0054). */
export interface ProjectCreationHost {
  /** Racine commune demandée une seule fois (`ensureRoot`) ; `undefined` si annulée. */
  commonRoot(): Promise<CommonRoot | undefined>;
  /** Sélecteur natif de dossier ouvert sur `<racine>/projets` ; `undefined` si annulé. */
  pickExisting(projectsDir: string): Promise<string | undefined>;
  /** Nom proposé puis éventuellement modifié ; `undefined` si annulé. */
  askName(proposed: string): Promise<string | undefined>;
}

/** Ce qu'il reste à écrire une fois les dialogues terminés ; aucune écriture n'a eu lieu. */
export type ProjectCreationPlan =
  | { kind: "create"; name: string; root: string }
  | { kind: "adopt"; name: string; folder: string };

/** Nom de base du dossier, borné comme un nom de projet. */
export function proposedProjectName(folder: string): string {
  return basename(folder)
    .replace(/[\0\r\n]/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Une annulation d'un dialogue renvoie `undefined` : rien n'est créé. Un dossier existant est accepté
 * où qu'il soit (le cœur le valide) ; hors de la racine, aucun conteneur ne le verra (ADR 0054).
 */
export async function planProjectCreation(
  choice: ProjectCreationChoice,
  host: ProjectCreationHost,
): Promise<ProjectCreationPlan | undefined> {
  const common = await host.commonRoot();
  if (common === undefined) return undefined;
  if (choice.kind === "create") return { kind: "create", name: choice.name, root: common.root };
  const folder = await host.pickExisting(common.projects);
  if (folder === undefined) return undefined;
  const name = choice.name !== "" ? choice.name : await host.askName(proposedProjectName(folder));
  if (name === undefined || name === "") return undefined;
  return { kind: "adopt", name, folder };
}

/** Ligne Docker relue par l'hôte, avec ses montages (démarrée ou arrêtée). */
export interface VisibilityRow {
  name: string;
  family?: string;
  workspace?: string;
  mounts?: readonly ContainerMount[];
}

/**
 * Visibilité (ADR 0054, point 3) : pour chaque projet, les conteneurs de famille connue, démarrés
 * ou arrêtés, dont un montage couvre son dossier. Fonction pure, comparaison lexicale.
 */
export function projectVisibility(
  projects: readonly Pick<StoredProject, "id" | "workspace">[],
  rows: readonly VisibilityRow[],
): Record<string, string[]> {
  const known = rows
    .filter((row) => row.family === "exegol" || row.family === "kali")
    .map((row) => ({ name: row.name, mounts: rowMounts(row) }));
  return Object.fromEntries(
    projects.map((project) => {
      const workspace = resolve(project.workspace);
      return [
        project.id,
        known
          .filter((row) => projectContainerPath(workspace, row.mounts) !== undefined)
          .map((row) => row.name),
      ];
    }),
  );
}

/**
 * Projets sans aucun conteneur visible. `visibility` : `undefined` si la liste Docker est
 * indisponible (rien n'est affirmé).
 */
export function unassociatedProjectIds(
  projects: readonly Pick<StoredProject, "id">[],
  visibility: Readonly<Record<string, readonly string[]>> | undefined,
): string[] {
  if (visibility === undefined) return [];
  return projects
    .filter((project) => (visibility[project.id]?.length ?? 0) === 0)
    .map((project) => project.id);
}

/** Charge utile du studio pour la carte projet : conteneurs qui voient le projet et défaut. */
export interface ProjectSeenBy {
  containers: { name: string; short: string; state: "running" | "stopped" }[];
  primary: string | null;
}

/** Combine la visibilité et les lignes d'affichage ; un conteneur inconnu de la liste est ignoré. */
export function projectSeenBy(
  projects: readonly Pick<StoredProject, "id" | "primary">[],
  visibility: Readonly<Record<string, readonly string[]>> | undefined,
  containers: readonly { name: string; short: string; state: "running" | "stopped" }[],
): Record<string, ProjectSeenBy> {
  if (visibility === undefined) return {};
  return Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        containers: containers
          .filter((row) => visibility[project.id]?.includes(row.name))
          .map(({ name, short, state }) => ({ name, short, state })),
        primary: project.primary ?? null,
      },
    ]),
  );
}

/**
 * Conteneur par défaut du projet (informatif, ADR 0054) : seulement un conteneur qui voit le
 * dossier, relu par l'hôte ; `null` retire le défaut.
 */
export async function setProjectPrimary(
  configDir: string,
  projectId: string,
  container: string | null,
  listContainers: () => Promise<readonly VisibilityRow[]>,
): Promise<void> {
  const project = (await readProjects(configDir))?.projects.find(({ id }) => id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  if (container !== null) {
    const seen = projectVisibility([project], await listContainers())[project.id] ?? [];
    if (!seen.includes(container))
      throw new Error(t("Ce conteneur ne voit pas le dossier du projet."));
  }
  await setPrimaryContainer(configDir, projectId, container);
}

/** Crée ou reprend le dossier, puis active le projet. Les contrôles de chemin restent ceux du cœur. */
export async function applyProjectPlan(configDir: string, plan: ProjectCreationPlan) {
  if (plan.kind === "create") return createManagedSelectedProject(configDir, plan.name, plan.root);
  const project = await adoptProjectDirectory(configDir, plan.name, plan.folder);
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
