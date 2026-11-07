import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  evaluatePolicy,
  evaluateProgramStatus,
  HTTP_REQUEST_TOOL,
  hostInScope,
  hostOfTarget,
  type Policy,
  type ProgramProvider,
  type ProgramSheet,
  parseProgramSheet,
  programDigest,
  READ_URL_TOOL,
} from "../src/index.js";

const NMAP = "mcp__kali__nmap_scan";
const NIKTO = "mcp__kali__nikto_scan";

const cited = <T>(value: T) => ({
  value,
  quote: "Scope",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

const sheet = (over: Record<string, unknown> = {}): ProgramSheet =>
  parseProgramSheet({
    version: 1,
    inScope: cited(["*.example.com", "app.test", "10.0.0.0/24"]),
    outOfScope: cited(["admin.example.com", "10.0.0.128/25"]),
    pace: cited({ preset: "careful" }),
    ...over,
  });

const approvedProvider = (s: ProgramSheet = sheet()): ProgramProvider => {
  const text = JSON.stringify(s);
  const approval = JSON.stringify({
    version: 1,
    digest: programDigest(s),
    approvedAt: "2026-11-07T12:00:00Z",
  });
  return () => evaluateProgramStatus(text, approval);
};

const ctx = (program?: ProgramProvider) => ({
  cwd: process.cwd(),
  posixShell: true,
  ...(program && { program }),
});

const verdict = (
  tool: string,
  input: Record<string, unknown>,
  program?: ProgramProvider,
  policy: Policy = DEFAULT_POLICY,
) => evaluatePolicy(policy, tool, input, ctx(program));

describe("hôtes et motifs", () => {
  it("extrait l'hôte d'une URL, d'un hôte:port, d'une IP et d'un CIDR", () => {
    expect(hostOfTarget("https://API.Example.com:8443/x?y=1")).toBe("api.example.com");
    expect(hostOfTarget("app.test:80")).toBe("app.test");
    expect(hostOfTarget("scan@10.0.0.5")).toBe("10.0.0.5");
    expect(hostOfTarget("10.0.0.0/24")).toBe("10.0.0.0/24");
    expect(hostOfTarget("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(hostOfTarget("example.com.")).toBe("example.com");
    expect(hostOfTarget("")).toBeNull();
  });

  it("exclusion prioritaire, joker strict, non listé hors périmètre", () => {
    const s = sheet();
    expect(hostInScope(s, "api.example.com")).toBe(true);
    expect(hostInScope(s, "example.com")).toBe(false); // le joker exclut l'apex
    expect(hostInScope(s, "notexample.com")).toBe(false);
    expect(hostInScope(s, "admin.example.com")).toBe(false);
    expect(hostInScope(s, "app.test")).toBe(true);
    expect(hostInScope(s, "evil.test")).toBe(false);
  });

  it("IP et CIDR : appartenance, exclusion et recoupement", () => {
    const s = sheet();
    expect(hostInScope(s, "10.0.0.7")).toBe(true);
    expect(hostInScope(s, "10.0.0.200")).toBe(false); // exclu par 10.0.0.128/25
    expect(hostInScope(s, "10.0.1.7")).toBe(false);
    expect(hostInScope(s, "10.0.0.0/25")).toBe(true);
    expect(hostInScope(s, "10.0.0.0/24")).toBe(false); // recoupe l'exclusion
    expect(hostInScope(s, "10.0.0.0/16")).toBe(false); // plus large que le périmètre
    expect(hostInScope(sheet({ inScope: cited(["2001:db8::/32"]) }), "2001:db8::1")).toBe(true);
    expect(hostInScope(sheet({ inScope: cited(["2001:db8::/32"]) }), "2001:db9::1")).toBe(false);
  });
});

describe("evaluateProgram", () => {
  it("hôte hors périmètre → ask program.out_of_scope (outil Kali)", () => {
    const v = verdict(NMAP, { target: "evil.test" }, approvedProvider());
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params).toMatchObject({ host: "evil.test", tool: NMAP });
  });

  it("une cible dans le périmètre garde le verdict d'origine pour un outil Kali", () => {
    const v = verdict(NMAP, { target: "api.example.com" }, approvedProvider());
    expect(v.reason.code).toBe("policy.default");
  });

  it("plusieurs cibles : une seule hors périmètre suffit, et elle seule est nommée", () => {
    const v = verdict(NMAP, { target: "api.example.com evil.test" }, approvedProvider());
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params?.host).toBe("evil.test");
  });

  it("deny conservé : une règle deny n'est jamais transformée", () => {
    const deny: Policy = { default: "ask", rules: [{ tool: NMAP, decision: "deny" }] };
    expect(verdict(NMAP, { target: "evil.test" }, approvedProvider(), deny).decision).toBe("deny");
    const denyRead: Policy = { default: "ask", rules: [{ tool: READ_URL_TOOL, decision: "deny" }] };
    const v = verdict(
      READ_URL_TOOL,
      { url: "https://api.example.com/" },
      approvedProvider(),
      denyRead,
    );
    expect(v.decision).toBe("deny");
  });

  it("une règle allow explicite reste allow dans le périmètre, repasse en ask dehors", () => {
    const allow: Policy = { default: "ask", rules: [{ tool: NMAP, decision: "allow" }] };
    expect(verdict(NMAP, { target: "api.example.com" }, approvedProvider(), allow).decision).toBe(
      "allow",
    );
    expect(verdict(NMAP, { target: "evil.test" }, approvedProvider(), allow).reason.code).toBe(
      "program.out_of_scope",
    );
  });

  it("fiche absente, brouillon, suspendue, invalidée : aucun effet", () => {
    const s = sheet();
    const text = JSON.stringify(s);
    const approval = (extra: object = {}) =>
      JSON.stringify({
        version: 1,
        digest: programDigest(s),
        approvedAt: "2026-11-07T12:00:00Z",
        ...extra,
      });
    const providers: ProgramProvider[] = [
      () => ({ state: "none" }),
      () => evaluateProgramStatus(text, null),
      () => evaluateProgramStatus(text, approval({ suspendedAt: "2026-11-07T13:00:00Z" })),
      () =>
        evaluateProgramStatus(
          JSON.stringify(sheet({ inScope: cited(["*.evil.test"]) })),
          approval(),
        ),
    ];
    for (const provider of providers) {
      expect(verdict(NMAP, { target: "evil.test" }, provider).reason.code).toBe("policy.default");
      expect(verdict(READ_URL_TOOL, { url: "https://evil.test/" }, provider).reason.code).toBe(
        "policy.default",
      );
    }
    expect(verdict(NMAP, { target: "evil.test" }).reason.code).toBe("policy.default");
  });

  it("fiche illisible (ou fournisseur qui lève) → ask program.unreadable", () => {
    const broken: ProgramProvider = () =>
      evaluateProgramStatus(null, JSON.stringify({ version: 1, digest: "zz" }));
    const throwing: ProgramProvider = () => {
      throw new Error("EACCES");
    };
    for (const provider of [broken, throwing]) {
      const v = verdict(NMAP, { target: "api.example.com" }, provider);
      expect(v.decision).toBe("ask");
      expect(v.reason.code).toBe("program.unreadable");
      // read_url vers une source de référence (allow) repasse aussi en ask.
      expect(verdict(READ_URL_TOOL, { url: "https://nvd.nist.gov/" }, provider).reason.code).toBe(
        "program.unreadable",
      );
    }
    // Un outil sans hôte visible n'est pas concerné.
    expect(verdict("Read", { file_path: "a.txt" }, broken).decision).toBe("allow");
  });

  it("read_url dans le périmètre : ask par défaut → allow program.in_scope ; http_request idem", () => {
    const provider = approvedProvider();
    const v = verdict(READ_URL_TOOL, { url: "https://api.example.com/docs" }, provider);
    expect(v.decision).toBe("allow");
    expect(v.reason.code).toBe("program.in_scope");
    expect(verdict(HTTP_REQUEST_TOOL, { url: "https://app.test/x" }, provider).reason.code).toBe(
      "program.in_scope",
    );
    const out = verdict(READ_URL_TOOL, { url: "https://evil.test/" }, provider);
    expect(out.decision).toBe("ask");
    expect(out.reason.code).toBe("program.out_of_scope");
  });

  it("read_url dans le périmètre avec secret dans l'URL → web.query_sensitive reste prioritaire", () => {
    const v = verdict(
      READ_URL_TOOL,
      { url: "https://api.example.com/x?token=abcdef123456" },
      approvedProvider(),
    );
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("web.query_sensitive");
    // Même hors périmètre : la garde non mémorisable l'emporte.
    const out = verdict(
      READ_URL_TOOL,
      { url: "https://evil.test/x?token=abcdef123456" },
      approvedProvider(),
    );
    expect(out.reason.code).toBe("web.query_sensitive");
  });

  it("sans fournisseur : aucun effet sur read_url", () => {
    expect(verdict(READ_URL_TOOL, { url: "https://api.example.com/" }).reason.code).toBe(
      "policy.default",
    );
  });
});

describe("gate : mémorisation par hôte", () => {
  function setup(program: ProgramProvider, options: { bypass?: boolean } = {}) {
    const recorder = createRecorder({ runId: "r" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const asked: string[] = [];
    const bypass = createBypassSwitch({ now: () => 0 });
    if (options.bypass) bypass.enable(60_000);
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: { cwd: process.cwd(), posixShell: true },
      ask: async (request) => {
        asked.push(JSON.stringify(request.input));
        return { decision: "allow", remember: "session" };
      },
      program,
      bypass,
      now: () => 0,
    });
    const decide = (tool: string, input: Record<string, unknown>, id: string) =>
      gate.decide({ toolUseId: id, tool, input }, new AbortController().signal);
    return { decide, asked, events };
  }

  it("« session » mémorisée pour un hôte ne couvre pas un autre hôte", async () => {
    const { decide, asked } = setup(approvedProvider());
    expect((await decide(NMAP, { target: "evil.test" }, "a")).decision).toBe("allow");
    const again = await decide(NMAP, { target: "evil.test" }, "b");
    expect(again.reason.code).toBe("approval.remembered");
    expect(asked).toHaveLength(1);
    const other = await decide(NMAP, { target: "other.test" }, "c");
    expect(other.reason.code).toBe("program.out_of_scope");
    expect(asked).toHaveLength(2);
    // Un autre outil vers le même hôte est couvert : la clé est l'hôte, pas l'outil.
    const sameHost = await decide(NIKTO, { target: "evil.test" }, "d");
    expect(sameHost.reason.code).toBe("approval.remembered");
  });

  it("la session de nmap_scan (cible dans le périmètre) ne couvre pas un hôte hors périmètre", async () => {
    const { decide, asked } = setup(approvedProvider());
    await decide(NMAP, { target: "api.example.com" }, "a");
    expect(asked).toHaveLength(1);
    const r = await decide(NMAP, { target: "api.example.com" }, "b");
    expect(r.reason.code).toBe("approval.remembered");
    const out = await decide(NMAP, { target: "evil.test" }, "c");
    expect(out.reason.code).not.toBe("approval.remembered");
    expect(asked).toHaveLength(2);
  });

  it("fiche illisible : jamais mémorisée", async () => {
    const { decide, asked } = setup(() => ({ state: "unreadable" }));
    await decide(NMAP, { target: "api.example.com" }, "a");
    await decide(NMAP, { target: "api.example.com" }, "b");
    expect(asked).toHaveLength(2);
  });

  it("Bypass actif : out_of_scope contourné (approval.bypassed), sans mémorisation", async () => {
    const { decide, asked, events } = setup(approvedProvider(), { bypass: true });
    const out = await decide(NMAP, { target: "evil.test" }, "a");
    expect(out.decision).toBe("allow");
    expect(out.source).toBe("bypass");
    expect(out.reason.code).toBe("approval.bypassed");
    expect(out.reason.cause?.code).toBe("program.out_of_scope");
    expect(asked).toHaveLength(0);
    expect(events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
  });

  it("read_url dans le périmètre est autorisé sans demande", async () => {
    const { decide, asked } = setup(approvedProvider());
    const out = await decide(READ_URL_TOOL, { url: "https://api.example.com/" }, "a");
    expect(out.decision).toBe("allow");
    expect(out.reason.code).toBe("program.in_scope");
    expect(asked).toHaveLength(0);
  });
});
