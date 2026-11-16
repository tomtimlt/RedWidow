import type { AgentCampaignPort, MissionDesk } from "@warband/core";
import { expect, it } from "vitest";
import { createOpencodeRunner, deskToolset, type OpencodeToolset } from "../src/index.js";
import { fakeOpencode, harness, userMessage } from "./helpers.js";

const PORT = {
  async openIntents() {
    return [];
  },
  async status() {
    return {};
  },
  async closeIntent() {
    return {};
  },
} as unknown as AgentCampaignPort;

async function run(maxTurns: number | undefined, worker: boolean) {
  const seen: (string | undefined)[] = [];
  let desk: MissionDesk | undefined;
  let emit: ((n: number) => void) | undefined;
  const base = deskToolset();
  const set: OpencodeToolset = {
    ...base,
    create(ctx) {
      desk = ctx.missionDesk;
      emit = (n) =>
        void ctx.recorder.emit({
          kind: "tool.requested",
          toolUseId: `c${n}`,
          tool: "Read",
          input: { n },
        });
      return base.create(ctx);
    },
  };
  const fake = fakeOpencode([
    (s) => {
      s.emit("message.updated", userMessage("u"));
      const code = () => desk?.context().supervision.checkpoint?.code;
      emit?.(1);
      seen.push(code()); // 9 tours restants : rien
      emit?.(2);
      seen.push(code()); // 8 : rappel
      seen.push(code()); // déjà envoyé : plus rien
      emit?.(3);
      seen.push(code());
      s.idle();
    },
  ]);
  const summary = await harness().run(
    createOpencodeRunner({ processEnv: {}, toolsets: [set], createClient: fake.createClient }),
    maxTurns !== undefined ? { maxTurns } : {},
    undefined,
    worker
      ? {
          multiAgent: {
            role: "worker",
            port: PORT,
            intent: { id: "i1", title: "IDOR", rationale: "ids" },
          },
        }
      : {},
  );
  expect(summary.status).toBe("success");
  return seen;
}

it("worker de campagne : rappel de clôture une seule fois à 8 tours restants (ADR 0054)", async () => {
  expect(await run(10, true)).toEqual([undefined, "campaign.closeReminder", undefined, undefined]);
});

it("sans plafond de tours ou hors worker : aucun rappel de clôture", async () => {
  expect(await run(undefined, true)).toEqual([undefined, undefined, undefined, undefined]);
  expect(await run(10, false)).toEqual([undefined, undefined, undefined, undefined]);
});
