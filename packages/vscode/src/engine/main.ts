import { join } from "node:path";
import { createSdkRunner, exegolToolset } from "@john-studio/agent-sdk";
import { CodedError, createExegolTargets, defaultConfigDir, readProject } from "@john-studio/core";
import { matchesFingerprint } from "../logic/integrity.js";
import { PROTOCOL_VERSION } from "../logic/protocol.js";
import { processChannel } from "./channel.js";
import { runEngine } from "./engine.js";

/**
 * Empreinte SHA-256 du binaire `claude`, injectée à l'empaquetage par `define` d'esbuild
 * (pas de fichier à lire : un fichier voisin du binaire serait modifiable avec lui).
 */
declare const __CLAUDE_SHA256__: string | undefined;

/**
 * Point d'entrée du moteur (processus enfant forké par l'extension).
 * Argument : dossier de l'extension (contient `bin/claude(.exe)`).
 */
const root = process.argv[2] ?? ".";
const exe = join(root, "bin", process.platform === "win32" ? "claude.exe" : "claude");
const channel = processChannel();

const targets = createExegolTargets();

const done = runEngine({
  channel,
  onPrompt: async (text) => {
    let dedicated: string | null = null;
    try {
      dedicated = (await readProject(defaultConfigDir()))?.container ?? null;
    } catch {
      dedicated = null;
    }
    targets.note(text, dedicated);
  },
  createRunner: async () => {
    // Vérification juste avant la construction du runner (fail-closed : empreinte absente = refus).
    const expected = typeof __CLAUDE_SHA256__ === "string" ? __CLAUDE_SHA256__ : "";
    if (!(await matchesFingerprint(exe, expected))) {
      throw new CodedError("extension.binaryMismatch");
    }
    // Aucun outil Docker : seul l'exec Exegol, borné à la cible notée pour le message.
    return createSdkRunner({
      executable: exe,
      toolsets: [exegolToolset({ targets, binary: "docker" })],
    });
  },
});
// Les écouteurs sont posés : le parent peut envoyer `start`.
void channel.send({ v: PROTOCOL_VERSION, type: "ready" });
process.exit(await done);
