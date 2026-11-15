import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  type EngagementProvider,
  engagementDigest,
  evaluateEngagementStatus,
  evaluatePolicy,
  evaluateProgramStatus,
  type ProgramProvider,
  parseEngagementSheet,
  parseProgramSheet,
  programDigest,
  programTargets,
} from "../src/index.js";

const BURP = "mcp__burp__call_tool";

const cited = <T>(value: T) => ({
  value,
  quote: "Scope",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

const program = (): ProgramProvider => {
  const s = parseProgramSheet({
    version: 1,
    inScope: cited(["*.example.com", "app.test"]),
    outOfScope: cited(["admin.example.com"]),
    pace: cited({ preset: "careful" }),
  });
  const approval = JSON.stringify({
    version: 1,
    digest: programDigest(s),
    approvedAt: "2026-11-07T12:00:00Z",
  });
  return () => evaluateProgramStatus(JSON.stringify(s), approval);
};

const engagement = (halted: boolean): EngagementProvider => {
  const s = parseEngagementSheet({
    version: 1,
    authorization: cited({ principal: "ACME", reference: "RT-1", signatory: "J. Martin" }),
    window: cited({ text: "décembre 2026" }),
    inScope: cited(["*.example.com"]),
    infrastructure: cited(["c2.redteam.example.net"]),
    outOfScope: cited(["admin.example.com"]),
    rulesOfEngagement: cited("Pas de déni de service."),
    whiteTeam: cited({ contact: "white@example.com", deconfliction: "Appel préalable" }),
    osintPolicy: cited("Informations professionnelles publiques."),
  });
  const approval = JSON.stringify({
    version: 1,
    digest: engagementDigest(s),
    approvedAt: "2026-11-08T12:00:00Z",
  });
  return () => ({ status: evaluateEngagementStatus(JSON.stringify(s), approval), halted });
};

const burp = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const raw = (host: string, line = "GET / HTTP/1.1") => `${line}\r\nHost: ${host}\r\n\r\n`;

const verdict = (
  input: Record<string, unknown>,
  opts: { program?: ProgramProvider; engagement?: EngagementProvider } = {},
) =>
  evaluatePolicy(DEFAULT_POLICY, BURP, input, {
    cwd: process.cwd(),
    posixShell: true,
    ...(opts.program && { program: opts.program }),
    ...(opts.engagement && { engagement: opts.engagement }),
  });

const send = (host: string, content?: string) =>
  burp("send_http1_request", {
    content: content ?? raw(host),
    targetHostname: host,
    targetPort: 443,
    usesHttps: true,
  });

describe("programTargets : outils Burp", () => {
  it("lit targetHostname, l'URL absolue et chaque ligne Host", () => {
    expect(programTargets(BURP, send("api.example.com"))).toEqual({
      hosts: ["api.example.com"],
      unresolved: false,
    });
    const absolute = burp("create_repeater_tab", {
      content: raw("b.example.com", "GET http://a.example.com/x HTTP/1.1"),
    });
    expect(programTargets(BURP, absolute)).toEqual({
      hosts: ["a.example.com", "b.example.com"],
      unresolved: false,
    });
  });

  it("lit :authority et host d'une requête HTTP/2", () => {
    const h2 = burp("send_http2_request", {
      pseudoHeaders: { ":authority": "h2.example.com", ":method": "GET" },
      headers: { Host: "other.example.com" },
      targetHostname: "h2.example.com",
    });
    expect(programTargets(BURP, h2)?.hosts).toEqual(["h2.example.com", "other.example.com"]);
  });

  it("outil non ciblé : aucun hôte, rien à résoudre", () => {
    for (const name of ["get_proxy_http_history", "output_project_options", "url_encode"]) {
      expect(programTargets(BURP, burp(name, { count: 5 }))).toEqual({
        hosts: [],
        unresolved: false,
      });
    }
  });

  it("outil inconnu, arguments absents ou hôte illisible : non extractible", () => {
    expect(programTargets(BURP, burp("start_scan", { url: "https://a.example.com" }))).toEqual({
      hosts: [],
      unresolved: true,
    });
    expect(programTargets(BURP, { name: "send_http1_request" })?.unresolved).toBe(true);
    expect(programTargets(BURP, { arguments: {} })?.unresolved).toBe(true);
    expect(
      programTargets(BURP, burp("send_http1_request", { content: "GET / HTTP/1.1\r\n\r\n" }))
        ?.unresolved,
    ).toBe(true);
    expect(programTargets(BURP, burp("send_to_intruder", { targetHostname: "" }))?.unresolved).toBe(
      true,
    );
    expect(programTargets(BURP, burp("set_project_options", { json: "{}" }))?.unresolved).toBe(
      true,
    );
  });

  it("n'agit que sur call_tool de Burp", () => {
    expect(programTargets("mcp__burp__list_tools", {})).toBeNull();
  });
});

describe("évaluation du périmètre pour Burp", () => {
  it("dans le périmètre : la règle existante (ask par défaut) reste, avec les hôtes visés", () => {
    const v = verdict(send("api.example.com"), { program: program() });
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("policy.default");
  });

  it("hors périmètre : ask program.out_of_scope avec l'hôte", () => {
    const v = verdict(send("evil.test"), { program: program() });
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params?.host).toBe("evil.test");
  });

  it("une exclusion l'emporte sur le joker", () => {
    const v = verdict(send("admin.example.com"), { program: program() });
    expect(v.reason.code).toBe("program.out_of_scope");
  });

  it("hôte non extractible ou outil inconnu : program.host_unresolved", () => {
    const noHost = verdict(burp("send_http1_request", { content: "GET / HTTP/1.1\r\n\r\n" }), {
      program: program(),
    });
    expect(noHost.decision).toBe("ask");
    expect(noHost.reason.code).toBe("program.host_unresolved");
    const unknown = verdict(burp("run_active_scan", { url: "https://a.example.com" }), {
      program: program(),
    });
    expect(unknown.reason.code).toBe("program.host_unresolved");
  });

  it("outil non ciblé : verdict inchangé, avec ou sans périmètre", () => {
    const input = burp("get_proxy_http_history", { count: 10, offset: 0 });
    const base = verdict(input);
    for (const opts of [
      { program: program() },
      { engagement: engagement(false) },
      { engagement: engagement(true) },
    ]) {
      expect(verdict(input, opts)).toEqual(base);
    }
    expect(base.reason.code).toBe("policy.default");
  });

  it("requête brute à deux hôtes dont un exclu : refusée (hors périmètre)", () => {
    const content = raw("admin.example.com", "GET https://api.example.com/ HTTP/1.1");
    const v = verdict(burp("send_http1_request", { content, targetHostname: "api.example.com" }), {
      program: program(),
    });
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params?.host).toBe("admin.example.com");
  });

  it("engagement : hors périmètre en ask engagement.out_of_scope", () => {
    const v = verdict(send("evil.test"), { engagement: engagement(false) });
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("engagement.out_of_scope");
    const excluded = verdict(send("admin.example.com"), { engagement: engagement(false) });
    expect(excluded.reason.code).toBe("engagement.out_of_scope");
  });

  it("arrêt d'urgence : deny pour tout outil Burp ciblé, même inconnu", () => {
    for (const input of [
      send("api.example.com"),
      burp("run_active_scan", {}),
      burp("send_http1_request", { content: "GET / HTTP/1.1\r\n\r\n" }),
    ]) {
      const v = verdict(input, { engagement: engagement(true) });
      expect(v.decision).toBe("deny");
      expect(v.reason.code).toBe("engagement.halted");
    }
  });
});

describe("gate : Burp", () => {
  function setup(opts: { halted?: boolean; bypassOn?: boolean; program?: ProgramProvider }) {
    const asked: string[] = [];
    const bypass = createBypassSwitch({ now: () => 0 });
    if (opts.bypassOn) bypass.enable(60_000);
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder({ runId: "r" }),
      workspace: { cwd: process.cwd(), posixShell: true },
      ask: async (request) => {
        asked.push(JSON.stringify(request.input));
        return { decision: "allow", remember: "session" };
      },
      ...(opts.halted !== undefined && { engagement: engagement(opts.halted) }),
      ...(opts.program && { program: opts.program }),
      bypass,
      now: () => 0,
    });
    const decide = (input: Record<string, unknown>, id: string) =>
      gate.decide({ toolUseId: id, tool: BURP, input }, new AbortController().signal);
    return { decide, asked };
  }

  it("arrêt actif : deny sans question, Bypass actif ou non", async () => {
    for (const bypassOn of [false, true]) {
      const { decide, asked } = setup({ halted: true, bypassOn });
      const out = await decide(send("api.example.com"), "a");
      expect(out.decision).toBe("deny");
      expect(out.reason.code).toBe("engagement.halted");
      expect(out.source).toBe("policy");
      expect(asked).toHaveLength(0);
    }
  });

  it("hors périmètre : jamais mémorisé, la question revient à chaque appel", async () => {
    const { decide, asked } = setup({ program: program() });
    await decide(send("evil.test"), "a");
    await decide(send("evil.test"), "b");
    expect(asked).toHaveLength(2);
  });
});
