import { type EngineEvent, EXEGOL_EXEC_TOOL, KALI_TOOL_PREFIX } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";

const ev = (payload: Record<string, unknown>): EngineEvent =>
  ({
    v: 1,
    id: "e",
    seq: 1,
    ts: "2026-10-16T00:00:00.000Z",
    runId: "r",
    parentId: null,
    ...payload,
  }) as EngineEvent;

describe("sortie d'exec en direct", () => {
  it("ajoute les lignes du processus tant que l'appel est en cours", () => {
    const state = createChatState();
    state.event(
      ev({
        id: "req",
        kind: "tool.requested",
        toolUseId: "scan",
        tool: EXEGOL_EXEC_TOOL,
        input: { container: "htb1", argv: ["nmap", "-sV", "10.10.10.1"] },
      }),
    );
    state.event(
      ev({
        id: "proc",
        parentId: "req",
        kind: "process.started",
        argv: ["docker", "exec", "exegol-htb1", "nmap"],
        pid: 1,
      }),
    );
    state.event(
      ev({
        id: "out",
        parentId: "proc",
        kind: "process.output",
        stream: "stdout",
        line: "Starting Nmap",
      }),
    );
    state.event(
      ev({
        id: "out2",
        parentId: "proc",
        kind: "process.output",
        stream: "stdout",
        line: "80/tcp open",
      }),
    );
    const tool = state.view().items.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({
      status: "pending",
      output: "Starting Nmap\n80/tcp open",
    });
  });

  it("ajoute aussi la sortie d'un outil Kali", () => {
    const state = createChatState();
    state.event(
      ev({
        id: "req",
        kind: "tool.requested",
        toolUseId: "scan",
        tool: `${KALI_TOOL_PREFIX}nmap_scan`,
        input: { container: "kali-box", target: "10.0.0.1" },
      }),
    );
    state.event(
      ev({
        id: "proc",
        parentId: "req",
        kind: "process.started",
        argv: ["docker", "exec"],
        pid: 1,
      }),
    );
    state.event(
      ev({ id: "out", parentId: "proc", kind: "process.output", stream: "stdout", line: "open" }),
    );
    const tool = state.view().items.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({ status: "pending", output: "open" });
  });

  it("ignore la sortie d'un processus qui n'est pas un exec Exegol", () => {
    const state = createChatState();
    state.event(
      ev({
        id: "req",
        kind: "tool.requested",
        toolUseId: "read",
        tool: "Read",
        input: { file_path: "a" },
      }),
    );
    state.event(
      ev({ id: "proc", parentId: "req", kind: "process.started", argv: ["docker"], pid: 1 }),
    );
    state.event(
      ev({ id: "out", parentId: "proc", kind: "process.output", stream: "stdout", line: "secret" }),
    );
    const tool = state.view().items.find((item) => item.kind === "tool");
    expect(tool?.kind === "tool" ? tool.output : "nope").toBeUndefined();
  });
});

it("affiche l'attente fournisseur puis l'efface quand la réponse reprend", () => {
  const state = createChatState();
  state.setBusy(true);
  state.event(
    ev({
      kind: "api.retry",
      attempt: 2,
      maxRetries: 0,
      delayMs: 5000,
      errorStatus: 429,
      error: "oc_sk_test-secret",
    }),
  );
  expect(state.view().retry).toEqual({ attempt: 2, delayMs: 5000 });
  expect(JSON.stringify(state.view())).not.toContain("oc_sk_test-secret");
  expect(state.view().items.at(-1)).toMatchObject({
    kind: "notice",
    text: expect.stringContaining("5 s"),
  });
  state.event(ev({ kind: "agent.text", text: "Bonjour" }));
  expect(state.view().retry).toBeUndefined();
  state.event(
    ev({
      kind: "api.retry",
      attempt: 3,
      maxRetries: 0,
      delayMs: 5000,
      errorStatus: null,
      error: "surcharge",
    }),
  );
  state.event(ev({ kind: "run.finished", status: "error", turns: 0, costUsd: 0, result: null }));
  expect(state.view().retry).toBeUndefined();
  expect(state.view().busy).toBe(false);
});
