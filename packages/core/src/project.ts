import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { DockerClient } from "./docker/client.js";
import { lookupContainer, shortContainerName } from "./exegol/targets.js";
import { capOutput } from "./output.js";
import {
  createProjectDirectory,
  moveDirectory,
  PROJECT_WORKSPACE_MAX,
  prepareProjectWorkspace,
  validateProjectFolder,
} from "./project-workspace.js";
import { CodedError } from "./reason.js";
import { createRedactor } from "./redact.js";

/** Fichier des projets, à côté de `policy.json`. */
export const USER_PROJECT_FILE = "project.json";

/** Dossier des trouvailles d'un projet : `<configDir>/projects/<id>/`. */
const PROJECTS_DIR = "projects";
/** Même nom que `USER_FINDINGS_FILE` (évite un import circulaire). */
const FINDINGS_BASENAME = "findings.json";

const SUMMARY_BASENAME = "summary.txt";
/** Fiche programme (brouillon) et son approbation : chemins sensibles, voir `approval/paths.ts`. */
const PROGRAM_BASENAME = "program.json";
const PROGRAM_APPROVAL_BASENAME = "program.approval.json";
const PACE_HALTED_BASENAME = "pace-halted.json";
/** Fiche d'engagement (ADR 0041), son approbation et l'arrêt d'urgence : chemins sensibles. */
const ENGAGEMENT_BASENAME = "engagement.json";
const ENGAGEMENT_APPROVAL_BASENAME = "engagement.approval.json";
const ENGAGEMENT_HALT_BASENAME = "engagement-halt.json";
/** Plan de campagne (ADR 0041), son approbation, l'exécution des étapes et le démontage : chemins sensibles. */
const CAMPAIGN_BASENAME = "campaign.json";
const CAMPAIGN_APPROVAL_BASENAME = "campaign.approval.json";
const CAMPAIGN_STEPS_BASENAME = "campaign.steps.json";
const TEARDOWN_BASENAME = "teardown.json";
/** Plafond du résumé de session (octets UTF-8, marqueur compris). */
const MAX_SUMMARY_BYTES = 8192;
const SUMMARY_TRUNCATED = "\n[… résumé tronqué]";

const MAX_PROJECTS = 32;
const MAX_CONTAINERS = 32;
const MAX_CREATE_NAME = 80;

/** UUID v4 canonique, minuscules. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FILE_KEYS = new Set(["activeId", "projects"]);
const REQUIRED_PROJECT_KEYS = new Set(["id", "name", "workspace", "containers"]);
const OPTIONAL_PROJECT_KEYS = new Set(["primary"]);
const LEGACY_KEYS = new Set(["container", "workspace"]);

export interface StoredProject {
  id: string;
  name: string;
  workspace: string;
  containers: readonly string[];
  /** Conteneur affiché (cockpit/CLI). Purement informatif : jamais lu à l'exécution. */
  primary?: string;
}

export interface ProjectFile {
  activeId: string | null;
  projects: readonly StoredProject[];
}

export type ProjectLiveState = "running" | "stopped" | "absent";

export interface ProjectStatus {
  container: string | null;
  workspace: string;
  image: string | null;
  state: ProjectLiveState | null;
}

const invalidProject = () => new CodedError("project.invalid", { reason: "json" });

type ChmodFn = (path: string, mode: number) => Promise<void>;

let chmodProjectFile: ChmodFn = chmod;

/** Tests uniquement : observer ou remplacer le `chmod` appliqué à `project.json`. */
export function setChmodProjectFileForTests(fn: ChmodFn | undefined): void {
  chmodProjectFile = fn ?? chmod;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const exactKeys = (raw: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const got = Object.keys(raw);
  return got.length === keys.size && got.every((k) => keys.has(k));
};

/** Clés requises toutes présentes, aucune clé en trop (requise ou optionnelle). */
const validKeys = (
  raw: Record<string, unknown>,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string>,
): boolean => {
  const got = Object.keys(raw);
  return (
    got.every((k) => required.has(k) || optional.has(k)) && [...required].every((k) => k in raw)
  );
};

const validContainerName = (name: string): boolean => name !== "" && !name.includes("\0");

/** Nom relu ou migré : non vide, sans CR, LF ni NUL. La limite de 80 ne s'applique qu'à `createProject`. */
const validStoredName = (name: string): boolean =>
  name !== "" && !name.includes("\0") && !name.includes("\n") && !name.includes("\r");

const validWorkspace = (workspace: unknown): workspace is string =>
  typeof workspace === "string" &&
  workspace !== "" &&
  !workspace.includes("\0") &&
  isAbsolute(workspace);

/** Chemin des trouvailles. L'id est contrôlé avant tout `join`. */
export function projectFindingsPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, FINDINGS_BASENAME);
}

/** Chemin de la fiche programme (brouillon). L'id est contrôlé avant tout `join`. */
export function projectProgramPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, PROGRAM_BASENAME);
}

/** Chemin de l'approbation de la fiche programme. L'id est contrôlé avant tout `join`. */
export function projectProgramApprovalPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, PROGRAM_APPROVAL_BASENAME);
}

/** Chemin de la fiche d'engagement (brouillon). L'id est contrôlé avant tout `join`. */
export function projectEngagementPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, ENGAGEMENT_BASENAME);
}

/** Chemin de l'approbation de la fiche d'engagement. L'id est contrôlé avant tout `join`. */
export function projectEngagementApprovalPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, ENGAGEMENT_APPROVAL_BASENAME);
}

/** Chemin de l'interrupteur d'arrêt d'urgence. L'id est contrôlé avant tout `join`. */
export function projectEngagementHaltPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, ENGAGEMENT_HALT_BASENAME);
}

/** Chemin du plan de campagne (brouillon). L'id est contrôlé avant tout `join`. */
export function projectCampaignPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, CAMPAIGN_BASENAME);
}

/** Chemin de l'approbation du plan de campagne. L'id est contrôlé avant tout `join`. */
export function projectCampaignApprovalPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, CAMPAIGN_APPROVAL_BASENAME);
}

/** Chemin de l'exécution des étapes du plan (écrit par le moteur). L'id est contrôlé avant tout `join`. */
export function projectCampaignStepsPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, CAMPAIGN_STEPS_BASENAME);
}

/** Chemin de l'avancement du démontage (écrit par le moteur). L'id est contrôlé avant tout `join`. */
export function projectTeardownPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, TEARDOWN_BASENAME);
}

/** Chemin des hôtes arrêtés par le contrôleur de rythme. L'id est contrôlé avant tout `join`. */
export function projectPaceHaltedPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, PACE_HALTED_BASENAME);
}

/** Chemin du résumé de session. L'id est contrôlé avant tout `join`. */
export function projectSummaryPath(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId, SUMMARY_BASENAME);
}

/** Résumé de session du projet. Fichier absent → `""`. Id non UUID → `project.invalid`. */
export async function readSummary(configDir: string, projectId: string): Promise<string> {
  const path = projectSummaryPath(configDir, projectId);
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Remplace le résumé de session du projet (pas d'ajout). Le texte est masqué
 * (le fichier est un sink) puis plafonné à 8 Kio avec un marqueur de troncature.
 * Écriture atomique, mode 0o600. Id non UUID → `project.invalid`, sans aucune E/S.
 */
export async function writeSummary(
  configDir: string,
  projectId: string,
  text: string,
): Promise<void> {
  const path = projectSummaryPath(configDir, projectId);
  const redacted = createRedactor({})(text);
  const capped = capOutput(redacted, MAX_SUMMARY_BYTES);
  const content = capped.truncated
    ? `${capOutput(redacted, MAX_SUMMARY_BYTES - Buffer.byteLength(SUMMARY_TRUNCATED)).output}${SUMMARY_TRUNCATED}`
    : capped.output;
  await mkdir(join(configDir, PROJECTS_DIR, projectId), { recursive: true });
  // Temporaire à nom aléatoire, créé en exclusif (`wx`) ; nettoyé si l'écriture ou le renommage échoue.
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await renameWithRetry(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  await chmod(path, 0o600);
}

/** Projet dont l'id est `activeId`, ou `null` si aucun n'est actif. */
export function activeProject(file: ProjectFile): StoredProject | null {
  if (file.activeId === null) return null;
  return file.projects.find((p) => p.id === file.activeId) ?? null;
}

/** Renommage atomique ; sous win32, nouveaux essais sur EPERM/EBUSY/EACCES. */
export async function renameWithRetry(
  from: string,
  to: string,
  io: {
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const { platform = process.platform, rename: doRename = rename, wait = sleep } = io;
  const attempts = platform === "win32" ? 4 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await doRename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !(code === "EPERM" || code === "EBUSY" || code === "EACCES"))
        throw err;
      await wait(50 * attempt);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Écrit la liste validée. Pas d'écriture d'un JSON arbitraire. */
async function writeProjectFile(configDir: string, file: ProjectFile): Promise<void> {
  const path = join(configDir, USER_PROJECT_FILE);
  await mkdir(configDir, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await renameWithRetry(temp, path);
  await chmodProjectFile(path, 0o600);
}

/**
 * Déplace `findings.json` vers le projet migré, sans le relire.
 * Destination déjà présente : le fichier global reste en place.
 */
async function moveGlobalFindings(configDir: string, projectId: string): Promise<void> {
  const dest = projectFindingsPath(configDir, projectId);
  const from = join(configDir, FINDINGS_BASENAME);
  if (await exists(dest)) return;
  if (!(await exists(from))) return;
  await mkdir(join(configDir, PROJECTS_DIR, projectId), { recursive: true });
  if (await exists(dest)) return;
  try {
    await rename(from, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

function parseContainers(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_CONTAINERS) throw invalidProject();
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !validContainerName(item)) throw invalidProject();
    names.push(item);
  }
  if (new Set(names).size !== names.length) throw invalidProject();
  return names;
}

function parseStoredProject(raw: unknown): StoredProject {
  if (!isPlainObject(raw) || !validKeys(raw, REQUIRED_PROJECT_KEYS, OPTIONAL_PROJECT_KEYS))
    throw invalidProject();
  if (typeof raw.id !== "string" || !PROJECT_ID.test(raw.id)) throw invalidProject();
  if (typeof raw.name !== "string" || !validStoredName(raw.name)) throw invalidProject();
  if (!validWorkspace(raw.workspace)) throw invalidProject();
  const containers = parseContainers(raw.containers);
  let primary: string | undefined;
  if ("primary" in raw) {
    if (typeof raw.primary !== "string" || !containers.includes(raw.primary)) {
      throw invalidProject();
    }
    primary = raw.primary;
  }
  return {
    id: raw.id,
    name: raw.name,
    workspace: raw.workspace,
    containers,
    ...(primary !== undefined && { primary }),
  };
}

function parseProjectFile(raw: Record<string, unknown>): ProjectFile {
  if (!Array.isArray(raw.projects) || raw.projects.length > MAX_PROJECTS) throw invalidProject();
  const projects = raw.projects.map((row) => parseStoredProject(row));
  if (new Set(projects.map((p) => p.id)).size !== projects.length) throw invalidProject();
  const ids = new Set(projects.map((p) => p.id));
  if (raw.activeId === null) return { activeId: null, projects };
  if (typeof raw.activeId !== "string" || !ids.has(raw.activeId)) throw invalidProject();
  return { activeId: raw.activeId, projects };
}

async function migrateLegacy(
  configDir: string,
  raw: Record<string, unknown>,
  newId: () => string,
): Promise<ProjectFile> {
  const container = raw.container;
  const workspace = raw.workspace;
  if (typeof container !== "string" || !validContainerName(container)) throw invalidProject();
  if (!validWorkspace(workspace)) throw invalidProject();
  const name = shortContainerName(container);
  if (!validStoredName(name)) throw invalidProject();
  const id = newId();
  if (!PROJECT_ID.test(id)) throw invalidProject();
  const file: ProjectFile = {
    activeId: id,
    projects: [{ id, name, workspace, containers: [container] }],
  };
  await writeProjectFile(configDir, file);
  await moveGlobalFindings(configDir, id);
  return file;
}

/**
 * Lit `project.json`. Absent → `null`. Invalide → `project.invalid`, fichier inchangé.
 * L'objet exact `{ container, workspace }` (workspace absolu) est migré une fois.
 * `newId` n'est appelé que pour cette migration.
 */
export async function readProjects(
  configDir: string,
  newId: () => string = randomUUID,
): Promise<ProjectFile | null> {
  const path = join(configDir, USER_PROJECT_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidProject();
  }
  if (!isPlainObject(parsed)) throw invalidProject();
  if (exactKeys(parsed, LEGACY_KEYS)) return migrateLegacy(configDir, parsed, newId);
  if (!exactKeys(parsed, FILE_KEYS)) throw invalidProject();
  return parseProjectFile(parsed);
}

function assertCreateName(name: string): void {
  if (
    name.length < 1 ||
    name.length > MAX_CREATE_NAME ||
    name.includes("\0") ||
    name.includes("\n") ||
    name.includes("\r")
  ) {
    throw invalidProject();
  }
}

function assertCreateWorkspace(workspace: string): void {
  if (
    workspace.length < 1 ||
    workspace.length > PROJECT_WORKSPACE_MAX ||
    workspace.includes("\0") ||
    !isAbsolute(workspace)
  ) {
    throw invalidProject();
  }
}

/**
 * Crée un projet sans parler à Docker. `containers` est vide.
 * Sans projet actif, le nouveau le devient. Sinon l'actif ne change pas.
 */
export async function createProject(
  configDir: string,
  input: { name: string; workspace: string },
): Promise<StoredProject> {
  assertCreateName(input.name);
  assertCreateWorkspace(input.workspace);
  const file = await readProjects(configDir);
  if (file !== null && file.projects.length >= MAX_PROJECTS) throw invalidProject();
  const id = randomUUID();
  if (!PROJECT_ID.test(id)) throw invalidProject();
  const project: StoredProject = {
    id,
    name: input.name,
    workspace: input.workspace,
    containers: [],
  };
  const activeId = file === null || activeProject(file) === null ? id : file.activeId;
  const projects = file === null ? [project] : [...file.projects, project];
  await writeProjectFile(configDir, { activeId, projects });
  return project;
}

/** Nouveau projet géré : valide avant le disque, réserve `<parent>/<slug>`, puis enregistre la fiche. */
export async function createManagedProject(
  configDir: string,
  name: string,
  parent: unknown,
): Promise<StoredProject> {
  assertCreateName(name);
  const file = await readProjects(configDir);
  if (file !== null && file.projects.length >= MAX_PROJECTS) throw invalidProject();
  const workspace = await createProjectDirectory(name, parent);
  return createProject(configDir, { name, workspace });
}

/** Chemin réel, ou le chemin tel quel si le dossier a disparu. */
async function realOrSame(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Refuse un dossier déjà enregistré (comparaison sur chemins réels). */
async function assertFolderFree(file: ProjectFile | null, folder: string): Promise<void> {
  if (file === null) return;
  const real = await realpath(folder);
  for (const project of file.projects)
    if ((await realOrSame(project.workspace)) === real)
      throw new CodedError("project.folderAlreadyProject", { name: project.name });
}

/**
 * Reprend un dossier existant comme projet (ADR 0052, point 2). Seuls les sous-dossiers usuels
 * manquants sont créés, sans rien écraser. Un dossier déjà enregistré est refusé.
 */
export async function adoptProjectDirectory(
  configDir: string,
  name: string,
  folder: unknown,
): Promise<StoredProject> {
  assertCreateName(name);
  const workspace = await validateProjectFolder(folder);
  const file = await readProjects(configDir);
  if (file !== null && file.projects.length >= MAX_PROJECTS) throw invalidProject();
  await assertFolderFree(file, workspace);
  await prepareProjectWorkspace(workspace);
  return createProject(configDir, { name, workspace });
}

/** Dossier de données d'un projet : `<configDir>/projects/<id>/`. L'id est contrôlé. */
export function projectDataDir(configDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw invalidProject();
  return join(configDir, PROJECTS_DIR, projectId);
}

/**
 * Déplace le dossier d'un projet sous `newParent` (ADR 0052, point 6). Le registre n'est mis à jour
 * qu'après la réussite du déplacement. Les liaisons aux conteneurs ne sont pas touchées.
 */
export async function moveProjectWorkspace(
  configDir: string,
  projectId: string,
  newParent: unknown,
  deps?: Parameters<typeof moveDirectory>[2],
): Promise<StoredProject> {
  const file = await readProjects(configDir);
  const project = file?.projects.find((p) => p.id === projectId);
  if (file === null || project === undefined) throw new CodedError("project.absent");
  const parent = await validateProjectFolder(newParent);
  const source = await realpath(project.workspace);
  const destination = join(parent, basename(project.workspace));
  if (destination.length > PROJECT_WORKSPACE_MAX) throw invalidProject();
  const inside = relative(source, await realpath(parent));
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new CodedError("project.moveFailed");
  try {
    await stat(destination);
    throw new CodedError("project.destinationExists", { path: destination });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  try {
    await moveDirectory(source, destination, deps);
  } catch (err) {
    if (err instanceof CodedError) throw err;
    throw new CodedError("project.moveFailed");
  }
  const updated: StoredProject = { ...project, workspace: destination };
  await writeProjectFile(configDir, {
    activeId: file.activeId,
    projects: file.projects.map((p) => (p.id === projectId ? updated : p)),
  });
  return updated;
}

/**
 * Enregistre un projet importé : garde `id` s'il est un UUID v4 libre, sinon en attribue un.
 * Le dossier existe déjà (validé comme une reprise) ; aucune liaison de conteneur.
 */
export async function registerImportedProject(
  configDir: string,
  input: { id: string; name: string; workspace: string },
): Promise<{ project: StoredProject; idChanged: boolean }> {
  assertCreateName(input.name);
  const workspace = await validateProjectFolder(input.workspace);
  const file = await readProjects(configDir);
  if (file !== null && file.projects.length >= MAX_PROJECTS) throw invalidProject();
  await assertFolderFree(file, workspace);
  const keep =
    typeof input.id === "string" &&
    PROJECT_ID.test(input.id) &&
    !(file?.projects.some((p) => p.id === input.id) ?? false);
  const id = keep ? input.id : randomUUID();
  if (!PROJECT_ID.test(id)) throw invalidProject();
  const project: StoredProject = { id, name: input.name, workspace, containers: [] };
  const activeId = file === null || activeProject(file) === null ? id : file.activeId;
  await writeProjectFile(configDir, {
    activeId,
    projects: file === null ? [project] : [...file.projects, project],
  });
  return { project, idChanged: !keep };
}

/** Renomme la fiche sans changer son identité, son dossier ou ses associations. */
export async function renameProject(
  configDir: string,
  projectId: string,
  name: string,
): Promise<void> {
  assertCreateName(name);
  if (!name.trim()) throw invalidProject();
  const file = await readProjects(configDir);
  if (file === null || !file.projects.some((project) => project.id === projectId))
    throw new CodedError("project.absent");
  await writeProjectFile(configDir, {
    activeId: file.activeId,
    projects: file.projects.map((project) =>
      project.id === projectId ? { ...project, name } : project,
    ),
  });
}

/** Active un projet existant. Id inconnu ou fichier absent : `project.absent`. */
export async function setActiveProject(configDir: string, projectId: string): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null || !file.projects.some((p) => p.id === projectId)) {
    throw new CodedError("project.absent");
  }
  if (file.activeId === projectId) return;
  await writeProjectFile(configDir, { activeId: projectId, projects: file.projects });
}

/**
 * Retire le projet. S'il était actif, `activeId` passe à null sans en activer un autre.
 * Dernier projet : le fichier est supprimé. Les trouvailles restent sur le disque.
 */
export async function removeProject(configDir: string, projectId: string): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null || !file.projects.some((p) => p.id === projectId)) {
    throw new CodedError("project.absent");
  }
  const projects = file.projects.filter((p) => p.id !== projectId);
  if (projects.length === 0) {
    await rm(join(configDir, USER_PROJECT_FILE), { force: true });
    return;
  }
  const activeId = file.activeId === projectId ? null : file.activeId;
  await writeProjectFile(configDir, { activeId, projects });
}

/** Retire le projet actif. Sans actif, ou fichier absent : rien. */
export async function unlink(configDir: string): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null) return;
  const active = activeProject(file);
  if (active === null) return;
  await removeProject(configDir, active.id);
}

/**
 * Ajoute le nom réel renvoyé par `lookupContainer` sur la liste (toute famille).
 * Absent ou ambigu : `project.notFound`. Déjà présent : rien. Au-delà de 32 : `project.invalid`.
 * Projet inconnu : `project.absent`. Le fichier n'est pas modifié en cas de refus.
 */
export async function associateContainer(
  configDir: string,
  projectId: string,
  name: string,
  docker: Pick<DockerClient, "listLabelPrefix">,
): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null) throw new CodedError("project.absent");
  const project = file.projects.find((p) => p.id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  const real = lookupContainer(name, await docker.listLabelPrefix());
  if (real === null) throw new CodedError("project.notFound", { name });
  if (project.containers.includes(real)) return;
  if (project.containers.length >= MAX_CONTAINERS) throw invalidProject();
  const projects = file.projects.map((p) =>
    p.id === projectId ? { ...p, containers: [...p.containers, real] } : p,
  );
  await writeProjectFile(configDir, { activeId: file.activeId, projects });
}

/**
 * Retire un nom stocké. Projet inconnu : `project.absent`. Nom absent : rien.
 * Si le nom retiré était `primary`, ce champ est nettoyé dans la même écriture.
 */
export async function dissociateContainer(
  configDir: string,
  projectId: string,
  name: string,
): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null) throw new CodedError("project.absent");
  const project = file.projects.find((p) => p.id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  if (!project.containers.includes(name)) return;
  const projects = file.projects.map((p) => {
    if (p.id !== projectId) return p;
    const containers = p.containers.filter((c) => c !== name);
    const { primary, ...rest } = p;
    return { ...rest, containers, ...(primary !== undefined && primary !== name && { primary }) };
  });
  await writeProjectFile(configDir, { activeId: file.activeId, projects });
}

/** Nettoie toutes les associations après suppression Docker ; nouvel essai sans effet supplémentaire. */
export async function removeContainerAssociations(configDir: string, name: string): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null || !file.projects.some((p) => p.containers.includes(name))) return;
  const projects = file.projects.map((p) => {
    if (!p.containers.includes(name)) return p;
    const { primary, ...rest } = p;
    return {
      ...rest,
      containers: p.containers.filter((container) => container !== name),
      ...(primary !== undefined && primary !== name && { primary }),
    };
  });
  await writeProjectFile(configDir, { activeId: file.activeId, projects });
}

/**
 * Fixe ou retire le conteneur affiché (`primary`), purement informatif.
 * `name` doit appartenir à `containers` du projet, sinon `project.notFound` (fichier inchangé).
 * `null` efface le champ. Projet inconnu : `project.absent`.
 */
export async function setPrimaryContainer(
  configDir: string,
  projectId: string,
  name: string | null,
): Promise<void> {
  const file = await readProjects(configDir);
  if (file === null) throw new CodedError("project.absent");
  const project = file.projects.find((p) => p.id === projectId);
  if (project === undefined) throw new CodedError("project.absent");
  if (name !== null && !project.containers.includes(name)) {
    throw new CodedError("project.notFound", { name });
  }
  const projects = file.projects.map((p) => {
    if (p.id !== projectId) return p;
    const { primary, ...rest } = p;
    return { ...rest, ...(name !== null && { primary: name }) };
  });
  await writeProjectFile(configDir, { activeId: file.activeId, projects });
}

/**
 * Lie un conteneur Exegol ou Kali en cours, avec un montage `/workspace` absolu.
 * Refus, dans l'ordre : absent, autre famille, arrêté, sans montage. Un refus n'écrit rien.
 * Sans projet actif, en crée un (nom court Exegol ou nom réel Kali, ce montage) puis associe le nom réel.
 * Un projet déjà actif garde son workspace et ses noms.
 */
export async function link(
  configDir: string,
  name: string,
  docker: Pick<DockerClient, "listLabelPrefix">,
  expectedProjectId?: string,
): Promise<void> {
  const rows = await docker.listLabelPrefix();
  const row = rows.find((r) => r.name === name);
  if (row === undefined) throw new CodedError("project.notFound", { name });
  if (row.family !== "exegol" && row.family !== "kali") {
    throw new CodedError("project.notExegol", { name });
  }
  if (row.state !== "running") throw new CodedError("project.notRunning", { name });
  if (row.workspace === undefined || !isAbsolute(row.workspace)) {
    throw new CodedError("project.noWorkspace", { name });
  }
  const file = await readProjects(configDir);
  if (expectedProjectId !== undefined && file?.activeId !== expectedProjectId)
    throw new CodedError("project.absent");
  if (file === null || activeProject(file) === null) {
    const projectName = row.family === "exegol" ? shortContainerName(row.name) : row.name;
    await createProject(configDir, {
      name: projectName,
      workspace: row.workspace,
    });
  }
  const current = await readProjects(configDir);
  const active = current === null ? null : activeProject(current);
  if (active === null || (expectedProjectId !== undefined && active.id !== expectedProjectId))
    throw new CodedError("project.absent");
  await associateContainer(configDir, active.id, row.name, docker);
}

/**
 * État du projet actif. Sans projet actif : `project.absent`.
 * Conteneur affiché, dans l'ordre : `primary` s'il est posé, sinon l'unique conteneur lié,
 * sinon `null` (ainsi que `image`/`state`). `primary` n'influence aucune résolution d'exécution.
 * Un seul conteneur : image et état de cette ligne (`state: "absent"` si le nom n'existe plus).
 */
export async function status(
  configDir: string,
  docker: Pick<DockerClient, "listLabelPrefix">,
): Promise<ProjectStatus> {
  const file = await readProjects(configDir);
  const active = file === null ? null : activeProject(file);
  if (active === null) throw new CodedError("project.absent");
  const container =
    active.primary ?? (active.containers.length === 1 ? active.containers[0] : undefined);
  if (container === undefined) {
    return { container: null, workspace: active.workspace, image: null, state: null };
  }
  const row = (await docker.listLabelPrefix()).find((r) => r.name === container);
  if (row === undefined) {
    return { container, workspace: active.workspace, image: null, state: "absent" };
  }
  return { container, workspace: active.workspace, image: row.image, state: row.state };
}
