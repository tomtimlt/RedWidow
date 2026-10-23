import {
  createDockerClient,
  createKaliApi,
  type ExegolTargets,
  KALI_SERVER_INSTRUCTIONS,
  KALI_SERVER_NAME,
  KALI_TOOL_PREFIX,
  kaliToolSpecs,
} from "@warband/core";
import { createSpecTools, type ResolveParent } from "./docker-tools.js";
import type { Toolset } from "./toolset.js";

export interface KaliToolsetOptions {
  targets: ExegolTargets;
  binary?: string;
  argsPrefix?: readonly string[];
}

/** Toolset Kali : les douze outils, bornés à la cible du message (`targets`). */
export function kaliToolset(options: KaliToolsetOptions): Toolset {
  return {
    name: KALI_SERVER_NAME,
    instructions: KALI_SERVER_INSTRUCTIONS,
    create: ({ recorder, resolveCall }) => {
      const resolveParent: ResolveParent = (name, args, extra) =>
        resolveCall(`${KALI_TOOL_PREFIX}${name}`, args, extra);
      const client = {
        recorder,
        ...(options.binary && { binary: options.binary }),
        ...(options.argsPrefix && { argsPrefix: options.argsPrefix }),
      };
      return createSpecTools(
        kaliToolSpecs(createDockerClient(client), createKaliApi(client), options.targets),
        resolveParent,
      );
    },
  };
}
