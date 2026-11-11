import { isAbsolute } from "node:path";
import {
  activeProject,
  assertOperand,
  type CampaignState,
  CodedError,
  createDockerClient,
  createRecorder,
  type DockerClient,
  defaultConfigDir,
  dockerFailure,
  type EngagementState,
  haltedPaceHosts,
  type ImageSummary,
  isHalted,
  type LabelPrefixContainer,
  link,
  lookupContainer,
  type ProgramState,
  type ProjectFile,
  readCampaignSync,
  readEngagementSync,
  readProgramSync,
  readProjects,
  resolveBinary,
  runProcess,
  setPrimaryContainer,
  shortContainerName,
} from "@warband/core";
import { formatError, getUiLocale, t } from "@warband/messages";
import { PRODUCT_NAME, productTitleSuffix } from "./brand.js";
import { encodedBashScript } from "./terminal-prompt.js";

/** Messages acceptés depuis la webview cockpit (non fiables). */
export type CockpitMessage =
  | { type: "ready" | "rendered" }
  | { type: "refresh" }
  | { type: "link"; name: string }
  | { type: "setPrimary"; name: string }
  | { type: "openWorkspace" }
  | { type: "terminal" }
  | { type: "openProgram" }
  | { type: "openEngagement" }
  | { type: "start"; name: string }
  | { type: "stop"; name: string }
  | {
      type: "createExegol";
      name: string;
      image?: string;
      vpn?: boolean;
      desktop?: boolean;
      desktopPort?: number;
      network?: "nat" | "host" | "disabled";
      shareResources?: boolean;
      shareMyResources?: boolean;
    }
  | { type: "remove"; name: string }
  | { type: "pickVpn" }
  | { type: "cancelOperation" }
  | { type: "createKali"; image: string; name: string }
  | { type: "listImages" }
  | { type: "pickSharedFolder" };

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
    case "ready":
    case "rendered":
      return only("type") ? { type: m.type } : null;
    case "refresh":
      return only("type") ? { type: "refresh" } : null;
    case "openWorkspace":
    case "openProgram":
    case "openEngagement":
    case "terminal":
      return only("type") ? { type: m.type } : null;
    case "link":
    case "setPrimary":
    case "start":
    case "stop":
    case "remove":
      return only("type", "name") &&
        typeof m.name === "string" &&
        m.name !== "" &&
        m.name.length <= CONTAINER_NAME_MAX
        ? { type: m.type, name: m.name }
        : null;
    case "createExegol": {
      if (
        !only(
          "type",
          "name",
          "image",
          "source",
          "vpn",
          "desktop",
          "desktopPort",
          "network",
          "shareResources",
          "shareMyResources",
        ) ||
        !isCreateName(m.name)
      )
        return null;
      if (m.image !== undefined && (typeof m.image !== "string" || !CREATE_NAME.test(m.image)))
        return null;
      if (m.source !== undefined && m.source !== "" && !isSourcePath(m.source)) return null;
      for (const key of ["vpn", "desktop", "shareResources", "shareMyResources"])
        if (m[key] !== undefined && typeof m[key] !== "boolean") return null;
      if (
        m.desktopPort !== undefined &&
        (!Number.isInteger(m.desktopPort) ||
          Number(m.desktopPort) < 1 ||
          Number(m.desktopPort) > 65535)
      )
        return null;
      if (m.network !== undefined && !["nat", "host", "disabled"].includes(String(m.network)))
        return null;
      // `source` reste toléré (anciennes webviews) mais n'est jamais retransmis : le dossier
      // partagé vient du sélecteur de l'hôte (ADR 0050).
      const { source: _ignored, ...kept } = m;
      return kept as Extract<CockpitMessage, { type: "createExegol" }>;
    }
    case "createKali":
      return only("type", "image", "name", "source") &&
        isImageRef(m.image) &&
        isCreateName(m.name) &&
        (m.source === undefined || m.source === "" || isSourcePath(m.source))
        ? { type: "createKali", image: m.image, name: m.name }
        : null;
    case "listImages":
    case "pickSharedFolder":
    case "pickVpn":
    case "cancelOperation":
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
      throw new Error(t("argv interdit"));
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
  workspace = "/workspace",
): { shellPath: string; shellArgs: readonly string[] } {
  if (dockerPath === null) throw new CodedError("process.notFound", { binary: "docker" });
  const name = assertOperand(container, "container");
  if (!program[0]?.startsWith("/")) throw new Error(t("programme refusé"));
  if (workspace !== "/workspace" && !/^\/redwidow\/Workspace\/[A-Za-z0-9_-]+$/.test(workspace))
    throw new Error(t("Chemin de workspace invalide."));
  const launch =
    workspace === "/workspace"
      ? program
      : encodedBashScript('cd "$1" || exit; shift; exec "$@"', [workspace, ...program]);
  const shellArgs = ["exec", "--interactive", "--tty", "--workdir", workspace, name, ...launch];
  assertSafeExecArgv(shellArgs);
  return { shellPath: dockerPath, shellArgs };
}

/** Résultat d'un `docker exec` de préparation, sans lancer Docker dans les tests. */
export type WorkspaceRun = (
  argv: readonly string[],
) => Promise<{ code: number | null; stderr: readonly string[]; stdout?: readonly string[] }>;

/**
 * Crée `/workspace` s'il manque, avant un exec qui s'y place.
 * `docker exec -u root <nom> mkdir -p /workspace` : pas de `--workdir`, pas de volume,
 * pas de `--privileged`, pas de réseau. `name` est le nom réel déjà lu dans la liste.
 */
function workspaceMkdirArgv(name: string): readonly string[] {
  return ["exec", "-u", "root", name, "mkdir", "-p", "/workspace"];
}

const runWorkspaceMkdir = async (
  dockerPath: string,
  argv: readonly string[],
): Promise<{ code: number | null; stderr: readonly string[]; stdout?: readonly string[] }> => {
  const result = await runProcess([dockerPath, ...argv], {
    recorder: createRecorder(),
    parentId: null,
    timeoutMs: 15_000,
  });
  return { code: result.code, stderr: result.stderr, stdout: result.stdout };
};

/**
 * Prépare le shell : crée `/workspace` puis renvoie l'argv de `terminalLaunch`.
 * Le nom n'est pas reconstruit. Échec de `mkdir` : `docker.failed`, avec la sortie d'erreur.
 */
export async function prepareTerminal(
  container: string,
  dockerPath: string | null = resolveBinary("docker"),
  program: readonly string[] = ["/bin/bash"],
  run?: WorkspaceRun,
  workspace = "/workspace",
): Promise<{ shellPath: string; shellArgs: readonly string[] }> {
  if (dockerPath === null) throw new CodedError("process.notFound", { binary: "docker" });
  const name = assertOperand(container, "container");
  const argv = workspaceMkdirArgv(name);
  const result = await (run ?? ((args) => runWorkspaceMkdir(dockerPath, args)))(argv);
  if (result.code !== 0) {
    // Même traduction que le client Docker : repli stdout si stderr est vide, `docker.pathNotShared`.
    throw dockerFailure("docker", "exec", {
      code: result.code,
      signal: null,
      stdout: [...(result.stdout ?? [])],
      stderr: [...result.stderr],
      durationMs: 0,
    });
  }
  return terminalLaunch(name, dockerPath, program, workspace);
}

/** Plafond de shells d'éditeur par conteneur Docker réel. */
export const EDITOR_SHELL_CAP = 4;

export type EditorShellPlan =
  | { action: "skip" }
  | { action: "launch"; name: string; title: string }
  | { action: "reveal"; title: string };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shellTitle = (name: string, index: number): string =>
  index <= 1 ? `${PRODUCT_NAME} : ${name}` : `${PRODUCT_NAME} : ${name} (${index})`;

/** Indice 1–4 si le titre correspond exactement à un shell de ce conteneur ; sinon `null`. */
const parseShellIndex = (title: string, name: string): number | null => {
  const suffix = productTitleSuffix(title);
  if (suffix === null) return null;
  if (suffix === name) return 1;
  const m = new RegExp(`^${escapeRegExp(name)} \\((\\d+)\\)$`).exec(suffix);
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
  /** Conteneur affiché (`primary`) ; vrai seulement si le projet a au moins deux conteneurs liés. */
  primary: boolean;
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
  projectWorkspace?: string;
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
  /** Fiche programme du projet actif (lecture seule) : état et nombre d'hôtes arrêtés. */
  program?: { state: ProgramState; halted: number };
  /**
   * Engagement red team du projet actif (lecture seule) : présent seulement si un engagement ou un
   * arrêt d'urgence existe. `halt` : arrêt d'urgence actif ; `campaign` : état du plan.
   */
  engagement?: { state: EngagementState; campaign: CampaignState; halt: boolean };
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
  expectedProjectId?: string;
  configDir?: string;
  resolveBin?: typeof resolveBinary;
  createDocker?: () => DockerList;
  readProj?: typeof readProjects;
  linkProject?: typeof link;
  setPrimaryContainerFn?: typeof setPrimaryContainer;
}

/** Dossier du projet actif et le conteneur affiché (`primary`, sinon l'unique conteneur lié). */
export interface LinkedProjectStatus {
  workspace: string;
  container: string | null;
  image: string | null;
  state: "running" | "stopped" | "absent" | null;
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

/** État de la fiche pour la ligne du cockpit ; une lecture en échec reste « illisible ». */
export function programLine(
  configDir: string,
  projectId: string,
): { state: ProgramState; halted: number } {
  try {
    return {
      state: readProgramSync(configDir, projectId).state,
      halted: haltedPaceHosts(configDir, projectId).length,
    };
  } catch {
    return { state: "unreadable", halted: 0 };
  }
}

/** Ligne « Engagement » du cockpit : absente sans engagement ni arrêt ; lecture en échec → « illisible ». */
export function engagementLine(
  configDir: string,
  projectId: string,
): { state: EngagementState; campaign: CampaignState; halt: boolean } | undefined {
  try {
    const state = readEngagementSync(configDir, projectId).state;
    const halt = isHalted(configDir, projectId);
    if (state === "none" && !halt) return undefined;
    return { state, campaign: readCampaignSync(configDir, projectId).state, halt };
  } catch {
    return { state: "unreadable", campaign: "none", halt: false };
  }
}

/** Sonde Docker / projet et construit la vue cockpit. */
export async function loadCockpitView(deps: CockpitDeps = {}): Promise<CockpitViewPayload> {
  const configDir = deps.configDir ?? defaultConfigDir();
  const resolveBin = deps.resolveBin ?? resolveBinary;
  const readProj = deps.readProj ?? readProjects;
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

  let stored: ProjectFile | null;
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
      linked: stored === null || activeProject(stored) === null ? "none" : "na",
      linkedBanner: null,
      containers: [],
      error: formatError(err, getUiLocale()),
    };
  }

  const sorted = sortContainers(rows);
  const active = stored === null ? null : activeProject(stored);
  const allowed = active?.containers ?? [];
  const unique = allowed.length === 1 ? allowed[0] : undefined;
  // Conteneur affiché : `primary` s'il est posé, sinon l'unique conteneur lié.
  const displayed = active?.primary ?? unique;
  const multiLinked = allowed.length >= 2;
  let linked: CockpitLinkedLine = active === null ? "none" : "absent";
  let linkedBanner: CockpitLinkedBanner | null = null;

  if (active !== null && displayed !== undefined) {
    const row = rows.find((r) => r.name === displayed);
    if (row === undefined) {
      linked = "absent";
      linkedBanner = {
        name: displayed,
        short: shortContainerName(displayed),
        image: null,
        workspace: active.workspace,
        state: "absent",
      };
    } else {
      linked = row.state === "running" ? "running" : "stopped";
      linkedBanner = {
        name: displayed,
        short: shortContainerName(displayed),
        image: row.image,
        workspace: active.workspace,
        state: row.state,
      };
    }
  } else if (active !== null) {
    linked = "none";
  }

  const containers: CockpitContainerView[] = sorted.map((r) => {
    const isLinked = allowed.includes(r.name);
    const mount = r.workspace !== undefined && isAbsolute(r.workspace);
    let canLink = false;
    let linkTitle: string | undefined;
    if (isLinked) {
      canLink = false;
    } else if (r.state !== "running") {
      linkTitle = t("Conteneur arrêté");
    } else if (!mount) {
      linkTitle = t("Sans montage /workspace");
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
      primary: multiLinked && active?.primary === r.name,
      canLink,
      ...(linkTitle !== undefined && { linkTitle }),
    };
  });

  const engagement = active ? engagementLine(configDir, active.id) : undefined;
  return {
    type: "view",
    docker: "present",
    daemon: "reachable",
    exegol,
    linked,
    linkedBanner,
    containers,
    ...(active && { projectWorkspace: active.workspace }),
    ...(active && { program: programLine(configDir, active.id) }),
    ...(engagement && { engagement }),
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
  return [
    ...new Set([
      "warband/kali:complete-1",
      "kalilinux/kali-rolling:latest",
      ...imageRefs(await docker.images()),
    ]),
  ];
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
  await linkProject(configDir, name, createDocker(), deps.expectedProjectId);
  return loadCockpitView(deps);
}

/**
 * Désigne le conteneur `primary` du projet actif, purement informatif, puis recharge la vue.
 * Aucun projet actif : `project.absent` (même code que `setPrimaryContainer` sur fichier absent).
 */
export async function setPrimary(
  name: string,
  deps: CockpitDeps = {},
): Promise<CockpitViewPayload> {
  const configDir = deps.configDir ?? defaultConfigDir();
  const readProj = deps.readProj ?? readProjects;
  const setPrimaryContainerFn = deps.setPrimaryContainerFn ?? setPrimaryContainer;
  const stored = await readProj(configDir);
  const active = stored === null ? null : activeProject(stored);
  if (active === null) throw new CodedError("project.absent");
  await setPrimaryContainerFn(configDir, active.id, name);
  return loadCockpitView(deps);
}

/**
 * Candidats du terminal : conteneurs liés et en cours d'exécution, le `primary` en tête
 * s'il en fait partie, sinon dans l'ordre de `sortContainers` (déjà celui de `containers`).
 * Choix ponctuel pour l'affichage uniquement ; n'écrit jamais `primary`.
 */
export function linkedTerminalChoices(
  containers: readonly CockpitContainerView[],
): { name: string; short: string; primary: boolean }[] {
  const running = containers.filter((c) => c.linked && c.state === "running");
  const first = running.filter((c) => c.primary);
  const rest = running.filter((c) => !c.primary);
  return [...first, ...rest].map((c) => ({ name: c.name, short: c.short, primary: c.primary }));
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

/**
 * Projet actif pour le dossier, le terminal et la barre.
 * Sans projet actif, ou fichier illisible : `null`.
 * Conteneur affiché, dans l'ordre : `primary` s'il est posé, sinon l'unique nom lié, sinon `null`.
 * `primary` est purement informatif : il n'autorise aucune exécution.
 */
export async function linkedProjectStatus(
  deps: CockpitDeps = {},
): Promise<LinkedProjectStatus | null> {
  const configDir = deps.configDir ?? defaultConfigDir();
  const readProj = deps.readProj ?? readProjects;
  let stored: ProjectFile | null;
  try {
    stored = await readProj(configDir);
  } catch (err) {
    if (isCoded(err, "project.invalid")) return null;
    throw err;
  }
  const active = stored === null ? null : activeProject(stored);
  if (active === null) return null;
  const container =
    active.primary ?? (active.containers.length === 1 ? active.containers[0] : undefined);
  if (container === undefined) {
    return { workspace: active.workspace, container: null, image: null, state: null };
  }
  const createDocker =
    deps.createDocker ??
    (() =>
      createDockerClient({
        recorder: createRecorder(),
        binary: "docker",
        timeoutMs: 15_000,
      }));
  const row = (await createDocker().listLabelPrefix()).find((r) => r.name === container);
  if (row === undefined) {
    return { workspace: active.workspace, container, image: null, state: "absent" };
  }
  return { workspace: active.workspace, container, image: row.image, state: row.state };
}
