import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  Options,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type Policy,
  type QueryFn,
  runAgent,
} from "../src/index.js";
import { callMcpTool, fakeDocker } from "./helpers.js";

// Messages SDK réduits aux champs lus par le moteur.
const assistant = (content: unknown[]) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { content } }) as unknown as SDKMessage;
const user = (content: unknown[]) =>
  ({
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content },
  }) as unknown as SDKMessage;
const result = (extra: Record<string, unknown>) =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    total_cost_usd: 0.0123,
    result: "fini",
    ...extra,
  }) as unknown as SDKMessage;

/** Faux SDK : pour chaque tool_use émis, appelle canUseTool puis renvoie un tool_result. */
function fakeQuery(calls: { id: string; tool: string; input: Record<string, unknown> }[]) {
  const seen: { options?: Options; decisions: string[] } = { decisions: [] };
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    const canUseTool = options.canUseTool as CanUseTool;
    yield assistant([{ type: "text", text: "Je regarde les conteneurs." }]);
    for (const c of calls) {
      yield assistant([{ type: "tool_use", id: c.id, name: c.tool, input: c.input }]);
      const r = await canUseTool(c.tool, c.input, {
        signal: new AbortController().signal,
        toolUseID: c.id,
        requestId: `req-${c.id}`,
      });
      if (!r) throw new Error("canUseTool doit toujours trancher");
      seen.decisions.push(r.behavior);
      yield user([
        {
          type: "tool_result",
          tool_use_id: c.id,
          is_error: r.behavior === "deny",
          content:
            r.behavior === "deny" ? r.message : [{ type: "text", text: "CONTAINER ID  web" }],
        },
      ]);
    }
    yield result({});
  };
  return { query, seen };
}

const setup = () => {
  const recorder = createRecorder({ runId: "run-1" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder });
  return { recorder, events, gate };
};

describe("runAgent", () => {
  it("route les outils via l'approbation et traduit le flux en événements", async () => {
    const { recorder, events, gate } = setup();
    const { query, seen } = fakeQuery([
      { id: "t1", tool: "Bash", input: { command: "docker ps" } },
      { id: "t2", tool: "Bash", input: { command: "docker rm -f web && rm -rf /" } },
    ]);

    const summary = await runAgent({ prompt: "état ?", recorder, gate, cwd: "/w", query });

    expect(summary).toEqual({ status: "success", turns: 2, costUsd: 0.0123, result: "fini" });
    expect(seen.decisions).toEqual(["allow", "deny"]);
    expect(seen.options).toMatchObject({
      cwd: "/w",
      settingSources: [],
      permissionMode: "default",
    });
    expect(events.map((e) => e.kind)).toEqual([
      "run.started",
      "agent.text",
      "tool.requested",
      "approval.decided",
      "tool.result",
      "tool.requested",
      "approval.decided",
      "tool.result",
      "run.finished",
    ]);

    const byId = new Map(events.map((e) => [e.id, e]));
    for (const e of events.filter(
      (e) => e.kind === "approval.decided" || e.kind === "tool.result",
    )) {
      expect(byId.get(e.parentId as string)?.kind).toBe("tool.requested");
    }
    const denial = events.find((e) => e.kind === "tool.result" && e.isError);
    expect(denial).toMatchObject({ toolUseId: "t2" });
  });

  it("produit un graphe causal cohérent", async () => {
    const { recorder, events, gate } = setup();
    const { query } = fakeQuery([{ id: "t1", tool: "Bash", input: { command: "docker ps" } }]);
    await runAgent({ prompt: "x", recorder, gate, query });

    const graph = buildGraph(events);
    expect(graph.runId).toBe("run-1");
    expect(graph.nodes.filter((n) => n.depth === 0)).toHaveLength(1);
    expect(graph.edges).toHaveLength(events.length - 1);
    expect(graph.nodes.find((n) => n.kind === "approval.decided")).toMatchObject({
      depth: 2,
      status: "ok",
    });
  });

  it("émet error + run.finished si le SDK lève", async () => {
    const { recorder, events, gate } = setup();
    // biome-ignore lint/correctness/useYield: le faux SDK échoue avant tout message.
    const query: QueryFn = async function* () {
      throw new Error("API indisponible");
    };
    const summary = await runAgent({ prompt: "x", recorder, gate, query });
    expect(summary.status).toBe("error");
    expect(events.map((e) => e.kind)).toEqual(["run.started", "error", "run.finished"]);
  });

  it("propage l'annulation au SDK", async () => {
    const { recorder, gate } = setup();
    const ac = new AbortController();
    let sdkSignal: AbortSignal | undefined;
    const query: QueryFn = async function* ({ options }) {
      sdkSignal = options.abortController?.signal;
      ac.abort();
      yield result({ subtype: "error_during_execution", is_error: true });
    };
    const summary = await runAgent({ prompt: "x", recorder, gate, query, signal: ac.signal });
    expect(sdkSignal?.aborted).toBe(true);
    expect(summary.status).toBe("error");
  });
});

const permit = (id: string) => ({
  signal: new AbortController().signal,
  toolUseID: id,
  requestId: `req-${id}`,
});
const sub = (message: SDKMessage, parent: string) =>
  ({ ...message, parent_tool_use_id: parent }) as unknown as SDKMessage;
const toolUse = (id: string, name: string, input: Record<string, unknown>) =>
  assistant([{ type: "tool_use", id, name, input }]);
const toolResult = (id: string, text: string) =>
  user([{ type: "tool_result", tool_use_id: id, is_error: false, content: text }]);

describe("outils MCP docker", () => {
  const byId = (events: EngineEvent[]) => new Map(events.map((e) => [e.id, e]));

  it("rattache les process.* au tool.requested via le vrai protocole MCP", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = options.canUseTool as CanUseTool;
      const server = options.mcpServers?.docker as McpSdkServerConfigWithInstance;
      yield toolUse("m1", "mcp__docker__ps", { all: true });
      const decision = await canUseTool("mcp__docker__ps", { all: true }, permit("m1"));
      expect(decision).toMatchObject({ behavior: "allow" });
      const out = await callMcpTool(server, "ps", { all: true });
      expect(out.isError).toBe(false);
      yield toolResult("m1", out.text);
      yield result({});
    };

    await runAgent({ prompt: "x", recorder, gate, query, docker: { binary: fake.bin } });

    const requested = events.find((e) => e.kind === "tool.requested");
    const started = events.find((e) => e.kind === "process.started");
    expect(started?.parentId).toBe(requested?.id);
    expect(started).toMatchObject({ argv: [fake.bin, "ps", "--all", "--format", "{{json .}}"] });
    expect(events.find((e) => e.kind === "approval.decided")?.parentId).toBe(requested?.id);
    expect(events.find((e) => e.kind === "tool.result")?.parentId).toBe(requested?.id);
    expect(events.find((e) => e.kind === "process.exited")).toMatchObject({ code: 0 });

    const graph = buildGraph(events);
    expect(graph.nodes.find((n) => n.id === started?.id)?.depth).toBe(2);
  });

  it("n'exécute rien quand l'approbation refuse (rm)", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = options.canUseTool as CanUseTool;
      yield toolUse("m1", "mcp__docker__rm", { container: "web" });
      const decision = await canUseTool("mcp__docker__rm", { container: "web" }, permit("m1"));
      expect(decision).toMatchObject({ behavior: "deny" });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: { binary: fake.bin } });
    expect(events.some((e) => e.kind === "process.started")).toBe(false);
    expect(await fake.calls()).toEqual([]);
  });

  it("apparie des appels concurrents de même outil par leurs arguments", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = options.canUseTool as CanUseTool;
      const server = options.mcpServers?.docker as McpSdkServerConfigWithInstance;
      yield toolUse("a", "mcp__docker__ps", {});
      yield toolUse("b", "mcp__docker__ps", { all: true });
      await canUseTool("mcp__docker__ps", {}, permit("a"));
      await canUseTool("mcp__docker__ps", { all: true }, permit("b"));
      // Exécution dans l'ordre inverse de l'approbation.
      await callMcpTool(server, "ps", { all: true });
      await callMcpTool(server, "ps", {});
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: { binary: fake.bin } });

    const ids = byId(events);
    const parents = events
      .filter((e) => e.kind === "process.started")
      .map((e) => ({
        all: e.kind === "process.started" && e.argv.includes("--all"),
        parent: (ids.get(e.parentId as string) as { toolUseId?: string }).toolUseId,
      }));
    expect(parents).toEqual([
      { all: true, parent: "b" },
      { all: false, parent: "a" },
    ]);
  });

  it("se rabat sur run.started si aucune approbation n'a précédé l'appel", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      await callMcpTool(options.mcpServers?.docker as McpSdkServerConfigWithInstance, "ps", {});
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: { binary: fake.bin } });
    expect(events.find((e) => e.kind === "process.started")?.parentId).toBe(events[0]?.id);
  });

  it("n'expose le serveur que si demandé, et fusionne mcpServers existants", async () => {
    const { recorder, gate } = setup();
    const seen: Options[] = [];
    const query: QueryFn = async function* ({ options }) {
      seen.push(options);
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    await runAgent({ prompt: "x", recorder, gate, query, docker: false });
    await runAgent({
      prompt: "x",
      recorder,
      gate,
      query,
      docker: false,
      sdkOptions: { mcpServers: { ext: { type: "stdio", command: "x" } } },
      toolsets: [{ name: "extra", tools: [] }],
    });
    expect(Object.keys(seen[0]?.mcpServers ?? {})).toEqual(["docker"]);
    expect(Object.keys(seen[1]?.mcpServers ?? {})).toEqual([]);
    expect(Object.keys(seen[2]?.mcpServers ?? {}).sort()).toEqual(["ext", "extra"]);
  });
});

describe("sous-agents", () => {
  const allowAll: Policy = { default: "allow", rules: [] };
  const setupAllow = () => {
    const recorder = createRecorder({ runId: "run-1" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    return { recorder, events, gate: createApprovalGate({ policy: allowAll, recorder }) };
  };

  it("imbrique les messages du sous-agent sous l'outil Task", async () => {
    const { recorder, events, gate } = setupAllow();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = options.canUseTool as CanUseTool;
      yield toolUse("task1", "Task", { prompt: "inspecte" });
      await canUseTool("Task", { prompt: "inspecte" }, permit("task1"));
      yield sub(assistant([{ type: "text", text: "Je vérifie." }]), "task1");
      yield sub(toolUse("s1", "Bash", { command: "docker ps" }), "task1");
      await canUseTool("Bash", { command: "docker ps" }, permit("s1"));
      yield sub(toolResult("s1", "web"), "task1");
      yield toolResult("task1", "terminé");
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });

    const task = events.find((e) => e.kind === "tool.requested" && e.toolUseId === "task1");
    const bash = events.find((e) => e.kind === "tool.requested" && e.toolUseId === "s1");
    expect(task).toBeDefined();
    expect(bash).toMatchObject({ parentId: task?.id, agentToolUseId: "task1" });
    expect(task).not.toHaveProperty("agentToolUseId");
    expect(events.find((e) => e.kind === "agent.text")?.parentId).toBe(task?.id);
    expect(events.find((e) => e.kind === "tool.result" && e.toolUseId === "s1")?.parentId).toBe(
      bash?.id,
    );

    const depth = (id?: string) => buildGraph(events).nodes.find((n) => n.id === id)?.depth;
    expect(depth(task?.id)).toBe(1);
    expect(depth(bash?.id)).toBe(2);
  });

  it("rattache à la racine si canUseTool précède le message du sous-agent", async () => {
    const { recorder, events, gate } = setupAllow();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = options.canUseTool as CanUseTool;
      yield toolUse("task1", "Task", {});
      await canUseTool("Task", {}, permit("task1"));
      await canUseTool("Bash", { command: "docker ps" }, permit("s1")); // course : avant le message
      yield sub(toolUse("s1", "Bash", { command: "docker ps" }), "task1");
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    const bash = events.find((e) => e.kind === "tool.requested" && e.toolUseId === "s1");
    expect(bash?.parentId).toBe(events[0]?.id);
    expect(bash).not.toHaveProperty("agentToolUseId");
  });
});
