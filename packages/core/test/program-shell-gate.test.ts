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
  type ProgramSheet,
  parseProgramSheet,
  programDigest,
  programHosts,
} from "../src/index.js";

const EXEC = "mcp__kali__execute_command";
const TASK = "mcp__kali__task_start";
const EXEGOL_EXEC = "mcp__exegol__exec";

const cited = <T>(value: T) => ({
  value,
  quote: "Scope",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified: true,
});

const sheet = (): ProgramSheet =>
  parseProgramSheet({
    version: 1,
    inScope: cited(["*.example.com", "app.test", "10.0.0.0/24"]),
    outOfScope: cited(["admin.example.com"]),
    pace: cited({ preset: "careful" }),
  });

const approved: ProgramProvider = () => {
  const s = sheet();
  return evaluateProgramStatus(
    JSON.stringify(s),
    JSON.stringify({ version: 1, digest: programDigest(s), approvedAt: "2026-11-07T12:00:00Z" }),
  );
};

const verdict = (
  tool: string,
  input: Record<string, unknown>,
  program?: ProgramProvider,
  policy: Policy = DEFAULT_POLICY,
) =>
  evaluatePolicy(policy, tool, input, {
    cwd: process.cwd(),
    posixShell: true,
    ...(program && { program }),
  });

const cmd = (command: string, program: ProgramProvider | null = approved) =>
  verdict(EXEC, { command }, program ?? undefined);

/** Commandes dont l'hôte est dans le périmètre, puis hors périmètre, par binaire. */
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "curl",
    "curl -sSL -H 'Host: evil.test' -o out.html https://api.example.com/x",
    "curl -s https://evil.test/x",
  ],
  ["curl --url", "curl --url=https://app.test/a", "curl --url https://evil.test/a"],
  ["wget", "wget -q -O page.html http://app.test/index", "wget http://evil.test/index"],
  ["httpx", "httpx -u https://api.example.com -silent -rl 0.2", "httpx -u evil.test -silent"],
  [
    "nmap",
    "nmap -sV -p 80,443 --max-rate 0.2 -oN scan.txt api.example.com",
    "nmap -sV -p 80 evil.test",
  ],
  ["nmap CIDR", "nmap -sn --max-rate 0.2 10.0.0.0/25", "nmap -sn 10.0.1.0/24"],
  [
    "sqlmap",
    "sqlmap -u 'https://api.example.com/?id=1' --batch --delay 5",
    "sqlmap --url https://evil.test/?id=1",
  ],
  [
    "ffuf",
    "ffuf -u https://api.example.com/FUZZ -w words.txt -rate 0.2",
    "ffuf -u https://evil.test/FUZZ -w words.txt",
  ],
  [
    "nuclei",
    "nuclei -u https://api.example.com -t cves/ -rl 0.2",
    "nuclei -target https://evil.test",
  ],
  [
    "gobuster",
    "gobuster dir -u https://api.example.com -w words.txt --delay 5s",
    "gobuster dir -u https://evil.test -w w",
  ],
];

describe("commandes shell : hôtes dans / hors périmètre", () => {
  it.each(CASES)("%s", (_name, inside, outside) => {
    expect(cmd(inside).reason.code).toBe("shell.unanalyzable");
    const v = cmd(outside);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params?.host).toMatch(/^(evil\.test|10\.0\.1\.0\/24)$/);
  });

  it("argv direct (task_start, exec Exegol) : mêmes règles, sans expansion shell", () => {
    expect(
      verdict(TASK, { argv: ["nmap", "-sV", "--max-rate", "0.2", "app.test"] }, approved).reason
        .code,
    ).toBe("shell.unanalyzable");
    expect(verdict(TASK, { argv: ["nmap", "evil.test"] }, approved).reason.code).toBe(
      "program.out_of_scope",
    );
    expect(
      verdict(EXEGOL_EXEC, { argv: ["curl", "-s", "https://evil.test/"] }, approved).reason.code,
    ).toBe("program.out_of_scope");
    expect(
      verdict("Bash", { command: "curl https://evil.test" }, approved, {
        default: "ask",
        rules: [{ tool: "Bash", command: "curl *", decision: "allow" }],
      }).reason.code,
    ).toBe("program.out_of_scope");
  });

  it("commande chaînée : un hôte hors périmètre suffit, même derrière ; && | ou sh -c", () => {
    for (const c of [
      "curl https://app.test/ ; curl https://evil.test/",
      "curl https://app.test/ && nmap evil.test",
      "echo go | curl https://evil.test/",
      "time nmap evil.test",
      "TOKEN=1 curl https://evil.test",
      "bash -c 'curl https://evil.test'",
    ]) {
      expect(cmd(c).reason.code, c).toBe("program.out_of_scope");
    }
    expect(cmd("curl https://app.test/ ; nmap --max-rate 0.2 api.example.com").reason.code).toBe(
      "shell.unanalyzable",
    );
  });

  it("l'exclusion du périmètre est respectée", () => {
    expect(cmd("curl https://admin.example.com/").reason.code).toBe("program.out_of_scope");
  });

  it("commande sans outil réseau connu ou --help : aucun effet", () => {
    expect(cmd("ls -la /tmp").reason.code).toBe("shell.unanalyzable");
    expect(cmd("nmap --help").reason.code).toBe("shell.unanalyzable");
    expect(programHosts(EXEC, { command: "ls" })).toEqual([]);
  });
});

describe("hôte non extractible → program.host_unresolved", () => {
  it.each([
    ["nmap -iL cibles.txt"],
    ["nmap -sV -iL=cibles.txt"],
    ["curl $URL"],
    ['curl "$(cat url.txt)"'],
    ["curl `cat u`"],
    ["wget -i liste.txt"],
    ["httpx -l hotes.txt"],
    ["nuclei -l hotes.txt"],
    ["sqlmap -m requetes.txt"],
    ["nmap 10.0.0.*"],
    ["echo x | httpx -silent"],
    ["curl https://app.test/ ; curl $OTHER"],
  ])("%s", (c) => {
    const v = cmd(c);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("program.host_unresolved");
  });

  it("jamais mémorisable : « session » redemande à chaque appel", async () => {
    const recorder = createRecorder({ runId: "r" });
    let asked = 0;
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: { cwd: process.cwd(), posixShell: true },
      ask: async () => {
        asked++;
        return { decision: "allow", remember: "session" };
      },
      program: approved,
      bypass: createBypassSwitch({ now: () => 0 }),
      now: () => 0,
    });
    const decide = (id: string) =>
      gate.decide(
        { toolUseId: id, tool: EXEC, input: { command: "nmap -iL cibles.txt" } },
        new AbortController().signal,
      );
    const first = await decide("a");
    expect(first.decision).toBe("allow");
    const second = await decide("b");
    expect(second.reason.code).not.toBe("approval.remembered");
    expect(asked).toBe(2);
    // Hôte hors périmètre sur un shell : ask à chaque fois aussi (jamais de clé d'hôte).
    const out = (id: string) =>
      gate.decide(
        { toolUseId: id, tool: TASK, input: { argv: ["nmap", "evil.test"] } },
        new AbortController().signal,
      );
    await out("c");
    const again = await out("d");
    expect(again.reason.code).not.toBe("approval.remembered");
    expect(asked).toBe(4);
    // Hôte hors périmètre en même temps : out_of_scope (mémorisable par hôte) prime.
    expect(cmd("nmap -iL l.txt evil.test").reason.code).toBe("program.out_of_scope");
  });

  it("outil Kali nmap_scan avec -iL dans additional_args", () => {
    const v = verdict(
      "mcp__kali__nmap_scan",
      { target: "app.test", additional_args: "-iL cibles.txt" },
      approved,
    );
    expect(v.reason.code).toBe("program.host_unresolved");
  });

  it("une règle allow explicite repasse en ask (Bash, nmap_scan)", () => {
    const bash: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "*", decision: "allow" }],
    };
    expect(verdict("Bash", { command: "nmap -iL l.txt" }, approved, bash).reason.code).toBe(
      "program.host_unresolved",
    );
    expect(verdict("Bash", { command: "curl https://app.test" }, approved, bash).decision).toBe(
      "allow",
    );
    const nmap: Policy = {
      default: "ask",
      rules: [{ tool: "mcp__kali__nmap_scan", decision: "allow" }],
    };
    const input = { target: "app.test", additional_args: "-iL l.txt" };
    expect(verdict("mcp__kali__nmap_scan", input, approved, nmap).reason.code).toBe(
      "program.host_unresolved",
    );
  });
});

describe("outils Kali dédiés à champ url", () => {
  it.each([
    ["mcp__kali__gobuster_scan"],
    ["mcp__kali__dirb_scan"],
    ["mcp__kali__sqlmap_scan"],
    ["mcp__kali__wpscan_analyze"],
  ])("%s", (tool) => {
    expect(verdict(tool, { url: "https://api.example.com/" }, approved).reason.code).toBe(
      "policy.default",
    );
    const v = verdict(tool, { url: "https://evil.test/" }, approved);
    expect(v.reason.code).toBe("program.out_of_scope");
    expect(v.reason.params?.host).toBe("evil.test");
  });
});

describe("garde-fous", () => {
  it("sans fiche approuvée : aucun effet", () => {
    const draft: ProgramProvider = () => evaluateProgramStatus(JSON.stringify(sheet()), null);
    for (const program of [null, draft]) {
      expect(cmd("curl https://evil.test", program).reason.code).toBe("shell.unanalyzable");
      expect(cmd("nmap -iL x.txt", program).reason.code).toBe("shell.unanalyzable");
      expect(verdict(TASK, { argv: ["nmap", "evil.test"] }, program ?? undefined).reason.code).toBe(
        "shell.unanalyzable",
      );
    }
  });

  it("deny conservé", () => {
    const deny: Policy = { default: "ask", rules: [{ tool: EXEC, decision: "deny" }] };
    expect(verdict(EXEC, { command: "curl https://evil.test" }, approved, deny).decision).toBe(
      "deny",
    );
    expect(verdict(EXEC, { command: "nmap -iL x" }, approved, deny).decision).toBe("deny");
  });

  it("fiche illisible : ask program.unreadable sur une commande réseau", () => {
    const broken: ProgramProvider = () => {
      throw new Error("boom");
    };
    expect(cmd("curl https://evil.test", broken).reason.code).toBe("program.unreadable");
    expect(cmd("ls", broken).reason.code).toBe("shell.unanalyzable");
  });
});
