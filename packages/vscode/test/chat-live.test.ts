import { type EngineEvent, EXEGOL_EXEC_TOOL } from "@warband/core";
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
