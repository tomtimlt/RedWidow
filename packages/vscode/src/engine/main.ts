import { realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createOpencodeRunner,
  burpToolset as openCodeBurp,
  coursToolset as openCodeCours,
  deskToolset as openCodeDesk,
  exegolToolset as openCodeExegol,
  integrationToolset as openCodeIntegration,
  kaliToolset as openCodeKali,
  webToolset as openCodeWeb,
} from "@warband/agent-opencode";
import {
  burpToolset as claudeBurp,
  deskToolset as claudeDesk,
  integrationToolset as claudeIntegration,
  createSdkRunner,
  createSpecTools,
} from "@warband/agent-sdk";
import {
  activeProject,
  CodedError,
  createCampaignPort,
  createDockerClient,
  createExegolTargets,
  createPaceRegistry,
  createRecorder,
  createWebProgram,
  defaultConfigDir,
  type EngagementView,
  isHalted,
  outputFileSpecs,
  type ProgramStatus,
  prepareContainerProjectWorkspace,
  readActiveProjectForPrompt,
  readEngagementSync,
  readProgramSync,
  readProjects,
  resolveExegolContainer,
  resolveKaliContainer,
  type StoredProject,
  writeProgramDraft,
} from "@warband/core";
import { matchesFingerprint } from "../logic/integrity.js";
import { PROTOCOL_VERSION } from "../logic/protocol.js";
import { createBurpBackend } from "./burp-client.js";
import { processChannel } from "./channel.js";
import { enrichContainerPrompt } from "./container-prompt.js";
import { runEngine } from "./engine.js";
import { createIntegrationBackend } from "./integration-client.js";
import { projectFileSpecs } from "./project-files.js";
import { runnerOptions } from "./runner-options.js";

/**
 * Empreinte SHA-256 du binaire `claude`, injectée à l'empaquetage par `define` d'esbuild
 * (pas de fichier à lire : un fichier voisin du binaire serait modifiable avec lui).
 */
declare const __CLAUDE_SHA256__: string | undefined;
declare const __OPENCODE_SHA256__: string | undefined;

/**
 * Point d'entrée du moteur (processus enfant forké par l'extension).
 * Argument : dossier de l'extension (contient `bin/claude(.exe)`).
 */
const root = process.argv[2] ?? ".";
const exe = join(root, "bin", process.platform === "win32" ? "claude.exe" : "claude");
const channel = processChannel();

// Sorties complètes des commandes : <projet>/outputs, relues par `read_output` (dossier hôte).
const outputRoot = () => join(projectRoot, "outputs");
const targets = createExegolTargets({ outputRoot });
const projectFileTools = () => [...projectFileSpecs(projectRoot), ...outputFileSpecs(outputRoot)];
let learningMode = false;
let projectRoot = process.cwd();
// Projet actif connu du moteur (ADR 0040) : mis à jour au `start` et à chaque consigne ; sans projet, la fiche n'a aucun effet.
let activeProjectId: string | null = null;
const programStatus = (): ProgramStatus =>
  activeProjectId === null
    ? { state: "none" }
    : readProgramSync(defaultConfigDir(), activeProjectId);
// Engagement red team et arrêt d'urgence du projet actif (ADR 0041), relus à chaque décision de la gate.
const engagementView = (): EngagementView =>
  activeProjectId === null
    ? { status: { state: "none" }, halted: false }
    : {
        status: readEngagementSync(defaultConfigDir(), activeProjectId),
        halted: isHalted(defaultConfigDir(), activeProjectId),
      };
// Fiche et rythme du projet actif pour l'outil `http_request` (ADR 0040).
const webProgram = createWebProgram({
  program: programStatus,
  registry: createPaceRegistry({ configDir: defaultConfigDir(), projectId: () => activeProjectId }),
});
const docker = createDockerClient({ recorder: createRecorder(), timeoutMs: 8_000 });

const done = runEngine({
  channel,
  program: programStatus,
  engagement: engagementView,
  campaign: createCampaignPort(defaultConfigDir(), () => activeProjectId),
  programDraft: (text) => writeProgramDraft(defaultConfigDir(), activeProjectId, text),
  resolveCwd: async (cwd) => {
    projectRoot = cwd;
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      activeProjectId = active?.id ?? null;
      if (active !== null && active.workspace !== "" && isAbsolute(active.workspace)) {
        projectRoot = active.workspace;
        return active.workspace;
      }
    } catch {
      // Lecture invalide : cwd du start.
    }
    return cwd;
  },
  onPrompt: async (text) => {
    // Lecture robuste (ADR 0015 point 3) : fichier absent/pas de projet actif, project.invalid
    // (pas de nouvelle tentative) et erreur transitoire (une relecture) sont distingués. Jamais
    // d’exception relancée pour la lecture du projet. Un partage invalide est en revanche
    // bloquant : aucune action ne doit partir vers un autre dossier de mission.
    let selected: StoredProject | null = null;
    const outcome = await readActiveProjectForPrompt(async () => {
      const file = await readProjects(defaultConfigDir());
      selected = file && activeProject(file);
      activeProjectId = (selected as StoredProject | null)?.id ?? null;
      return file;
    }, activeProject);
    targets.note(text, outcome.containers, outcome.projectId, outcome.blocked);
    if (learningMode) return text;
    let rows: Awaited<ReturnType<typeof docker.listLabelPrefix>>;
    try {
      rows = await docker.listLabelPrefix();
    } catch {
      return enrichContainerPrompt(text, outcome.containers, () => docker.listLabelPrefix());
    }
    const verified = new Map<string, string>();
    if (!learningMode && selected && outcome.projectId === (selected as StoredProject).id) {
      const project = selected as StoredProject;
      if ((await realpath(project.workspace)) !== (await realpath(projectRoot)))
        throw new CodedError("project.invalid");
      for (const row of rows.filter(
        (r) => project.containers.includes(r.name) && r.state === "running",
      )) {
        let chosen: string;
        try {
          chosen =
            row.family === "kali"
              ? resolveKaliContainer(targets.current(), row.name, rows)
              : resolveExegolContainer(targets.current(), row.name, rows);
        } catch {
          continue;
        }
        if (chosen === row.name)
          verified.set(row.name, await prepareContainerProjectWorkspace(project, row.name, docker));
      }
    }
    return enrichContainerPrompt(text, outcome.containers, async () => rows, verified);
  },
  createRunner: async (
    mode,
    provider = "claude",
    burp,
    integrations,
    opencodeProviders,
    webSearch = true,
  ) => {
    learningMode = mode === "learning";
    if (provider !== "claude") {
      const binary = join(root, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
      const hash = typeof __OPENCODE_SHA256__ === "string" ? __OPENCODE_SHA256__ : "";
      if (!(await matchesFingerprint(binary, hash)))
        throw new CodedError("extension.binaryMismatch");
      return createOpencodeRunner({
        binary,
        isolateConfig: true,
        ...(provider === "opencode" &&
          opencodeProviders && { config: { provider: opencodeProviders } }),
        ...(provider === "openai" && { provider: "openai" }),
        ...(mode === "learning"
          ? { toolsets: [openCodeCours()], builtinTools: [] }
          : {
              toolsets: [
                openCodeExegol({ targets, binary: "docker", includeMemory: false }),
                openCodeKali({ targets, binary: "docker", includeMemory: false }),
                ...(webSearch ? [openCodeWeb(webProgram)] : []),
                openCodeDesk(),
                { name: "projectfiles", create: projectFileTools },
                ...(integrations ?? []).map((config) =>
                  openCodeIntegration(config, createIntegrationBackend(config)),
                ),
                ...(burp ? [openCodeBurp(burp, createBurpBackend(burp))] : []),
              ],
            }),
      });
    }
    // Vérification juste avant la construction du runner (fail-closed : empreinte absente = refus).
    const expected = typeof __CLAUDE_SHA256__ === "string" ? __CLAUDE_SHA256__ : "";
    if (!(await matchesFingerprint(exe, expected))) {
      throw new CodedError("extension.binaryMismatch");
    }
    const options = runnerOptions(mode, exe, targets, webSearch, webProgram);
    if (mode !== "learning")
      options.toolsets?.push(claudeDesk(), {
        name: "projectfiles",
        create: ({ resolveCall }) =>
          createSpecTools(projectFileTools(), (name, args, extra) =>
            resolveCall(`mcp__projectfiles__${name}`, args, extra),
          ),
      });
    if (mode !== "learning" && burp)
      options.toolsets?.push(claudeBurp(burp, createBurpBackend(burp)));
    if (mode !== "learning")
      options.toolsets?.push(
        ...(integrations ?? []).map((config) =>
          claudeIntegration(config, createIntegrationBackend(config)),
        ),
      );
    return createSdkRunner(options);
  },
});
// Les écouteurs sont posés : le parent peut envoyer `start`.
void channel.send({ v: PROTOCOL_VERSION, type: "ready" });
process.exit(await done);
