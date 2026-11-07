import {
  coursToolset,
  exegolToolset,
  kaliToolset,
  type SdkRunnerOptions,
  webToolset,
} from "@warband/agent-sdk";
import type { createExegolTargets, WebProgram } from "@warband/core";
import type { StartParams } from "../logic/protocol.js";

/**
 * Options de `createSdkRunner` selon le mode (ADR 0010, décision 2).
 * Apprentissage : seul le toolset `cours`, aucun outil natif, pas de `bash`.
 * Sans mode : Exegol et Kali, bornés à la cible notée (aucun outil Docker).
 */
export function runnerOptions(
  mode: StartParams["mode"],
  executable: string,
  targets: ReturnType<typeof createExegolTargets>,
  webSearch = true,
  webProgram?: WebProgram,
): SdkRunnerOptions & { executable: string } {
  if (mode === "learning") {
    return { executable, toolsets: [coursToolset()], builtinTools: [] };
  }
  return {
    executable,
    toolsets: [
      exegolToolset({ targets, binary: "docker", includeMemory: false }),
      kaliToolset({ targets, binary: "docker", includeMemory: false }),
      ...(webSearch ? [webToolset(webProgram)] : []),
    ],
  };
}
