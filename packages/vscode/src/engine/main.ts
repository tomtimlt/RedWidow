import { isAbsolute, join } from "node:path";
import {
  createOpencodeRunner,
  coursToolset as openCodeCours,
  exegolToolset as openCodeExegol,
  kaliToolset as openCodeKali,
} from "@warband/agent-opencode";
import { createSdkRunner } from "@warband/agent-sdk";
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
import { processChannel } from "./channel.js";
import { enrichContainerPrompt } from "./container-prompt.js";
import { runEngine } from "./engine.js";
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
const docker = createDockerClient({ recorder: createRecorder(), timeoutMs: 8_000 });

const done = runEngine({
  channel,
  resolveCwd: async (cwd) => {
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      if (active !== null && active.workspace !== "" && isAbsolute(active.workspace)) {
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
  createRunner: async (mode, provider = "claude") => {
    if (provider !== "claude") {
      const binary = join(root, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
      const hash = typeof __OPENCODE_SHA256__ === "string" ? __OPENCODE_SHA256__ : "";
      if (!(await matchesFingerprint(binary, hash)))
        throw new CodedError("extension.binaryMismatch");
      return createOpencodeRunner({
        binary,
        ...(provider === "openai" && { provider: "openai" }),
        ...(mode === "learning"
          ? { toolsets: [openCodeCours()], builtinTools: [] }
          : {
              toolsets: [
                openCodeExegol({ targets, binary: "docker", includeMemory: false }),
                openCodeKali({ targets, binary: "docker", includeMemory: false }),
              ],
            }),
      });
    }
    // Vérification juste avant la construction du runner (fail-closed : empreinte absente = refus).
    const expected = typeof __CLAUDE_SHA256__ === "string" ? __CLAUDE_SHA256__ : "";
    if (!(await matchesFingerprint(exe, expected))) {
      throw new CodedError("extension.binaryMismatch");
    }
    return createSdkRunner(runnerOptions(mode, exe, targets));
  },
});
// Les écouteurs sont posés : le parent peut envoyer `start`.
void channel.send({ v: PROTOCOL_VERSION, type: "ready" });
process.exit(await done);
