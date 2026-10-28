import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type BurpConfig,
  burpToolSpecs,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  isBurpConfig,
  isRememberable,
} from "@warband/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createBurpBackend } from "../src/engine/burp-client.js";

const specsFor = (config: BurpConfig) => burpToolSpecs(config, createBurpBackend(config));

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const ctx = { parentId: null, correlation: undefined, signal: undefined };
async function fixture(transport: BurpConfig["transport"]) {
  const calls: unknown[] = [];
  const sessions = new Map<string, SSEServerTransport>();
  const servers: McpServer[] = [];
  const make = () => {
    const mcp = new McpServer({ name: "burp-fixture", version: "1.0.0" });
    mcp.registerTool("read_history", { inputSchema: { offset: z.number() } }, async (args) => {
      calls.push(args);
      return { content: [{ type: "text", text: `page ${args.offset}` }] };
    });
    mcp.registerTool("large_result", { inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "é".repeat(30_000) }],
    }));
    servers.push(mcp);
    return mcp;
  };
  const http = createServer((req, res) => {
    void (async () => {
      if (req.method === "GET" && req.url === "/sse") {
        const t = new SSEServerTransport("/messages", res);
        sessions.set(t.sessionId, t);
        await make().connect(t);
      } else if (req.method === "POST" && req.url?.startsWith("/messages?")) {
        const id = new URL(req.url, "http://localhost").searchParams.get("sessionId");
        const t = id ? sessions.get(id) : undefined;
        if (t) await t.handlePostMessage(req, res);
        else {
          res.writeHead(404);
          res.end();
        }
      } else if (req.url === "/mcp") {
        const t = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        const mcp = make();
        await mcp.connect(t as Parameters<McpServer["connect"]>[0]);
        await t.handleRequest(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    await Promise.all(servers.map((server) => server.close()));
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { calls, specs: specsFor({ port: (http.address() as AddressInfo).port, transport }) };
}

describe("MCP Burp local", () => {
  it.each([
    {},
    { port: 0, transport: "sse" },
    { port: 65536, transport: "http" },
    { port: 9876, transport: "stdio" },
    { port: 9876, transport: "sse", url: "http://evil" },
  ])("refuse une configuration non bornée (%#)", (config) => {
    expect(isBurpConfig(config)).toBe(false);
    expect(() => specsFor(config as BurpConfig)).toThrow();
  });
  it.each(["sse", "http"] as const)(
    "découvre puis appelle un outil réel via %s",
    async (transport) => {
      const { specs, calls } = await fixture(transport);
      const list = specs.find((spec) => spec.name === "list_tools");
      const call = specs.find((spec) => spec.name === "call_tool");
      if (!list || !call) throw Error("Outils Burp absents");
      const catalog = JSON.parse(await list.run({}, ctx));
      expect(catalog.tools.map((tool: { name: string }) => tool.name)).toContain("read_history");
      expect(calls).toEqual([]);
      const output = JSON.parse(
        await call.run({ name: "read_history", arguments: { offset: 7 } }, ctx),
      );
      expect(output).toEqual({ isError: false, text: "page 7", truncated: false });
      expect(calls).toEqual([{ offset: 7 }]);
      const large = JSON.parse(await call.run({ name: "large_result", arguments: {} }, ctx));
      expect(large.truncated).toBe(true);
      expect(Buffer.byteLength(large.text)).toBeLessThanOrEqual(32 * 1024);
      await expect(
        call.run({ name: "read_history", arguments: {}, url: "http://evil" }, ctx),
      ).rejects.toThrow();
      await expect(
        call.run({ name: "read_history", arguments: { data: "a".repeat(70_000) } }, ctx),
      ).rejects.toMatchObject({ code: "burp.invalidResponse" });
    },
  );
  it("le catalogue est permis mais un appel n’est jamais permis automatiquement par la politique par défaut", () => {
    expect(evaluatePolicy(DEFAULT_POLICY, "mcp__burp__list_tools", {}).decision).toBe("allow");
    expect(
      evaluatePolicy(DEFAULT_POLICY, "mcp__burp__call_tool", {
        name: "send_http1_request",
        arguments: {},
      }).decision,
    ).toBe("ask");
  });
  it("un endpoint SSE hostile ne reçoit aucune requête distante", async () => {
    let posts = 0;
    const http = createServer((req, res) => {
      if (req.method === "POST") posts++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("event: endpoint\ndata: http://example.invalid/messages\n\n");
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanup.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    const specs = specsFor({ port: (http.address() as AddressInfo).port, transport: "sse" });
    await expect(
      specs.find((spec) => spec.name === "list_tools")?.run({}, ctx),
    ).rejects.toMatchObject({ code: "burp.unavailable" });
    expect(posts).toBe(0);
  });
  it("annule une initialisation qui ne répond jamais sans relancer l’action", async () => {
    let requests = 0;
    const http = createServer(() => {
      requests++;
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    cleanup.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    const abort = new AbortController();
    const specs = specsFor({ port: (http.address() as AddressInfo).port, transport: "sse" });
    const result = specs
      .find((spec) => spec.name === "call_tool")
      ?.run({ name: "read_history", arguments: { offset: 0 } }, { ...ctx, signal: abort.signal });
    setTimeout(() => abort.abort(), 60);
    await expect(result).rejects.toMatchObject({ code: "burp.unavailable" });
    expect(requests).toBeLessThanOrEqual(1);
  });
});

it("un allow global ne court-circuite pas un appel Burp et toujours ne mémorise rien", async () => {
  const request = {
    toolUseId: "burp-1",
    tool: "mcp__burp__call_tool",
    input: { name: "send_http1_request", arguments: {} },
  };
  expect(
    evaluatePolicy(
      { ...DEFAULT_POLICY, default: "allow", rules: [{ tool: "*", decision: "allow" }] },
      request.tool,
      request.input,
    ).decision,
  ).toBe("ask");
  expect(
    evaluatePolicy(
      { ...DEFAULT_POLICY, rules: [{ tool: "mcp__burp__*", decision: "deny" }] },
      request.tool,
      request.input,
    ).decision,
  ).toBe("deny");
  expect(isRememberable(request, evaluatePolicy(DEFAULT_POLICY, request.tool, request.input))).toBe(
    false,
  );
  let asks = 0;
  let persisted = 0;
  const gate = createApprovalGate({
    policy: DEFAULT_POLICY,
    recorder: createRecorder(),
    ask: async () => {
      asks++;
      return { decision: "allow", remember: "always" };
    },
    persistRule: async () => {
      persisted++;
    },
  });
  await gate.decide(request, new AbortController().signal);
  await gate.decide({ ...request, toolUseId: "burp-2" }, new AbortController().signal);
  expect(asks).toBe(2);
  expect(persisted).toBe(0);
});
