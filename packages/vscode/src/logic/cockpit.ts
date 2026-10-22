import {
  assertOperand,
  CodedError,
  createDockerClient,
  createRecorder,
  type DockerClient,
  defaultConfigDir,
  type ImageSummary,
  type LabelPrefixContainer,
  link,
  lookupContainer,
  readProject,
  resolveBinary,
  shortContainerName,
  status,
} from "@warband/core";
import { formatError } from "@warband/messages";

/** Messages acceptés depuis la webview cockpit (non fiables). */
export type CockpitMessage =
  | { type: "refresh" }
  | { type: "link"; name: string }
  | { type: "openWorkspace" }
  | { type: "terminal" }
  | { type: "start"; name: string }
  | { type: "stop"; name: string }
  | { type: "createExegol"; name: string }
  | { type: "createKali"; image: string; name: string; source: string }
  | { type: "listImages" }
  | { type: "pickSource" };

const CONTAINER_NAME_MAX = 256;
/** Nom saisi pour créer : une lettre ou un chiffre, puis au plus 63 caractères `.`, `_` ou `-`. */
const CREATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const IMAGE_MAX = 256;
const SOURCE_MAX = 4096;

const isCreateName = (value: unknown): value is string =>
  typeof value === "string" && CREATE_NAME.test(value);

/** Même motif que `assertOperand`, borné à 256 caractères. */
const isImageRef = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > IMAGE_MAX) return false;
  try {
    assertOperand(value, "image");
    return true;
  } catch {
    return false;
  }
};

/** Chemin hôte non vide, sans NUL ni saut de ligne, au plus 4096 caractères. */
const isSourcePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= SOURCE_MAX &&
  !value.includes("\0") &&
  !value.includes("\n") &&
  !value.includes("\r");

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
    case "start":
    case "stop":
      return only("type", "name") &&
        typeof m.name === "string" &&
        m.name !== "" &&
        m.name.length <= CONTAINER_NAME_MAX
        ? { type: m.type, name: m.name }
        : null;
    case "createExegol":
      return only("type", "name") && isCreateName(m.name)
        ? { type: "createExegol", name: m.name }
        : null;
    case "createKali":
      return only("type", "image", "name", "source") &&
        isImageRef(m.image) &&
        isCreateName(m.name) &&
        isSourcePath(m.source)
        ? { type: "createKali", image: m.image, name: m.name, source: m.source }
        : null;
    case "listImages":
    case "pickSource":
      return only("type") ? { type: m.type } : null;
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
 * `dockerPath` doit être un chemin absolu (résolution hors espace de travail). `program` remplace
 * `/bin/bash` (shell capturé de `termlog.ts`) ; il commence toujours par un chemin absolu.
 */
export function terminalLaunch(
  container: string,
  dockerPath: string | null = resolveBinary("docker"),
  program: readonly string[] = ["/bin/bash"],
): { shellPath: string; shellArgs: readonly string[] } {
  if (dockerPath === null) throw new CodedError("process.notFound", { binary: "docker" });
  const name = assertOperand(container, "container");
  if (!program[0]?.startsWith("/")) throw new Error("programme refusé");
  const shellArgs = ["exec", "--interactive", "--tty", "--workdir", "/workspace", name, ...program];
  assertSafeExecArgv(shellArgs);
  return { shellPath: dockerPath, shellArgs };
}

/** Plafond de shells d'éditeur par conteneur Docker réel. */
export const EDITOR_SHELL_CAP = 4;

export type EditorShellPlan =
  | { action: "skip" }
  | { action: "launch"; name: string; title: string }
  | { action: "reveal"; title: string };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shellTitle = (name: string, index: number): string =>
  index <= 1 ? `Warband : ${name}` : `Warband : ${name} (${index})`;

/** Indice 1–4 si le titre correspond exactement à un shell de ce conteneur ; sinon `null`. */
const parseShellIndex = (title: string, name: string): number | null => {
  if (title === `Warband : ${name}`) return 1;
  const m = new RegExp(`^Warband : ${escapeRegExp(name)} \\((\\d+)\\)$`).exec(title);
  if (m === null) return null;
  const n = Number(m[1]);
  if (n >= 2 && n <= EDITOR_SHELL_CAP) return n;
  return null;
};

/**
 * Décide d'ouvrir, de révéler ou de ne rien faire pour un shell d'éditeur Exegol.
 * `openTitles` : titres des terminaux déjà suivis pour ce nom réel, ordre de création.
 */
export function planEditorShell(
  token: string,
  containers: readonly { name: string; state: "running" | "stopped" }[],
  openTitles: readonly string[],
): EditorShellPlan {
  const real = lookupContainer(token, containers);
  if (real === null) return { action: "skip" };
  const row = containers.find((c) => c.name === real);
  if (row?.state !== "running") return { action: "skip" };

  const used = new Set<number>();
  let validCount = 0;
  for (const t of openTitles) {
    const idx = parseShellIndex(t, real);
    if (idx !== null) {
      used.add(idx);
      validCount++;
    }
  }

  if (validCount >= EDITOR_SHELL_CAP) {
    let last: string | undefined;
    for (const t of openTitles) {
      if (parseShellIndex(t, real) !== null) last = t;
    }
    if (last !== undefined) return { action: "reveal", title: last };
    return { action: "skip" };
  }

  for (let i = 1; i <= EDITOR_SHELL_CAP; i++) {
    if (!used.has(i)) {
      return { action: "launch", name: real, title: shellTitle(real, i) };
    }
  }
  return { action: "skip" };
}

export type CockpitDaemon = "reachable" | "unreachable" | "na";
export type CockpitLinkedLine = "running" | "stopped" | "absent" | "none" | "na";

export interface CockpitContainerView {
  /** Nom Docker. */
  name: string;
  /** Nom court affiché et cité. */
  short: string;
  image: string;
  state: "running" | "stopped";
  /** Famille recopiée de la ligne, sans déduction. */
  family: "exegol" | "kali";
  workspace?: string;
  linked: boolean;
  canLink: boolean;
  linkTitle?: string;
}

export interface CockpitLinkedBanner {
  name: string;
  short: string;
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

/**
 * Noms courts proposés dans le menu `@`. Un court ambigu (deux conteneurs) est omis.
 * `name` est le court, pas le nom Docker.
 */
export function containerMentions(
  containers: readonly { name: string; state: "running" | "stopped" }[],
): { name: string; state: "running" | "stopped" }[] {
  const tagged = containers.map((c) => ({ state: c.state, short: shortContainerName(c.name) }));
  const counts = new Map<string, number>();
  for (const c of tagged) counts.set(c.short, (counts.get(c.short) ?? 0) + 1);
  return tagged
    .filter((c) => counts.get(c.short) === 1)
    .map((c) => ({ name: c.short, state: c.state }));
}

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
        short: shortContainerName(stored.container),
        image: null,
        workspace: stored.workspace,
        state: "absent",
      };
    } else {
      linked = row.state === "running" ? "running" : "stopped";
      linkedBanner = {
        name: stored.container,
        short: shortContainerName(stored.container),
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
    } else if (r.family === "kali") {
      linkTitle = "On ne lie pas un Kali";
    } else if (r.state !== "running") {
      linkTitle = "Conteneur arrêté";
    } else if (r.workspace === undefined) {
      linkTitle = "Sans montage /workspace";
    } else {
      canLink = true;
    }
    return {
      name: r.name,
      short: shortContainerName(r.name),
      image: r.image,
      state: r.state,
      family: r.family,
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

const IMAGE_NONE = "<none>";

/** Référence affichée : `repository:tag`, ou l'identifiant si l'un des deux vaut `<none>`. */
export function imageRef(image: Pick<ImageSummary, "id" | "repository" | "tag">): string {
  if (image.repository !== IMAGE_NONE && image.tag !== IMAGE_NONE) {
    return `${image.repository}:${image.tag}`;
  }
  return image.id;
}

/** Références dédoublonnées et triées pour le sélecteur Kali. */
export function imageRefs(
  images: readonly Pick<ImageSummary, "id" | "repository" | "tag">[],
): string[] {
  return [...new Set(images.map((image) => imageRef(image)))].sort((a, b) => a.localeCompare(b));
}

type DockerImages = Pick<DockerClient, "images">;

/** Liste les images avec le même client que `loadCockpitView` (binaire docker, 15 s). */
export async function listCockpitImages(
  deps: { createDocker?: () => DockerImages } = {},
): Promise<string[]> {
  const docker =
    deps.createDocker?.() ??
    createDockerClient({
      recorder: createRecorder(),
      binary: "docker",
      timeoutMs: 15_000,
    });
  return imageRefs(await docker.images());
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

type DockerControl = Pick<DockerClient, "listLabelPrefix" | "start" | "stop">;

/**
 * Démarre ou arrête un conteneur déjà listé. Le nom exécuté est celui de la liste
 * (court ou complet), jamais une chaîne construite. Absent, ambigu ou mauvais état : refus ou no-op.
 */
export async function controlListedContainer(
  action: "start" | "stop",
  name: string,
  deps: { createDocker?: () => DockerControl } = {},
): Promise<void> {
  const docker =
    deps.createDocker?.() ??
    createDockerClient({
      recorder: createRecorder(),
      binary: "docker",
      timeoutMs: 15_000,
    });
  const rows = await docker.listLabelPrefix();
  const real = lookupContainer(name, rows);
  if (real === null) throw new CodedError("exegol.containerDenied", { name });
  const row = rows.find((r) => r.name === real);
  if (action === "start") {
    if (row?.state !== "stopped") return;
    await docker.start(real);
    return;
  }
  if (row?.state !== "running") return;
  await docker.stop(real);
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
