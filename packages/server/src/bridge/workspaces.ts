/**
 * Dossiers partagés des conteneurs et projets qui y vivent (ADR 0056). Tout est sous une seule racine,
 * `<données>/containers/<conteneur>/<projet>`. Le client ne fournit jamais un chemin hôte : seuls des noms
 * (conteneur, projet) arrivent ici, revalidés ; les chemins sont construits et revérifiés côté serveur
 * (dossiers réels, jamais de lien symbolique suivi, aucune sortie de la racine, aucun écrasement).
 */
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  utimes,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  associateContainer,
  CodedError,
  createManagedProject,
  PROJECT_WORKSPACE_FOLDERS,
  prepareProjectWorkspace,
  readProjects,
  removeProject,
  type StoredProject,
  USER_PROJECT_FILE,
} from "@warband/core";
import { isContainerRef } from "../docker/containers.js";
import { containerFolder, writeFileAtomic } from "../storage/paths.js";

/** Les deux racines : la nouvelle (`containers`) et l'ancienne (`legacy`, lecture et migration seulement). */
export interface WorkspaceRoots {
  containers: string;
  legacy: string;
}

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Dossier partagé et chemin du projet d'après un dossier de travail (lexical) ; `null` hors `<racine>/<dossier>/<projet>`. */
export function locate(
  workspace: string,
  containersRoot: string,
): { folder: string; project: string } | null {
  const rel = relative(resolve(containersRoot), resolve(workspace));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const [folder, ...rest] = rel.split(sep);
  if (folder === undefined || rest.length === 0 || !isContainerRef(folder)) return null;
  return { folder, project: rest.join("/") };
}

/** Un projet est lié s'il vit dans un dossier partagé et nomme au moins un conteneur (sinon : « à lier »). */
export function isLinked(project: StoredProject, containersRoot: string): boolean {
  return project.containers.length > 0 && locate(project.workspace, containersRoot) !== null;
}

/** Projets dont le dossier est dans le dossier partagé `folder`. */
export function projectsInFolder(
  projects: readonly StoredProject[],
  containersRoot: string,
  folder: string,
): StoredProject[] {
  return projects.filter((p) => locate(p.workspace, containersRoot)?.folder === folder);
}

/** Dossier réel `<racine>/<nom>` : ni lien symbolique, ni sortie de la racine. Renvoie son chemin. */
async function checkedFolder(containersRoot: string, name: string): Promise<string> {
  const path = containerFolder(containersRoot, name);
  if (path === null) throw new CodedError("container.invalidName");
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new CodedError("path.outside", { path: name });
    const [real, base] = await Promise.all([realpath(path), realpath(containersRoot)]);
    if (real !== join(base, name)) throw new CodedError("path.outside", { path: name });
  } catch (error) {
    if (error instanceof CodedError) throw error;
    throw new CodedError("folder.invalid");
  }
  return path;
}

/**
 * Crée le dossier partagé d'un conteneur (0700 : le serveur en est propriétaire ; root dans le conteneur y
 * écrit quand même) avec la racine RedWidow. Dossier déjà présent, quelle qu'en soit la cause : refus
 * `container.folderExists`, rien n'est touché.
 */
export async function provisionFolder(containersRoot: string, name: string): Promise<string> {
  const path = containerFolder(containersRoot, name);
  if (path === null) throw new CodedError("container.invalidName");
  await mkdir(containersRoot, { recursive: true, mode: 0o700 });
  await chmod(containersRoot, 0o700).catch(() => undefined);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CodedError("container.folderExists", { name });
    throw new CodedError("folder.invalid");
  }
  try {
    await chmod(path, 0o700).catch(() => undefined);
    await prepareProjectWorkspace(path);
    return await checkedFolder(containersRoot, name);
  } catch (error) {
    await discardFolder(path);
    throw error instanceof CodedError ? error : new CodedError("folder.invalid");
  }
}

/**
 * Retire un dossier partagé tout juste créé, SANS jamais supprimer un fichier : `rmdir` non récursif des six
 * dossiers de la racine RedWidow puis du dossier. S'il contient autre chose, il reste.
 */
export async function discardFolder(path: string): Promise<void> {
  for (const name of PROJECT_WORKSPACE_FOLDERS)
    await rmdir(join(path, name)).catch(() => undefined);
  await rmdir(path).catch(() => undefined);
}

/** Faux client Docker : `associateContainer` ne lit que la liste ; le conteneur a déjà été validé par l'appelant. */
const knownContainer = (name: string) => ({
  listLabelPrefix: async () => [
    { name, image: "", state: "stopped" as const, family: "kali" as const },
  ],
});

/**
 * Crée un projet dans le dossier partagé d'un conteneur : `<racine>/<dossier>/<projet>` avec la racine RedWidow,
 * fiche liée au conteneur. Dossier partagé absent ou douteux : refus. Ne rend pas le projet actif.
 */
export async function createProjectInFolder(
  configDir: string,
  containersRoot: string,
  folder: string,
  container: string,
  name: string,
): Promise<StoredProject> {
  const dir = await checkedFolder(containersRoot, folder);
  const project = await createManagedProject(configDir, name, dir);
  try {
    await associateContainer(configDir, project.id, container, knownContainer(container));
  } catch (error) {
    await removeProject(configDir, project.id).catch(() => undefined);
    await discardFolder(project.workspace);
    throw error;
  }
  return { ...project, containers: [container] };
}

// ------------------------------------------------------------------------------------------------
// Déplacement d'un projet existant
// ------------------------------------------------------------------------------------------------

type Entry = { kind: "dir" | "file" | "link"; size: number; target?: string };

/** Inventaire d'un arbre sans suivre aucun lien ; fichier spécial (socket, périphérique…) : refus. */
async function inventory(root: string, rel = "", out = new Map<string, Entry>()) {
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const full = join(root, path);
    if (entry.isSymbolicLink())
      out.set(path, { kind: "link", size: 0, target: await readlink(full) });
    else if (entry.isDirectory()) {
      out.set(path, { kind: "dir", size: 0 });
      await inventory(root, path, out);
    } else if (entry.isFile()) out.set(path, { kind: "file", size: (await lstat(full)).size });
    else throw new CodedError("project.moveFailed");
  }
  return out;
}

/** Copie récursive vers un dossier déjà réservé et vide. Les liens sont recréés tels quels, jamais suivis. */
async function copyTree(from: string, to: string, rel = ""): Promise<void> {
  for (const entry of await readdir(join(from, rel), { withFileTypes: true })) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const src = join(from, path);
    const dst = join(to, path);
    const info = await lstat(src);
    if (info.isSymbolicLink()) await symlink(await readlink(src), dst);
    else if (info.isDirectory()) {
      await mkdir(dst, { mode: info.mode & 0o777 });
      await copyTree(from, to, path);
      await chmod(dst, info.mode & 0o777).catch(() => undefined);
      await utimes(dst, info.atime, info.mtime).catch(() => undefined);
    } else if (info.isFile()) {
      await copyFile(src, dst, 1 /* COPYFILE_EXCL : jamais d'écrasement */);
      await chmod(dst, info.mode & 0o777).catch(() => undefined);
      await utimes(dst, info.atime, info.mtime).catch(() => undefined);
    } else throw new CodedError("project.moveFailed");
  }
}

/** Les deux arbres ont les mêmes entrées, types, tailles et cibles de lien. */
async function sameTree(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([inventory(a), inventory(b)]);
  if (x.size !== y.size) return false;
  for (const [path, e] of x) {
    const o = y.get(path);
    if (o === undefined || o.kind !== e.kind || o.size !== e.size || o.target !== e.target)
      return false;
  }
  return true;
}

/** Réserve un dossier libre `<parent>/<base>[-n]` (création exclusive : jamais d'écrasement). */
async function reserve(parent: string, base: string): Promise<string> {
  for (let n = 1; n <= 1000; n++) {
    const path = join(parent, n === 1 ? base : `${base}-${n}`);
    try {
      await mkdir(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new CodedError("project.destExists");
}

/** Réécrit `project.json` après relecture : le projet doit être resté tel qu'on l'a vu. */
async function relocate(
  configDir: string,
  before: StoredProject,
  workspace: string,
  container: string,
): Promise<void> {
  const file = await readProjects(configDir);
  const current = file?.projects.find((p) => p.id === before.id);
  if (file === null || current === undefined || current.workspace !== before.workspace)
    throw new CodedError("project.absent");
  const projects = file.projects.map((p) =>
    p.id === before.id
      ? {
          ...p,
          workspace,
          containers: p.containers.includes(container)
            ? p.containers
            : [...p.containers, container],
        }
      : p,
  );
  await writeFileAtomic(
    join(configDir, USER_PROJECT_FILE),
    `${JSON.stringify({ activeId: file.activeId, projects }, null, 2)}\n`,
  );
}

export interface MoveOptions {
  configDir: string;
  roots: WorkspaceRoots;
  project: StoredProject;
  /** Dossier partagé et nom du conteneur cible (déjà validés contre la liste des conteneurs gérés). */
  folder: string;
  container: string;
  /** Injectable (tests) : `rename` qui échoue en `EXDEV` pour exercer la copie entre volumes. */
  io?: { rename?: typeof rename };
}

/**
 * Déplace le dossier d'un projet existant dans le dossier partagé d'un conteneur, puis met à jour la fiche.
 * La source doit être un vrai dossier sous l'ancienne racine (migration) ou sous la racine des conteneurs.
 * `rename` atomique si possible ; sinon (autre volume) copie vérifiée, fiche mise à jour, puis seulement
 * suppression de l'ancien dossier. Rien n'est jamais écrasé ; aucun lien symbolique n'est suivi.
 */
export async function moveProjectIntoFolder(options: MoveOptions): Promise<StoredProject> {
  const { configDir, roots, project, folder, container } = options;
  const doRename = options.io?.rename ?? rename;
  const src = resolve(project.workspace);
  let realSrc: string;
  try {
    const info = await lstat(src);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new CodedError("path.outside", { path: project.name });
    realSrc = await realpath(src);
    const [legacy, shared] = await Promise.all([
      realpath(roots.legacy).catch(() => null),
      realpath(roots.containers).catch(() => null),
    ]);
    const allowed = [legacy, shared].some((r) => r !== null && within(r, realSrc));
    if (!allowed) throw new CodedError("path.outside", { path: project.name });
  } catch (error) {
    throw error instanceof CodedError ? error : new CodedError("project.moveFailed");
  }
  const target = await checkedFolder(roots.containers, folder);
  if (realSrc === join(await realpath(target), basename(realSrc))) {
    // Déjà dans le bon dossier partagé : seule la fiche change.
    await relocate(configDir, project, src, container);
    return { ...project, containers: [...project.containers, container] };
  }
  if (within(realSrc, await realpath(target)))
    throw new CodedError("path.outside", { path: folder });
  const dest = await reserve(target, basename(realSrc));
  let state = "none" as "none" | "renamed" | "copying" | "copied";
  try {
    try {
      await doRename(src, dest);
      state = "renamed";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // Autre volume : copie dans le dossier réservé, vérifiée avant toute suppression.
      state = "copying";
      await copyTree(src, dest);
      if (!(await sameTree(src, dest))) throw new CodedError("project.moveFailed");
      state = "copied";
    }
    await relocate(configDir, project, dest, container);
  } catch (error) {
    // Fiche non écrite : retour à l'état initial (l'ancien dossier n'est supprimé qu'après la fiche).
    if (state === "renamed") await rename(dest, src).catch(() => undefined);
    else if (state === "none") await rmdir(dest).catch(() => undefined);
    else await rm(dest, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof CodedError ? error : new CodedError("project.moveFailed");
  }
  if (state === "copied") await rm(src, { recursive: true, force: true }).catch(() => undefined);
  return { ...project, workspace: dest, containers: [...project.containers, container] };
}

// ------------------------------------------------------------------------------------------------
// Suppression d'un dossier partagé (après seconde confirmation humaine)
// ------------------------------------------------------------------------------------------------

/**
 * Supprime le dossier partagé d'un conteneur et les fiches des projets qui y vivent. À n'appeler qu'après une
 * confirmation humaine explicite. Dossier vérifié (réel, sous la racine, pas un lien) ; `rm` ne suit pas les liens.
 */
export async function removeFolderAndProjects(
  configDir: string,
  containersRoot: string,
  folder: string,
): Promise<number> {
  const path = await checkedFolder(containersRoot, folder);
  const file = await readProjects(configDir).catch(() => null);
  const inside = projectsInFolder(file?.projects ?? [], containersRoot, folder);
  await rm(path, { recursive: true });
  for (const p of inside) await removeProject(configDir, p.id).catch(() => undefined);
  return inside.length;
}

/** Nombre de projets d'un dossier partagé (pour le texte de la confirmation). */
export async function countFolderProjects(
  configDir: string,
  containersRoot: string,
  folder: string,
): Promise<number> {
  const file = await readProjects(configDir).catch(() => null);
  return projectsInFolder(file?.projects ?? [], containersRoot, folder).length;
}
