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
      "start avec sandbox (clé retirée)",
      {
        v: 1,
        type: "start",
        cwd,
        sandbox: { image: "a", timeoutSec: 5, network: "none", memory: "2g", cpus: 2 },
      },
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
  it("reçoit les 112 modèles OpenCode au travers de l’IPC", () => {
    const models = Array.from({ length: 112 }, (_, index) => ({
      value: `opencode/model-${index}`,
      displayName: `Modèle ${index}`,
    }));
    const result = parseFromEngine({ v: 1, type: "models", models });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual({ v: 1, type: "models", models });
  });
});

describe("protocole IPC : Bypass (ADR 0006, décision 6)", () => {
  const now = 1_700_000_000_000;
  const ok = { since: now, expiresAt: now + 60_000 };
  const bad = (msg: unknown) => {
    const parsed = parseToEngine(msg);
    expect(parsed.ok, JSON.stringify(msg)).toBe(false);
    if (!parsed.ok) expect(parsed.reason.code).toBe("ipc.invalidMessage");
  };

  it("accepte un état actif, un état nul (off) et les bornes à la durée maximale", () => {
    for (const state of [ok, null, { since: now, expiresAt: now + 4 * 60 * 60 * 1000 }]) {
      expect(parseToEngine({ v: 1, type: "bypass", seq: 1, state }).ok).toBe(true);
    }
  });

  it("(p) refuse un message forgé : clé en trop, type incorrect, durée excessive, bornes inversées", () => {
    bad({ v: 1, type: "bypass", seq: 1, state: ok, extra: true });
    bad({ v: 1, type: "bypass", seq: 1, state: { ...ok, duration: 1 } });
    bad({ v: 1, type: "bypass", seq: 1, state: { since: now, expiresAt: "x" } });
    bad({
      v: 1,
      type: "bypass",
      seq: 1,
      state: { since: now, expiresAt: now + 4 * 60 * 60 * 1000 + 1 },
    });
    bad({ v: 1, type: "bypass", seq: 1, state: { since: now, expiresAt: now } });
    bad({ v: 1, type: "bypass", seq: 1, state: { since: now + 1, expiresAt: now } });
    bad({ v: 1, type: "bypass", seq: 1, state: { since: 1.5, expiresAt: now + 60_000 } });
    bad({ v: 1, type: "bypass", seq: 1, state: undefined });
    bad({ v: 1, type: "bypass", seq: 1, state: ["x"] });
    bad({ v: 1, type: "bypass", state: null });
    bad({ v: 1, type: "bypass", seq: 0, state: null });
    bad({ v: 1, type: "bypass", seq: 1.5, state: null });
    bad({ v: 1, type: "bypass", seq: "1", state: null });
    bad({ v: 1, type: "bypass", seq: 1, state: null, extra: 1 });
  });

  it("accusé moteur → extension : forme exacte et état borné", () => {
    expect(parseFromEngine({ v: 1, type: "bypassAck", seq: 2, state: ok }).ok).toBe(true);
    expect(parseFromEngine({ v: 1, type: "bypassAck", seq: 2, state: null }).ok).toBe(true);
    for (const m of [
      { v: 1, type: "bypassAck", seq: 0, state: null },
      { v: 1, type: "bypassAck", seq: 2, state: { since: now, expiresAt: now - 1 } },
      { v: 1, type: "bypassAck", seq: 2, state: null, extra: 1 },
      { v: 1, type: "bypassAck", state: null },
    ]) {
      const parsed = parseFromEngine(m);
      expect(parsed.ok, JSON.stringify(m)).toBe(false);
    }
  });
});

describe("protocole IPC : mode apprentissage (ADR 0010)", () => {
  it("accepte mode learning ; l'absence reste valide", () => {
    expect(parseToEngine({ v: 1, type: "start", cwd, mode: "learning" }).ok).toBe(true);
    expect(parseToEngine({ v: 1, type: "start", cwd }).ok).toBe(true);
    expect(parseToEngine({ v: 1, type: "start", cwd, systemPrompt: "x" }).ok).toBe(true);
  });

  it.each([["Learning"], [""], [null], [1], [{}], [["learning"]], [true]])(
    "rejette mode %j",
    (mode) => {
      const parsed = parseToEngine({ v: 1, type: "start", cwd, mode });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toMatchObject({
          code: "ipc.invalidMessage",
          params: { field: "mode" },
        });
      }
    },
  );

  it("rejette mode avec systemPrompt", () => {
    const parsed = parseToEngine({ v: 1, type: "start", cwd, mode: "learning", systemPrompt: "x" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason.params).toMatchObject({ field: "mode" });
  });
});

describe("configuration Burp du moteur", () => {
  const start = { v: 1, type: "start", cwd };
  it("valide uniquement port et transport, hors apprentissage", () => {
    expect(parseToEngine({ ...start, burp: { port: 9876, transport: "sse" } }).ok).toBe(true);
    for (const patch of [
      { burp: { port: 0, transport: "sse" } },
      { burp: { port: 9876, transport: "stdio" } },
      { burp: { port: 9876, transport: "sse", command: "java" } },
      { mode: "learning", burp: { port: 9876, transport: "sse" } },
    ])
      expect(parseToEngine({ ...start, ...patch }).ok).toBe(false);
  });
});
