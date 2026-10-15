import {
  SANDBOX_SERVER_INSTRUCTIONS,
  SANDBOX_SERVER_NAME,
  SANDBOX_TOOL_PREFIX,
  type SandboxContext,
  sandboxToolSpecs,
} from "@john-studio/core";
import { createSpecTools } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

/**
 * Toolset `sandbox` (`mcp__sandbox__exec`). L'identifiant du conteneur vient du registre de
 * `context`, jamais de l'entrée de l'outil ; les exécutions sont sérialisées par run.
 */
export function sandboxToolset(options: { context: SandboxContext }): Toolset {
  return {
    name: SANDBOX_SERVER_NAME,
    instructions: SANDBOX_SERVER_INSTRUCTIONS,
    create: ({ resolveCall }) =>
      createSpecTools(sandboxToolSpecs(options.context), (name, args, extra) =>
        resolveCall(`${SANDBOX_TOOL_PREFIX}${name}`, args, extra),
      ),
  };
}
