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
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  evaluatePolicy,
  isBypassable,
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

  it("borne toute durée demandée à BYPASS_MAX_MS", () => {
    const c = clock();
    const sw = createBypassSwitch({ now: c.now });
    sw.enable(10 * BYPASS_MAX_MS);
    const state = sw.current(c.now());
    expect(state !== null && state.expiresAt - state.since).toBe(BYPASS_MAX_MS);
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

describe("isBypassable", () => {
  const verdictOf = (request: ApprovalRequest, policy: Policy = ASK_POLICY) => {
    const verdict = evaluatePolicy(policy, request.tool, request.input, WORKSPACE);
    return isBypassable(request, verdict, policy, WORKSPACE);
  };

  it("couvre une règle ask explicite et l'absence de règle, hors Bash", () => {
    expect(verdictOf(mcp())).toBe(true);
    expect(verdictOf({ toolUseId: "x", tool: "mcp__other__y", input: {} })).toBe(true);
  });

  it("ne couvre jamais un deny ni un verdict d'un autre motif", () => {
    expect(verdictOf({ toolUseId: "x", tool: "mcp__demo__deny", input: {} })).toBe(false);
    expect(verdictOf(bash("sudo ls"), DEFAULT_POLICY)).toBe(false);
  });

  it("couvre une commande Bash simple dont la règle a un premier mot littéral", () => {
    expect(verdictOf(bash("git status"))).toBe(true);
  });

  it("ne couvre pas une règle Bash sans command ni un premier mot en joker", () => {
    const noCommand: Policy = { default: "ask", rules: [{ tool: "Bash", decision: "ask" }] };
    expect(verdictOf(bash("git status"), noCommand)).toBe(false);
    const wildcard: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "* status", decision: "ask" }],
    };
    expect(verdictOf(bash("git status"), wildcard)).toBe(false);
  });
});

describe("Bypass dans la gate : refus et garde-fous jamais contournés", () => {
  it("(a) un deny de règle reste un deny, sans demander", async () => {
    const c = clock();
    const bypass = switchOn(c);
    const h = harness({ bypass, now: c.now });
    const out = await h.gate.decide(bash("sudo ls"), signal);
    expect(out).toMatchObject({ decision: "deny", source: "policy" });
    expect(out.reason.code).toBe("policy.rule");
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("(a) un deny de règle non Bash reste un deny", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide({ toolUseId: "d", tool: "mcp__demo__deny", input: {} }, signal);
    expect(out).toMatchObject({ decision: "deny", source: "policy" });
    expect(h.asked()).toBe(0);
  });

  it("(b) un fichier sensible et un chemin hors espace de travail restent demandés ou refusés", async () => {
    const c = clock();
    const sensitive = harness({ bypass: switchOn(c), now: c.now });
    const denied = await sensitive.gate.decide(
      { toolUseId: "s", tool: "Read", input: { file_path: join(homedir(), ".ssh", "id_rsa") } },
      signal,
    );
    expect(denied).toMatchObject({ decision: "deny", source: "policy" });
    expect(denied.reason.code).toBe("path.sensitive");
    expect(sensitive.asked()).toBe(0);

    const outside = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await outside.gate.decide(
      { toolUseId: "o", tool: "Read", input: { file_path: "/opt/hors-espace/notes.txt" } },
      signal,
    );
    expect(out).toMatchObject({ source: "user" });
    expect(outside.asked()).toBe(1);
    expect(kinds(outside.events)).toContain("approval.requested");
    expect(bypassedDecisions(outside.events)).toEqual([]);
  });

  it("(c) un danger shell (substitution) ou une chaîne de plusieurs segments reste demandé", async () => {
    const c = clock();
    const hazard = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await hazard.gate.decide(bash("echo $(id)"), signal);
    expect(out).toMatchObject({ source: "user", reason: { code: "bash.hazard" } });
    expect(hazard.asked()).toBe(1);

    const chained = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    await chained.gate.decide(bash("ls; ls"), signal);
    expect(chained.asked()).toBe(1);
    expect(kinds(chained.events)).toContain("approval.requested");
  });

  it("(d) docker run avec accès à l'hôte est refusé sans demander", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const out = await h.gate.decide(bash("docker run -v /:/host alpine"), signal);
    expect(out).toMatchObject({ decision: "deny", source: "policy" });
    expect(out.reason.code).toBe("docker.hostAccess");
    expect(h.asked()).toBe(0);
  });

  it("(e) un accès hors espace de travail (outil externe) n'est jamais auto-approuvé", async () => {
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
    expect(out.source).toBe("user");
    expect(out.source).not.toBe("bypass");
    expect(external.asked()).toBe(1);
  });

  it("(e) une entrée portant externalDirectories n'est jamais auto-approuvée (motif policy.default)", async () => {
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
    expect(out).toMatchObject({ source: "user", decision: "allow" });
    expect(out.reason.code).toBe("policy.default");
    expect(h.asked()).toBe(1);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });
});

describe("Bypass dans la gate : verdicts couverts", () => {
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

  it("(g) une commande Bash sans règle (bash.noRule) reste demandée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now });
    const out = await h.gate.decide(bash("docker run alpine"), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
  });

  it("(g) ls && rm x avec une règle ask sur ls seulement reste demandée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("ls && rm x"), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
  });

  it("(g) une règle Bash ask sans command ne couvre pas la commande", async () => {
    const c = clock();
    const policy: Policy = { default: "ask", rules: [{ tool: "Bash", decision: "ask" }] };
    const h = harness({ bypass: switchOn(c), now: c.now, policy });
    const out = await h.gate.decide(bash("git status"), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
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

/** Système de fichiers fictif : `/ws` est l'espace de travail ; `/ws/link` pointe hors de lui. */
const FAKE_FS: PolicyContext = {
  cwd: "/ws",
  platform: "posix",
  home: "/home/u",
  realpath: (p) => {
    if (p === "/ws/link") return "/etc/passwd";
    if (p === "/ws" || p.startsWith("/ws/")) return p;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
};

/** Fichier sensible du répertoire personnel (`~/.ssh/id_rsa`), absolu. */
const SENSITIVE = join(homedir(), ".ssh", "id_rsa");

/** Règle `ask` sur `cat` : le premier mot est littéral, la commande est couverte. */
const CAT_POLICY: Policy = {
  default: "ask",
  rules: [{ tool: "Bash", command: "cat *", decision: "ask" }],
};

/** Verdict de la politique puis `isBypassable`, dans le contexte donné. */
const bypassableIn = (request: ApprovalRequest, policy: Policy, ws: PolicyContext = WORKSPACE) =>
  isBypassable(request, evaluatePolicy(policy, request.tool, request.input, ws), policy, ws);

describe("isBypassable : chemins de l'entrée (garde-fous jamais contournés)", () => {
  it("une commande Bash sur un chemin absolu sensible ou hors espace reste non bypassable", () => {
    expect(bypassableIn(bash(`cat ${SENSITIVE}`), CAT_POLICY)).toBe(false);
    expect(bypassableIn(bash("cat /opt/hors/x"), CAT_POLICY)).toBe(false);
  });

  it("un argument Bash lié par `=` ou attaché à une option est contrôlé", () => {
    expect(bypassableIn(bash(`cat --file=${SENSITIVE}`), CAT_POLICY)).toBe(false);
    expect(bypassableIn(bash("cat -f/opt/hors/x"), CAT_POLICY)).toBe(false);
  });

  it("un lien symbolique du dépôt pointant hors de l'espace de travail reste non bypassable", () => {
    expect(bypassableIn(bash("cat link"), CAT_POLICY, FAKE_FS)).toBe(false);
    expect(bypassableIn(bash("cat src/a.ts"), CAT_POLICY, FAKE_FS)).toBe(true);
  });

  it("un chemin hors espace ou sensible dans une chaîne d'un outil (même imbriquée) reste non bypassable", () => {
    const mcpWith = (input: Record<string, unknown>): ApprovalRequest => ({
      toolUseId: "m",
      tool: "mcp__demo__ask",
      input,
    });
    expect(bypassableIn(mcpWith({ path: "/etc/passwd" }), ASK_POLICY)).toBe(false);
    expect(bypassableIn(mcpWith({ opts: { items: [{ src: "/opt/hors/x" }] } }), ASK_POLICY)).toBe(
      false,
    );
    expect(bypassableIn(mcpWith({ note: `voir ${SENSITIVE}` }), ASK_POLICY)).toBe(false);
    expect(bypassableIn(mcpWith({ text: "$HOME/.ssh/id_rsa" }), ASK_POLICY)).toBe(false);
    expect(bypassableIn(mcpWith({ text: "~other/secret" }), ASK_POLICY)).toBe(false);
  });

  it("une entrée trop profondément imbriquée n'est pas explorée : refus de bypass (fail-closed)", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 70; i++) deep = { n: deep };
    expect(
      bypassableIn({ toolUseId: "d", tool: "mcp__demo__ask", input: { deep } }, ASK_POLICY),
    ).toBe(false);
  });

  it("contre-exemple : un chemin DANS l'espace de travail reste bypassable", () => {
    expect(bypassableIn(bash("cat src/a.ts"), CAT_POLICY)).toBe(true);
    // `%` dans un argument Bash (format de `git log`) n'est pas un chemin à refuser.
    const gitFormat: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "git log *", decision: "ask" }],
    };
    expect(bypassableIn(bash("git log --format=%H/%s"), gitFormat)).toBe(true);
    const inside = {
      toolUseId: "i",
      tool: "mcp__demo__ask",
      input: { path: join(process.cwd(), "src", "a.ts") },
    };
    expect(bypassableIn(inside, ASK_POLICY)).toBe(true);
    expect(
      bypassableIn(
        { toolUseId: "r", tool: "mcp__demo__ask", input: { path: "src/a.ts" } },
        ASK_POLICY,
      ),
    ).toBe(true);
  });
});

describe("Bypass dans la gate : chemins, constats et plateformes", () => {
  it("un danger shell (redirection) sur une règle ask reste demandé", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("echo x > f"), signal);
    expect(out).toMatchObject({ source: "user", reason: { code: "bash.hazard" } });
    expect(h.asked()).toBe(1);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("une chaîne de deux segments sur une règle ask reste demandée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY });
    const out = await h.gate.decide(bash("echo a | echo b"), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("un Read sur une règle ask hors espace de travail reste demandé", async () => {
    const c = clock();
    const policy: Policy = { default: "ask", rules: [{ tool: "Read", decision: "ask" }] };
    const h = harness({ bypass: switchOn(c), now: c.now, policy });
    const out = await h.gate.decide(
      { toolUseId: "r", tool: "Read", input: { file_path: "/opt/hors-espace/notes.txt" } },
      signal,
    );
    expect(out).toMatchObject({ source: "user", reason: { code: "path.outside" } });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("un chemin non analysable (UNC sous Windows) donne path.unsupported, jamais un bypass", async () => {
    const c = clock();
    const win: PolicyContext = { cwd: process.cwd(), platform: "win32" };
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY, workspace: win });
    const out = await h.gate.decide(
      { toolUseId: "u", tool: "Read", input: { file_path: "\\\\srv\\partage\\a.txt" } },
      signal,
    );
    expect(out).toMatchObject({
      decision: "deny",
      source: "policy",
      reason: { code: "path.unsupported" },
    });
    expect(h.asked()).toBe(0);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("Bash sous win32 sans posixShell n'est jamais bypassé", async () => {
    const c = clock();
    const win: PolicyContext = { cwd: process.cwd(), platform: "win32" };
    const h = harness({ bypass: switchOn(c), now: c.now, policy: ASK_POLICY, workspace: win });
    const out = await h.gate.decide(bash("git status"), signal);
    expect(out).toMatchObject({ source: "user", reason: { code: "shell.unanalyzable" } });
    expect(h.asked()).toBe(1);
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("une commande Bash sur un chemin absolu sensible sous règle cat * est demandée", async () => {
    const c = clock();
    const h = harness({ bypass: switchOn(c), now: c.now, policy: CAT_POLICY });
    const out = await h.gate.decide(bash(`cat ${SENSITIVE}`), signal);
    expect(out).toMatchObject({ source: "user" });
    expect(h.asked()).toBe(1);
    expect(kinds(h.events)).toContain("approval.requested");
    expect(bypassedDecisions(h.events)).toEqual([]);
  });

  it("un outil MCP avec un chemin hors espace ou une chaîne imbriquée hors espace est demandé", async () => {
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
    expect(h.asked()).toBe(2);
    expect(kinds(h.events).filter((k) => k === "approval.requested")).toHaveLength(2);
    expect(bypassedDecisions(h.events)).toEqual([]);
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
