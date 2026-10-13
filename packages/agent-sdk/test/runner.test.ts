import type {
  HookInput,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentRunner,
  buildGraph,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type Policy,
} from "@john-studio/core";
import { describe, expect, it } from "vitest";
import {
  createSdkRunner,
  dockerToolset,
  type QueryFn,
  type SdkRunnerOptions,
} from "../src/index.js";
import { callMcpTool, fakeDocker } from "./helpers.js";

/**
 * Simule l'enchaînement du SDK pour un appel d'outil : hook PreToolUse (un
 * refus est définitif), puis `canUseTool` quand le hook n'a pas refusé.
 */
function guarded(options: Options) {
  return async (
    tool: string,
    input: Record<string, unknown>,
    { toolUseID, signal }: { toolUseID: string; signal: AbortSignal },
  ): Promise<PermissionResult> => {
    for (const matcher of options.hooks?.PreToolUse ?? []) {
      for (const hook of matcher.hooks) {
        const out = await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: tool,
            tool_input: input,
            tool_use_id: toolUseID,
            session_id: "s",
            transcript_path: "",
            cwd: "/",
          } as HookInput,
          toolUseID,
          { signal },
        );
        const specific = "hookSpecificOutput" in out ? out.hookSpecificOutput : undefined;
        if (specific?.hookEventName === "PreToolUse" && specific.permissionDecision === "deny") {
          return { behavior: "deny", message: specific.permissionDecisionReason ?? "" };
        }
      }
    }
    const result = await options.canUseTool?.(tool, input, {
      signal,
      toolUseID,
      requestId: `req-${toolUseID}`,
    });
    if (!result) throw new Error("canUseTool doit toujours trancher");
    return result;
  };
}

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
    const canUseTool = guarded(options);
    yield assistant([{ type: "text", text: "Je regarde les conteneurs." }]);
    for (const c of calls) {
      yield assistant([{ type: "tool_use", id: c.id, name: c.tool, input: c.input }]);
      const r = await canUseTool(c.tool, c.input, {
        signal: new AbortController().signal,
        toolUseID: c.id,
      });
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

/** Adaptateur de test : ancienne forme d'appel `runAgent` traduite vers `createSdkRunner().run()`. */
interface RunArgs extends SdkRunnerOptions {
  prompt: string;
  recorder: ReturnType<typeof createRecorder>;
  gate: ReturnType<typeof createApprovalGate>;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  /** Binaire docker : active le toolset docker (absent = aucun toolset docker). */
  docker?: string;
}

const runAgent = (a: RunArgs) => {
  const { prompt, recorder, gate, cwd = "/w", model, maxTurns, signal, docker, ...rest } = a;
  const toolsets = [
    ...(docker ? [dockerToolset({ binary: docker })] : []),
    ...(rest.toolsets ?? []),
  ];
  const runner: AgentRunner = createSdkRunner({ ...rest, toolsets });
  return runner.run(
    {
      prompt,
      cwd,
      ...(model !== undefined && { model }),
      ...(maxTurns !== undefined && { maxTurns }),
    },
    { recorder, gate, ...(signal && { signal }) },
  );
};

const setup = () => {
  const recorder = createRecorder({ runId: "run-1" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder });
  return { recorder, events, gate };
};

describe("createSdkRunner", () => {
  it("route les outils via l'approbation et traduit le flux en événements", async () => {
    const { recorder, events, gate } = setup();
    const { query, seen } = fakeQuery([
      { id: "t1", tool: "Bash", input: { command: "docker ps" } },
      { id: "t2", tool: "Bash", input: { command: "docker rm -f web && rm -rf /" } },
    ]);

    const summary = await runAgent({ prompt: "état ?", recorder, gate, cwd: "/w", query });

    expect(summary).toEqual({
      status: "success",
      turns: 2,
      costUsd: 0.0123,
      result: "fini",
      unhandledMessages: {},
    });
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
    // Erreur inconnue : code générique + message brut (pas de texte français dans le cœur).
    expect(events[1]).toMatchObject({
      kind: "error",
      code: "error.unknown",
      message: "API indisponible",
    });
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
      const canUseTool = guarded(options);
      const server = options.mcpServers?.docker as McpSdkServerConfigWithInstance;
      yield toolUse("m1", "mcp__docker__ps", { all: true });
      const decision = await canUseTool("mcp__docker__ps", { all: true }, permit("m1"));
      expect(decision).toMatchObject({ behavior: "allow" });
      const out = await callMcpTool(server, "ps", { all: true });
      expect(out.isError).toBe(false);
      yield toolResult("m1", out.text);
      yield result({});
    };

    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });

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
      const canUseTool = guarded(options);
      yield toolUse("m1", "mcp__docker__rm", { container: "web" });
      const decision = await canUseTool("mcp__docker__rm", { container: "web" }, permit("m1"));
      expect(decision).toMatchObject({ behavior: "deny" });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });
    expect(events.some((e) => e.kind === "process.started")).toBe(false);
    expect(await fake.calls()).toEqual([]);
  });

  it("apparie des appels concurrents de même outil par leurs arguments", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = guarded(options);
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
    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });

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
    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });
    expect(events.find((e) => e.kind === "process.started")?.parentId).toBe(events[0]?.id);
  });

  it("n'expose le serveur que si demandé, et fusionne mcpServers existants", async () => {
    const { recorder, gate } = setup();
    const seen: Options[] = [];
    const query: QueryFn = async function* ({ options }) {
      seen.push(options);
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: "docker" });
    await runAgent({ prompt: "x", recorder, gate, query });
    await runAgent({
      prompt: "x",
      recorder,
      gate,
      query,
      sdkOptions: { mcpServers: { ext: { type: "stdio", command: "x" } } },
      toolsets: [{ name: "extra", create: () => [] }],
    });
    expect(Object.keys(seen[0]?.mcpServers ?? {})).toEqual(["docker"]);
    expect(Object.keys(seen[1]?.mcpServers ?? {})).toEqual([]);
    expect(Object.keys(seen[2]?.mcpServers ?? {}).sort()).toEqual(["ext", "extra"]);
  });

  it("reconstruit les serveurs MCP à chaque run", async () => {
    const { recorder, gate } = setup();
    const servers: unknown[] = [];
    const query: QueryFn = async function* ({ options }) {
      servers.push(options.mcpServers?.docker);
      yield result({});
    };
    const runner = createSdkRunner({ query, toolsets: [dockerToolset()] });
    await runner.run({ prompt: "x", cwd: "/w" }, { recorder, gate });
    await runner.run({ prompt: "x", cwd: "/w" }, { recorder, gate });
    expect(servers[0]).toBeDefined();
    expect(servers[0]).not.toBe(servers[1]);
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
      const canUseTool = guarded(options);
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
      const canUseTool = guarded(options);
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

describe("garde PreToolUse", () => {
  const capture = async (extra: Partial<Parameters<typeof runAgent>[0]> = {}) => {
    const { recorder, events, gate } = setup();
    let options: Options | undefined;
    const query: QueryFn = async function* (params) {
      options = params.options;
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, ...extra });
    return { options: options as Options, events };
  };

  it("expose seulement les lectures natives, sans Bash, et verrouille les permissions", async () => {
    const { options } = await capture({
      sdkOptions: {
        // Tentatives de contournement via l'API : ignorées par le type et par le moteur.
        ...({
          permissionMode: "bypassPermissions",
          allowedTools: ["Bash"],
          tools: ["Bash", "Write"],
          strictMcpConfig: false,
          settingSources: ["project"],
        } as object),
      },
    });
    expect(options.tools).toEqual(["Read", "Glob", "Grep"]);
    expect(options.disallowedTools).toContain("Bash");
    expect(options).toMatchObject({
      permissionMode: "default",
      allowedTools: [],
      strictMcpConfig: true,
      settingSources: [],
    });
  });

  it("n'ajoute Bash que sur demande explicite", async () => {
    const { options } = await capture({ bash: true });
    expect(options.tools).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect(options.disallowedTools ?? []).not.toContain("Bash");
    const { options: viaBuiltin } = await capture({ builtinTools: ["Read", "Bash"] });
    expect(viaBuiltin.tools).toEqual(["Read"]);
  });

  it("voit les outils que le SDK auto-approuverait sans appeler canUseTool", async () => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* ({ options }) {
      yield toolUse("r1", "Read", { file_path: "notes.txt" });
      // Le SDK n'appelle PAS canUseTool pour une lecture dans le cwd : seul le hook la voit.
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      const out = await hook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: "notes.txt" },
          tool_use_id: "r1",
        } as HookInput,
        "r1",
        { signal: new AbortController().signal },
      );
      expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    expect(events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
  });

  it("refuse dans le hook : canUseTool n'est jamais atteint", async () => {
    const { recorder, events, gate } = setup();
    let reachedCanUseTool = false;
    const query: QueryFn = async function* ({ options }) {
      const inner = options.canUseTool;
      const spy = {
        ...options,
        canUseTool: ((...a: Parameters<NonNullable<typeof inner>>) => {
          reachedCanUseTool = true;
          return inner?.(...a);
        }) as NonNullable<typeof inner>,
      };
      yield toolUse("t1", "Bash", { command: "rm -rf /" });
      const r = await guarded(spy)("Bash", { command: "rm -rf /" }, permit("t1"));
      expect(r.behavior).toBe("deny");
      // Le texte renvoyé au modèle est libellé en français par @john-studio/messages.
      expect(r).toMatchObject({ message: "Refusé par john-studio : règle #10 deny Bash(rm *)" });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    expect(reachedCanUseTool).toBe(false);
    expect(events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
  });

  it("canUseTool relaie la décision du hook sans la rejouer", async () => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* ({ options }) {
      yield toolUse("t1", "Bash", { command: "docker ps" });
      const r = await guarded(options)("Bash", { command: "docker ps" }, permit("t1"));
      expect(r.behavior).toBe("allow");
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    expect(events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });

  it("canUseTool refuse (fail-closed) un appel que le hook n'a pas vu", async () => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* ({ options }) {
      const r = await options.canUseTool?.(
        "Bash",
        { command: "docker ps" },
        { signal: new AbortController().signal, toolUseID: "orphan", requestId: "r" },
      );
      expect(r).toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("Refusé par john-studio : appel non routé par la garde"),
      });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    expect(events.find((e) => e.kind === "error")).toMatchObject({
      code: "guard.unrouted",
      params: { tool: "Bash", toolUseId: "orphan" },
    });
  });

  it("fusionne les hooks de l'appelant après la garde", async () => {
    const mine = async () => ({});
    const { options } = await capture({
      hooks: { PreToolUse: [{ hooks: [mine] }], PostToolUse: [{ hooks: [mine] }] },
    });
    expect(options.hooks?.PreToolUse).toHaveLength(2);
    expect(options.hooks?.PreToolUse?.[1]?.hooks[0]).toBe(mine);
    expect(options.hooks?.PostToolUse).toHaveLength(1);
  });
});

// Messages `system` et autres, réduits aux champs lus par le moteur.
const system = (subtype: string, fields: Record<string, unknown>) =>
  ({
    type: "system",
    subtype,
    session_id: "sess-1",
    uuid: "u",
    ...fields,
  }) as unknown as SDKMessage;
const startedTask = (taskId: string, toolUseId: string) =>
  system("task_started", { task_id: taskId, tool_use_id: toolUseId, description: "inspecter" });

/** Lance un run dont le faux SDK diffuse `messages` tels quels. */
async function replay(messages: SDKMessage[]) {
  const { recorder, events, gate } = setup();
  const query: QueryFn = async function* () {
    for (const m of messages) yield m;
    yield result({});
  };
  const summary = await runAgent({ prompt: "x", recorder, gate, query });
  return { events, summary };
}

describe("événements du SDK", () => {
  it("traduit system/init en session.started", async () => {
    const { events } = await replay([
      system("init", { model: "m-test", tools: ["Read", "Glob"], cwd: "/w" }),
    ]);
    expect(events[1]).toMatchObject({
      kind: "session.started",
      sessionId: "sess-1",
      model: "m-test",
      tools: ["Read", "Glob"],
      parentId: events[0]?.id,
    });
  });

  it("traduit system/api_retry en api.retry", async () => {
    const { events } = await replay([
      system("api_retry", {
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 1500,
        error_status: 529,
        error: "overloaded",
      }),
      system("api_retry", {
        attempt: 1,
        max_retries: 5,
        retry_delay_ms: 10,
        error_status: null,
        error: "unknown",
      }),
    ]);
    const retries = events.filter((e) => e.kind === "api.retry");
    expect(retries[0]).toMatchObject({
      attempt: 2,
      maxRetries: 5,
      delayMs: 1500,
      errorStatus: 529,
      error: "overloaded",
    });
    expect(retries[1]).toMatchObject({ errorStatus: null });
  });

  it("traduit system/permission_denied sous l'outil concerné", async () => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* () {
      yield toolUse("t1", "Write", { file_path: "x" });
      yield system("permission_denied", {
        tool_name: "Write",
        tool_use_id: "t1",
        decision_reason_type: "mode",
        message: "refusé",
      });
      yield system("permission_denied", {
        tool_name: "Edit",
        tool_use_id: "inconnu",
        message: "m",
      });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    const requested = events.find((e) => e.kind === "tool.requested");
    const denied = events.filter((e) => e.kind === "permission.denied");
    expect(denied[0]).toMatchObject({
      toolUseId: "t1",
      tool: "Write",
      reasonType: "mode",
      message: "refusé",
      parentId: requested?.id,
    });
    expect(denied[1]).not.toHaveProperty("reasonType");
    expect(denied[1]?.parentId).toBe(events[0]?.id);
  });

  it("traduit les quatre messages de tâche en task.updated", async () => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* () {
      yield toolUse("task1", "Task", { prompt: "p" });
      yield startedTask("k1", "task1");
      yield system("task_progress", {
        task_id: "k1",
        tool_use_id: "task1",
        description: "en cours",
        summary: "moitié",
        usage: { total_tokens: 100, tool_uses: 2, duration_ms: 50 },
      });
      yield system("task_updated", {
        task_id: "k1",
        patch: { status: "running", description: "encore", error: "oups" },
      });
      yield system("task_notification", {
        task_id: "k1",
        tool_use_id: "task1",
        status: "completed",
        summary: "fini",
        output_file: "/tmp/o",
        usage: { total_tokens: 200, tool_uses: 3, duration_ms: 90 },
      });
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    const task = events.find((e) => e.kind === "tool.requested");
    const updates = events.filter((e) => e.kind === "task.updated");
    expect(updates.map((e) => e.kind === "task.updated" && e.phase)).toEqual([
      "started",
      "progress",
      "updated",
      "finished",
    ]);
    expect(updates[0]).toMatchObject({
      taskId: "k1",
      toolUseId: "task1",
      description: "inspecter",
    });
    expect(updates[1]).toMatchObject({
      summary: "moitié",
      usage: { totalTokens: 100, toolUses: 2, durationMs: 50 },
    });
    // task_updated n'a pas de tool_use_id : retrouvé via task_started.
    expect(updates[2]).toMatchObject({
      toolUseId: "task1",
      status: "running",
      description: "encore",
      summary: "oups",
    });
    expect(updates[3]).toMatchObject({
      status: "completed",
      summary: "fini",
      usage: { totalTokens: 200, toolUses: 3, durationMs: 90 },
    });
    expect(updates.every((e) => e.parentId === task?.id)).toBe(true);
  });

  it("rattache une tâche inconnue à la racine", async () => {
    const { events } = await replay([startedTask("k9", "ghost")]);
    expect(events.find((e) => e.kind === "task.updated")?.parentId).toBe(events[0]?.id);
  });

  it("traduit rate_limit_event en rate.limited", async () => {
    const { events } = await replay([
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          resetsAt: 1_900_000_000,
          rateLimitType: "five_hour",
          utilization: 0.92,
        },
      } as unknown as SDKMessage,
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } } as unknown as SDKMessage,
    ]);
    const limits = events.filter((e) => e.kind === "rate.limited");
    expect(limits[0]).toMatchObject({
      status: "allowed_warning",
      resetsAt: 1_900_000_000,
      limitType: "five_hour",
      utilization: 0.92,
    });
    expect(limits[1]).not.toHaveProperty("utilization");
  });

  it("traduit les blocs thinking et redacted_thinking en agent.thinking", async () => {
    const { events } = await replay([
      assistant([
        { type: "thinking", thinking: "Je dois lister les conteneurs.", signature: "sig" },
        { type: "thinking", thinking: "  ", signature: "sig" },
        { type: "redacted_thinking", data: "chiffré" },
        { type: "text", text: "Voici." },
      ]),
    ]);
    const thoughts = events.filter((e) => e.kind === "agent.thinking");
    expect(thoughts).toHaveLength(2);
    expect(thoughts[0]).toMatchObject({ text: "Je dois lister les conteneurs.", redacted: false });
    expect(thoughts[1]).toMatchObject({ text: "", redacted: true });
    expect(JSON.stringify(events)).not.toContain("chiffré");
  });

  it("compte les messages non gérés sans émettre d'événement", async () => {
    const { events, summary } = await replay([
      system("status", { status: "compacting" }),
      system("status", { status: "x" }),
      system("compact_boundary", {}),
      { type: "stream_event", event: {} } as unknown as SDKMessage,
    ]);
    expect(summary.unhandledMessages).toEqual({
      "system/status": 2,
      "system/compact_boundary": 1,
      stream_event: 1,
    });
    expect(events.map((e) => e.kind)).toEqual(["run.started", "run.finished"]);
    expect(events.at(-1)).toMatchObject({
      kind: "run.finished",
      unhandledMessages: { "system/status": 2, "system/compact_boundary": 1, stream_event: 1 },
    });
  });

  it("n'ajoute rien à unhandledMessages pour les messages gérés", async () => {
    const { summary } = await replay([
      system("init", { model: "m", tools: [] }),
      assistant([{ type: "text", text: "ok" }]),
    ]);
    expect(summary.unhandledMessages).toEqual({});
  });
});

describe("tool.result : sortie complète", () => {
  const withResult = async (content: unknown, maxResultBytes?: number) => {
    const { recorder, events, gate } = setup();
    const query: QueryFn = async function* () {
      yield toolUse("t1", "Read", { file_path: "a" });
      yield user([{ type: "tool_result", tool_use_id: "t1", is_error: false, content }]);
      yield result({});
    };
    await runAgent({
      prompt: "x",
      recorder,
      gate,
      query,
      ...(maxResultBytes !== undefined && { maxResultBytes }),
    });
    return events.find((e) => e.kind === "tool.result");
  };

  it("conserve le texte complet (blocs texte joints par un saut de ligne)", async () => {
    const e = await withResult([
      { type: "text", text: "ligne 1\n  ligne 2" },
      { type: "image", source: {} },
      { type: "text", text: "fin" },
    ]);
    expect(e).toMatchObject({
      output: "ligne 1\n  ligne 2\nfin",
      truncated: false,
      bytes: Buffer.byteLength("ligne 1\n  ligne 2\nfin"),
    });
  });

  it("plafonne à maxResultBytes avec truncated et la taille d'origine", async () => {
    const e = await withResult("é".repeat(100), 51);
    expect(e).toMatchObject({ truncated: true, bytes: 200 });
    expect(e?.kind === "tool.result" && Buffer.byteLength(e.output)).toBe(50);
  });

  it("plafonne par défaut à 64 Kio", async () => {
    const e = await withResult("z".repeat(100_000));
    expect(e).toMatchObject({ truncated: true, bytes: 100_000 });
    expect(e?.kind === "tool.result" && e.output.length).toBe(64 * 1024);
  });

  it("masque les secrets de la sortie via le recorder", async () => {
    const e = await withResult("TOKEN=abcdef1234567890 et sk-ant-abcdefgh12345678");
    expect(JSON.stringify(e)).not.toContain("abcdef1234567890");
    expect(JSON.stringify(e)).not.toContain("abcdefgh12345678");
  });
});

describe("corrélation MCP", () => {
  const callWith = async (
    meta: Record<string, unknown> | undefined,
    plan: { approve: [string, Record<string, unknown>][]; call: Record<string, unknown> },
  ) => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = guarded(options);
      for (const [id, args] of plan.approve) {
        yield toolUse(id, "mcp__docker__ps", args);
        await canUseTool("mcp__docker__ps", args, permit(id));
      }
      await callMcpTool(
        options.mcpServers?.docker as McpSdkServerConfigWithInstance,
        "ps",
        plan.call,
        meta,
      );
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });
    const started = events.find((e) => e.kind === "process.started");
    const parent = events.find((e) => e.id === started?.parentId);
    return { started, parent, events };
  };

  it("exacte : l'id de _meta l'emporte sur l'inférence par arguments", async () => {
    // Les arguments de l'appel correspondent à « b », mais _meta désigne « a ».
    const { started, parent } = await callWith(
      { "claudecode/toolUseId": "a" },
      {
        approve: [
          ["a", {}],
          ["b", { all: true }],
        ],
        call: { all: true },
      },
    );
    expect(parent).toMatchObject({ kind: "tool.requested", toolUseId: "a" });
    expect(started).toMatchObject({ correlation: "exact" });
  });

  it("exacte : accepte toute clé contenant toolUseId", async () => {
    const { started, parent } = await callWith(
      { "x/toolUseId": "b" },
      {
        approve: [
          ["a", {}],
          ["b", {}],
        ],
        call: {},
      },
    );
    expect(parent).toMatchObject({ toolUseId: "b" });
    expect(started).toMatchObject({ correlation: "exact" });
  });

  it("inférée : sans _meta, repli sur la FIFO du registre", async () => {
    const { started, parent } = await callWith(undefined, {
      approve: [
        ["a", {}],
        ["b", { all: true }],
      ],
      call: { all: true },
    });
    expect(parent).toMatchObject({ toolUseId: "b" });
    expect(started).toMatchObject({ correlation: "inferred" });
  });

  it("inférée : un _meta sans identifiant ou inconnu ne casse pas le repli", async () => {
    for (const meta of [{ progressToken: 3 }, { "claudecode/toolUseId": "inconnu" }]) {
      const { started, parent } = await callWith(meta, { approve: [["a", {}]], call: {} });
      expect(parent).toMatchObject({ toolUseId: "a" });
      expect(started).toMatchObject({ correlation: "inferred" });
    }
  });

  it("aucune : appel sans approbation préalable, rattaché à la racine", async () => {
    const { started, parent, events } = await callWith(undefined, { approve: [], call: {} });
    expect(parent).toBe(events[0]);
    expect(started).toMatchObject({ correlation: "none" });
  });

  it("l'appariement exact consomme l'entrée : un appel suivant ne la réutilise pas", async () => {
    const { recorder, events, gate } = setup();
    const fake = await fakeDocker();
    const query: QueryFn = async function* ({ options }) {
      const canUseTool = guarded(options);
      const server = options.mcpServers?.docker as McpSdkServerConfigWithInstance;
      yield toolUse("a", "mcp__docker__ps", {});
      await canUseTool("mcp__docker__ps", {}, permit("a"));
      await callMcpTool(server, "ps", {}, { "claudecode/toolUseId": "a" });
      await callMcpTool(server, "ps", {});
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query, docker: fake.bin });
    const starts = events.filter((e) => e.kind === "process.started");
    expect(starts.map((e) => e.kind === "process.started" && e.correlation)).toEqual([
      "exact",
      "none",
    ]);
  });
});

describe("sous-agents : hook devançant le message assistant", () => {
  const hookInput = (toolUseId: string, tool: string, input: object, agentId?: string) =>
    ({
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
      tool_use_id: toolUseId,
      ...(agentId && { agent_id: agentId }),
    }) as HookInput;

  const allowAll: Policy = { default: "allow", rules: [] };
  const setupAllow = () => {
    const recorder = createRecorder({ runId: "run-1" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    return { recorder, events, gate: createApprovalGate({ policy: allowAll, recorder }) };
  };

  const run = async (messages: (SDKMessage | { hook: HookInput })[]) => {
    const { recorder, events, gate } = setupAllow();
    const query: QueryFn = async function* ({ options }) {
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      for (const step of messages) {
        if ("hook" in step) {
          await hook?.(step.hook, (step.hook as { tool_use_id: string }).tool_use_id, {
            signal: new AbortController().signal,
          });
        } else {
          yield step;
        }
      }
      yield result({});
    };
    await runAgent({ prompt: "x", recorder, gate, query });
    return events;
  };

  it("rattache à l'outil Task via agent_id et task_started", async () => {
    const events = await run([
      toolUse("task1", "Task", {}),
      startedTask("agent-7", "task1"),
      { hook: hookInput("s1", "Bash", { command: "docker ps" }, "agent-7") },
      sub(toolUse("s1", "Bash", { command: "docker ps" }), "task1"),
    ]);
    const task = events.find((e) => e.kind === "tool.requested" && e.toolUseId === "task1");
    const bash = events.filter((e) => e.kind === "tool.requested" && e.toolUseId === "s1");
    expect(bash).toHaveLength(1); // le message assistant tardif ne crée pas de doublon
    expect(bash[0]).toMatchObject({
      parentId: task?.id,
      agentToolUseId: "task1",
      agentId: "agent-7",
    });
    expect(events.find((e) => e.kind === "approval.decided")?.parentId).toBe(bash[0]?.id);
  });

  it("retombe sur la racine (en gardant agentId) si task_started n'est pas encore arrivé", async () => {
    const events = await run([
      toolUse("task1", "Task", {}),
      { hook: hookInput("s1", "Bash", { command: "docker ps" }, "agent-7") },
      startedTask("agent-7", "task1"),
    ]);
    const bash = events.find((e) => e.kind === "tool.requested" && e.toolUseId === "s1");
    expect(bash?.parentId).toBe(events[0]?.id);
    expect(bash).toMatchObject({ agentId: "agent-7" });
    expect(bash).not.toHaveProperty("agentToolUseId");
  });

  it("n'ajoute pas agentId pour l'agent principal", async () => {
    const events = await run([{ hook: hookInput("m1", "Read", { file_path: "a" }) }]);
    expect(events.find((e) => e.kind === "tool.requested")).not.toHaveProperty("agentId");
  });
});
