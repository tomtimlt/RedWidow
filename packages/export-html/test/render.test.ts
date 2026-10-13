import { buildGraph, createRecorder } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderGraphHtml } from "../src/index.js";

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
    expect(renderGraphHtml({ runId: null, nodes: [], edges: [] })).toContain("<svg");
  });
});
