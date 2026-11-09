import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DockerToolContext, DockerToolSpec } from "@warband/core";
import { formatError } from "@warband/messages";

export interface ServedToolset {
  name: string;
  instructions?: string;
  tools: DockerToolSpec[];
  decorateResult?: (output: string) => string;
}

/** Résultat de la garde d'un appel : autorisé (avec son contexte causal) ou refusé (texte pour le modèle). */
export type GuardResult =
  | { allowed: true; ctx: Omit<DockerToolContext, "signal"> }
  | { allowed: false; message: string };

/** Garde appelée avant chaque exécution (défense en profondeur, en plus de la permission OpenCode). */
export type ToolGuard = (call: {
  toolName: string;
  args: unknown;
  signal: AbortSignal | undefined;
}) => Promise<GuardResult>;

export interface ToolServerOptions {
  toolsets: readonly ServedToolset[];
  /** Jeton Bearer exigé sur chaque requête. */
  token: string;
  guard: ToolGuard;
}

export interface ToolServer {
  /** URL MCP d'un toolset. */
  url(name: string): string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(given), digest(token));
}

function reply(res: ServerResponse, status: number, headers: Record<string, string> = {}) {
  res.writeHead(status, headers);
  res.end();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("corps trop volumineux");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function buildMcp(set: ServedToolset, guard: ToolGuard): McpServer {
  const server = new McpServer(
    { name: set.name, version: "0.1.0" },
    set.instructions ? { instructions: set.instructions } : {},
  );
  for (const spec of set.tools) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.input,
        annotations: {
          ...(spec.readOnly && { readOnlyHint: true }),
          ...(spec.destructive && { destructiveHint: true }),
        },
      },
      async (args: unknown, extra: { signal?: AbortSignal }) => {
        const text = (value: string, isError = false) => ({
          content: [{ type: "text" as const, text: set.decorateResult?.(value) ?? value }],
          ...(isError && { isError: true }),
        });
        try {
          const verdict = await guard({
            toolName: `mcp__${set.name}__${spec.name}`,
            args,
            signal: extra.signal,
          });
          if (!verdict.allowed) return text(verdict.message, true);
          return text(await spec.run(args, { ...verdict.ctx, signal: extra.signal }));
        } catch (err) {
          return text(formatError(err), true);
        }
      },
    );
  }
  return server;
}

/**
 * Serveur MCP HTTP (Streamable HTTP, sans état) en processus : lié à
 * 127.0.0.1, port aléatoire, jeton Bearer obligatoire (comparé en temps
 * constant) et en-tête Host vérifié. Chaque appel d'outil passe par `guard`.
 */
export async function startToolServer({
  toolsets,
  token,
  guard,
}: ToolServerOptions): Promise<ToolServer> {
  const byName = new Map(toolsets.map((set) => [set.name, set]));
  let port = 0;

  const http = createServer((req, res) => {
    void (async () => {
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403);
      if (!authorized(req, token)) {
        return reply(res, 401, { "www-authenticate": "Bearer" });
      }
      const match = /^\/mcp\/([A-Za-z0-9_-]+)$/.exec(req.url ?? "");
      const set = match?.[1] === undefined ? undefined : byName.get(match[1]);
      if (!set) return reply(res, 404);
      if (req.method !== "POST") return reply(res, 405, { allow: "POST" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return reply(res, 400);
      }
      const mcp = buildMcp(set, guard);
      // Sans générateur d'identifiant de session : mode sans état.
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(req, res, body);
    })().catch(() => {
      if (!res.headersSent) reply(res, 500);
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  port = (http.address() as AddressInfo).port;

  return {
    url: (name) => `http://127.0.0.1:${port}/mcp/${name}`,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
