import { buildGraph, createRecorder, EVENT_KINDS } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { escapeHtml, KIND_CLASS, MAX_RENDERED_NODES, renderGraphHtml } from "../src/index.js";

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
    // Journal non fiable : séquences de contrôle et bidi retirées.
    expect(escapeHtml("a\x1b[2Kb\u202ec\r")).toBe("abc");
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

  it("libelle les nœuds depuis l'événement source, en échappant le texte", () => {
    const r = createRecorder({ runId: "r2" });
    const out = [] as ReturnType<typeof r.emit>[];
    r.subscribe((e) => out.push(e));
    const root = r.emit({ kind: "run.started", prompt: "p", cwd: "/" });
    r.emit(
      {
        kind: "approval.decided",
        toolUseId: "t",
        decision: "deny",
        source: "policy",
        reason: { code: "path.sensitive", params: { path: "<b>~/.ssh</b>" } },
      },
      root.id,
    );
    const html = renderGraphHtml(buildGraph(out));
    expect(html).toContain("deny (policy) : chemin sensible : &lt;b&gt;~/.ssh&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(renderGraphHtml(buildGraph(out), { locale: "en" })).toContain(
      "deny (policy) : sensitive path:",
    );
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
      output: `<b>${"y".repeat(10000)}</b>`,
      truncated: true,
      bytes: 9999,
    });
    r.emit({ kind: "rate.limited", status: "rejected" });
    const html = renderGraphHtml(buildGraph(out));
    expect(html).toContain("k-warn");
    expect(html).not.toContain("<b>y");
    expect(html).toContain("&lt;b&gt;yyy");
    // texte affiché tronqué à 80 caractères ; infobulle bornée (pas les 10 000 caractères)
    expect(html).not.toContain("y".repeat(5000));
  });

  const emitAll = (runId: string, fill: (r: ReturnType<typeof createRecorder>) => void) => {
    const r = createRecorder({ runId });
    const out = [] as ReturnType<typeof r.emit>[];
    r.subscribe((e) => out.push(e));
    fill(r);
    return out;
  };
  const heightOf = (html: string) => Number(html.match(/<svg[^>]* height="(\d+)"/)?.[1]);

  it("regroupe 10 000 process.output d'un processus en un seul nœud", () => {
    const small = renderGraphHtml(buildGraph(events));
    const big = emitAll("g", (r) => {
      const root = r.emit({ kind: "run.started", prompt: "p", cwd: "/" });
      const p = r.emit({ kind: "process.started", argv: ["yes"], pid: 1 }, root.id);
      for (let i = 0; i < 10000; i++) {
        r.emit(
          { kind: "process.output", stream: i % 2 ? "stderr" : "stdout", line: `l${i}` },
          p.id,
        );
      }
      r.emit({ kind: "process.exited", code: 0, signal: null, durationMs: 1 }, p.id);
    });
    const html = renderGraphHtml(buildGraph(big));
    expect(html.match(/10000 lignes/g)).toHaveLength(2); // texte + infobulle
    expect(html.match(/<g class="node/g)).toHaveLength(3);
    expect(heightOf(html)).toBe(heightOf(small));
    expect(html).toContain("stdout 5000 · stderr 5000");
    expect(html).toContain("l9999");
  });

  it("regroupe les process.output dont le parent est absent du graphe", () => {
    const out = emitAll("o", (r) => {
      const root = r.emit({ kind: "run.started", prompt: "p", cwd: "/" });
      for (let i = 0; i < 50; i++) {
        r.emit({ kind: "process.output", stream: "stdout", line: `x${i}` }, root.id);
      }
    });
    const graph = buildGraph(out);
    expect(graph.nodes).toHaveLength(51);
    const html = renderGraphHtml(graph);
    expect(html.match(/<g class="node/g)).toHaveLength(2);
    expect(html.match(/class="edge"/g)).toHaveLength(1);
    expect(html).toContain("50 lignes");
  });

  it("plafonne l'affichage et signale les événements masqués", () => {
    const big = emitAll("c", (r) => {
      const root = r.emit({ kind: "run.started", prompt: "p", cwd: "/" });
      for (let i = 0; i < 6000; i++) r.emit({ kind: "agent.text", text: `t${i}` }, root.id);
    });
    const graph = buildGraph(big);
    expect(MAX_RENDERED_NODES).toBe(5000);
    const html = renderGraphHtml(graph);
    expect(html.match(/<g class="node/g)).toHaveLength(5000);
    expect(html.match(/class="edge"/g)).toHaveLength(4999);
    expect(html).toContain("1001 événements non affichés");
    expect(html).not.toContain(">t5000<");
    expect(html).toContain(">t4998<");
    const custom = renderGraphHtml(graph, { maxNodes: 10 });
    expect(custom.match(/<g class="node/g)).toHaveLength(10);
    expect(custom).toContain("5991 événements non affichés");
    expect(renderGraphHtml(graph, { maxNodes: 6001 })).not.toContain("non affiché");
    expect(heightOf(custom)).toBe(20 * 2 + 9 * 44 + 30 + 44);
  });

  it("met le libellé complet en infobulle et le tronque dans le texte", () => {
    const long = `${"a".repeat(100)}FIN`;
    const out = emitAll("t", (r) => {
      const root = r.emit({ kind: "run.started", prompt: "p", cwd: "/" });
      r.emit({ kind: "agent.text", text: long }, root.id);
    });
    const html = renderGraphHtml(buildGraph(out));
    expect(html).toContain(`<title>#1 agent.text\n${out[1]?.ts}\n${long}</title>`);
    expect(html).toContain(`<text x="8" y="19" clip-path="url(#c)">${"a".repeat(79)}…</text>`);
  });
});
