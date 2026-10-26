import {
  createDockerClient,
  EXEGOL_SERVER_INSTRUCTIONS,
  EXEGOL_SERVER_NAME,
  EXEGOL_TOOL_PREFIX,
  type ExegolTargets,
  exegolToolSpecs,
  taskToolSpecs,
} from "@warband/core";
import { createSpecTools, type ResolveParent } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

export interface ExegolToolsetOptions {
  targets: ExegolTargets;
  /** Expose `remember` (défaut : true). */
  includeMemory?: boolean;
  binary?: string;
  argsPrefix?: readonly string[];
}

/** Toolset Exegol : un `exec` borné à la cible du message (`targets`). */
export function exegolToolset(options: ExegolToolsetOptions): Toolset {
  return {
    name: EXEGOL_SERVER_NAME,
    instructions: EXEGOL_SERVER_INSTRUCTIONS,
    create: ({ recorder, resolveCall }) => {
      const resolveParent: ResolveParent = (name, args, extra) =>
        resolveCall(`${EXEGOL_TOOL_PREFIX}${name}`, args, extra);
      const docker = createDockerClient({
        recorder,
        ...(options.binary && { binary: options.binary }),
        ...(options.argsPrefix && { argsPrefix: options.argsPrefix }),
      });
      return createSpecTools(
        [
          ...exegolToolSpecs(docker, options.targets),
          ...taskToolSpecs("exegol", docker, options.targets),
        ].filter((spec) => options.includeMemory !== false || spec.name !== "remember"),
        resolveParent,
      );
    },
  };
}
