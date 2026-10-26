import {
  COURS_SERVER_INSTRUCTIONS,
  COURS_SERVER_NAME,
  coursRoot,
  coursToolSpecs,
  createDockerClient,
  createKaliApi,
  DOCKER_SERVER_INSTRUCTIONS,
  DOCKER_SERVER_NAME,
  type DockerToolSpec,
  dockerToolSpecs,
  EXEGOL_SERVER_INSTRUCTIONS,
  EXEGOL_SERVER_NAME,
  type ExegolTargets,
  exegolToolSpecs,
  KALI_SERVER_INSTRUCTIONS,
  KALI_SERVER_NAME,
  kaliToolSpecs,
  type Recorder,
  taskToolSpecs,
  WEB_SERVER_INSTRUCTIONS,
  WEB_SERVER_NAME,
  webToolSpecs,
} from "@warband/core";

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

export function webToolset(): OpencodeToolset {
  return {
    name: WEB_SERVER_NAME,
    instructions: WEB_SERVER_INSTRUCTIONS,
    create: () => webToolSpecs(),
  };
}

export interface DockerToolsetOptions {
  /** Binaire docker (défaut : `docker`). */
  binary?: string;
  /** Préfixe d'arguments du binaire : réservé au code (tests), voir `DockerClientOptions`. */
  argsPrefix?: readonly string[];
}

/** Toolset docker : son propre `DockerClient` branché sur le recorder du run. */
export function dockerToolset(options: DockerToolsetOptions = {}): OpencodeToolset {
  return {
    name: DOCKER_SERVER_NAME,
    instructions: DOCKER_SERVER_INSTRUCTIONS,
    create: ({ recorder }) =>
      dockerToolSpecs(
        createDockerClient({
          recorder,
          ...(options.binary && { binary: options.binary }),
          ...(options.argsPrefix && { argsPrefix: options.argsPrefix }),
        }),
      ),
  };
}

export interface ExegolToolsetOptions extends DockerToolsetOptions {
  targets: ExegolTargets;
  /** Expose `remember` (défaut : true). */
  includeMemory?: boolean;
}

/** Outils Exegol neutres ; leur exécution passe par le ToolGuard du serveur MCP. */
export function exegolToolset(options: ExegolToolsetOptions): OpencodeToolset {
  return {
    name: EXEGOL_SERVER_NAME,
    instructions: EXEGOL_SERVER_INSTRUCTIONS,
    create: ({ recorder }) => {
      const docker = createDockerClient({ ...options, recorder });
      return [
        ...exegolToolSpecs(docker, options.targets),
        ...taskToolSpecs("exegol", docker, options.targets),
      ].filter((spec) => options.includeMemory !== false || spec.name !== "remember");
    },
  };
}

export type KaliToolsetOptions = ExegolToolsetOptions;

/** Outils Kali bornés aux cibles du message. */
export function kaliToolset(options: KaliToolsetOptions): OpencodeToolset {
  return {
    name: KALI_SERVER_NAME,
    instructions: KALI_SERVER_INSTRUCTIONS,
    create: ({ recorder }) => {
      const client = { ...options, recorder };
      const docker = createDockerClient(client);
      return [
        ...kaliToolSpecs(docker, createKaliApi(client), options.targets),
        ...taskToolSpecs("kali", docker, options.targets),
      ].filter((spec) => options.includeMemory !== false || spec.name !== "remember");
    },
  };
}

/** Cours en lecture seule, sous la racine contrôlée par le cœur. */
export function coursToolset(): OpencodeToolset {
  return {
    name: COURS_SERVER_NAME,
    instructions: COURS_SERVER_INSTRUCTIONS,
    create: () => coursToolSpecs(coursRoot()),
  };
}
