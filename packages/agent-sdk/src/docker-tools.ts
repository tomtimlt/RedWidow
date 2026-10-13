import { tool } from "@anthropic-ai/claude-agent-sdk";
import { createDockerClient, type DockerClient } from "@john-studio/core";
import { z } from "zod";
import type { AnyMcpTool, ResolvedCall, Toolset } from "./toolset.js";

export const DOCKER_SERVER_NAME = "docker";
export const DOCKER_TOOL_PREFIX = `mcp__${DOCKER_SERVER_NAME}__`;
export const DOCKER_SERVER_INSTRUCTIONS =
  "Outils Docker structurés. Préférez-les à `Bash docker …` : leur exécution est journalisée et les cibles sont validées.";

const MAX_LINES = 200;

/**
 * Parent (id d'événement) à utiliser pour les `process.*` d'un appel, ou
 * `ResolvedCall` pour consigner aussi la fiabilité de l'appariement.
 */
export type ResolveParent = (
  toolName: string,
  args: unknown,
  extra?: unknown,
) => string | null | ResolvedCall;

interface Ctx {
  parentId: string | null;
  correlation: ResolvedCall["correlation"] | undefined;
  signal: AbortSignal | undefined;
}

function clip(lines: readonly string[]): string {
  if (lines.length <= MAX_LINES) return lines.join("\n");
  const kept = lines.slice(-MAX_LINES);
  return [`… ${lines.length - MAX_LINES} lignes tronquées`, ...kept].join("\n");
}

const text = (value: string, isError = false) => ({
  content: [{ type: "text" as const, text: value }],
  ...(isError && { isError: true }),
});

/**
 * Définitions d'outils MCP exposant le client docker. Le nom vu par le modèle
 * est `mcp__docker__<nom>`.
 */
export function createDockerTools(
  docker: DockerClient,
  resolveParent: ResolveParent,
): AnyMcpTool[] {
  const handler =
    <A>(name: string, run: (args: A, ctx: Ctx) => Promise<string>) =>
    async (args: A, extra: unknown) => {
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
      try {
        const resolved = resolveParent(name, args, extra);
        const parentId = typeof resolved === "object" && resolved ? resolved.parentId : resolved;
        const correlation =
          typeof resolved === "object" && resolved ? resolved.correlation : undefined;
        return text(await run(args, { parentId, correlation, signal }));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    };
  const call = (ctx: Ctx) => ({
    parentId: ctx.parentId,
    ...(ctx.correlation && { correlation: ctx.correlation }),
    ...(ctx.signal && { signal: ctx.signal }),
  });
  const readOnly = { annotations: { readOnlyHint: true } };

  const container = z.string().describe("Nom ou identifiant du conteneur");
  const tools = [
    tool(
      "ps",
      "Liste les conteneurs (JSON).",
      { all: z.boolean().optional().describe("Inclure les conteneurs arrêtés") },
      handler("ps", async (a: { all?: boolean | undefined }, ctx) =>
        JSON.stringify(await docker.ps({ ...call(ctx), ...(a.all && { all: true }) }), null, 2),
      ),
      readOnly,
    ),
    tool(
      "images",
      "Liste les images locales (JSON).",
      {},
      handler("images", async (_a: object, ctx) =>
        JSON.stringify(await docker.images(call(ctx)), null, 2),
      ),
      readOnly,
    ),
    tool(
      "logs",
      "Dernières lignes de journal d'un conteneur.",
      {
        container,
        tail: z.number().int().min(0).max(5000).optional().describe("Nombre de lignes"),
        since: z.string().optional().describe("Ex. 10m, 2h ou horodatage RFC3339"),
      },
      handler(
        "logs",
        async (
          a: { container: string; tail?: number | undefined; since?: string | undefined },
          ctx,
        ) =>
          clip(
            await docker.logs(a.container, {
              ...call(ctx),
              ...(a.tail !== undefined && { tail: a.tail }),
              ...(a.since !== undefined && { since: a.since }),
            }),
          ),
      ),
      readOnly,
    ),
    tool(
      "inspect",
      "Détails d'un conteneur ou d'une image (JSON).",
      { target: z.string().describe("Nom ou identifiant") },
      handler("inspect", async (a: { target: string }, ctx) =>
        clip(JSON.stringify(await docker.inspect(a.target, call(ctx)), null, 2).split("\n")),
      ),
      readOnly,
    ),
    tool(
      "run",
      "Crée et démarre un conteneur en arrière-plan. Pas de volumes, réseau hôte ni mode privilégié.",
      {
        image: z.string(),
        name: z.string().optional(),
        ports: z.array(z.string()).optional().describe("Ex. 8080:80 ou 127.0.0.1:8080:80/tcp"),
        env: z.record(z.string(), z.string()).optional(),
        command: z.array(z.string()).optional().describe("Commande et arguments après l'image"),
      },
      handler(
        "run",
        async (
          a: {
            image: string;
            name?: string | undefined;
            ports?: string[] | undefined;
            env?: Record<string, string> | undefined;
            command?: string[] | undefined;
          },
          ctx,
        ) => {
          const id = await docker.run({
            ...call(ctx),
            image: a.image,
            ...(a.name !== undefined && { name: a.name }),
            ...(a.ports && { ports: a.ports }),
            ...(a.env && { env: a.env }),
            ...(a.command && { command: a.command }),
          });
          return `démarré : ${id}`;
        },
      ),
    ),
    tool(
      "start",
      "Démarre un conteneur existant.",
      { container },
      handler("start", async (a: { container: string }, ctx) => {
        await docker.start(a.container, call(ctx));
        return `démarré : ${a.container}`;
      }),
    ),
    tool(
      "stop",
      "Arrête un conteneur.",
      { container },
      handler("stop", async (a: { container: string }, ctx) => {
        await docker.stop(a.container, call(ctx));
        return `arrêté : ${a.container}`;
      }),
    ),
    tool(
      "rm",
      "Supprime un conteneur.",
      { container, force: z.boolean().optional().describe("Même s'il tourne") },
      handler("rm", async (a: { container: string; force?: boolean | undefined }, ctx) => {
        await docker.rm(a.container, { ...call(ctx), ...(a.force && { force: true }) });
        return `supprimé : ${a.container}`;
      }),
      { annotations: { destructiveHint: true } },
    ),
  ];
  // Le SDK ne sait pas typer un tableau d'outils aux schémas hétérogènes (InferShape<any>).
  return tools as unknown as AnyMcpTool[];
}

export interface DockerToolsetOptions {
  /** Binaire docker (défaut : `docker`). */
  binary?: string;
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
        }),
        (name, args, extra) => resolveCall(`${DOCKER_TOOL_PREFIX}${name}`, args, extra),
      ),
  };
}
