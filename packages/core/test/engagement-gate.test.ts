import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  type EngagementProvider,
  type EngagementSheet,
  engagementDigest,
  evaluateEngagementStatus,
  evaluatePolicy,
  evaluateProgramStatus,
  HTTP_REQUEST_TOOL,
  type Policy,
  type ProgramProvider,
  parseEngagementSheet,
  parseProgramSheet,
  programDigest,
  READ_URL_TOOL,
} from "../src/index.js";

const NMAP = "mcp__kali__nmap_scan";
const EXEC = "mcp__kali__execute_command";

const cited = <T>(value: T) => ({
  value,
  quote: "Lettre de mission",
  url: "https://example.com/mission",
  retrievedAt: "2026-11-08T10:00:00Z",
  verified: true,
});

const sheet = (): EngagementSheet =>
  parseEngagementSheet({
    version: 1,
    authorization: cited({ principal: "ACME", reference: "RT-1", signatory: "J. Martin" }),
    window: cited({ text: "décembre 2026" }),
    inScope: cited(["*.example.com", "10.0.0.0/24"]),
    infrastructure: cited(["c2.redteam.example.net"]),
    outOfScope: cited(["admin.example.com"]),
    rulesOfEngagement: cited("Pas de déni de service."),
    whiteTeam: cited({ contact: "white@example.com", deconfliction: "Appel préalable" }),
    osintPolicy: cited("Informations professionnelles publiques."),
  });

const approved = (halted = false): EngagementProvider => {
  const s = sheet();
  const draft = JSON.stringify(s);
  const approval = JSON.stringify({
    version: 1,
    digest: engagementDigest(s),
    approvedAt: "2026-11-08T12:00:00Z",
  });
  return () => ({ status: evaluateEngagementStatus(draft, approval), halted });
};
const haltOnly: EngagementProvider = () => ({ status: { state: "none" }, halted: true });
const draftOnly: EngagementProvider = () => ({
  status: evaluateEngagementStatus(JSON.stringify(sheet()), null),
  halted: false,
});

const ctx = (engagement?: EngagementProvider, program?: ProgramProvider) => ({
  cwd: process.cwd(),
  posixShell: true,
  ...(engagement && { engagement }),
  ...(program && { program }),
});

const verdict = (
  tool: string,
  input: Record<string, unknown>,
  engagement?: EngagementProvider,
  policy: Policy = DEFAULT_POLICY,
  program?: ProgramProvider,
) => evaluatePolicy(policy, tool, input, ctx(engagement, program));

describe("arrêt d'urgence : verdict", () => {
  const calls: [string, string, Record<string, unknown>][] = [
    ["read_url", READ_URL_TOOL, { url: "https://api.example.com/" }],
    ["http_request", HTTP_REQUEST_TOOL, { url: "https://api.example.com/" }],
    ["cible Kali", NMAP, { target: "api.example.com" }],
    ["commande curl", "Bash", { command: "curl https://api.example.com/" }],
    ["hors périmètre aussi", READ_URL_TOOL, { url: "https://evil.test/" }],
  ];
  for (const [name, tool, input] of calls) {
    it(`${name} → deny engagement.halted`, () => {
      for (const provider of [haltOnly, approved(true)]) {
        const v = verdict(tool, input, provider);
        expect(v.decision).toBe("deny");
        expect(v.reason.code).toBe("engagement.halted");
      }
    });
  }

  it("transforme aussi un deny préexistant d'un outil réseau (le Bypass le lèverait sinon)", () => {
    const policy: Policy = {
      default: "ask",
      rules: [{ tool: READ_URL_TOOL, decision: "deny" }],
    };
    expect(verdict(READ_URL_TOOL, { url: "https://a.test/" }, undefined, policy).reason.code).toBe(
      "policy.rule",
    );
    expect(verdict(READ_URL_TOOL, { url: "https://a.test/" }, haltOnly, policy).reason.code).toBe(
      "engagement.halted",
    );
  });

  it("n'atteint pas les outils non réseau", () => {
    const allow: Policy = { default: "allow", rules: [] };
    for (const [tool, input] of [
      ["Read", { file_path: `${process.cwd()}/README.md` }],
      ["mcp__desk__record_finding", { title: "x" }],
      ["Bash", { command: "ls -la" }],
    ] as [string, Record<string, unknown>][]) {
      expect(verdict(tool, input, haltOnly, allow).reason.code).not.toBe("engagement.halted");
    }
  });

  it("un fournisseur qui lève vaut arrêt actif", () => {
    const boom: EngagementProvider = () => {
      throw new Error("lecture");
    };
    expect(verdict(READ_URL_TOOL, { url: "https://a.test/" }, boom).reason.code).toBe(
      "engagement.halted",
    );
  });
});

describe("engagement approuvé : verdict", () => {
  it("hôte hors périmètre et hors infrastructure → ask par hôte", () => {
    const v = verdict(READ_URL_TOOL, { url: "https://evil.test/" }, approved());
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("engagement.out_of_scope");
    expect(v.reason.params?.host).toBe("evil.test");
  });

  it("hôte exclu → ask, même sous un joker", () => {
    const v = verdict(NMAP, { target: "admin.example.com" }, approved());
    expect(v.reason.code).toBe("engagement.out_of_scope");
  });

  it("hôte d'infrastructure → allow engagement.infrastructure", () => {
    const v = verdict(READ_URL_TOOL, { url: "https://c2.redteam.example.net/" }, approved());
    expect(v.decision).toBe("allow");
    expect(v.reason.code).toBe("engagement.infrastructure");
  });

  it("hôte inScope → base inchangée", () => {
    const v = verdict(READ_URL_TOOL, { url: "https://api.example.com/" }, approved());
    expect(v.reason.code).toBe("policy.default");
  });

  it("outil Kali vers l'infrastructure : base inchangée (pas d'allow)", () => {
    const v = verdict(NMAP, { target: "c2.redteam.example.net" }, approved());
    expect(v.decision).toBe("ask");
    expect(v.reason.code).not.toBe("engagement.infrastructure");
  });

  it("deny et ask de garde conservés", () => {
    const deny: Policy = { default: "ask", rules: [{ tool: READ_URL_TOOL, decision: "deny" }] };
    expect(
      verdict(READ_URL_TOOL, { url: "https://evil.test/" }, approved(), deny).reason.code,
    ).toBe("policy.rule");
    const sensitive = verdict(
      READ_URL_TOOL,
      { url: "https://evil.test/x?token=abcdef123456" },
      approved(),
    );
    expect(sensitive.reason.code).toBe("web.query_sensitive");
  });

  it("commande shell hors périmètre → ask (non mémorisable par la gate)", () => {
    const allow: Policy = { default: "allow", rules: [] };
    const v = verdict("Bash", { command: "curl https://evil.test/" }, approved(), allow);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("engagement.out_of_scope");
  });

  it("sans arrêt ni engagement approuvé : aucun effet", () => {
    for (const provider of [
      undefined,
      draftOnly,
      () => ({ status: { state: "none" as const }, halted: false }),
    ]) {
      const v = verdict(READ_URL_TOOL, { url: "https://evil.test/" }, provider);
      expect(v.reason.code).toBe("policy.default");
    }
  });
});

describe("programme puis engagement", () => {
  const program: ProgramProvider = () => {
    const s = parseProgramSheet({
      version: 1,
      inScope: cited(["*.example.com", "evil.test"]),
      outOfScope: cited([]),
      pace: cited({ preset: "careful" }),
    });
    return evaluateProgramStatus(
      JSON.stringify(s),
      JSON.stringify({ version: 1, digest: programDigest(s), approvedAt: "2026-11-08T12:00:00Z" }),
    );
  };

  it("hôte dans le programme mais hors engagement → ask engagement", () => {
    const v = verdict(
      READ_URL_TOOL,
      { url: "https://evil.test/" },
      approved(),
      DEFAULT_POLICY,
      program,
    );
    expect(v.reason.code).toBe("engagement.out_of_scope");
  });

  it("hôte dans les deux → allow du programme", () => {
    const v = verdict(
      READ_URL_TOOL,
      { url: "https://api.example.com/" },
      approved(),
      DEFAULT_POLICY,
      program,
    );
    expect(v.reason.code).toBe("program.in_scope");
  });
});

describe("gate : arrêt d'urgence et mémorisation", () => {
  function setup(engagement: EngagementProvider, bypassOn = false) {
    const asked: string[] = [];
    const bypass = createBypassSwitch({ now: () => 0 });
    if (bypassOn) bypass.enable(60_000);
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder({ runId: "r" }),
      workspace: { cwd: process.cwd(), posixShell: true },
      ask: async (request) => {
        asked.push(JSON.stringify(request.input));
        return { decision: "allow", remember: "session" };
      },
      engagement,
      bypass,
      now: () => 0,
    });
    const decide = (tool: string, input: Record<string, unknown>, id: string) =>
      gate.decide({ toolUseId: id, tool, input }, new AbortController().signal);
    return { decide, asked };
  }

  it("arrêt actif : deny sans question, Bypass actif ou non", async () => {
    for (const bypassOn of [false, true]) {
      const { decide, asked } = setup(approved(true), bypassOn);
      for (const [tool, input] of [
        [READ_URL_TOOL, { url: "https://api.example.com/" }],
        [HTTP_REQUEST_TOOL, { url: "https://api.example.com/" }],
        [NMAP, { target: "api.example.com" }],
        ["Bash", { command: "curl https://api.example.com/" }],
      ] as [string, Record<string, unknown>][]) {
        const out = await decide(tool, input, tool);
        expect(out.decision).toBe("deny");
        expect(out.reason.code).toBe("engagement.halted");
        expect(out.source).toBe("policy");
      }
      expect(asked).toHaveLength(0);
    }
  });

  it("Bypass actif sans arrêt : hors périmètre contourné comme avant", async () => {
    const { decide } = setup(approved(), true);
    const out = await decide(READ_URL_TOOL, { url: "https://evil.test/" }, "a");
    expect(out.source).toBe("bypass");
  });

  it("session mémorisée par hôte, jamais pour une commande shell", async () => {
    const { decide, asked } = setup(approved());
    await decide(NMAP, { target: "evil.test" }, "a");
    expect((await decide(NMAP, { target: "evil.test" }, "b")).reason.code).toBe(
      "approval.remembered",
    );
    expect((await decide(NMAP, { target: "other.test" }, "c")).reason.code).not.toBe(
      "approval.remembered",
    );
    expect(asked).toHaveLength(2);
    const sh = { command: "curl https://evil.test/" };
    await decide(EXEC, sh, "d");
    await decide(EXEC, sh, "e");
    expect(asked).toHaveLength(4);
  });

  it("une approbation de session passe après la levée de l'arrêt : l'arrêt prime sur la session", async () => {
    let halted = false;
    const base = approved();
    const { decide } = setup(() => ({ ...base(), halted }));
    await decide(NMAP, { target: "evil.test" }, "a");
    halted = true;
    const out = await decide(NMAP, { target: "evil.test" }, "b");
    expect(out.reason.code).toBe("engagement.halted");
  });
});
