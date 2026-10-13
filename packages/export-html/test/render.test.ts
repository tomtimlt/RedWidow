import { buildGraph, createRecorder, EVENT_KINDS } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { escapeHtml, KIND_CLASS, renderGraphHtml } from "../src/index.js";

describe("renderGraphHtml", () => {
  const events = (() => {
    const r = createRecorder({ runId: "r" });
    const out = [] as ReturnType<typeof r.emit>[];
    r.subscribe((e) => out.push(e));
    const root = r.emit({ kind: "run.started", prompt: "<script>alert(1)</script>", cwd: "/" });
    const p = r.emit({ kind: "process.started", argv: ["docker", "ps"], pid: 1 }, root.id);
    r.emit({ kind: "process.output", stream: "stdout", line: "x".repeat(10) }, p.id);
    r.emit({ kind: "process.exited", code: 1, signal: null, durationMs: 3 }, p.id);
    return out;
  })();

  it("échappe tout le contenu utilisateur", () => {
    const html = renderGraphHtml(buildGraph(events));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("dessine un nœud par événement non agrégé et une arête par lien", () => {
    const graph = buildGraph(events);
    expect(graph.nodes).toHaveLength(3); // process.output agrégé
    expect(graph.nodes[1]?.output).toEqual({ stdout: 1, stderr: 0, tail: ["xxxxxxxxxx"] });
    const html = renderGraphHtml(graph);
    expect(html.match(/<g class="node/g)).toHaveLength(3);
    expect(html.match(/class="edge"/g)).toHaveLength(2);
    expect(html).toContain("s-error");
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("gère un graphe vide", () => {
    expect(renderGraphHtml({ runId: null, runs: [], nodes: [], edges: [] })).toContain("<svg");
  });

  it("associe une classe à chaque kind d'événement", () => {
    expect(Object.keys(KIND_CLASS).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it("indique le run affiché quand le journal en contient plusieurs", () => {
    const other = (() => {
      const r = createRecorder({ runId: "autre" });
      const out = [] as ReturnType<typeof r.emit>[];
      r.subscribe((e) => out.push(e));
      r.emit({ kind: "run.started", prompt: "second", cwd: "/" });
      return out;
    })();
    const html = renderGraphHtml(buildGraph([...events, ...other], { runId: "r" }));
    expect(html).toContain("run 1 sur 2");
    expect(html).toContain("<b>r</b>");
    expect(renderGraphHtml(buildGraph(events))).not.toContain('class="runs"');
  });

  it("résume tool.result et rend les nouveaux kinds sans erreur", () => {
    const r = createRecorder({ runId: "n" });
    const out = [] as ReturnType<typeof r.emit>[];
    r.subscribe((e) => out.push(e));
    r.emit({ kind: "session.started", sessionId: "s", model: "m", tools: [] });
    r.emit({
      kind: "tool.result",
      toolUseId: "t",
      isError: true,
      output: `<b>${"y".repeat(500)}</b>`,
      truncated: true,
      bytes: 9999,
    });
    r.emit({ kind: "rate.limited", status: "rejected" });
    const html = renderGraphHtml(buildGraph(out));
    expect(html).toContain("k-warn");
    expect(html).not.toContain("<b>y");
    expect(html).toContain("&lt;b&gt;yyy");
    expect(html).not.toContain("y".repeat(200));
  });
});
