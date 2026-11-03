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
  createDockerClient,
  createExegolTargets,
  createRecorder,
  defaultConfigDir,
  readActiveProjectForPrompt,
  readProjects,
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

const targets = createExegolTargets();
let projectRoot = process.cwd();
const docker = createDockerClient({ recorder: createRecorder(), timeoutMs: 8_000 });

const done = runEngine({
  channel,
  resolveCwd: async (cwd) => {
    projectRoot = cwd;
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
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
    // d'exception relancée ici : elle aborterait tout le run, pas seulement le tour.
    const outcome = await readActiveProjectForPrompt(
      () => readProjects(defaultConfigDir()),
      activeProject,
    );
    targets.note(text, outcome.containers, outcome.projectId, outcome.blocked);
    return enrichContainerPrompt(text, outcome.containers, () => docker.listLabelPrefix());
  },
  createRunner: async (
    mode,
    provider = "claude",
    burp,
    integrations,
    opencodeProviders,
    webSearch = true,
  ) => {
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
                ...(webSearch ? [openCodeWeb()] : []),
                openCodeDesk(),
                { name: "projectfiles", create: () => projectFileSpecs(projectRoot) },
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
    const options = runnerOptions(mode, exe, targets, webSearch);
    if (mode !== "learning")
      options.toolsets?.push(claudeDesk(), {
        name: "projectfiles",
        create: ({ resolveCall }) =>
          createSpecTools(projectFileSpecs(projectRoot), (name, args, extra) =>
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
