import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentCampaignPort,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type MissionDesk,
} from "@warband/core";
import { expect, it } from "vitest";
import { createSdkRunner, deskToolset } from "../src/index.js";

const PORT: AgentCampaignPort = {
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

/** Joue `calls` appels d'outils puis lit le point de contrôle du bureau ; `maxTurns` du run. */
async function run(maxTurns: number | undefined, worker: boolean) {
  const recorder = createRecorder();
  const seen: (string | undefined)[] = [];
  let desk: MissionDesk | undefined;
  const base = deskToolset();
  await createSdkRunner({
    processEnv: {},
    toolsets: [
      {
        ...base,
        create(ctx) {
          desk = ctx.missionDesk;
          return base.create(ctx);
        },
      },
    ],
    query: async function* () {
      const call = (n: number) =>
        recorder.emit({ kind: "tool.requested", toolUseId: `c${n}`, tool: "Read", input: { n } });
      const code = () => desk?.context().supervision.checkpoint?.code;
      call(1);
      seen.push(code()); // 9 tours restants : rien
      call(2);
      seen.push(code()); // 8 : rappel
      seen.push(code()); // déjà envoyé : plus rien
      call(3);
      seen.push(code());
      yield { type: "result", subtype: "success", result: "ok" } as unknown as SDKMessage;
    },
  }).run(
    { prompt: "go", cwd: process.cwd(), ...(maxTurns !== undefined && { maxTurns }) },
    {
      recorder,
      gate: createApprovalGate({ recorder, policy: DEFAULT_POLICY }),
      ...(worker && {
        multiAgent: {
          role: "worker" as const,
          port: PORT,
          intent: { id: "i1", title: "IDOR", rationale: "ids" },
        },
      }),
    },
  );
  return seen;
}

it("worker de campagne : rappel de clôture une seule fois à 8 tours restants (ADR 0054)", async () => {
  expect(await run(10, true)).toEqual([undefined, "campaign.closeReminder", undefined, undefined]);
});

it("sans plafond de tours ou hors worker : aucun rappel de clôture", async () => {
  expect(await run(undefined, true)).toEqual([undefined, undefined, undefined, undefined]);
  expect(await run(10, false)).toEqual([undefined, undefined, undefined, undefined]);
});
