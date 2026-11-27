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

describe("protocole IPC : encadrement", () => {
  it("supervision : énumération stricte", () => {
    for (const supervision of ["light", "standard", "strict"])
      expect(parseToEngine({ v: 1, type: "start", cwd, supervision }).ok, supervision).toBe(true);
    for (const supervision of ["max", "", 3, null])
      expect(parseToEngine({ v: 1, type: "start", cwd, supervision }).ok, String(supervision)).toBe(
        false,
      );
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
    for (const state of [
      ok,
      null,
      { since: now, expiresAt: null },
      { since: now, expiresAt: now + 48 * 60 * 60 * 1000 },
    ]) {
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
      state: { since: now, expiresAt: now + 48 * 60 * 60 * 1000 + 1 },
    });
    bad({ v: 1, type: "bypass", seq: 1, state: { since: now, expiresAt: now + 59_999 } });
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

it("valide les images et la capacité de vision aux frontières IPC", () => {
  const image = { name: "capture.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
  expect(parseToEngine({ v: 1, type: "prompt", text: "voir", images: [image] }).ok).toBe(true);
  expect(
    parseToEngine({ v: 1, type: "prompt", text: "voir", images: [{ ...image, data: "AAAA" }] }).ok,
  ).toBe(false);
  expect(
    parseFromEngine({
      v: 1,
      type: "models",
      models: [{ value: "a", displayName: "A", supportsImages: false }],
    }).ok,
  ).toBe(true);
  expect(
    parseFromEngine({
      v: 1,
      type: "models",
      models: [{ value: "a", displayName: "A", supportsImages: "yes" }],
    }).ok,
  ).toBe(false);
});

describe("protocole IPC : sous-agents (ADR 0054)", () => {
  const items = [
    { id: "s1", name: "Domaines", goal: "Énumérer les sous-domaines" },
    { id: "s2", name: "API", goal: "Cartographier les routes" },
  ];

  it("start : subagents est un booléen strict, refusé en apprentissage", () => {
    for (const subagents of [true, false])
      expect(parseToEngine({ v: 1, type: "start", cwd, subagents }).ok).toBe(true);
    expect(parseToEngine({ v: 1, type: "start", cwd }).ok).toBe(true);
    for (const subagents of ["true", 1, null, {}, []])
      expect(parseToEngine({ v: 1, type: "start", cwd, subagents }).ok, String(subagents)).toBe(
        false,
      );
    expect(parseToEngine({ v: 1, type: "start", cwd, mode: "learning", subagents: true })).toEqual({
      ok: false,
      reason: { code: "ipc.invalidMessage", params: { field: "subagents", reason: "invalid" } },
    });
    // Désactivé en apprentissage : sans objet, donc accepté.
    expect(parseToEngine({ v: 1, type: "start", cwd, mode: "learning", subagents: false }).ok).toBe(
      true,
    );
  });

  it("subagentsAnswer : forme exacte, identifiants bornés", () => {
    for (const m of [
      { v: 1, type: "subagentsAnswer", proposalId: "p1", selected: ["s1", "s2"] },
      { v: 1, type: "subagentsAnswer", proposalId: "p1", selected: [] },
      { v: 1, type: "subagentsAnswer", proposalId: "p1", selected: ["s1"], note: "ok" },
    ])
      expect(parseToEngine(m).ok, JSON.stringify(m)).toBe(true);
  });

  it.each([
    ["sans proposalId", { v: 1, type: "subagentsAnswer", selected: [] }],
    ["proposalId vide", { v: 1, type: "subagentsAnswer", proposalId: "", selected: [] }],
    [
      "proposalId trop long",
      { v: 1, type: "subagentsAnswer", proposalId: "p".repeat(201), selected: [] },
    ],
    ["proposalId non texte", { v: 1, type: "subagentsAnswer", proposalId: 3, selected: [] }],
    ["sans selected", { v: 1, type: "subagentsAnswer", proposalId: "p" }],
    ["selected non tableau", { v: 1, type: "subagentsAnswer", proposalId: "p", selected: "s1" }],
    ["selected non texte", { v: 1, type: "subagentsAnswer", proposalId: "p", selected: [1] }],
    ["selected vide", { v: 1, type: "subagentsAnswer", proposalId: "p", selected: [""] }],
    [
      "selected en double",
      { v: 1, type: "subagentsAnswer", proposalId: "p", selected: ["s1", "s1"] },
    ],
    [
      "selected trop long",
      { v: 1, type: "subagentsAnswer", proposalId: "p", selected: ["a", "b", "c", "d", "e"] },
    ],
    [
      "identifiant trop long",
      { v: 1, type: "subagentsAnswer", proposalId: "p", selected: ["s".repeat(65)] },
    ],
    ["note non texte", { v: 1, type: "subagentsAnswer", proposalId: "p", selected: [], note: 1 }],
    [
      "note trop longue",
      { v: 1, type: "subagentsAnswer", proposalId: "p", selected: [], note: "n".repeat(2001) },
    ],
    [
      "clé en trop",
      { v: 1, type: "subagentsAnswer", proposalId: "p", selected: [], approve: true },
    ],
  ])("subagentsAnswer rejeté : %s", (_name, message) => {
    expect(parseToEngine(message).ok).toBe(false);
  });

  it("subagentsProposal : 1 à 4 éléments exacts, identifiants uniques", () => {
    expect(parseFromEngine({ v: 1, type: "subagentsProposal", proposalId: "p1", items }).ok).toBe(
      true,
    );
  });

  it.each([
    ["sans proposalId", { v: 1, type: "subagentsProposal", items }],
    ["proposalId vide", { v: 1, type: "subagentsProposal", proposalId: "", items }],
    ["sans éléments", { v: 1, type: "subagentsProposal", proposalId: "p", items: [] }],
    ["éléments non tableau", { v: 1, type: "subagentsProposal", proposalId: "p", items: "x" }],
    [
      "cinq éléments",
      {
        v: 1,
        type: "subagentsProposal",
        proposalId: "p",
        items: ["a", "b", "c", "d", "e"].map((name) => ({ id: name, name, goal: "x" })),
      },
    ],
    [
      "identifiants en double",
      {
        v: 1,
        type: "subagentsProposal",
        proposalId: "p",
        items: [
          { id: "s1", name: "A", goal: "a" },
          { id: "s1", name: "B", goal: "b" },
        ],
      },
    ],
    [
      "élément sans objectif",
      { v: 1, type: "subagentsProposal", proposalId: "p", items: [{ id: "s1", name: "A" }] },
    ],
    [
      "clé en trop dans un élément",
      {
        v: 1,
        type: "subagentsProposal",
        proposalId: "p",
        items: [{ id: "s1", name: "A", goal: "a", model: "m" }],
      },
    ],
    [
      "nom vide",
      {
        v: 1,
        type: "subagentsProposal",
        proposalId: "p",
        items: [{ id: "s1", name: "", goal: "a" }],
      },
    ],
    ["clé en trop", { v: 1, type: "subagentsProposal", proposalId: "p", items, token: "x" }],
  ])("subagentsProposal rejeté : %s", (_name, message) => {
    expect(parseFromEngine(message).ok).toBe(false);
  });

  it("une demande d'approbation peut nommer le sous-agent demandeur (agentId)", () => {
    const approval = { toolUseId: "t", tool: "Write", input: {}, verdict, agentId: "agent-1" };
    expect(parseFromEngine({ v: 1, type: "approval", approval }).ok).toBe(true);
    expect(
      parseFromEngine({ v: 1, type: "approval", approval: { ...approval, agentId: 3 } }).ok,
    ).toBe(false);
    expect(
      parseFromEngine({ v: 1, type: "approval", approval: { ...approval, extra: 1 } }).ok,
    ).toBe(false);
  });

  it("relaie les événements des sous-agents", () => {
    const meta = {
      v: 1,
      id: "e",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      runId: "r",
      parentId: null,
    };
    expect(
      parseFromEngine({
        v: 1,
        type: "event",
        event: { ...meta, kind: "subagents.proposed", proposalId: "p", items },
      }).ok,
    ).toBe(true);
    expect(
      parseFromEngine({
        v: 1,
        type: "event",
        event: {
          ...meta,
          kind: "subagents.decided",
          proposalId: "p",
          decision: "accepted",
          selected: [{ id: "s1", description: "Domaines" }],
        },
      }).ok,
    ).toBe(true);
    expect(
      parseFromEngine({
        v: 1,
        type: "event",
        event: {
          ...meta,
          kind: "subagents.decided",
          proposalId: "p",
          decision: "oui",
          selected: [],
        },
      }).ok,
    ).toBe(false);
  });
});
