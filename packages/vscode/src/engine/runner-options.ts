import { coursToolset, exegolToolset, type SdkRunnerOptions } from "@warband/agent-sdk";
import type { createExegolTargets } from "@warband/core";
import type { StartParams } from "../logic/protocol.js";

/**
 * Options de `createSdkRunner` selon le mode (ADR 0010, décision 2).
 * Apprentissage : seul le toolset `cours`, aucun outil natif, pas de `bash`.
 * Sans mode : Exegol seul, borné à la cible notée (aucun outil Docker).
 */
export function runnerOptions(
  mode: StartParams["mode"],
  executable: string,
  targets: ReturnType<typeof createExegolTargets>,
): SdkRunnerOptions & { executable: string } {
  if (mode === "learning") {
    return { executable, toolsets: [coursToolset()], builtinTools: [] };
  }
  return { executable, toolsets: [exegolToolset({ targets, binary: "docker" })] };
}
