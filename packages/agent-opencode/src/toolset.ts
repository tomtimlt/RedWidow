import {
  createDockerClient,
  DOCKER_SERVER_INSTRUCTIONS,
  DOCKER_SERVER_NAME,
  type DockerToolSpec,
  dockerToolSpecs,
  type Recorder,
} from "@john-studio/core";

/** Contexte fourni à un toolset à chaque run. */
export interface OpencodeToolContext {
  recorder: Recorder;
}

/**
 * Serveur MCP du moteur exposé à l'agent (`mcp__<name>__<outil>` côté
 * politique), construit à chaque run pour être branché sur son recorder.
 * Mêmes définitions neutres que l'adaptateur Claude (`DockerToolSpec`).
 */
export interface OpencodeToolset {
  name: string;
  instructions?: string;
  create(ctx: OpencodeToolContext): DockerToolSpec[];
}

export interface DockerToolsetOptions {
  /** Binaire docker (défaut : `docker`). */
  binary?: string;
}

/** Toolset docker : son propre `DockerClient` branché sur le recorder du run. */
export function dockerToolset(options: DockerToolsetOptions = {}): OpencodeToolset {
  return {
    name: DOCKER_SERVER_NAME,
    instructions: DOCKER_SERVER_INSTRUCTIONS,
    create: ({ recorder }) =>
      dockerToolSpecs(
        createDockerClient({ recorder, ...(options.binary && { binary: options.binary }) }),
      ),
  };
}
