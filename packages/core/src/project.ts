import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { DockerClient } from "./docker/client.js";
import { CodedError } from "./reason.js";

/** Fichier de liaison au conteneur actif, à côté de `policy.json`. */
export const USER_PROJECT_FILE = "project.json";

const PROJECT_KEYS = new Set(["container", "workspace"]);

export interface StoredProject {
  container: string;
  workspace: string;
}

export type ProjectLiveState = "running" | "stopped" | "absent";

export interface ProjectStatus {
  container: string;
  workspace: string;
  image: string | null;
  state: ProjectLiveState;
}

const invalidProject = () => new CodedError("project.invalid", { reason: "json" });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseStoredProject(raw: unknown): StoredProject {
  if (!isPlainObject(raw)) throw invalidProject();
  const keys = Object.keys(raw);
  if (keys.length !== PROJECT_KEYS.size || keys.some((k) => !PROJECT_KEYS.has(k))) {
    throw invalidProject();
  }
  const container = raw.container;
  const workspace = raw.workspace;
  if (typeof container !== "string" || container === "") throw invalidProject();
  if (typeof workspace !== "string" || workspace === "") throw invalidProject();
  return { container, workspace };
}

/** Renommage atomique ; sous win32, nouveaux essais sur EPERM/EBUSY/EACCES. */
async function renameWithRetry(
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

async function writeProjectAtomic(configDir: string, project: StoredProject): Promise<void> {
  const path = join(configDir, USER_PROJECT_FILE);
  await mkdir(configDir, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(project, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await renameWithRetry(temp, path);
}

/**
 * Lie le projet au conteneur `name` (déjà listé par `listLabelPrefix`). Remplace
 * tout fichier existant.
 */
export async function link(
  configDir: string,
  name: string,
  docker: Pick<DockerClient, "listLabelPrefix">,
): Promise<void> {
  const rows = await docker.listLabelPrefix();
  const row = rows.find((r) => r.name === name);
  if (row === undefined) throw new CodedError("project.notFound", { name });
  if (row.state !== "running") throw new CodedError("project.notRunning", { name });
  if (row.workspace === undefined) throw new CodedError("project.noWorkspace", { name });
  await writeProjectAtomic(configDir, { container: name, workspace: row.workspace });
}

/** Supprime `project.json`. Absent : rien. */
export async function unlink(configDir: string): Promise<void> {
  await rm(join(configDir, USER_PROJECT_FILE), { force: true });
}

/** Lit `project.json` ; absent → `null` ; invalide → `project.invalid`. */
export async function readProject(configDir: string): Promise<StoredProject | null> {
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
  return parseStoredProject(parsed);
}

/** État du projet lié et du conteneur correspondant dans la liste actuelle. */
export async function status(
  configDir: string,
  docker: Pick<DockerClient, "listLabelPrefix">,
): Promise<ProjectStatus> {
  const stored = await readProject(configDir);
  if (stored === null) throw new CodedError("project.absent");
  const rows = await docker.listLabelPrefix();
  const row = rows.find((r) => r.name === stored.container);
  if (row === undefined) {
    return {
      container: stored.container,
      workspace: stored.workspace,
      image: null,
      state: "absent",
    };
  }
  return {
    container: stored.container,
    workspace: stored.workspace,
    image: row.image,
    state: row.state,
  };
}
