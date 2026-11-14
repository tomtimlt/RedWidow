import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";
import { mountExposesSensitive } from "./approval/paths.js";
import { isInside } from "./cours/confine.js";
import type { DockerClient } from "./docker/client.js";
import type { StoredProject } from "./project.js";
import { CodedError } from "./reason.js";

export const PROJECT_WORKSPACE_MAX = 1024;

export const PROJECT_WORKSPACE_FOLDERS = [
  "reports",
  "payloads",
  "scans",
  "scripts",
  "evidence",
  "notes",
] as const;

/** Dossiers de travail d’un conteneur, sans projet (ADR 0053, point 3). */
export const CONTAINER_ROOT_DIRS = PROJECT_WORKSPACE_FOLDERS;
export const REDWIDOW_DIR = "RedWidow";
export const PROJECTS_DIR = "projects";

const CONTAINER_FOLDER_NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

/**
 * Plus petit N ≥ 1 tel que `<kind>-N` n’est pas pris (insensible à la casse). L’appelant fournit
 * les conteneurs existants et les noms de dossiers de la racine (ADR 0053, point 2).
 */
export function nextContainerName(kind: "kali" | "exegol", taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  let n = 1;
  while (used.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

/** Réserve `<root>/<name>` (création exclusive, 0o700) et renvoie son chemin réel. */
export async function reserveContainerFolder(root: string, name: string): Promise<string> {
  let base: string;
  try {
    base = await validateProjectFolder(root);
  } catch {
    throw new CodedError("container.rootInvalid");
  }
  const folder = typeof name === "string" ? name.toLowerCase() : "";
  if (!CONTAINER_FOLDER_NAME.test(folder)) throw new CodedError("project.parentInvalid");
  const path = join(base, folder);
  if (path.length > PROJECT_WORKSPACE_MAX) throw new CodedError("project.parentInvalid");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CodedError("project.destinationExists", { path });
    throw error;
  }
  const real = await realpath(path);
  if (relative(await realpath(base), real) !== folder)
    throw new CodedError("path.outside", { path });
  return real;
}

/** `<share>/RedWidow/projects` : parent des projets hébergés par un conteneur. */
export function projectsParent(share: string): string {
  return join(share, REDWIDOW_DIR, PROJECTS_DIR);
}

/**
 * Crée `<share>/RedWidow/{evidence,notes,payloads,reports,scans,scripts,projects}` sans rien
 * écraser (idempotent, 0o700). Un lien symbolique rencontré est refusé. Renvoie `<share>/RedWidow`.
 */
export async function prepareRedwidowRoot(share: string): Promise<string> {
  const base = await validateProjectFolder(share);
  const root = join(base, REDWIDOW_DIR);
  for (const path of [root, ...[...CONTAINER_ROOT_DIRS, PROJECTS_DIR].map((d) => join(root, d))]) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new CodedError("path.outside", { path });
  }
  return root;
}

/** Vrai si `folder` est le partage ou s’y trouve (chemins réels ; faux si l’un des deux est absent). */
export async function isInsideShare(share: string, folder: string): Promise<boolean> {
  try {
    return isInside(await realpath(share), await realpath(folder), process.platform);
  } catch {
    return false;
  }
}

/** Réglage machine de l’hôte : absolu et explicite, sans valeur par défaut (ADR 0052). */
export function projectWorkspacesRoot(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\p{Cc}\p{Cf}]/u.test(value))
    throw new CodedError("project.invalid");
  return resolve(value);
}

function workspaceSlug(name: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .toLowerCase() || "project";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug) ? `project-${slug}` : slug;
}

/** Refuse aussi les liens des ancêtres ; les chemins absents seront créés puis revérifiés. */
async function checkDirectoryChain(root: string, missing = false): Promise<void> {
  let current = parse(root).root;
  for (const part of ["", ...relative(current, root).split(sep).filter(Boolean)]) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new CodedError("path.outside", { path: current });
    } catch (error) {
      if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/**
 * Valide un dossier choisi par l’utilisateur (parent de création, dossier repris ou destination).
 * Absolu, existant, dossier, sans lien symbolique, sans exposer de chemin sensible.
 * Renvoie le chemin résolu ; tout refus est `project.parentInvalid`.
 */
export async function validateProjectFolder(folder: unknown): Promise<string> {
  const refuse = () => new CodedError("project.parentInvalid");
  if (
    typeof folder !== "string" ||
    folder === "" ||
    folder.length > PROJECT_WORKSPACE_MAX ||
    !isAbsolute(folder) ||
    /[\p{Cc}\p{Cf}]/u.test(folder)
  )
    throw refuse();
  const path = resolve(folder);
  // Racine d'un disque ou du système de fichiers : jamais un dossier de projet ni de conteneurs.
  if (parse(path).root === path) throw refuse();
  try {
    await checkDirectoryChain(path);
  } catch {
    throw refuse();
  }
  if (mountExposesSensitive(path, { cwd: path }) !== null) throw refuse();
  return path;
}

/** Réservation exclusive : aucun dossier existant n’est réutilisé ni nettoyé récursivement. */
export async function createProjectDirectory(name: string, parent: unknown): Promise<string> {
  const root = await validateProjectFolder(parent);
  if (join(root, workspaceSlug(name)).length > PROJECT_WORKSPACE_MAX)
    throw new CodedError("project.invalid");
  const canonical = await realpath(root);
  const identity = await lstat(root);
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const path = join(root, `${workspaceSlug(name)}${suffix === 1 ? "" : `-${suffix}`}`);
    if (path.length > PROJECT_WORKSPACE_MAX) throw new CodedError("project.invalid");
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    await prepareProjectWorkspace(path);
    await checkDirectoryChain(path);
    const fresh = await lstat(root);
    if (
      fresh.dev !== identity.dev ||
      fresh.ino !== identity.ino ||
      relative(canonical, await realpath(path)) !== parse(path).base
    )
      throw new CodedError("path.outside", { path });
    return path;
  }
  throw new CodedError("project.invalid");
}

/** Opérations disque injectables (test de la voie inter-volumes). */
export interface MoveDeps {
  rename?: (from: string, to: string) => Promise<void>;
}

/** Copie récursive sans suivre les liens : un lien rencontré est refusé. Taille vérifiée par fichier. */
async function copyTree(from: string, to: string): Promise<void> {
  const info = await lstat(from);
  if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile()))
    throw new CodedError("project.moveFailed");
  if (info.isFile()) {
    await copyFile(from, to, constants.COPYFILE_EXCL);
    if ((await lstat(to)).size !== info.size) throw new CodedError("project.moveFailed");
    return;
  }
  await mkdir(to, { mode: 0o700 });
  for (const entry of await readdir(from)) await copyTree(join(from, entry), join(to, entry));
}

/**
 * Déplace un dossier : `rename`, ou sur EXDEV copie + vérification + suppression de la source.
 * Échec de copie : la copie partielle est supprimée, la source reste intacte.
 */
export async function moveDirectory(
  source: string,
  destination: string,
  deps: MoveDeps = {},
): Promise<void> {
  const move = deps.rename ?? rename;
  try {
    await move(source, destination);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  const root = await lstat(source);
  if (root.isSymbolicLink() || !root.isDirectory()) throw new CodedError("project.moveFailed");
  // La racine est créée de façon exclusive : on ne supprime jamais un dossier qu’on n’a pas créé.
  try {
    await mkdir(destination, { mode: 0o700 });
  } catch {
    throw new CodedError("project.destinationExists");
  }
  try {
    for (const entry of await readdir(source))
      await copyTree(join(source, entry), join(destination, entry));
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error instanceof CodedError ? error : new CodedError("project.moveFailed");
  }
  await rm(source, { recursive: true, force: true });
}

/** Identité de projet incluse pour éviter les collisions entre noms normalisés. */
export function containerProjectWorkspace(project: Pick<StoredProject, "id" | "name">): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(project.id))
    throw new CodedError("project.invalid");
  const slug =
    project.name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  return `/redwidow/Workspace/${slug}-${project.id.slice(0, 8)}`;
}

/** Aucun dossier existant n’est remplacé, aucun lien de catégorie n’est suivi. */
export async function prepareProjectWorkspace(root: string): Promise<void> {
  if (!(await lstat(root)).isDirectory()) throw new CodedError("path.outside", { path: root });
  for (const folder of PROJECT_WORKSPACE_FOLDERS) {
    const path = join(root, folder);
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const st = await lstat(path);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new CodedError("path.outside", { path });
  }
}

/** Adaptation des chemins annoncés par Docker Desktop ; aucun chemin distant n’est supposé local. */
export function dockerHostWorkspace(source: string, platform = process.platform): string {
  const match = /^\/(?:host_mnt|run\/desktop\/mnt\/host)\/([a-zA-Z])(?:\/(.*))?$/.exec(source);
  if (match && platform === "win32")
    return win32.join(`${match[1]}:\\`, ...(match[2] ?? "").split("/"));
  if (match && platform === "linux") return `/mnt/${match[1]?.toLowerCase()}/${match[2] ?? ""}`;
  return source;
}

// Arguments fixes : ni shell utilisateur ni chemin arbitraire provenant du modèle.
const ALIAS_SCRIPT = `set -eu
for parent in /redwidow /redwidow/Workspace; do
  test ! -L "$parent"
  mkdir -p "$parent"
done
if test -e "$1" || test -L "$1"; then
  test "$(readlink -f "$1")" = "$(readlink -f "$2")"
else
  ln -s "$2" "$1" || test "$(readlink -f "$1")" = "$(readlink -f "$2")"
fi`;

/** Prouve le partage hôte/conteneur avant de créer l’alias. Ne recrée jamais un conteneur. */
export async function prepareContainerProjectWorkspace(
  project: StoredProject,
  container: string,
  docker: Pick<DockerClient, "listLabelPrefix" | "execWorkspace">,
): Promise<string> {
  if (!project.containers.includes(container))
    throw new CodedError("project.notFound", { name: container });
  const row = (await docker.listLabelPrefix()).find((r) => r.name === container);
  if (!row || row.state !== "running")
    throw new CodedError("project.notRunning", { name: container });
  if (!row.workspace) throw new CodedError("project.noWorkspace", { name: container });
  const root = await realpath(project.workspace);
  const notMounted = () =>
    new CodedError("project.workspaceNotMounted", {
      container,
      mounted: row.workspace ?? "",
      project: `${project.name} (${project.workspace})`,
    });
  let mounted: string;
  try {
    mounted = await realpath(dockerHostWorkspace(row.workspace));
  } catch {
    throw notMounted();
  }
  const rel = relative(mounted, root);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw notMounted();
  const containerRoot = posix.join("/workspace", ...rel.split(sep).filter(Boolean));
  await prepareProjectWorkspace(root);
  const marker = `.redwidow-share-${randomUUID()}`;
  const proof = randomUUID();
  await writeFile(join(root, marker), proof, { flag: "wx", mode: 0o600 });
  try {
    const lines = await docker.execWorkspace(container, ["cat", posix.join(containerRoot, marker)]);
    if (lines.join("\n").trim() !== proof) throw notMounted();
    const target = containerProjectWorkspace(project);
    await docker.execWorkspace(container, [
      "/bin/sh",
      "-c",
      ALIAS_SCRIPT,
      "redwidow-workspace",
      target,
      containerRoot,
    ]);
    return target;
  } finally {
    await unlink(join(root, marker));
  }
}
