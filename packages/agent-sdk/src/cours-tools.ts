import {
  COURS_SERVER_INSTRUCTIONS,
  COURS_SERVER_NAME,
  COURS_TOOL_PREFIX,
  coursRoot,
  coursToolSpecs,
} from "@john-studio/core";
import { createSpecTools, type ResolveParent } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

/** Toolset `cours` (mode apprentissage) : `chercher` et `lire`, en lecture seule sous `coursRoot()`. */
export function coursToolset(): Toolset {
  return {
    name: COURS_SERVER_NAME,
    instructions: COURS_SERVER_INSTRUCTIONS,
    create: ({ resolveCall }) => {
      const resolveParent: ResolveParent = (name, args, extra) =>
        resolveCall(`${COURS_TOOL_PREFIX}${name}`, args, extra);
      return createSpecTools(coursToolSpecs(coursRoot()), resolveParent);
    },
  };
}
