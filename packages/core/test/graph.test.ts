import { describe, expect, it } from "vitest";
import { buildGraph, createRecorder, type EngineEvent, splitRuns } from "../src/index.js";

function record(runId: string, prompt: string): EngineEvent[] {
  const r = createRecorder({ runId });
  const out: EngineEvent[] = [];
  r.subscribe((e) => out.push(e));
  const root = r.emit({ kind: "run.started", prompt, cwd: "/" });
  const req = r.emit(
    { kind: "tool.requested", toolUseId: "t", tool: "Bash", input: { command: "ls" } },
    root.id,
  );
  r.emit(
    {
      kind: "tool.result",
      toolUseId: "t",
      isError: false,
      output: "a b",
      truncated: false,
      bytes: 3,
    },
    req.id,
  );
  return out;
}

describe("splitRuns", () => {
  it("sépare par run, dans l'ordre d'apparition, et trie par seq dans chaque run", () => {
    const a = record("A", "un");
    const b = record("B", "deux");
    const mixed = [a[2], b[0], a[0], b[2], a[1], b[1]] as EngineEvent[];
    const runs = splitRuns(mixed);
    expect([...runs.keys()]).toEqual(["A", "B"]);
    expect(runs.get("A")?.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(runs.get("B")?.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(splitRuns([]).size).toBe(0);
  });
});

describe("buildGraph multi-runs", () => {
  const events = [...record("A", "un"), ...record("B", "deux")];

  it("prend le dernier run par défaut et expose tous les runs", () => {
    const g = buildGraph(events);
    expect(g.runId).toBe("B");
    expect(g.runs).toEqual(["A", "B"]);
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0]?.label).toContain("deux");
    expect(g.edges).toHaveLength(2);
  });

  it("filtre sur un runId donné, même quand les événements sont mélangés", () => {
    const shuffled = [...events].reverse();
    const g = buildGraph(shuffled, { runId: "A" });
    expect(g.runId).toBe("A");
    expect(g.nodes.map((n) => n.seq)).toEqual([0, 1, 2]);
    expect(g.nodes[0]?.label).toContain("un");
  });

  it("renvoie un graphe vide pour un run inconnu ou sans événement", () => {
    expect(buildGraph(events, { runId: "Z" })).toMatchObject({ runId: null, nodes: [] });
    expect(buildGraph([])).toEqual({ runId: null, runs: [], nodes: [], edges: [] });
  });

  it("étiquette les nouveaux kinds sans planter", () => {
    const r = createRecorder({ runId: "R" });
    const out: EngineEvent[] = [];
    r.subscribe((e) => out.push(e));
    r.emit({ kind: "session.started", sessionId: "s", model: "m", tools: [] });
    r.emit({ kind: "agent.thinking", text: "", redacted: true });
    r.emit({ kind: "permission.denied", toolUseId: "t", tool: "x", message: "non" });
    r.emit({
      kind: "api.retry",
      attempt: 1,
      maxRetries: 2,
      delayMs: 5,
      errorStatus: null,
      error: "e",
    });
    r.emit({ kind: "task.updated", taskId: "k", phase: "started", description: "d" });
    r.emit({ kind: "rate.limited", status: "rejected" });
    r.emit({ kind: "sink.error", message: "m" });
    r.emit({ kind: "journal.truncated", limitBytes: 1, droppedEvents: 2 });
    const g = buildGraph(out);
    expect(g.nodes).toHaveLength(8);
    expect(g.nodes.every((n) => n.label !== "")).toBe(true);
    expect(g.nodes.find((n) => n.kind === "permission.denied")?.status).toBe("denied");
  });
});
