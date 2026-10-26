import { WEB_SERVER_INSTRUCTIONS, WEB_SERVER_NAME, webToolSpecs } from "@warband/core";
import { createSpecTools, type ResolveParent } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

export function webToolset(): Toolset {
  return {
    name: WEB_SERVER_NAME,
    instructions: WEB_SERVER_INSTRUCTIONS,
    create: ({ resolveCall }) => {
      const parent: ResolveParent = (name, args, extra) =>
        resolveCall(`mcp__web__${name}`, args, extra);
      return createSpecTools(webToolSpecs(), parent);
    },
  };
}
