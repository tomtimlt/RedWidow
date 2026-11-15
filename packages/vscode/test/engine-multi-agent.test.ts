import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunner,
  CAMPAIGN_PLANNER_GUIDANCE,
  CAMPAIGN_WORKER_GUIDANCE,
  campaignToolSpecs,
} from "@warband/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import type { FromEngine } from "../src/logic/protocol.js";

/** Canal factice : le test joue le rôle du parent. */
function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(m),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: () => {},
  };
  return { channel, sent, receive: (raw: unknown) => onMessage(raw) };
}

const idleRunner: AgentRunner = {
  run: async ({ prompt }) => {
    for await (const _ of prompt as AsyncIterable<unknown>) {
      // consignes ignorées
    }
    return { status: "success", turns: 0, costUsd: 0, result: null };
  },
};

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "warband-engine-ma-"));
});
afterAll(() => rm(cwd, { recursive: true, force: true }));

const codes = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "error" ? [m.reason.code] : []));

type Ctx = Parameters<AgentRunner["run"]>[1];
type Input = Parameters<AgentRunner["run"]>[0];

/** Lance un moteur dont le runner publie son contexte, puis attend `dispose`. */
function launch(start: Record<string, unknown> = {}) {
  const t = fakeChannel();
  const seen: { ctx?: Ctx; input?: Input } = {};
  const runner: AgentRunner = {
    run: async (input, ctx) => {
      seen.ctx = ctx;
      seen.input = input;
      return idleRunner.run(input, ctx);
    },
  };
  const done = runEngine({ channel: t.channel, createRunner: () => runner });
  t.receive({ v: 1, type: "start", cwd, ...start });
  return { t, seen, done };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const worker = { role: "worker", intent: { id: "i1", title: "Titre", rationale: "Pourquoi" } };

describe("moteur : mode multi-agents (ADR 0054, lot 3a)", () => {
  it("sans multiAgent : aucun outil de campagne, aucune consigne de rôle", async () => {
    const { t, seen, done } = launch();
    await settle();
    t.receive({ v: 1, type: "dispose" });
    await done;
    expect(seen.ctx?.multiAgent).toBeUndefined();
    expect(campaignToolSpecs(seen.ctx?.multiAgent)).toEqual([]);
    expect(seen.input?.systemPrompt).not.toContain(CAMPAIGN_PLANNER_GUIDANCE);
    expect(seen.input?.systemPrompt).not.toContain(CAMPAIGN_WORKER_GUIDANCE);
    expect(codes(t.sent)).toEqual([]);
  });

  it("worker : port IPC, outil campaign_close_intent et consigne de worker seulement", async () => {
    const { t, seen, done } = launch({ multiAgent: { ...worker, runId: "run-w1" } });
    await settle();
    expect(t.sent.find((m) => m.type === "started")).toMatchObject({ runId: "run-w1" });
    expect(seen.ctx?.multiAgent?.role).toBe("worker");
    expect(campaignToolSpecs(seen.ctx?.multiAgent).map((s) => s.name)).toEqual([
      "campaign_close_intent",
    ]);
    expect(seen.input?.systemPrompt).toContain(CAMPAIGN_WORKER_GUIDANCE);
    expect(seen.input?.systemPrompt).not.toContain(CAMPAIGN_PLANNER_GUIDANCE);
    // Requête vers l'hôte, résolue par sa réponse.
    const pending = seen.ctx?.multiAgent?.port.status();
    await settle();
    const request = t.sent.find((m) => m.type === "campaign");
    expect(request).toMatchObject({ op: "status", args: {} });
    t.receive({
      v: 1,
      type: "campaignResult",
      id: (request as { id: string }).id,
      ok: true,
      value: { started: true },
    });
    await expect(pending).resolves.toEqual({ started: true });
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("planificateur : consigne de planificateur et outils d'ouverture", async () => {
    const { t, seen, done } = launch({ multiAgent: { role: "planner" } });
    await settle();
    expect(campaignToolSpecs(seen.ctx?.multiAgent).map((s) => s.name)).toEqual([
      "campaign_open_intent",
      "campaign_status",
    ]);
    expect(seen.input?.systemPrompt).toContain(CAMPAIGN_PLANNER_GUIDANCE);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("rejette un multiAgent incohérent ou en apprentissage", async () => {
    for (const bad of [
      { role: "worker" },
      { role: "planner", intent: worker.intent },
      { role: "boss" },
      { role: "planner", runId: "../evil" },
      { role: "planner", extra: 1 },
    ]) {
      const t = fakeChannel();
      const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
      t.receive({ v: 1, type: "start", cwd, multiAgent: bad });
      expect(codes(t.sent)).toEqual(["ipc.invalidMessage"]);
      t.receive({ v: 1, type: "dispose" });
      await done;
    }
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "start", cwd, mode: "learning", multiAgent: { role: "planner" } });
    expect(codes(t.sent)).toEqual(["ipc.invalidMessage"]);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("un campaignResult sans port abonné est sans effet ; mal formé, il est rejeté", async () => {
    const { t, done } = launch();
    await settle();
    t.receive({ v: 1, type: "campaignResult", id: "x", ok: true, value: 1 });
    t.receive({ v: 1, type: "campaignResult", id: "x", ok: true });
    expect(codes(t.sent)).toEqual(["ipc.invalidMessage"]);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });
});
