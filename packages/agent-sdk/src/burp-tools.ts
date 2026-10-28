import { BURP_INSTRUCTIONS, type BurpBackend, type BurpConfig, burpToolSpecs } from "@warband/core";
import { createSpecTools } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

export function burpToolset(config: BurpConfig, backend: BurpBackend): Toolset {
  return {
    name: "burp",
    instructions: BURP_INSTRUCTIONS,
    create: ({ resolveCall }) =>
      createSpecTools(burpToolSpecs(config, backend), (name, args, extra) =>
        resolveCall(`mcp__burp__${name}`, args, extra),
      ),
  };
}
