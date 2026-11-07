import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApprovalGate, createRecorder, DEFAULT_POLICY, webToolSpecs } from "@warband/core";
import { expect, it, vi } from "vitest";
import { startToolServer, webToolset } from "../src/index.js";

it("les outils web partagés restent soumis à la gate malgré leur annotation lecture seule", async () => {
  let allow = false;
  const ask = vi.fn(async () => ({ decision: allow ? ("allow" as const) : ("deny" as const) }));
  const recorder = createRecorder();
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, ask });
  const network = vi.fn(async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: (async function* () {
      yield Buffer.from(
        JSON.stringify({
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: "Title: Documentation\nURL: https://github.com/example/project",
              },
            ],
          },
        }),
      );
    })(),
  }));
  const server = await startToolServer({
    token: "web-test-token",
    toolsets: [
      {
        name: "web",
        tools: webToolSpecs({
          lookup: async () => [{ address: "8.8.8.8", family: 4 }],
          transport: network,
        }),
      },
    ],
    guard: async ({ toolName, args, signal }) => {
      const verdict = await gate.decide(
        {
          toolUseId: `web-${ask.mock.calls.length}`,
          tool: toolName,
          input: args as Record<string, unknown>,
        },
        signal ?? new AbortController().signal,
      );
      return verdict.decision === "allow"
        ? { allowed: true, ctx: { parentId: null, correlation: undefined } }
        : { allowed: false, message: "Refusé par la gate" };
    },
  });
  const client = new Client({ name: "web-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url("web")), {
        requestInit: { headers: { Authorization: "Bearer web-test-token" } },
      }) as Parameters<typeof client.connect>[0],
    );
    const denied = await client.callTool({
      name: "search_web",
      arguments: { query: "documentation GitHub 10.0.0.5" },
    });
    expect(denied.isError).toBe(true);
    expect(network).not.toHaveBeenCalled();
    allow = true;
    const allowed = await client.callTool({
      name: "search_web",
      arguments: { query: "documentation GitHub 10.0.0.5" },
    });
    expect(allowed.isError).not.toBe(true);
    expect(network).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledTimes(2);
    const privateUrl = await client.callTool({
      name: "read_url",
      arguments: { url: "http://127.0.0.1" },
    });
    expect(privateUrl.isError).toBe(true);
    expect(network).toHaveBeenCalledOnce();
    expect(
      webToolset()
        .create({ recorder })
        .map((spec) => spec.name),
    ).toEqual(["search_web", "read_url", "http_request"]);
  } finally {
    await client.close();
    await server.close();
  }
});
