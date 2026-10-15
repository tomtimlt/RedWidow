import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFromEngine, parseToEngine } from "../src/logic/protocol.js";

const cwd = resolve("/tmp/projet");
const verdict = {
  decision: "ask",
  reason: { code: "policy.default", params: { tool: "Write" } },
  rule: null,
};

describe("protocole IPC : vers le moteur", () => {
  it("accepte les messages valides", () => {
    for (const m of [
      {
        v: 1,
        type: "start",
        cwd,
        model: "m",
        maxTurns: 3,
        auth: "subscription",
        maxBudgetUsd: 1.5,
        sandbox: { image: "alpine:3.20", timeoutSec: 600 },
      },
      { v: 1, type: "prompt", text: "bonjour" },
      { v: 1, type: "answer", toolUseId: "t1", decision: "allow", remember: "session" },
      { v: 1, type: "abort" },
      { v: 1, type: "dispose" },
    ]) {
      expect(parseToEngine(m).ok, JSON.stringify(m)).toBe(true);
    }
  });

  it.each([
    ["non-objet", "texte"],
    ["tableau", []],
    ["sans version", { type: "abort" }],
    ["version inconnue", { v: 2, type: "abort" }],
    ["type inconnu", { v: 1, type: "exec" }],
    ["clé en trop (jeton glissé)", { v: 1, type: "abort", token: "sk-ant-xxxxxxxxxx" }],
    ["start sans cwd", { v: 1, type: "start" }],
    ["start cwd relatif", { v: 1, type: "start", cwd: "rel/ative" }],
    ["start avec env", { v: 1, type: "start", cwd, env: { A: "b" } }],
    ["start auth inconnue", { v: 1, type: "start", cwd, auth: "bypass" }],
    ["start maxTurns négatif", { v: 1, type: "start", cwd, maxTurns: -1 }],
    [
      "start sandbox sans image",
      { v: 1, type: "start", cwd, sandbox: { image: "", timeoutSec: 10 } },
    ],
    [
      "start sandbox délai hors bornes",
      { v: 1, type: "start", cwd, sandbox: { image: "a", timeoutSec: 1801 } },
    ],
    [
      "start sandbox option réseau",
      { v: 1, type: "start", cwd, sandbox: { image: "a", timeoutSec: 5, network: "host" } },
    ],
    ["prompt vide", { v: 1, type: "prompt", text: "" }],
    ["prompt non texte", { v: 1, type: "prompt", text: 3 }],
    ["answer decision inconnue", { v: 1, type: "answer", toolUseId: "t", decision: "ask" }],
    ["answer sans id", { v: 1, type: "answer", decision: "allow" }],
    [
      "answer remember inconnu",
      { v: 1, type: "answer", toolUseId: "t", decision: "allow", remember: "forever" },
    ],
  ])("rejette : %s", (_name, message) => {
    const parsed = parseToEngine(message);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason.code).toMatch(/^ipc\./);
  });

  it("signale la version inconnue par un code dédié", () => {
    const parsed = parseToEngine({ v: 9, type: "abort" });
    expect(parsed.ok || parsed.reason.code).toBe("ipc.unsupportedVersion");
  });
});

describe("protocole IPC : vers l'extension", () => {
  const event = {
    v: 1,
    id: "e1",
    seq: 0,
    ts: "2026-01-01T00:00:00.000Z",
    runId: "r",
    parentId: null,
    kind: "run.started",
    prompt: "p",
    cwd,
  };

  it("accepte les messages valides", () => {
    for (const m of [
      { v: 1, type: "ready" },
      { v: 1, type: "started", runId: "r", policySource: null },
      { v: 1, type: "event", event },
      { v: 1, type: "approval", approval: { toolUseId: "t", tool: "Write", input: {}, verdict } },
      { v: 1, type: "ended", summary: { status: "success", turns: 1, costUsd: 0, result: null } },
      { v: 1, type: "error", reason: { code: "error.unknown", message: "boum" } },
    ]) {
      const parsed = parseFromEngine(m);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    }
  });

  it.each([
    ["type inconnu", { v: 1, type: "answer" }],
    ["version inconnue", { v: 2, type: "ready" }],
    ["clé en trop", { v: 1, type: "ready", extra: 1 }],
    ["événement invalide", { v: 1, type: "event", event: { kind: "run.started" } }],
    ["événement inconnu", { v: 1, type: "event", event: { ...event, kind: "nope" } }],
    [
      "approbation sans verdict",
      { v: 1, type: "approval", approval: { toolUseId: "t", tool: "W", input: {} } },
    ],
    [
      "approbation entrée non objet",
      { v: 1, type: "approval", approval: { toolUseId: "t", tool: "W", input: "x", verdict } },
    ],
    ["résumé invalide", { v: 1, type: "ended", summary: { status: "weird" } }],
    ["code de raison inconnu", { v: 1, type: "error", reason: { code: "pas.un.code" } }],
    [
      "message brut hors error.unknown",
      { v: 1, type: "error", reason: { code: "path.sensitive", message: "x" } },
    ],
    ["started sans runId", { v: 1, type: "started", policySource: null }],
  ])("rejette : %s", (_name, message) => {
    expect(parseFromEngine(message).ok).toBe(false);
  });
});

describe("protocole IPC : effort et modèles", () => {
  it("effort : énumération stricte", () => {
    expect(parseToEngine({ v: 1, type: "start", cwd, effort: "xhigh" }).ok).toBe(true);
    for (const effort of ["ultra", "", 3, null]) {
      expect(parseToEngine({ v: 1, type: "start", cwd, effort }).ok, String(effort)).toBe(false);
    }
  });
  it("modèle : identifiant bien formé seulement", () => {
    expect(parseToEngine({ v: 1, type: "start", cwd, model: "a b" }).ok).toBe(false);
    expect(parseToEngine({ v: 1, type: "start", cwd, model: "x".repeat(201) }).ok).toBe(false);
  });
  it("message models : forme exacte des deux côtés", () => {
    expect(parseToEngine({ v: 1, type: "models", cwd }).ok).toBe(true);
    expect(parseToEngine({ v: 1, type: "models", cwd, prompt: "x" }).ok).toBe(false);
    expect(parseToEngine({ v: 1, type: "models", cwd: "relatif" }).ok).toBe(false);
    expect(
      parseFromEngine({ v: 1, type: "models", models: [{ value: "a", displayName: "A" }] }).ok,
    ).toBe(true);
    expect(parseFromEngine({ v: 1, type: "models", models: [{ value: "a" }] }).ok).toBe(false);
    expect(parseFromEngine({ v: 1, type: "models", models: "x" }).ok).toBe(false);
  });
});
