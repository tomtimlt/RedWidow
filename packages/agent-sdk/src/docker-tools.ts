import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  createDockerClient,
  DOCKER_SERVER_INSTRUCTIONS,
  DOCKER_SERVER_NAME,
  DOCKER_TOOL_PREFIX,
  type DockerClient,
  type DockerToolSpec,
  dockerToolSpecs,
} from "@john-studio/core";
import { formatError } from "@john-studio/messages";
import type { AnyMcpTool, ResolvedCall, Toolset } from "./toolset.js";

// Constantes définies dans le cœur (partagées avec l'adaptateur OpenCode), ré-exportées ici.
export { DOCKER_SERVER_INSTRUCTIONS, DOCKER_SERVER_NAME, DOCKER_TOOL_PREFIX };

/**
 * Parent (id d'événement) à utiliser pour les `process.*` d'un appel, ou
 * `ResolvedCall` pour consigner aussi la fiabilité de l'appariement.
 */
export type ResolveParent = (
  toolName: string,
  args: unknown,
  extra?: unknown,
) => string | null | ResolvedCall;

const text = (value: string, isError = false) => ({
  content: [{ type: "text" as const, text: value }],
  ...(isError && { isError: true }),
});

/**
 * Définitions d'outils MCP exposant le client docker (voir `dockerToolSpecs`
 * du cœur). Le nom vu par le modèle est `mcp__docker__<nom>`.
 */
export function createDockerTools(
  docker: DockerClient,
  resolveParent: ResolveParent,
): AnyMcpTool[] {
  return createSpecTools(dockerToolSpecs(docker), resolveParent);
}

/** Enveloppe des spécifications neutres (docker, bac à sable) en outils MCP du SDK. */
export function createSpecTools(
  specs: readonly DockerToolSpec[],
  resolveParent: ResolveParent,
): AnyMcpTool[] {
  const tools = specs.map((spec) =>
    tool(
      spec.name,
      spec.description,
      spec.input,
      async (args: unknown, extra: unknown) => {
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
        try {
          const resolved = resolveParent(spec.name, args, extra);
          const parentId = typeof resolved === "object" && resolved ? resolved.parentId : resolved;
          const correlation =
            typeof resolved === "object" && resolved ? resolved.correlation : undefined;
          return text(await spec.run(args, { parentId, correlation, signal }));
        } catch (err) {
          return text(formatError(err), true);
        }
      },
      spec.readOnly
        ? { annotations: { readOnlyHint: true } }
        : spec.destructive
          ? { annotations: { destructiveHint: true } }
          : undefined,
    ),
  );
  // Le SDK ne sait pas typer un tableau d'outils aux schémas hétérogènes (InferShape<any>).
  return tools as unknown as AnyMcpTool[];
}

export interface DockerToolsetOptions {
  /** Binaire docker (défaut : `docker`). */
  binary?: string;
  /** Préfixe d'arguments du binaire : réservé au code (tests), voir `DockerClientOptions`. */
  argsPrefix?: readonly string[];
}

/**
 * Toolset docker : crée son propre `DockerClient` branché sur le recorder du
 * run, et relie chaque appel à sa demande d'outil via `resolveParent`.
 */
export function dockerToolset(options: DockerToolsetOptions = {}): Toolset {
  return {
    name: DOCKER_SERVER_NAME,
    instructions: DOCKER_SERVER_INSTRUCTIONS,
    create: ({ recorder, resolveCall }) =>
      createDockerTools(
        createDockerClient({
          recorder,
          ...(options.binary && { binary: options.binary }),
          ...(options.argsPrefix && { argsPrefix: options.argsPrefix }),
        }),
        (name, args, extra) => resolveCall(`${DOCKER_TOOL_PREFIX}${name}`, args, extra),
      ),
  };
}
