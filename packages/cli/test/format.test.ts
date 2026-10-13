import { createRecorder, type EngineEvent, type EventPayload } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { formatEvent, formatRunList, summarizeOutput } from "../src/format.js";

describe("formatEvent", () => {
  const r = createRecorder({ runId: "r" });
  const opts = { color: false, verbose: false };

  it("rend une ligne par événement", () => {
    const e = r.emit({
      kind: "tool.requested",
      toolUseId: "t",
      tool: "Bash",
      input: { command: "docker ps" },
    });
    expect(formatEvent(e, opts)).toBe("tool      Bash docker ps");
  });

  it("indente les outils demandés par un sous-agent", () => {
    const e = r.emit({
      kind: "tool.requested",
      toolUseId: "s",
      tool: "mcp__docker__ps",
      input: { all: true },
      agentToolUseId: "task1",
    });
    expect(formatEvent(e, opts)).toBe('tool      ↳ mcp__docker__ps {"all":true}');
  });

  it("masque la sortie des processus sauf en verbose", () => {
    const e = r.emit({ kind: "process.output", stream: "stdout", line: "hello" });
    expect(formatEvent(e, opts)).toBeNull();
    expect(formatEvent(e, { ...opts, verbose: true })).toBe("stdout    hello");
  });

  it("colore seulement si demandé", () => {
    const e = r.emit({ kind: "error", message: "boom" });
    expect(formatEvent(e, opts)).not.toContain("\x1b[");
    expect(formatEvent(e, { ...opts, color: true })).toContain("\x1b[31m");
  });

  it("résume tool.result sur une ligne côté CLI et signale la troncature", () => {
    const long = `première\n  ligne ${"x".repeat(300)}`;
    const e = r.emit({
      kind: "tool.result",
      toolUseId: "t",
      isError: false,
      output: long,
      truncated: true,
      bytes: 70_000,
    });
    const line = formatEvent(e, opts) as string;
    expect(line).not.toContain("\n");
    expect(line).toContain("première ligne xxx");
    expect(line).toContain("…");
    expect(line).toContain("[tronqué : 70000 octets]");
  });

  it("summarizeOutput aplatit les blancs et coupe", () => {
    expect(summarizeOutput("a\n\n  b")).toBe("a b");
    expect(summarizeOutput("abcdef", 4)).toBe("abc…");
  });

  it("signale lignes coupées et lignes non journalisées", () => {
    const out = r.emit({ kind: "process.output", stream: "stdout", line: "abc", truncated: true });
    expect(formatEvent(out, { ...opts, verbose: true })).toBe("stdout    abc […]");
    const exit = r.emit({
      kind: "process.exited",
      code: 0,
      signal: null,
      durationMs: 4,
      droppedLines: 12,
    });
    expect(formatEvent(exit, opts)).toContain("12 lignes non journalisées");
  });

  it("rend chaque nouveau kind sur une ligne non vide", () => {
    const payloads: EventPayload[] = [
      { kind: "session.started", sessionId: "s", model: "m", tools: ["Read"] },
      { kind: "agent.thinking", text: "hmm", redacted: false },
      { kind: "agent.thinking", text: "", redacted: true },
      { kind: "permission.denied", toolUseId: "t", tool: "Write", message: "non" },
      {
        kind: "api.retry",
        attempt: 1,
        maxRetries: 3,
        delayMs: 5,
        errorStatus: 529,
        error: "overloaded",
      },
      { kind: "task.updated", taskId: "k", phase: "finished", status: "completed", summary: "ok" },
      { kind: "rate.limited", status: "rejected", limitType: "five_hour", utilization: 1 },
      { kind: "sink.error", message: "disque plein" },
      { kind: "journal.truncated", limitBytes: 10, droppedEvents: 3 },
      {
        kind: "run.finished",
        status: "success",
        turns: 1,
        costUsd: 0,
        result: null,
        unhandledMessages: { a: 2 },
      },
    ];
    for (const p of payloads) {
      const line = formatEvent(r.emit(p), opts);
      expect(line, p.kind).toBeTruthy();
      expect(line).not.toContain("\n");
    }
    expect(formatEvent(r.emit(payloads[3] as EventPayload), opts)).toContain("sdk-deny");
    expect(formatEvent(r.emit(payloads[9] as EventPayload), opts)).toContain(
      "2 messages non traduits",
    );
  });
});

describe("formatRunList", () => {
  it("liste un run par ligne avec son statut", () => {
    const mk = (runId: string, prompt: string, done: boolean) => {
      const rec = createRecorder({ runId });
      const out: EngineEvent[] = [];
      rec.subscribe((e) => out.push(e));
      rec.emit({ kind: "run.started", prompt, cwd: "/" });
      if (done)
        rec.emit({ kind: "run.finished", status: "success", turns: 1, costUsd: 0, result: null });
      return out;
    };
    const lines = formatRunList(
      new Map([
        ["A", mk("A", "premier", true)],
        ["B", mk("B", "second", false)],
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^A\t.*\tsuccess\t2 événements\tpremier$/);
    expect(lines[1]).toMatch(/^B\t.*\tincomplet\t1 événements\tsecond$/);
  });
});
