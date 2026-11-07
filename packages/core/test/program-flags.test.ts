import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  evaluateProgramStatus,
  type Policy,
  type ProgramProvider,
  parseProgramSheet,
  programDigest,
} from "../src/index.js";

const EXEC = "mcp__kali__execute_command";
const SUFFIX = "bugbounty-alice";

const cited = <T>(value: T) => ({
  value,
  quote: "Règles",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

interface Options {
  suffix?: string | null;
  pace?: unknown;
}

/** Fiche approuvée : suffixe `bugbounty-alice` et préréglage `careful` (0,2 req/s) par défaut. */
const provider = ({
  suffix = SUFFIX,
  pace = { preset: "careful" },
}: Options = {}): ProgramProvider => {
  const sheet = parseProgramSheet({
    version: 1,
    inScope: cited(["*.example.com", "app.test"]),
    outOfScope: cited(["admin.example.com"]),
    ...(suffix !== null && { userAgentSuffix: cited(suffix) }),
    pace: cited(pace),
  });
  return () =>
    evaluateProgramStatus(
      JSON.stringify(sheet),
      JSON.stringify({
        version: 1,
        digest: programDigest(sheet),
        approvedAt: "2026-11-07T12:00:00Z",
      }),
    );
};

const verdict = (
  command: string,
  program: ProgramProvider | null = provider(),
  policy: Policy = DEFAULT_POLICY,
  tool = EXEC,
  input: Record<string, unknown> = { command },
) =>
  evaluatePolicy(policy, tool, input, {
    cwd: process.cwd(),
    posixShell: true,
    ...(program && { program }),
  });

const UA = `Mozilla/5.0 ${SUFFIX}`;
const H = "https://api.example.com";

/** Binaire, commande conforme, commande sans aucun drapeau (careful : UA + ≤ 0,2 req/s). */
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ["curl", `curl -A '${UA}' ${H}/x`, `curl ${H}/x`],
  ["wget", `wget --user-agent='${UA}' ${H}/x`, `wget ${H}/x`],
  ["sqlmap", `sqlmap -u '${H}/?id=1' --user-agent='${UA}' --delay 5`, `sqlmap -u '${H}/?id=1'`],
  ["ffuf", `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -rate 0.2`, `ffuf -u ${H}/FUZZ -w w`],
  ["nuclei", `nuclei -u ${H} -H 'User-Agent: ${UA}' -rl 0.2`, `nuclei -u ${H}`],
  ["httpx", `httpx -u ${H} -H 'User-Agent: ${UA}' -rl 0.2`, `httpx -u ${H}`],
  ["gobuster", `gobuster dir -u ${H} -w w -a '${UA}' --delay 5s`, `gobuster dir -u ${H} -w w`],
  [
    "nmap",
    `nmap -sV --script http-title --script-args http.useragent='${UA}' --max-rate 0.2 api.example.com`,
    "nmap -sV api.example.com",
  ],
];

describe("drapeaux attendus (ADR 0040, lot 7)", () => {
  it.each(CASES)(
    "%s : conforme → inchangé, sans drapeaux → program.flag_missing",
    (binary, ok, bad) => {
      expect(verdict(ok).reason.code, ok).toBe("shell.unanalyzable");
      const v = verdict(bad);
      expect(v.decision).toBe("ask");
      expect(v.reason.code).toBe("program.flag_missing");
      expect(v.reason.params?.binary).toBe(binary);
      expect(typeof v.reason.params?.flag).toBe("string");
      expect(v.rule).toBeNull();
    },
  );

  it("variantes de syntaxe du User-Agent", () => {
    for (const c of [
      `curl --user-agent '${UA}' ${H}`,
      `curl --user-agent='${UA}' ${H}`,
      `curl -sA '${UA}' ${H}`,
      `curl -H 'user-agent: ${UA}' ${H}`,
      `wget -U '${UA}' ${H}`,
      `sqlmap -u ${H}/?a=1 -A '${UA}' --delay=5`,
      `gobuster dir -u ${H} --useragent '${UA}' --delay 6s`,
      `nmap --script-args 'foo=1,http.useragent="${UA}"' --scan-delay 5s api.example.com`,
      `nmap --script-args http.useragent=${SUFFIX} --scan-delay 10 api.example.com`,
      `httpx -u ${H} -header 'User-Agent: ${UA}' -rate-limit 0.1`,
      `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -p 5`,
      `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -p 5-10`,
      `nuclei -u ${H} -H 'User-Agent: ${UA}' -rate-limit 0.2`,
    ]) {
      expect(verdict(c).reason.code, c).toBe("shell.unanalyzable");
    }
  });

  it("suffixe absent du User-Agent → flag_missing", () => {
    for (const c of [
      `curl -A 'curl/8.0' ${H}`,
      `curl -H 'Accept: */*' ${H}`,
      `wget --user-agent=Mozilla ${H}`,
      `ffuf -u ${H}/FUZZ -w w -H 'X-User-Agent: ${UA}' -rate 0.2`,
      `nuclei -u ${H} -H 'User-Agent: autre' -rl 0.2`,
      `nmap --script-args http.useragent=autre --max-rate 0.2 api.example.com`,
      `nmap --max-rate 0.2 api.example.com`,
    ]) {
      const v = verdict(c);
      expect(v.reason.code, c).toBe("program.flag_missing");
    }
  });

  it("débit trop élevé, nul ou illisible → flag_missing", () => {
    for (const c of [
      `sqlmap -u ${H}/?a=1 -A '${UA}' --delay 1`,
      `sqlmap -u ${H}/?a=1 -A '${UA}' --delay 0`,
      `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -rate 10`,
      `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -p 0.5`,
      `nuclei -u ${H} -H 'User-Agent: ${UA}' -rl 150`,
      `httpx -u ${H} -H 'User-Agent: ${UA}' -rl 1`,
      `gobuster dir -u ${H} -w w -a '${UA}' --delay 100ms`,
      `gobuster dir -u ${H} -w w -a '${UA}' --delay 5`,
      `nmap --script-args http.useragent=${SUFFIX} --max-rate 1000 api.example.com`,
      `nmap --script-args http.useragent=${SUFFIX} --scan-delay 1s api.example.com`,
      `nmap --script-args http.useragent=${SUFFIX} --scan-delay abc api.example.com`,
    ]) {
      expect(verdict(c).reason.code, c).toBe("program.flag_missing");
    }
  });

  it("le débit suit la fiche : préréglages et plafond explicite", () => {
    const cmdRate = (rate: number) => `ffuf -u ${H}/FUZZ -w w -H 'User-Agent: ${UA}' -rate ${rate}`;
    const fast = provider({ pace: { preset: "fast" } });
    expect(verdict(cmdRate(1), fast).reason.code).toBe("shell.unanalyzable");
    expect(verdict(cmdRate(2), fast).reason.code).toBe("program.flag_missing");
    const normal = provider({ pace: { preset: "normal" } });
    expect(verdict(cmdRate(0.5), normal).reason.code).toBe("shell.unanalyzable");
    expect(verdict(cmdRate(0.6), normal).reason.code).toBe("program.flag_missing");
    const custom = provider({ pace: { maxRequestsPerSecond: 10 } });
    expect(verdict(cmdRate(10), custom).reason.code).toBe("shell.unanalyzable");
    expect(verdict(cmdRate(11), custom).reason.code).toBe("program.flag_missing");
  });

  it("curl et wget : seul le User-Agent est exigé, pas de débit", () => {
    const v = verdict(`curl -A '${UA}' ${H}`);
    expect(v.reason.code).toBe("shell.unanalyzable");
  });

  it("sans suffixe dans la fiche : aucune exigence de User-Agent (le débit reste exigé)", () => {
    const none = provider({ suffix: null });
    expect(verdict(`curl ${H}`, none).reason.code).toBe("shell.unanalyzable");
    expect(verdict(`wget ${H}`, none).reason.code).toBe("shell.unanalyzable");
    expect(verdict(`ffuf -u ${H}/FUZZ -w w -rate 0.2`, none).reason.code).toBe(
      "shell.unanalyzable",
    );
    expect(verdict(`ffuf -u ${H}/FUZZ -w w`, none).reason.code).toBe("program.flag_missing");
  });

  it("sans fiche (ou non approuvée) : aucune exigence", () => {
    expect(verdict(`curl ${H}`, null).reason.code).toBe("shell.unanalyzable");
    const draft: ProgramProvider = () =>
      evaluateProgramStatus(
        JSON.stringify({
          version: 1,
          inScope: cited(["app.test"]),
          outOfScope: cited([]),
          pace: cited({ preset: "careful" }),
        }),
        null,
      );
    expect(verdict(`ffuf -u ${H}/FUZZ -w w`, draft).reason.code).toBe("shell.unanalyzable");
  });

  it("priorités : hors périmètre et hôte non résolu l'emportent", () => {
    expect(verdict("curl https://evil.test/").reason.code).toBe("program.out_of_scope");
    expect(verdict(`curl ${H} ; curl https://evil.test/`).reason.code).toBe("program.out_of_scope");
    expect(verdict("curl $URL").reason.code).toBe("program.host_unresolved");
    expect(verdict("nmap -iL l.txt").reason.code).toBe("program.host_unresolved");
  });

  it("commande chaînée : chaque appel est vérifié, un binaire fautif suffit", () => {
    const ok = `curl -A '${UA}' ${H}`;
    expect(verdict(`${ok} && ${ok}`).reason.code).toBe("shell.unanalyzable");
    expect(verdict(`${ok} && curl ${H}/b`).reason.code).toBe("program.flag_missing");
    const two = verdict(`curl ${H} ; wget ${H}`);
    expect(two.reason.code).toBe("program.flag_missing");
    expect(two.reason.params?.binary).toBe("curl, wget");
  });

  it("argv direct (task_start) et Bash avec règle allow", () => {
    const argv = ["curl", "-A", UA, `${H}/x`];
    const task = (a: string[]) =>
      verdict("", provider(), DEFAULT_POLICY, "mcp__kali__task_start", { argv: a });
    expect(task(argv).reason.code).toBe("shell.unanalyzable");
    expect(task(["curl", `${H}/x`]).reason.code).toBe("program.flag_missing");
    const allow: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "*", decision: "allow" }],
    };
    const bash = (command: string) => verdict(command, provider(), allow, "Bash", { command });
    expect(bash(`curl -A '${UA}' ${H}`).decision).toBe("allow");
    const v = bash(`curl ${H}`);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("program.flag_missing");
  });

  it("deny conservé : jamais transformé", () => {
    const deny: Policy = { default: "ask", rules: [{ tool: EXEC, decision: "deny" }] };
    expect(verdict(`curl ${H}`, provider(), deny).decision).toBe("deny");
    const bashDeny: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "curl *", decision: "deny" }],
    };
    expect(
      verdict(`curl ${H}`, provider(), bashDeny, "Bash", { command: `curl ${H}` }).decision,
    ).toBe("deny");
  });
});

describe("mémorisation par binaire", () => {
  const setup = () => {
    let asked = 0;
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder({ runId: "r" }),
      workspace: { cwd: process.cwd(), posixShell: true },
      ask: async () => {
        asked++;
        return { decision: "allow", remember: "session" };
      },
      program: provider(),
      bypass: createBypassSwitch({ now: () => 0 }),
      now: () => 0,
    });
    let n = 0;
    const decide = (command: string) =>
      gate.decide(
        { toolUseId: `t${n++}`, tool: EXEC, input: { command } },
        new AbortController().signal,
      );
    return { decide, asked: () => asked };
  };

  it("execute_command : jamais mémorisé par binaire (shell non analysable)", async () => {
    const { decide, asked } = setup();
    expect((await decide(`curl ${H}/a`)).decision).toBe("allow");
    expect(asked()).toBe(1);
    // Même binaire : redemandé, un « toujours » ne lève pas le shell non analysable.
    const again = await decide(`curl https://app.test/b`);
    expect(again.reason.code).not.toBe("approval.remembered");
    expect(asked()).toBe(2);
  });

  it("plusieurs binaires fautifs : non mémorisable", async () => {
    const { decide, asked } = setup();
    await decide(`curl ${H} ; wget ${H}`);
    const again = await decide(`curl ${H} ; wget ${H}`);
    expect(again.reason.code).not.toBe("approval.remembered");
    expect(asked()).toBe(2);
  });

  it("la mémorisation ne vaut pas pour un hôte hors périmètre ni un hôte non résolu", async () => {
    const { decide, asked } = setup();
    await decide(`curl ${H}/a`);
    const before = asked();
    const out = await decide("curl https://evil.test/");
    expect(out.reason.code).not.toBe("approval.remembered");
    const unresolved = await decide("curl $URL");
    expect(unresolved.reason.code).not.toBe("approval.remembered");
    expect(asked()).toBe(before + 2);
  });
});
