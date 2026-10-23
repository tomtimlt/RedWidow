import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  isRememberable,
  KALI_EXECUTE_TOOL,
  KALI_TOOL_PREFIX,
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
    ["rm.exe::$DATA", "rm"],
    ["CMD.EXE::$data", "cmd"],
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
    "runas /user:x cmd",
    "cscript x.vbs",
    "WScript.exe x.vbs",
    "mshta x.hta",
    "rundll32 x.dll,f",
    "forfiles /c x",
    "conhost.exe cmd",
    "schtasks /create",
    "echo hi && pwsh.exe -c ls",
  ])("%s est une indirection", (cmd) => expect(hazards(cmd).has("indirection")).toBe(true));

  it("ne passe jamais en allow, même avec une règle Bash *", () => {
    const policy: Policy = { default: "ask", rules: [{ tool: "Bash", decision: "allow" }] };
    for (const command of ["pwsh -c ls", "'C:\\Windows\\System32\\cmd.exe' /c dir", "wsl ls"]) {
      expect(evaluatePolicy(policy, "Bash", { command }, win).decision).toBe("ask");
    }
  });

  it("POSIX inchangé : docker ps reste autorisé, docker.exe ps aussi analysé comme docker", () => {
    const posix = { cwd: process.cwd(), posixShell: true };
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }, posix).decision).toBe(
      "allow",
    );
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

const DOCKER_PS: Policy = {
  default: "ask",
  rules: [{ tool: "Bash", command: "docker ps *", decision: "allow" }],
};

describe("Bash non confirmé POSIX (OpenCode sous win32)", () => {
  const ctx = { ...win, posixShell: false };
  it("ask / shell.unanalyzable même pour une commande autorisée par une règle", () => {
    const v = evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps" }, ctx);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("shell.unanalyzable");
    expect(evaluatePolicy(ALLOW_ALL, "Bash", { command: "ls" }, ctx).decision).toBe("ask");
  });
  it("un deny de politique reste deny ; la politique par défaut (deny avec motif) refuse l'outil", () => {
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "rm -rf x" }, ctx).decision).toBe(
      "deny",
    );
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "docker ps" }, ctx).decision).toBe(
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
  it("win32 sans posixShell : non POSIX par défaut (fail-closed)", () => {
    const v = evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps" }, win);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("shell.unanalyzable");
  });
  it("win32 avec posixShell: true : comportement POSIX", () => {
    expect(
      evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps" }, { ...win, posixShell: true })
        .decision,
    ).toBe("allow");
  });
  it("hors win32, le défaut reste POSIX ; posixShell: false l'emporte", () => {
    const posix = { cwd: "/w", platform: "posix" } as const;
    expect(evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps" }, posix).decision).toBe(
      "allow",
    );
    expect(
      evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps" }, { ...posix, posixShell: false })
        .decision,
    ).toBe("ask");
  });
  it("l'entrée de l'outil ne peut pas déclarer posixShell", () => {
    expect(
      evaluatePolicy(DOCKER_PS, "Bash", { command: "docker ps", posixShell: true }, win).decision,
    ).toBe("ask");
  });
});

describe("règle deny avec motif command: sur un shell non analysable", () => {
  const deny = (tool: string): Policy => ({
    default: "allow",
    rules: [
      { tool: "*", decision: "allow" },
      { tool, command: "rm *", decision: "deny" },
    ],
  });
  it.each(["PowerShell", "pwsh"])("%s : refus de l'outil entier", (tool) => {
    expect(evaluatePolicy(deny("*"), tool, { command: "ls" }, win).decision).toBe("deny");
  });
  it("PowerShell nommé (casse ignorée) : refus de l'outil entier", () => {
    expect(evaluatePolicy(deny("PowerShell"), "powershell", { command: "ls" }, win).decision).toBe(
      "deny",
    );
  });
  it("Bash non POSIX : refus de l'outil entier", () => {
    expect(evaluatePolicy(deny("Bash"), "Bash", { command: "ls" }, win).decision).toBe("deny");
  });
  it("Bash POSIX : le motif reste un motif", () => {
    expect(
      evaluatePolicy(deny("Bash"), "Bash", { command: "ls" }, { ...win, posixShell: true })
        .decision,
    ).toBe("allow");
  });
});

describe("deny : nom de programme normalisé ; allow : jamais", () => {
  const posix = { cwd: "/w", platform: "posix" } as const;
  const denyRm: Policy = {
    default: "allow",
    rules: [{ tool: "Bash", command: "rm *", decision: "deny" }],
  };
  it.each([
    "rm.exe -rf x",
    "/usr/bin/rm -rf x",
    '"C:\\x\\rm.exe" -rf x',
    "RM.EXE -rf x",
    "rm.exe::$DATA -rf x",
  ])("deny `rm *` attrape %s", (command) => {
    expect(evaluatePolicy(denyRm, "Bash", { command }, posix).decision).toBe("deny");
  });
  it("allow `docker ps *` n'est pas élargi à ./docker.exe ni /tmp/docker", () => {
    const allow: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "docker ps *", decision: "allow" }],
    };
    expect(evaluatePolicy(allow, "Bash", { command: "docker ps -a" }, posix).decision).toBe(
      "allow",
    );
    for (const command of ["./docker.exe ps -a", "/tmp/docker ps -a", "docker.exe ps -a"]) {
      expect(evaluatePolicy(allow, "Bash", { command }, posix).decision).toBe("ask");
    }
  });
});

describe("gate : jamais mémorisable", () => {
  const signal = new AbortController().signal;
  it.each([
    ["PowerShell", {}, undefined],
    ["Bash", { command: "docker ps" }, { posixShell: false }],
    ["Bash", { command: "docker ps" }, { platform: "win32" }],
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

  it("execute_command : deny conservé, id non autorisable ni mémorisable", () => {
    const tool = KALI_EXECUTE_TOOL;
    const sudo = evaluatePolicy(DEFAULT_POLICY, tool, { command: "sudo id" });
    expect(sudo.decision).toBe("deny");
    const host = evaluatePolicy(DEFAULT_POLICY, tool, { command: "docker run -v /:/h x" });
    expect(host.decision).toBe("deny");
    expect(host.reason.code).toBe("docker.hostAccess");
    const id = evaluatePolicy(ALLOW_ALL, tool, { command: "id" });
    expect(id.decision).toBe("ask");
    expect(id.reason.code).toBe("shell.unanalyzable");
    expect(isRememberable({ toolUseId: "t", tool, input: { command: "id" } }, id)).toBe(false);
    const onWin = evaluatePolicy(ALLOW_ALL, tool, { command: "id" }, win);
    expect(onWin.decision).toBe("ask");
    expect(onWin.reason.code).toBe("shell.unanalyzable");
    const forced = evaluatePolicy(
      ALLOW_ALL,
      tool,
      { command: "id" },
      {
        cwd: "/w",
        platform: "posix",
        posixShell: false,
      },
    );
    expect(forced.decision).toBe("ask");
    expect(forced.reason.code).toBe("shell.unanalyzable");
  });

  it("nmap_scan sans règle : ask et policy.default", () => {
    const v = evaluatePolicy(DEFAULT_POLICY, `${KALI_TOOL_PREFIX}nmap_scan`, {
      container: "kali-box",
      target: "10.0.0.1",
    });
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("policy.default");
  });

  it("sans approbateur : refus", async () => {
    const gate = createApprovalGate({
      policy: ALLOW_ALL,
      recorder: createRecorder({ runId: "r" }),
    });
    const out = await gate.decide({ toolUseId: "t", tool: "PowerShell", input: {} }, signal);
    expect(out.decision).toBe("deny");
  });
});
