import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ApprovalRequest,
  BYPASS_DEFAULT_MS,
  BYPASS_MAX_MS,
  type BypassSwitch,
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  EXEGOL_TOOL_PREFIX,
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  evaluatePolicy,
  isRememberable,
  KALI_EXECUTE_TOOL,
  KALI_TOOL_PREFIX,
  type Policy,
  type PolicyContext,
} from "../src/index.js";

/** Contexte POSIX : l'espace de travail est le répertoire courant du test. */
const WORKSPACE: PolicyContext = { cwd: process.cwd(), posixShell: true };

/** Politique de test : chaque cas « ask » visé par un critère a sa règle explicite. */
const ASK_POLICY: Policy = {
  default: "ask",
  rules: [
    { tool: "Bash", command: "git status", decision: "ask" },
    { tool: "Bash", command: "ls", decision: "ask" },
    { tool: "Bash", command: "echo *", decision: "ask" },
    { tool: "mcp__demo__ask", decision: "ask" },
    { tool: "Read", decision: "allow" },
    { tool: "mcp__demo__deny", decision: "deny" },
  ],
};

const signal = new AbortController().signal;

/** Horloge pilotable. */
const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, set: (value: number) => (t = value) };
};

/** Interrupteur en mémoire piloté par `clock`. */
const switchOn = (c: ReturnType<typeof clock>) => {
  const sw = createBypassSwitch({ now: c.now });
  sw.enable(BYPASS_DEFAULT_MS);
  return sw;
};

function harness(options: {
  policy?: Policy;
  bypass?: BypassSwitch;
  now?: () => number;
  withAsker?: boolean;
  workspace?: PolicyContext;
}) {
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  let asked = 0;
  const gate = createApprovalGate({
    policy: options.policy ?? DEFAULT_POLICY,
    recorder,
    workspace: options.workspace ?? WORKSPACE,
    ...(options.withAsker !== false && {
      ask: async () => {
        asked++;
        return { decision: "allow" };
      },
    }),
    ...(options.bypass && { bypass: options.bypass }),
    ...(options.now && { now: options.now }),
  });
  return { gate, events, asked: () => asked };
}

const kinds = (events: EngineEvent[]) => events.map((e) => e.kind);
/** Décisions réellement auto-approuvées par le Bypass (`source`, pas le code de motif). */
const bypassedDecisions = (events: EngineEvent[]) =>
  events.filter((e) => e.kind === "approval.decided" && e.source === "bypass");
const changes = (events: EngineEvent[]) =>
  events.filter(
    (e): e is Extract<EngineEvent, { kind: "bypass.changed" }> => e.kind === "bypass.changed",
  );

const mcp = (toolUseId = "t"): ApprovalRequest => ({
  toolUseId,
  tool: "mcp__demo__ask",
  input: {},
});
const bash = (command: string, toolUseId = "b"): ApprovalRequest => ({
  toolUseId,
  tool: "Bash",
  input: { command },
});
const kaliExec = (command: string, toolUseId = "k"): ApprovalRequest => ({
  toolUseId,
  tool: KALI_EXECUTE_TOOL,
  input: { command },
});
/** Un des onze outils Kali structurés (pas `execute_command`), avec une entrée donnée. */
const kaliTool = (
  name: string,
  input: Record<string, unknown>,
  toolUseId = "kt",
): ApprovalRequest => ({
  toolUseId,
  tool: `${KALI_TOOL_PREFIX}${name}`,
  input,
});

describe("createBypassSwitch", () => {
  it("démarre désactivé et s'active pour la durée par défaut", () => {
    const c = clock();
    const sw = createBypassSwitch({ now: c.now });
    expect(sw.current(c.now())).toBeNull();
    sw.enable(BYPASS_DEFAULT_MS);
    expect(sw.current(c.now())).toEqual({
      since: c.now(),
      expiresAt: c.now() + BYPASS_DEFAULT_MS,
    });
  });

  it("refuse une durée supérieure à 48 h et accepte le mode illimité", () => {
    const c = clock();
    const sw = createBypassSwitch({ now: c.now });
    sw.enable(BYPASS_MAX_MS + 1);
    expect(sw.current(c.now())).toBeNull();
    sw.enable(null);
    expect(sw.current(c.now() + BYPASS_MAX_MS * 2)).toEqual({ since: c.now(), expiresAt: null });
    sw.disable();
    expect(sw.current(c.now())).toBeNull();
  });

  it("passe à off à l'échéance, avec le motif bypass.expired", () => {
    const c = clock();
    const sw = switchOn(c);
    c.set(c.now() + BYPASS_DEFAULT_MS - 1);
    expect(sw.current(c.now())).not.toBeNull();
    c.set(c.now() + 1);
    expect(sw.current(c.now())).toBeNull();
    expect(sw.lastOffReason()).toBe("bypass.expired");
  });

  it("se désactive sur demande, avec le motif bypass.disabled", () => {
    const c = clock();
    const sw = switchOn(c);
    sw.disable();
    expect(sw.current(c.now())).toBeNull();
    expect(sw.lastOffReason()).toBe("bypass.disabled");
  });

  it("garde le motif d'expiration si la désactivation arrive après l'échéance", () => {
    const c = clock();
    const sw = switchOn(c);
    c.set(c.now() + BYPASS_DEFAULT_MS);
    sw.disable();
    expect(sw.lastOffReason()).toBe("bypass.expired");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "une durée invalide (%s) désactive le Bypass (fail-closed)",
    (duration) => {
      const c = clock();
      const sw = switchOn(c);
      sw.enable(duration);
      expect(sw.current(c.now())).toBeNull();
      expect(sw.lastOffReason()).toBe("bypass.disabled");
    },
  );
});

describe("Bypass dans la gate : refus durs levés par l'override (ADR 0017)", () => {
  it("(a) un deny de règle est auto-approuvé une fois, motif approval.override, sans demander", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now });
    const out = await h.gate.decide(bash("sudo ls"), signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "policy.rule" } },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("(a) un deny de règle non Bash est de même auto-approuvé", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide({ toolUseId: "d", tool: "mcp__demo__deny", input: {} }, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "policy.rule" } },
    });
    expect(h.asked()).toBe(0);
  });

  it("(b) un fichier sensible et un chemin hors espace de travail sont levés par l'override", async () => {
    const c = clock();
    const sensitive = harness({ bypass: switchOn(c), now: c.now });
    const denied = await sensitive.gate.decide(
      { toolUseId: "s", tool: "Read", input: { file_path: join(homedir(), ".ssh", "id_rsa") } },
      signal,
    );
    expect(denied).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "path.sensitive" } },
    });
    expect(sensitive.asked()).toBe(0);

    const outside = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await outside.gate.decide(
      { toolUseId: "o", tool: "Read", input: { file_path: "/opt/hors-espace/notes.txt" } },
      signal,
    );
    expect(out).toMatchObject({ source: "bypass", reason: { code: "approval.bypassed" } });
    expect(outside.asked()).toBe(0);
    expect(kinds(outside.events)).not.toContain("approval.requested");
  });

  it("(c) un danger shell (substitution) ou une chaîne de plusieurs segments est levé par l'override", async () => {
    const c = clock();
    const hazard = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await hazard.gate.decide(bash("echo $(id)"), signal);
    expect(out).toMatchObject({
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "bash.hazard" } },
    });
    expect(hazard.asked()).toBe(0);

    const chained = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const chainedOut = await chained.gate.decide(bash("ls; ls"), signal);
    expect(chainedOut).toMatchObject({ source: "bypass" });
    expect(chained.asked()).toBe(0);
    expect(kinds(chained.events)).not.toContain("approval.requested");
  });

  it("(d) docker run avec accès à l'hôte est levé par l'override, motif approval.override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const out = await h.gate.decide(bash("docker run -v /:/host alpine"), signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "docker.hostAccess" } },
    });
    expect(h.asked()).toBe(0);
  });

  it("(e) un accès hors espace de travail (outil externe) est levé par l'override", async () => {
    const c = clock();
    const external = harness({
      bypass: switchOn(c),
      now: c.now,
      policy: { default: "ask", rules: [{ tool: EXTERNAL_DIRECTORY_TOOL, decision: "allow" }] },
    });
    const out = await external.gate.decide(
      { toolUseId: "e", tool: EXTERNAL_DIRECTORY_TOOL, input: { patterns: ["/opt/*"] } },
      signal,
    );
    expect(out.source).toBe("bypass");
    expect(external.asked()).toBe(0);
  });

  it("(e) une entrée portant externalDirectories est levée par l'override (motif policy.default)", async () => {
    const c = clock();
    const h = harness({
      bypass: switchOn(c),
      now: c.now,
      policy: { default: "ask", rules: [{ tool: "Read", decision: "allow" }] },
    });
    const out = await h.gate.decide(
      {
        toolUseId: "x",
        tool: "Read",
        input: { file_path: "src/a.ts", [EXTERNAL_PATTERNS_FIELD]: ["src/*"] },
      },
      signal,
    );
    expect(out).toMatchObject({ source: "bypass", decision: "allow" });
    expect(out.reason).toMatchObject({
      code: "approval.bypassed",
      cause: { code: "policy.default" },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("rien n'est mémorisé par l'override : une fois le Bypass coupé, le refus redevient refus", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, withAsker: false });
    // Avec asker, sous Bypass : auto-approuvé par l'override.
    const withAsker = harness({ bypass, now: c.now });
    const first = await withAsker.gate.decide(bash("sudo ls", "s1"), signal);
    expect(first).toMatchObject({ decision: "allow", source: "bypass" });
    // Bypass coupé : la même demande redevient un deny, rien n'a été mémorisé.
    bypass.disable();
    const second = await withAsker.gate.decide(bash("sudo ls", "s2"), signal);
    expect(second).toMatchObject({ decision: "deny", source: "policy" });
    // Sans Asker (apprentissage/CLI non interactive), le Bypass est sans effet dès le départ.
    const noAsker = await h.gate.decide(bash("sudo ls", "s3"), signal);
    expect(noAsker).toMatchObject({ decision: "deny", source: "policy" });
  });
});

describe("Bypass dans la gate : verdicts couverts", () => {
  it("(b) un allow de politique reste source policy sous Bypass, aucun événement bypass", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide({ toolUseId: "r1", tool: "Read", input: {} }, signal, "parent");
    expect(out.source).toBe("policy");
    expect(out.decision).toBe("allow");
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(0);
  });

  it("(f) une règle ask explicite non Bash est auto-approuvée, sans demande ni mémorisation", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(mcp("m1"), signal, "parent");
    expect(out).toEqual({
      decision: "allow",
      reason: {
        code: "approval.bypassed",
        cause: {
          code: "policy.rule",
          params: { index: 3, decision: "ask", target: "mcp__demo__ask" },
        },
      },
      source: "bypass",
    });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
    expect(h.events.at(-1)).toMatchObject({
      kind: "approval.decided",
      source: "bypass",
      parentId: "parent",
    });

    // Bypass coupé : la même demande est de nouveau posée, rien n'a été mémorisé.
    bypass.disable();
    const again = await h.gate.decide(mcp("m2"), signal);
    expect(again).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
  });

  it("(f) une commande Bash git status couverte par sa règle est auto-approuvée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("git status"), signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: {
        code: "approval.bypassed",
        cause: { code: "policy.rule", params: { target: "Bash(git status)" } },
      },
    });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("(f) l'absence de règle est auto-approuvée quand elle relève de policy.default", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide({ toolUseId: "p", tool: "mcp__other__y", input: {} }, signal);
    expect(out).toMatchObject({
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "policy.default" } },
    });
  });

  it("(g) une commande Bash sans règle (bash.noRule) est aussi levée par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const out = await h.gate.decide(bash("docker run alpine"), signal);
    expect(out).toMatchObject({ source: "bypass", reason: { code: "approval.bypassed" } });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("(g) ls && rm x avec une règle ask sur ls seulement est aussi levée par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("ls && rm x"), signal);
    expect(out).toMatchObject({ source: "bypass" });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("(g) une règle Bash ask sans command est aussi levée par l'override", async () => {
    const c = clock();
    const policy: Policy = { default: "ask", rules: [{ tool: "Bash", decision: "ask" }] };
    const h = harness({ bypass: switchOn(c), now: c.now, policy });
    const out = await h.gate.decide(bash("git status"), signal);
    expect(out).toMatchObject({ source: "bypass" });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("(h) sans approbateur, le refus approval.noAsker reste, même Bypass actif", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY, withAsker: false });
    const out = await h.gate.decide(mcp(), signal);
    expect(out).toEqual({
      decision: "deny",
      reason: {
        code: "approval.noAsker",
        cause: {
          code: "policy.rule",
          params: { index: 3, decision: "ask", target: "mcp__demo__ask" },
        },
      },
      source: "policy",
    });
    expect(bypassedDecisions(h.events)).toEqual([]);
  });
});

describe("Bypass dans la gate : transitions et état", () => {
  it("(i) journalise un bypass.changed on avant la décision, une seule fois", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    await h.gate.decide(mcp("b"), signal);
    await h.gate.decide(bash("git status", "c"), signal);
    const changed = changes(h.events);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      state: "on",
      reason: { code: "bypass.enabled" },
      since: c.now(),
      expiresAt: c.now() + BYPASS_DEFAULT_MS,
    });
    const onIndex = h.events.indexOf(changed[0] as EngineEvent);
    const firstDecided = h.events.findIndex(
      (e) => e.kind === "approval.decided" && e.source === "bypass",
    );
    expect(onIndex).toBeLessThan(firstDecided);
  });

  it("journalise les transitions du Bypass illimité", async () => {
    const c = clock();
    const bypass = createBypassSwitch({ now: c.now });
    bypass.enable(null);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    bypass.disable();
    await h.gate.decide(mcp("b"), signal);
    expect(changes(h.events)).toMatchObject([
      { state: "on", since: c.now(), unlimited: true },
      { state: "off", since: c.now(), unlimited: true },
    ]);
  });

  it("(i) l'expiration prend effet dès la décision suivante, avec bypass.expired", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    c.set(c.now() + BYPASS_DEFAULT_MS);
    const out = await h.gate.decide(mcp("b"), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    const changed = changes(h.events);
    expect(changed.map((e) => [e.state, e.reason.code])).toEqual([
      ["on", "bypass.enabled"],
      ["off", "bypass.expired"],
    ]);
  });

  it("(i) la désactivation prend effet dès la décision suivante, avec bypass.disabled", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    bypass.disable();
    await h.gate.decide(mcp("b"), signal);
    await h.gate.decide(mcp("c"), signal);
    expect(changes(h.events).map((e) => [e.state, e.reason.code])).toEqual([
      ["on", "bypass.enabled"],
      ["off", "bypass.disabled"],
    ]);
    expect(h.asked()).toBe(2);
  });

  it("(i) une réactivation après désactivation journalise une nouvelle transition on", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    bypass.disable();
    await h.gate.decide(mcp("b"), signal);
    bypass.enable(BYPASS_DEFAULT_MS);
    await h.gate.decide(mcp("c"), signal);
    expect(changes(h.events).map((e) => e.state)).toEqual(["on", "off", "on"]);
    expect(h.asked()).toBe(1);
  });

  it("(i) un état incohérent (borné au-delà de BYPASS_MAX_MS) est inactif, sans transition", async () => {
    const c = clock();
    const bogus: BypassSwitch = {
      current: (now) => ({ since: now, expiresAt: now + BYPASS_MAX_MS + 1 }),
      lastOffReason: () => "bypass.disabled",
    };
    const h = harness({ bypass: bogus, now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(mcp(), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(changes(h.events)).toHaveLength(0);
  });

  it("(i) un état daté dans le futur est inactif", async () => {
    const c = clock();
    const bogus: BypassSwitch = {
      current: (now) => ({ since: now + 10, expiresAt: now + 1_000 }),
      lastOffReason: () => "bypass.disabled",
    };
    const h = harness({ bypass: bogus, now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(mcp(), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(changes(h.events)).toHaveLength(0);
  });

  it("(i) un état devenu incohérent après un on passe à off avec bypass.disabled", async () => {
    const c = clock();
    let state: { since: number; expiresAt: number } | null = {
      since: c.now(),
      expiresAt: c.now() + 1_000,
    };
    const flaky: BypassSwitch = {
      current: () => state,
      lastOffReason: () => "bypass.expired",
    };
    const h = harness({ bypass: flaky, now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    state = { since: c.now(), expiresAt: c.now() + BYPASS_MAX_MS + 1 };
    await h.gate.decide(mcp("b"), signal);
    expect(changes(h.events).map((e) => [e.state, e.reason.code])).toEqual([
      ["on", "bypass.enabled"],
      ["off", "bypass.disabled"],
    ]);
    expect(h.asked()).toBe(1);
  });

  it("sans interrupteur, la gate se comporte comme avant (aucun événement bypass)", async () => {
    const c = clock();
    const h = harness({ now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp(), signal);
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).not.toContain("bypass.changed");
  });
});

/** Fichier sensible du répertoire personnel (`~/.ssh/id_rsa`), absolu. */
const SENSITIVE = join(homedir(), ".ssh", "id_rsa");

/** Règle `ask` sur `cat` : le premier mot est littéral, la commande est couverte. */
const CAT_POLICY: Policy = {
  default: "ask",
  rules: [{ tool: "Bash", command: "cat *", decision: "ask" }],
};

describe("Bypass dans la gate : chemins, constats et plateformes", () => {
  it("un danger shell (redirection) sur une règle ask est levé par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("echo x > f"), signal);
    expect(out).toMatchObject({
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "bash.hazard" } },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("une chaîne de deux segments sur une règle ask est levée par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("echo a | echo b"), signal);
    expect(out).toMatchObject({ source: "bypass" });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("un Read sur une règle ask hors espace de travail est levé par l'override", async () => {
    const c = clock();
    const policy: Policy = { default: "ask", rules: [{ tool: "Read", decision: "ask" }] };
    const h = harness({ bypass: switchOn(c), now: c.now, policy });
    const out = await h.gate.decide(
      { toolUseId: "r", tool: "Read", input: { file_path: "/opt/hors-espace/notes.txt" } },
      signal,
    );
    expect(out).toMatchObject({
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "path.outside" } },
    });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("un chemin non analysable (UNC sous Windows, deny) est aussi levé par l'override", async () => {
    const c = clock();
    const win: PolicyContext = { cwd: process.cwd(), platform: "win32" };
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY, workspace: win });
    const out = await h.gate.decide(
      { toolUseId: "u", tool: "Read", input: { file_path: "\\\\srv\\partage\\a.txt" } },
      signal,
    );
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "path.unsupported" } },
    });
    expect(h.asked()).toBe(0);
  });

  it("Bash sous win32 sans posixShell est aussi levé par l'override", async () => {
    const c = clock();
    const win: PolicyContext = { cwd: process.cwd(), platform: "win32" };
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY, workspace: win });
    const out = await h.gate.decide(bash("git status"), signal);
    expect(out).toMatchObject({
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "shell.unanalyzable" } },
    });
    expect(h.asked()).toBe(0);
  });

  it("une commande Bash sur un chemin absolu sensible sous règle cat * est levée par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: CAT_POLICY });
    const out = await h.gate.decide(bash(`cat ${SENSITIVE}`), signal);
    expect(out).toMatchObject({ source: "bypass" });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
  });

  it("un outil MCP avec un chemin hors espace ou une chaîne imbriquée hors espace est levé par l'override", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    await h.gate.decide(
      { toolUseId: "a", tool: "mcp__demo__ask", input: { path: "/etc/passwd" } },
      signal,
    );
    await h.gate.decide(
      {
        toolUseId: "b",
        tool: "mcp__demo__ask",
        input: { opts: { items: [{ src: "/opt/hors/x" }] } },
      },
      signal,
    );
    expect(h.asked()).toBe(0);
    expect(kinds(h.events).filter((k) => k === "approval.requested")).toHaveLength(0);
    expect(bypassedDecisions(h.events)).toHaveLength(2);
  });

  it("contre-exemple : une commande Bash dont l'argument est dans l'espace est auto-approuvée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: CAT_POLICY });
    const out = await h.gate.decide(bash("cat src/a.ts"), signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.bypassed" },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });
});

describe("Bypass dans la gate : réactivation et prolongation sans décision entre deux", () => {
  it("une prolongation journalise un nouveau on avec les nouvelles bornes", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    const first = c.now();
    await h.gate.decide(mcp("a"), signal);
    c.set(first + 1_000);
    bypass.enable(BYPASS_DEFAULT_MS);
    const out = await h.gate.decide(mcp("b"), signal);
    expect(out.source).toBe("bypass");
    expect(changes(h.events).map((e) => [e.state, e.since, e.expiresAt])).toEqual([
      ["on", first, first + BYPASS_DEFAULT_MS],
      ["on", first + 1_000, first + 1_000 + BYPASS_DEFAULT_MS],
    ]);
    expect(h.asked()).toBe(0);
  });

  it("une réactivation sans décision entre deux journalise un on avec les nouvelles bornes", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now, policy: ASK_POLICY });
    const first = c.now();
    await h.gate.decide(mcp("a"), signal);
    bypass.disable();
    c.set(first + 5_000);
    bypass.enable(BYPASS_DEFAULT_MS);
    await h.gate.decide(mcp("b"), signal);
    expect(changes(h.events).map((e) => [e.state, e.since])).toEqual([
      ["on", first],
      ["on", first + 5_000],
    ]);
    expect(h.asked()).toBe(0);
  });

  it("sans changement de bornes, une décision suivante ne réémet rien", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    await h.gate.decide(mcp("a"), signal);
    await h.gate.decide(mcp("b"), signal);
    expect(changes(h.events)).toHaveLength(1);
  });
});

describe("Bypass et mcp__kali__execute_command", () => {
  it("Bypass actif : id est allow sans asker, et reste non mémorisable", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const request = kaliExec("id");
    const verdict = evaluatePolicy(DEFAULT_POLICY, request.tool, request.input, WORKSPACE);
    expect(verdict).toMatchObject({ decision: "ask", reason: { code: "shell.unanalyzable" } });
    expect(isRememberable(request, verdict)).toBe(false);
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.bypassed", cause: { code: "shell.unanalyzable" } },
    });
    expect(h.asked()).toBe(0);
    expect(kinds(h.events)).not.toContain("approval.requested");
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("Bypass actif : sudo id et un docker run qui donne l'hôte sont aussi levés par l'override", async () => {
    const c = clock();
    const sudo = harness({ bypass: switchOn(c), now: c.now });
    const sudoOut = await sudo.gate.decide(kaliExec("sudo id"), signal);
    expect(sudoOut).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override" },
    });
    expect(sudo.asked()).toBe(0);
    expect(bypassedDecisions(sudo.events)).toHaveLength(1);

    const host = harness({ bypass: switchOn(c), now: c.now });
    const hostOut = await host.gate.decide(kaliExec("docker run -v /:/h x"), signal);
    expect(hostOut).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "docker.hostAccess" } },
    });
    expect(host.asked()).toBe(0);
    expect(bypassedDecisions(host.events)).toHaveLength(1);
  });

  it("sans Asker (apprentissage/CLI non interactive), sudo et l'accès hôte restent deny malgré le Bypass", async () => {
    const c = clock();
    const sudo = harness({ bypass: switchOn(c), now: c.now, withAsker: false });
    const sudoOut = await sudo.gate.decide(kaliExec("sudo id"), signal);
    expect(sudoOut).toMatchObject({ decision: "deny", source: "policy" });
    expect(bypassedDecisions(sudo.events)).toEqual([]);
  });

  it("Bypass actif : redirection, chemin, segments et danger avalé sont allow sans asker", async () => {
    const commands = [
      "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest 2>&1",
      "cat /etc/hostname",
      "ls /tmp && id",
      "echo $(id)",
      "echo '",
    ];
    for (const command of commands) {
      const c = clock();
      const request = kaliExec(command);
      const verdict = evaluatePolicy(DEFAULT_POLICY, request.tool, request.input, WORKSPACE);
      expect(verdict).toMatchObject({ decision: "ask", reason: { code: "shell.unanalyzable" } });
      expect(isRememberable(request, verdict)).toBe(false);
      const persisted: unknown[] = [];
      const recorder = createRecorder({ runId: "r" });
      const events: EngineEvent[] = [];
      recorder.subscribe((e) => events.push(e));
      let asked = 0;
      const gate = createApprovalGate({
        policy: DEFAULT_POLICY,
        recorder,
        workspace: WORKSPACE,
        bypass: switchOn(c),
        now: c.now,
        ask: async () => {
          asked++;
          return { decision: "allow", remember: "always" };
        },
        persistRule: (rule) => {
          persisted.push(rule);
        },
      });
      const out = await gate.decide(request, signal);
      expect(out).toMatchObject({
        decision: "allow",
        source: "bypass",
        reason: { code: "approval.bypassed", cause: { code: "shell.unanalyzable" } },
      });
      expect(asked).toBe(0);
      expect(kinds(events)).not.toContain("approval.requested");
      expect(bypassedDecisions(events)).toHaveLength(1);
      expect(persisted).toEqual([]);
    }
  });

  it("Bypass actif : un danger dont le verdict est deny est aussi levé par l'override", async () => {
    const policy: Policy = {
      default: "deny",
      rules: [{ tool: "Bash", command: "echo *", decision: "ask" }],
    };
    const c = clock();
    const h = harness({ policy, bypass: switchOn(c), now: c.now });
    const request = kaliExec("echo $(id)");
    const verdict = evaluatePolicy(policy, request.tool, request.input, WORKSPACE);
    expect(verdict).toMatchObject({ decision: "deny", reason: { code: "bash.hazard" } });
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override", cause: { code: "bash.hazard" } },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("sans Bypass, la carte ask reste et always n'écrit aucune règle", async () => {
    const recorder = createRecorder({ runId: "r" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const persisted: unknown[] = [];
    let asked = 0;
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: WORKSPACE,
      ask: async () => {
        asked++;
        return { decision: "allow", remember: "always" };
      },
      persistRule: (rule) => {
        persisted.push(rule);
      },
    });
    const request = kaliExec(
      "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest 2>&1",
    );
    expect(
      isRememberable(
        request,
        evaluatePolicy(DEFAULT_POLICY, request.tool, request.input, WORKSPACE),
      ),
    ).toBe(false);
    const out = await gate.decide(request, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "user",
      reason: { code: "shell.unanalyzable" },
    });
    expect(asked).toBe(1);
    expect(kinds(events)).toContain("approval.requested");
    expect(bypassedDecisions(events)).toEqual([]);
    expect(persisted).toEqual([]);
    await gate.decide(kaliExec("id", "k2"), signal);
    expect(asked).toBe(2);
    expect(persisted).toEqual([]);
  });
});

describe("Bypass et les outils Kali structurés", () => {
  it("un deny de règle sur un outil Kali structuré est aussi levé par l'override, Bypass actif", async () => {
    const policy: Policy = {
      default: "ask",
      rules: [{ tool: `${KALI_TOOL_PREFIX}john_crack`, decision: "deny" }],
    };
    const c = clock();
    const h = harness({ policy, bypass: switchOn(c), now: c.now });
    const request = kaliTool("john_crack", { hash_file: "/tmp/hashes.txt" });
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override" },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  it("sans Asker, un deny de règle sur un outil Kali structuré reste refusé malgré le Bypass", async () => {
    const policy: Policy = {
      default: "ask",
      rules: [{ tool: `${KALI_TOOL_PREFIX}john_crack`, decision: "deny" }],
    };
    const c = clock();
    const h = harness({ policy, bypass: switchOn(c), now: c.now, withAsker: false });
    const request = kaliTool("john_crack", { hash_file: "/tmp/hashes.txt" });
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({ decision: "deny", source: "policy" });
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("Bypass actif : ask d'un outil Kali structuré est allow sans asker (mémorisable comme l'outil, arguments compris non stockés)", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const request = kaliTool("gobuster_scan", {
      url: "http://exemple.test",
      wordlist: "/usr/share/wordlists/dirb/common.txt",
    });
    const verdict = evaluatePolicy(DEFAULT_POLICY, request.tool, request.input, WORKSPACE);
    expect(verdict.decision).toBe("ask");
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({ decision: "allow", source: "bypass" });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });

  // La gate n'a plus de traitement particulier par préfixe d'outil (ADR 0017) : un outil Exegol
  // suit exactement le même chemin que n'importe quel autre, via l'override universel.
  it("un deny sur un outil Exegol est lui aussi levé par l'override, Bypass actif", async () => {
    const policy: Policy = {
      default: "ask",
      rules: [{ tool: `${EXEGOL_TOOL_PREFIX}exec`, decision: "deny" }],
    };
    const c = clock();
    const h = harness({ policy, bypass: switchOn(c), now: c.now });
    const request = { toolUseId: "e", tool: `${EXEGOL_TOOL_PREFIX}exec`, input: { argv: ["id"] } };
    const out = await h.gate.decide(request, signal);
    expect(out).toMatchObject({
      decision: "allow",
      source: "bypass",
      reason: { code: "approval.override" },
    });
    expect(bypassedDecisions(h.events)).toHaveLength(1);
  });
});
