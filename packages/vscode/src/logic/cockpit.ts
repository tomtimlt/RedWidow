import {
  assertOperand,
  CodedError,
  createDockerClient,
  createRecorder,
  type DockerClient,
  defaultConfigDir,
  type LabelPrefixContainer,
  link,
  readProject,
  resolveBinary,
  status,
} from "@john-studio/core";
import { formatError } from "@john-studio/messages";

/** Messages acceptés depuis la webview cockpit (non fiables). */
export type CockpitMessage =
  | { type: "refresh" }
  | { type: "link"; name: string }
  | { type: "openWorkspace" }
  | { type: "terminal" };

const CONTAINER_NAME_MAX = 256;

/** Valide un message cockpit ; les types du chat ou formes invalides → `null`. */
export function parseCockpitMessage(raw: unknown): CockpitMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const only = (...allowed: string[]) => Object.keys(m).every((k) => allowed.includes(k));
  switch (m.type) {
    case "refresh":
      return only("type") ? { type: "refresh" } : null;
    case "openWorkspace":
    case "terminal":
      return only("type") ? { type: m.type } : null;
    case "link":
      return only("type", "name") &&
        typeof m.name === "string" &&
        m.name !== "" &&
        m.name.length <= CONTAINER_NAME_MAX
        ? { type: "link", name: m.name }
        : null;
    default:
      return null;
  }
}

const FORBIDDEN_EXEC_FLAGS = new Set([
  "-u",
  "--user",
  "--privileged",
  "-v",
  "--volume",
  "--mount",
  "--network",
  "-e",
  "--env",
]);

/** Vérifie qu'aucun argument d'exécution dangereux n'est présent (filet sur le conteneur). */
export function assertSafeExecArgv(argv: readonly string[]): void {
  for (const arg of argv) {
    if (FORBIDDEN_EXEC_FLAGS.has(arg) || arg.startsWith("--user=") || arg.startsWith("--env=")) {
      throw new Error("argv interdit");
    }
  }
}

/**
 * Lance un shell interactif dans le conteneur lié : `docker exec -it --workdir /workspace … bash`.
 * `dockerPath` doit être un chemin absolu (résolution hors espace de travail).
 */
export function terminalLaunch(
  container: string,
  dockerPath: string | null = resolveBinary("docker"),
): { shellPath: string; shellArgs: readonly string[] } {
  if (dockerPath === null) throw new CodedError("process.notFound", { binary: "docker" });
  const name = assertOperand(container, "container");
  const shellArgs = [
    "exec",
    "--interactive",
    "--tty",
    "--workdir",
    "/workspace",
    name,
    "/bin/bash",
  ] as const;
  assertSafeExecArgv(shellArgs);
  return { shellPath: dockerPath, shellArgs };
}

export type CockpitDaemon = "reachable" | "unreachable" | "na";
export type CockpitLinkedLine = "running" | "stopped" | "absent" | "none" | "na";

export interface CockpitContainerView {
  name: string;
  image: string;
  state: "running" | "stopped";
  workspace?: string;
  linked: boolean;
  canLink: boolean;
  linkTitle?: string;
}

export interface CockpitLinkedBanner {
  name: string;
  image: string | null;
  workspace: string;
  state: "running" | "stopped" | "absent";
}

/** État affiché dans la webview (hôte → webview). */
export interface CockpitViewPayload {
  type: "view";
  loading?: boolean;
  docker: "present" | "absent";
  daemon: CockpitDaemon;
  exegol: "present" | "absent";
  linked: CockpitLinkedLine;
  linkedBanner: CockpitLinkedBanner | null;
  containers: CockpitContainerView[];
  /** Échec du démon (pas de liste périmée). */
  error?: string;
  /** Projet illisible : pas de terminal. */
  projectInvalid?: boolean;
  empty?: "docker" | "list";
}

export function sortContainers(rows: LabelPrefixContainer[]): LabelPrefixContainer[] {
  return rows.slice().sort((a, b) => {
    const order = (s: LabelPrefixContainer["state"]) => (s === "running" ? 0 : 1);
    const d = order(a.state) - order(b.state);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

type DockerList = Pick<DockerClient, "listLabelPrefix">;

export interface CockpitDeps {
  configDir?: string;
  resolveBin?: typeof resolveBinary;
  createDocker?: () => DockerList;
  readProj?: typeof readProject;
  linkProject?: typeof link;
  projectStatus?: typeof status;
}

const isCoded = (e: unknown, code: string): boolean =>
  typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === code;

/** Sonde Docker / projet et construit la vue cockpit. */
export async function loadCockpitView(deps: CockpitDeps = {}): Promise<CockpitViewPayload> {
  const configDir = deps.configDir ?? defaultConfigDir();
  const resolveBin = deps.resolveBin ?? resolveBinary;
  const readProj = deps.readProj ?? readProject;
  const dockerPresent = resolveBin("docker") !== null;
  const exegol = resolveBin("exegol") !== null ? "present" : "absent";

  if (!dockerPresent) {
    return {
      type: "view",
      docker: "absent",
      daemon: "na",
      exegol,
      linked: "na",
      linkedBanner: null,
      containers: [],
      empty: "docker",
    };
  }

  let stored: Awaited<ReturnType<typeof readProject>>;
  try {
    stored = await readProj(configDir);
  } catch (err) {
    if (isCoded(err, "project.invalid")) {
      return {
        type: "view",
        docker: "present",
        daemon: "na",
        exegol,
        linked: "na",
        linkedBanner: null,
        containers: [],
        projectInvalid: true,
      };
    }
    throw err;
  }

  const createDocker =
    deps.createDocker ??
    (() =>
      createDockerClient({
        recorder: createRecorder(),
        binary: "docker",
        timeoutMs: 15_000,
      }));

  let rows: LabelPrefixContainer[];
  try {
    rows = await createDocker().listLabelPrefix();
  } catch (err) {
    return {
      type: "view",
      docker: "present",
      daemon: "unreachable",
      exegol,
      linked: stored === null ? "none" : "na",
      linkedBanner: null,
      containers: [],
      error: formatError(err),
    };
  }

  const sorted = sortContainers(rows);
  let linked: CockpitLinkedLine = stored === null ? "none" : "absent";
  let linkedBanner: CockpitLinkedBanner | null = null;

  if (stored !== null) {
    const row = rows.find((r) => r.name === stored.container);
    if (row === undefined) {
      linked = "absent";
      linkedBanner = {
        name: stored.container,
        image: null,
        workspace: stored.workspace,
        state: "absent",
      };
    } else {
      linked = row.state === "running" ? "running" : "stopped";
      linkedBanner = {
        name: stored.container,
        image: row.image,
        workspace: stored.workspace,
        state: row.state,
      };
    }
  }

  const linkedName = stored?.container;
  const containers: CockpitContainerView[] = sorted.map((r) => {
    const isLinked = linkedName === r.name;
    let canLink = false;
    let linkTitle: string | undefined;
    if (isLinked) {
      canLink = false;
    } else if (r.state !== "running") {
      linkTitle = "Conteneur arrêté";
    } else if (r.workspace === undefined) {
      linkTitle = "Sans montage /workspace";
    } else {
      canLink = true;
    }
    return {
      name: r.name,
      image: r.image,
      state: r.state,
      ...(r.workspace !== undefined && { workspace: r.workspace }),
      linked: isLinked,
      canLink,
      ...(linkTitle !== undefined && { linkTitle }),
    };
  });

  return {
    type: "view",
    docker: "present",
    daemon: "reachable",
    exegol,
    linked,
    linkedBanner,
    containers,
    ...(containers.length === 0 && { empty: "list" }),
  };
}

/** Lie un conteneur puis recharge la vue. */
export async function linkContainer(
  name: string,
  deps: CockpitDeps = {},
): Promise<CockpitViewPayload> {
  const configDir = deps.configDir ?? defaultConfigDir();
  const createDocker =
    deps.createDocker ??
    (() =>
      createDockerClient({
        recorder: createRecorder(),
        binary: "docker",
        timeoutMs: 15_000,
      }));
  const linkProject = deps.linkProject ?? link;
  await linkProject(configDir, name, createDocker());
  return loadCockpitView(deps);
}

/** État du projet lié pour ouverture de dossier / terminal (relève si absent ou invalide). */
export async function linkedProjectStatus(deps: CockpitDeps = {}) {
  const configDir = deps.configDir ?? defaultConfigDir();
  const readProj = deps.readProj ?? readProject;
  let stored: Awaited<ReturnType<typeof readProject>>;
  try {
    stored = await readProj(configDir);
  } catch (err) {
    if (isCoded(err, "project.invalid")) return null;
    throw err;
  }
  if (stored === null) return null;
  const createDocker =
    deps.createDocker ??
    (() =>
      createDockerClient({
        recorder: createRecorder(),
        binary: "docker",
        timeoutMs: 15_000,
      }));
  const projectStatus = deps.projectStatus ?? status;
  return projectStatus(configDir, createDocker());
}
