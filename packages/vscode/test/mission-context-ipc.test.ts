import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMissionDesk, DEFAULT_POLICY } from "@warband/core";
import { expect, it } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import { type FromEngine, parseFromEngine } from "../src/logic/protocol.js";

it("relaie le paquet réellement construit par le runner, borné et masqué, sans journal historique", async () => {
  const root = await mkdtemp(join(tmpdir(), "warband-context-ipc-"));
  const messages: FromEngine[] = [];
  let receive: (message: unknown) => void = () => {};
  const channel: EngineChannel = {
    send: async (message) => {
      messages.push(message);
    },
    onMessage: (handler) => {
      receive = handler;
    },
    onDisconnect: () => {},
  };
  try {
    const done = runEngine({
      channel,
      policyLoader: async () => ({ policy: DEFAULT_POLICY, source: null, origin: "builtin" }),
      createRunner: () => ({
        run: async (input, ctx) => {
          const desk = createMissionDesk({ recorder: ctx.recorder });
          if (typeof input.prompt !== "string")
            for await (const text of input.prompt) {
              desk.beginTurn(text);
              break;
            }
          ctx.onMissionContext?.(desk.context());
          desk.dispose();
          return { status: "success", turns: 1, costUsd: 0, result: "ok" };
        },
      }),
    });
    receive({ v: 1, type: "start", cwd: root });
    receive({ v: 1, type: "prompt", text: "Vérifier le service de cette mission" });
    expect(await done).toBe(0);
    const snapshot = messages.find((message) => message.type === "missionContext");
    expect(snapshot?.type).toBe("missionContext");
    expect(parseFromEngine(snapshot).ok).toBe(true);
    if (snapshot?.type === "missionContext")
      expect(JSON.parse(snapshot.text)).toMatchObject({
        version: 1,
        observations: [],
        prompt: "Vérifier le service de cette mission",
      });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejette les paquets IPC illisibles, trop grands ou attribués à un autre run", () => {
  const envelope = { v: 1, type: "missionContext", runId: "run" };
  for (const text of [
    "{invalid",
    "x".repeat(24001),
    JSON.stringify({ version: 1, runId: "other", prompt: "", observations: [] }),
  ])
    expect(parseFromEngine({ ...envelope, text }).ok).toBe(false);
});
