import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  type Policy,
  parseShell,
  programName,
} from "../src/index.js";

const ALLOW_ALL: Policy = { default: "allow", rules: [{ tool: "*", decision: "allow" }] };
const win = { cwd: "/w", platform: "win32" } as const;

describe("programName (Windows)", () => {
  it.each([
    ["cmd.exe", "cmd"],
    ["CMD.EXE", "cmd"],
    ["PowerShell.EXE", "powershell"],
    ["C:\\Windows\\System32\\cmd.exe", "cmd"],
    ["C:/Windows/System32/cmd.exe", "cmd"],
    ["run.BAT", "run"],
    ["x.cmd", "x"],
    ["x.com", "x"],
    ["script.ps1", "script"],
    ["cmd.exe.", "cmd"],
    ["/usr/bin/env", "env"],
    ["docker", "docker"],
  ])("%s → %s", (word, name) => expect(programName(word)).toBe(name));
  it("mot absent", () => expect(programName(undefined)).toBe(""));
});

describe("interpréteurs Windows dans Bash", () => {
  const hazards = (cmd: string) => {
    const r = parseShell(cmd);
    if (!r.ok) throw new Error(r.error.code);
    return r.value.hazards;
  };
  it.each([
    "cmd /c dir",
    "'C:\\Windows\\System32\\cmd.exe' /c dir",
    '"C:\\Windows\\System32\\CMD.EXE" /c dir',
    "powershell -c ls",
    "PowerShell.EXE -c ls",
    "pwsh -c ls",
    "wsl ls",
    "start notepad",
    "echo hi && pwsh.exe -c ls",
  ])("%s est une indirection", (cmd) => expect(hazards(cmd).has("indirection")).toBe(true));

  it("ne passe jamais en allow, même avec une règle Bash *", () => {
    const policy: Policy = { default: "ask", rules: [{ tool: "Bash", decision: "allow" }] };
    for (const command of ["pwsh -c ls", "'C:\\Windows\\System32\\cmd.exe' /c dir", "wsl ls"]) {
      expect(evaluatePolicy(policy, "Bash", { command }, win).decision).toBe("ask");
    }
  });

  it("POSIX inchangé : docker ps reste autorisé, docker.exe ps aussi analysé comme docker", () => {
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }).decision).toBe("allow");
    expect(
      evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker.exe run -v /:/h x" }, win).decision,
    ).toBe("deny");
  });
});

describe("outil PowerShell", () => {
  it.each(["PowerShell", "powershell", "POWERSHELL", "pwsh"])(
    "%s : ask / shell.unanalyzable, même avec une règle * allow et défaut allow",
    (tool) => {
      const v = evaluatePolicy(ALLOW_ALL, tool, { command: "Get-ChildItem" }, win);
      expect(v.decision).toBe("ask");
      expect(v.reason.code).toBe("shell.unanalyzable");
    },
  );

  it("une règle allow nommée ne l'autorise pas non plus", () => {
    const policy: Policy = { default: "ask", rules: [{ tool: "PowerShell", decision: "allow" }] };
    expect(evaluatePolicy(policy, "PowerShell", { command: "ls" }, win).decision).toBe("ask");
  });

  it("une règle deny s'applique (exacte, joker, casse différente)", () => {
    for (const tool of ["PowerShell", "Power*", "*", "powershell"]) {
      const policy: Policy = {
        default: "allow",
        rules: [
          { tool: "*", decision: "allow" },
          { tool, decision: "deny" },
        ],
      };
      expect(evaluatePolicy(policy, "PowerShell", { command: "ls" }, win).decision).toBe("deny");
    }
  });

  it("défaut deny : reste deny (jamais assoupli en ask)", () => {
    const policy: Policy = { default: "deny", rules: [] };
    expect(evaluatePolicy(policy, "PowerShell", { command: "ls" }, win).decision).toBe("deny");
  });

  it("un outil inconnu avec une règle * allow n'est pas touché (non-régression)", () => {
    expect(evaluatePolicy(ALLOW_ALL, "Mystery", {}, win).decision).toBe("allow");
  });

  it("indépendant de la plateforme", () => {
    expect(evaluatePolicy(ALLOW_ALL, "PowerShell", { command: "ls" }, { cwd: "/w" }).decision).toBe(
      "ask",
    );
  });
});

describe("Bash non confirmé POSIX (OpenCode sous win32)", () => {
  const ctx = { ...win, posixShell: false };
  it("ask / shell.unanalyzable même pour une commande autorisée par une règle", () => {
    const v = evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }, ctx);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("shell.unanalyzable");
    expect(evaluatePolicy(ALLOW_ALL, "Bash", { command: "ls" }, ctx).decision).toBe("ask");
  });
  it("un deny de politique reste deny", () => {
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "rm -rf x" }, ctx).decision).toBe(
      "deny",
    );
    expect(
      evaluatePolicy(
        { default: "allow", rules: [{ tool: "Bash", decision: "deny" }] },
        "Bash",
        { command: "ls" },
        ctx,
      ).decision,
    ).toBe("deny");
  });
  it("commande absente : jamais allow", () => {
    expect(evaluatePolicy(ALLOW_ALL, "Bash", {}, ctx).decision).not.toBe("allow");
  });
  it("posixShell absent ou true : comportement POSIX inchangé", () => {
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }, win).decision).toBe(
      "allow",
    );
    expect(
      evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }, { ...win, posixShell: true })
        .decision,
    ).toBe("allow");
  });
});

describe("gate : jamais mémorisable", () => {
  const signal = new AbortController().signal;
  it.each([
    ["PowerShell", {}, undefined],
    ["Bash", { command: "docker ps" }, { posixShell: false }],
  ] as const)(
    "%s : remember session/always ignoré, redemandé à chaque fois",
    async (tool, input, extra) => {
      const recorder = createRecorder({ runId: "r" });
      let asked = 0;
      const persisted: unknown[] = [];
      const gate = createApprovalGate({
        policy: { default: "ask", rules: [] },
        recorder,
        workspace: { cwd: "/w", ...extra },
        ask: async () => {
          asked++;
          return { decision: "allow", remember: asked === 1 ? "session" : "always" };
        },
        persistRule: (r) => {
          persisted.push(r);
        },
      });
      for (let i = 0; i < 3; i++) {
        const out = await gate.decide({ toolUseId: `t${i}`, tool, input }, signal);
        expect(out).toMatchObject({ decision: "allow", source: "user" });
        expect(out.reason.code).toBe("shell.unanalyzable");
      }
      expect(asked).toBe(3);
      expect(persisted).toEqual([]);
    },
  );

  it("sans approbateur : refus", async () => {
    const gate = createApprovalGate({
      policy: ALLOW_ALL,
      recorder: createRecorder({ runId: "r" }),
    });
    const out = await gate.decide({ toolUseId: "t", tool: "PowerShell", input: {} }, signal);
    expect(out.decision).toBe("deny");
  });
});
