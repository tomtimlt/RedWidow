import {
  WEB_SERVER_INSTRUCTIONS,
  WEB_SERVER_NAME,
  type WebProgram,
  webToolSpecs,
} from "@warband/core";
import { createSpecTools, type ResolveParent } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

/** `program` : fiche et rythme du projet actif, requis par l'outil `http_request` (ADR 0040). */
export function webToolset(program?: WebProgram): Toolset {
  return {
    name: WEB_SERVER_NAME,
    instructions: WEB_SERVER_INSTRUCTIONS,
    create: ({ resolveCall, recorder, accounts }) => {
      program?.attach?.(recorder);
      const parent: ResolveParent = (name, args, extra) =>
        resolveCall(`mcp__web__${name}`, args, extra);
      return createSpecTools(webToolSpecs({}, program, accounts), parent);
    },
  };
}
