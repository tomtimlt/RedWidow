import type { CanUseTool, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type QueryFn,
  runAgent,
} from "../src/index.js";

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
