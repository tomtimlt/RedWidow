import { describe, expect, it } from "vitest";
import { parseFromEngine, parseToEngine } from "../src/logic/protocol.js";

describe("protocole : requêtes de campagne (ADR 0054)", () => {
  it("moteur → hôte : accepte une requête valide, rejette op, id ou args invalides", () => {
    const ok = { v: 1, type: "campaign", id: "c1", op: "status", args: {} };
    expect(parseFromEngine(ok).ok).toBe(true);
    for (const bad of [
      { ...ok, op: "rm" },
      { ...ok, id: "" },
      { ...ok, args: [] },
      { ...ok, args: "x" },
      { ...ok, extra: 1 },
    ])
      expect(parseFromEngine(bad).ok).toBe(false);
  });

  it("hôte → moteur : succès avec valeur, refus avec motif connu, rien d'autre", () => {
    const ok = { v: 1, type: "campaignResult", id: "c1", ok: true, value: { a: 1 } };
    expect(parseToEngine(ok).ok).toBe(true);
    const refused = {
      v: 1,
      type: "campaignResult",
      id: "c1",
      ok: false,
      reason: { code: "campaign.roleForbidden", params: { op: "openIntents", role: "worker" } },
    };
    expect(parseToEngine(refused).ok).toBe(true);
    for (const bad of [
      { ...ok, reason: { code: "campaign.finished" } },
      { ...ok, value: undefined },
      { ...refused, value: 1 },
      { ...refused, reason: { code: "code.inconnu" } },
      { ...ok, ok: "oui" },
      { ...ok, id: "x".repeat(101) },
    ])
      expect(parseToEngine(bad).ok).toBe(false);
  });
});
