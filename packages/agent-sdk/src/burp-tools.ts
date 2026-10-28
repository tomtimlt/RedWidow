import {
  BURP_INSTRUCTIONS,
  type BurpBackend,
  type BurpConfig,
  burpToolSpecs,
  deskToolSpecs,
  INTEGRATION_GUIDANCE,
  type IntegrationConfig,
  integrationToolSpecs,
} from "@warband/core";
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

export function integrationToolset(config: IntegrationConfig, backend: BurpBackend): Toolset {
  return {
    name: config.id,
    instructions: INTEGRATION_GUIDANCE,
    create: ({ resolveCall }) =>
      createSpecTools(integrationToolSpecs(config, backend), (name, args, extra) =>
        resolveCall(`mcp__${config.id}__${name}`, args, extra),
      ),
  };
}

export function deskToolset(): Toolset {
  return {
    name: "desk",
    create: ({ resolveCall }) =>
      createSpecTools(deskToolSpecs(), (name, args, extra) =>
        resolveCall(`mcp__desk__${name}`, args, extra),
      ),
  };
}
