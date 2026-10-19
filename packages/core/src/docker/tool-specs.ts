import { z } from "zod";
import type { Correlation } from "../events.js";
import type { CallOptions, DockerClient } from "./client.js";

/** Nom du serveur MCP docker : les outils vus par le modèle s'appellent `mcp__docker__<nom>`. */
export const DOCKER_SERVER_NAME = "docker";
export const DOCKER_TOOL_PREFIX = `mcp__${DOCKER_SERVER_NAME}__`;
export const DOCKER_SERVER_INSTRUCTIONS =
  "Outils Docker structurés. Préférez-les à `Bash docker …` : leur exécution est journalisée et les cibles sont validées.";

/** Nombre maximal de lignes renvoyées au modèle par un outil docker. */
export const MAX_TOOL_LINES = 200;

/** Joint les lignes ; au-delà du plafond, ne garde que les dernières et signale la coupe. */
export function formatLines(lines: readonly string[]): string {
  if (lines.length <= MAX_TOOL_LINES) return lines.join("\n");
  const kept = lines.slice(-MAX_TOOL_LINES);
  return [`… ${lines.length - MAX_TOOL_LINES} lignes tronquées`, ...kept].join("\n");
}

/** Contexte d'un appel : parent causal des `process.*`, fiabilité de l'appariement, annulation. */
export interface DockerToolContext {
  parentId: string | null;
  correlation: Correlation | undefined;
  signal: AbortSignal | undefined;
}

/**
 * Définition neutre d'un outil docker, indépendante de tout moteur d'agent :
 * l'adaptateur Claude l'enveloppe avec `tool()` du SDK, l'adaptateur OpenCode
 * l'expose par un serveur MCP HTTP. Les textes destinés au modèle sont en français.
 */
export interface DockerToolSpec {
  name: string;
  description: string;
  /** Schéma des arguments (forme zod, comme attendu par `tool()` du SDK et par MCP). */
  input: z.ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;
  /** Valide les arguments par `input`, exécute la commande et renvoie le texte pour le modèle. */
  run(args: unknown, ctx: DockerToolContext): Promise<string>;
}

/** Options communes à chaque appel du client docker, dérivées du contexte. */
function callOptions(ctx: DockerToolContext): CallOptions {
  return {
    parentId: ctx.parentId,
    ...(ctx.correlation && { correlation: ctx.correlation }),
    ...(ctx.signal && { signal: ctx.signal }),
  };
}

function spec<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  run(args: z.infer<z.ZodObject<S>>, call: CallOptions): Promise<string>;
}): DockerToolSpec {
  const schema = z.object(def.input);
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    ...(def.readOnly && { readOnly: true }),
    ...(def.destructive && { destructive: true }),
    run: async (args, ctx) => def.run(schema.parse(args), callOptions(ctx)),
  };
}

/** Définitions des outils exposant le client docker (`ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm`). */
export function dockerToolSpecs(docker: DockerClient): DockerToolSpec[] {
  const container = z.string().describe("Nom ou identifiant du conteneur");
  return [
    spec({
      name: "ps",
      description: "Liste les conteneurs (JSON).",
      input: { all: z.boolean().optional().describe("Inclure les conteneurs arrêtés") },
      readOnly: true,
      run: async (a, call) =>
        JSON.stringify(await docker.ps({ ...call, ...(a.all && { all: true }) }), null, 2),
    }),
    spec({
      name: "images",
      description: "Liste les images locales (JSON).",
      input: {},
      readOnly: true,
      run: async (_a, call) => JSON.stringify(await docker.images(call), null, 2),
    }),
    spec({
      name: "logs",
      description: "Dernières lignes de journal d'un conteneur.",
      input: {
        container,
        tail: z.number().int().min(0).max(5000).optional().describe("Nombre de lignes"),
        since: z.string().optional().describe("Ex. 10m, 2h ou horodatage RFC3339"),
      },
      readOnly: true,
      run: async (a, call) =>
        formatLines(
          await docker.logs(a.container, {
            ...call,
            ...(a.tail !== undefined && { tail: a.tail }),
            ...(a.since !== undefined && { since: a.since }),
          }),
        ),
    }),
    spec({
      name: "inspect",
      description: "Détails d'un conteneur ou d'une image (JSON).",
      input: { target: z.string().describe("Nom ou identifiant") },
      readOnly: true,
      run: async (a, call) =>
        formatLines(JSON.stringify(await docker.inspect(a.target, call), null, 2).split("\n")),
    }),
    spec({
      name: "run",
      description:
        "Crée et démarre un conteneur en arrière-plan. Pas de volumes, réseau hôte ni mode privilégié.",
      input: {
        image: z.string(),
        name: z.string().optional(),
        ports: z.array(z.string()).optional().describe("Ex. 8080:80 ou 127.0.0.1:8080:80/tcp"),
        env: z.record(z.string(), z.string()).optional(),
        command: z.array(z.string()).optional().describe("Commande et arguments après l'image"),
      },
      run: async (a, call) => {
        const id = await docker.run({
          ...call,
          image: a.image,
          ...(a.name !== undefined && { name: a.name }),
          ...(a.ports && { ports: a.ports }),
          ...(a.env && { env: a.env }),
          ...(a.command && { command: a.command }),
        });
        return `démarré : ${id}`;
      },
    }),
    spec({
      name: "start",
      description: "Démarre un conteneur existant.",
      input: { container },
      run: async (a, call) => {
        await docker.start(a.container, call);
        return `démarré : ${a.container}`;
      },
    }),
    spec({
      name: "stop",
      description: "Arrête un conteneur.",
      input: { container },
      run: async (a, call) => {
        await docker.stop(a.container, call);
        return `arrêté : ${a.container}`;
      },
    }),
    spec({
      name: "rm",
      description: "Supprime un conteneur.",
      input: { container, force: z.boolean().optional().describe("Même s'il tourne") },
      destructive: true,
      run: async (a, call) => {
        await docker.rm(a.container, { ...call, ...(a.force && { force: true }) });
        return `supprimé : ${a.container}`;
      },
    }),
  ];
}
