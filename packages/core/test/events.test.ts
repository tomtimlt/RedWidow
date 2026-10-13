import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS,
  EVENT_SCHEMA_VERSION,
  EVENT_VALIDATORS,
  type EventKind,
  type EventPayload,
  isEventKind,
  parseJournal,
  validateEvent,
} from "../src/index.js";

/** Un exemplaire valide de chaque kind (le typage force l'exhaustivité). */
const SAMPLES: { [K in EventKind]: Extract<EventPayload, { kind: K }> } = {
  "run.started": { kind: "run.started", prompt: "p", cwd: "/" },
  "session.started": { kind: "session.started", sessionId: "s", model: "m", tools: ["Read"] },
  "agent.text": { kind: "agent.text", text: "t" },
  "agent.thinking": { kind: "agent.thinking", text: "hm", redacted: false },
  "tool.requested": {
    kind: "tool.requested",
    toolUseId: "t",
    tool: "Bash",
    input: { command: "ls" },
    agentToolUseId: "a",
    agentId: "ag",
  },
  "approval.decided": {
    kind: "approval.decided",
    toolUseId: "t",
    decision: "allow",
    source: "policy",
    reason: "r",
  },
  "permission.denied": { kind: "permission.denied", toolUseId: "t", tool: "x", message: "m" },
  "tool.result": {
    kind: "tool.result",
    toolUseId: "t",
    isError: false,
    output: "o",
    truncated: false,
    bytes: 1,
  },
  "process.started": { kind: "process.started", argv: ["a"], pid: null, correlation: "exact" },
  "process.output": { kind: "process.output", stream: "stdout", line: "l", truncated: true },
  "process.exited": {
    kind: "process.exited",
    code: null,
    signal: "SIGTERM",
    durationMs: 1,
    droppedLines: 3,
  },
  "api.retry": {
    kind: "api.retry",
    attempt: 1,
    maxRetries: 3,
    delayMs: 500,
    errorStatus: null,
    error: "overloaded",
  },
  "task.updated": {
    kind: "task.updated",
    taskId: "k",
    phase: "progress",
    usage: { totalTokens: 1, toolUses: 2, durationMs: 3 },
  },
  "rate.limited": { kind: "rate.limited", status: "allowed_warning", utilization: 0.9 },
  "run.finished": {
    kind: "run.finished",
    status: "success",
    turns: 1,
    costUsd: 0,
    result: null,
    unhandledMessages: { "system/status": 2 },
  },
  error: { kind: "error", message: "m" },
  "sink.error": { kind: "sink.error", message: "m" },
  "journal.truncated": { kind: "journal.truncated", limitBytes: 10, droppedEvents: 2 },
};

const meta = { v: 1, id: "i", seq: 0, ts: "2026-01-01T00:00:00.000Z", runId: "r", parentId: null };
const event = (payload: object, over: object = {}) => ({ ...meta, ...payload, ...over });

describe("schéma d'événements", () => {
  it("EVENT_KINDS découle des validateurs et couvre tous les kinds", () => {
    expect([...EVENT_KINDS].sort()).toEqual(Object.keys(EVENT_VALIDATORS).sort());
    expect([...EVENT_KINDS].sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(isEventKind("tool.result")).toBe(true);
    expect(isEventKind("toString")).toBe(false);
    expect(isEventKind(3)).toBe(false);
  });

  it.each(Object.entries(SAMPLES))("accepte une charge utile valide : %s", (_kind, payload) => {
    expect(validateEvent(event(payload))).toBeNull();
  });

  it("refuse une charge utile invalide, kind par kind", () => {
    const bad: [EventKind, Record<string, unknown>][] = [
      ["run.started", { cwd: 1 }],
      ["session.started", { tools: "Read" }],
      ["agent.text", { text: 1 }],
      ["agent.thinking", { redacted: "non" }],
      ["tool.requested", { input: [] }],
      ["approval.decided", { decision: "ask" }],
      ["permission.denied", { message: undefined }],
      ["tool.result", { output: undefined }],
      ["tool.result", { bytes: "12" }],
      ["process.started", { correlation: "magic" }],
      ["process.output", { stream: "stdin" }],
      ["process.exited", { durationMs: Number.NaN }],
      ["api.retry", { errorStatus: "500" }],
      ["task.updated", { phase: "done" }],
      ["task.updated", { usage: { totalTokens: "1" } }],
      ["rate.limited", { status: 1 }],
      ["run.finished", { unhandledMessages: { a: "x" } }],
      ["error", { message: null }],
      ["sink.error", { message: undefined }],
      ["journal.truncated", { limitBytes: "1" }],
    ];
    for (const [kind, patch] of bad) {
      const payload = { ...SAMPLES[kind], ...patch };
      expect(validateEvent(event(payload)), `${kind} ${JSON.stringify(patch)}`).not.toBeNull();
    }
  });

  it("nomme le champ fautif et refuse un kind inconnu ou des métadonnées absentes", () => {
    expect(validateEvent(event({ ...SAMPLES["tool.result"], output: undefined }))).toBe(
      "output manquant",
    );
    expect(validateEvent(event({ ...SAMPLES["tool.result"], bytes: "x" }))).toBe("bytes invalide");
    expect(validateEvent(event({ kind: "inconnu" }))).toMatch(/kind inconnu/);
    expect(validateEvent(null)).toBe("objet attendu");
    expect(validateEvent(event(SAMPLES.error, { runId: undefined }))).toBe("runId manquant");
  });

  it("accepte un v absent (= 1) et signale une version future", () => {
    const { v: _v, ...legacy } = event(SAMPLES.error);
    expect(validateEvent(legacy)).toBeNull();
    expect(validateEvent(event(SAMPLES.error, { v: 0 }))).toBe("v invalide");
    expect(validateEvent(event(SAMPLES.error, { v: "1" }))).toBe("v invalide");
    expect(validateEvent(event(SAMPLES.error, { v: EVENT_SCHEMA_VERSION + 1 }))).toMatch(
      /version de schéma 2 non prise en charge/,
    );
  });
});

describe("relecture du journal", () => {
  const line = (e: object) => JSON.stringify(e);

  it("valide la charge utile complète et normalise v", () => {
    const { v: _v, ...legacy } = event(SAMPLES["agent.text"]);
    const text = [
      line(legacy),
      line(event({ ...SAMPLES["tool.result"], bytes: "x" }, { id: "j", seq: 1 })),
      line(event(SAMPLES.error, { id: "k", seq: 2, v: 2 })),
    ].join("\n");
    const { events, issues } = parseJournal(text);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "agent.text", v: 1 });
    expect(issues).toEqual([
      { line: 2, error: "bytes invalide" },
      { line: 3, error: expect.stringContaining("version de schéma 2") },
    ]);
  });

  it("relit un ancien tool.result (summary) comme une sortie complète", () => {
    const legacy = event({ kind: "tool.result", toolUseId: "t", isError: false, summary: "héé" });
    const { events, issues } = parseJournal(line(legacy));
    expect(issues).toEqual([]);
    expect(events[0]).toMatchObject({ output: "héé", truncated: false, bytes: 5 });
    expect(events[0]).not.toHaveProperty("summary");
  });
});
