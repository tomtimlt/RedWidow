import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner } from "@john-studio/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import type { FromEngine } from "../src/logic/protocol.js";

/** Canal factice : le test joue le rôle du parent. */
function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(m),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: (h) => {
      onDisconnect = h;
    },
  };
  return {
    channel,
    sent,
    receive: (raw: unknown) => onMessage(raw),
    disconnect: () => onDisconnect(),
  };
}

const idleRunner: AgentRunner = {
  run: ({ prompt }) =>
    new Promise((resolve) => {
      // Se termine quand le flux de consignes est clos (dispose, abort ou déconnexion).
      void (async () => {
        for await (const _ of prompt as AsyncIterable<string>) {
          // consignes ignorées
        }
        resolve({ status: "success", turns: 0, costUsd: 0, result: null });
      })();
    }),
};

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "john-engine-"));
});
afterAll(() => rm(cwd, { recursive: true, force: true }));

const codes = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "error" ? [m.reason.code] : []));

describe("moteur : validation des messages reçus", () => {
  it("signale et ignore messages inconnus, mal formés ou d'une autre version", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "rm -rf" });
    t.receive({ v: 2, type: "abort" });
    t.receive("garbage");
    t.receive({ v: 1, type: "start", cwd: "relatif" });
    t.receive({ v: 1, type: "dispose", env: { ANTHROPIC_API_KEY: "x" } });
    expect(codes(t.sent)).toEqual([
      "ipc.invalidMessage",
      "ipc.unsupportedVersion",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
    ]);
    // Rien n'a démarré ni terminé : seul un dispose valide clôt le moteur.
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  });

  it("answer sur un toolUseId inconnu est sans effet et signalé ; prompt avant start refusé", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({
      v: 1,
      type: "answer",
      toolUseId: "inconnu",
      decision: "allow",
      remember: "always",
    });
    t.receive({ v: 1, type: "prompt", text: "trop tôt" });
    expect(codes(t.sent)).toEqual(["ipc.invalidMessage", "ipc.invalidMessage"]);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("un échec du runner (ex. binaire altéré) est signalé par un code et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: async () => {
        const { CodedError } = await import("@john-studio/core");
        throw new CodedError("extension.binaryMismatch");
      },
    });
    t.receive({ v: 1, type: "start", cwd });
    expect(await done).toBe(1);
    expect(t.sent.find((m) => m.type === "error")).toMatchObject({
      reason: { code: "extension.binaryMismatch" },
    });
    expect(t.sent.some((m) => m.type === "ended")).toBe(false);
  });

  it("une déconnexion annule le run et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    // Le run s'achève (flux de consignes clos) : le moteur rend la main sans attendre le délai de grâce.
    expect(await done).toBeTypeOf("number");
  });

  it("déconnexion sans réponse du run : arbre de processus tué à la fin du délai de grâce", async () => {
    const t = fakeChannel();
    const killTree = vi.fn();
    const stuck: AgentRunner = { run: () => new Promise(() => {}) };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => stuck,
      disconnectGraceMs: 50,
      killTree,
    });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    expect(await done).toBe(1);
    expect(killTree).toHaveBeenCalledOnce();
  });
});
