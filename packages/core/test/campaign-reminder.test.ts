import { describe, expect, it } from "vitest";
import { CAMPAIGN_CLOSE_REMINDER_TURNS } from "../src/campaign/coordinator.js";
import { createMissionDesk } from "../src/mission-desk.js";
import { createRecorder } from "../src/recorder.js";

const intent = { id: "i1", title: "IDOR", rationale: "ids" };

function worker(options: { turnLimit?: number; withIntent?: boolean } = {}) {
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({
    recorder,
    ...(options.withIntent !== false && { campaignIntent: intent }),
    ...(options.turnLimit !== undefined && { turnLimit: options.turnLimit }),
  });
  let n = 0;
  const call = (tool = "read") =>
    void recorder.emit({ kind: "tool.requested", toolUseId: `c${n++}`, tool, input: { n } });
  const checkpoint = () => desk.context().supervision.checkpoint;
  return { call, checkpoint };
}

describe("rappel de clôture d'un worker de campagne (ADR 0054)", () => {
  it("vaut 8 tours", () => {
    expect(CAMPAIGN_CLOSE_REMINDER_TURNS).toBe(8);
  });

  it("injecté une seule fois, quand il reste 8 tours", () => {
    const { call, checkpoint } = worker({ turnLimit: 40 });
    for (let i = 0; i < 31; i++) call();
    expect(checkpoint()).toBeUndefined();
    call(); // 32 appels : il reste 8 tours
    const reminder = checkpoint();
    expect(reminder?.code).toBe("campaign.closeReminder");
    expect(reminder).toMatchObject({ params: { remaining: 8 } });
    // Une seule fois, même plus près de la limite.
    expect(checkpoint()).toBeUndefined();
    for (let i = 0; i < 5; i++) call();
    expect(checkpoint()).toBeUndefined();
  });

  it("compte aussi les appels d'outils du bureau (ils consomment des tours)", () => {
    const { call, checkpoint } = worker({ turnLimit: 10 });
    call("campaign_status");
    expect(checkpoint()).toBeUndefined();
    call("mission_context");
    expect(checkpoint()?.code).toBe("campaign.closeReminder");
  });

  it("sans plafond de tours ou sans intention : aucun rappel", () => {
    const noLimit = worker();
    for (let i = 0; i < 100; i++) noLimit.call();
    expect(noLimit.checkpoint()).toBeUndefined();
    const noIntent = worker({ turnLimit: 10, withIntent: false });
    for (let i = 0; i < 20; i++) noIntent.call();
    expect(noIntent.checkpoint()).toBeUndefined();
  });
});
