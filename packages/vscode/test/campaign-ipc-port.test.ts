import { CodedError } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIpcCampaignPort } from "../src/engine/campaign-port.js";
import type { FromEngine, ToEngine } from "../src/logic/protocol.js";

type Result = Extract<ToEngine, { type: "campaignResult" }>;

function setup(timeoutMs?: number) {
  const sent: FromEngine[] = [];
  let deliver: (message: Result) => void = () => {};
  const port = createIpcCampaignPort(
    (m) => void sent.push(m),
    (h) => {
      deliver = h;
    },
    timeoutMs === undefined ? {} : { timeoutMs },
  );
  const request = (index = 0) => sent[index] as Extract<FromEngine, { type: "campaign" }>;
  return { port, sent, request, deliver: (m: Result) => deliver(m) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("port de campagne IPC (moteur)", () => {
  it("envoie la requête et résout avec la valeur de l'hôte", async () => {
    const { port, request, deliver } = setup();
    const pending = port.openIntents([{ title: "a", rationale: "b" }]);
    expect(request()).toMatchObject({
      type: "campaign",
      op: "openIntents",
      args: { drafts: [{ title: "a", rationale: "b" }] },
    });
    deliver({ v: 1, type: "campaignResult", id: request().id, ok: true, value: [{ id: "i1" }] });
    await expect(pending).resolves.toEqual([{ id: "i1" }]);
  });

  it("transforme le refus de l'hôte en CodedError", async () => {
    const { port, request, deliver } = setup();
    const pending = port.closeIntent({ outcome: "reported", summary: "s", evidence: [] });
    deliver({
      v: 1,
      type: "campaignResult",
      id: request().id,
      ok: false,
      reason: { code: "campaign.notClaimant", params: { intentId: "i1" } },
    });
    await expect(pending).rejects.toBeInstanceOf(CodedError);
    await expect(pending).rejects.toMatchObject({ code: "campaign.notClaimant" });
  });

  it("expire après 30 s avec une erreur codée, et ignore la réponse tardive", async () => {
    const { port, request, deliver } = setup();
    const pending = port.status();
    const outcome = expect(pending).rejects.toMatchObject({
      code: "campaign.ipcTimeout",
      params: { op: "status", seconds: 30 },
    });
    await vi.advanceTimersByTimeAsync(29_999);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(() =>
      deliver({ v: 1, type: "campaignResult", id: request().id, ok: true, value: {} }),
    ).not.toThrow();
  });

  it("une réponse à temps annule le délai", async () => {
    const { port, request, deliver } = setup(1000);
    const pending = port.status();
    deliver({ v: 1, type: "campaignResult", id: request().id, ok: true, value: { x: 1 } });
    await expect(pending).resolves.toEqual({ x: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("des requêtes simultanées gardent des identifiants distincts", async () => {
    const { port, request, deliver } = setup();
    const a = port.status();
    const b = port.status();
    expect(request(0).id).not.toBe(request(1).id);
    deliver({ v: 1, type: "campaignResult", id: request(1).id, ok: true, value: "b" });
    deliver({ v: 1, type: "campaignResult", id: request(0).id, ok: true, value: "a" });
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
  });
});
