import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";
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

/** Réglage machine de l’hôte uniquement ; la webview ne choisit jamais le dossier d’un projet. */
export function projectWorkspacesRoot(value?: unknown, home = homedir()): string {
  if (value === undefined || value === "") return join(home, ".exegol", "workspaces");
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

/** Réservation exclusive : aucun dossier existant n’est réutilisé ni nettoyé récursivement. */
export async function createProjectDirectory(
  name: string,
  configuredRoot?: unknown,
): Promise<string> {
  const root = projectWorkspacesRoot(configuredRoot);
  if (join(root, workspaceSlug(name)).length > PROJECT_WORKSPACE_MAX)
    throw new CodedError("project.invalid");
  await checkDirectoryChain(root, true);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await checkDirectoryChain(root);
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
