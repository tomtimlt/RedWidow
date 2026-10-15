import { describe, expect, it } from "vitest";
import {
  type ApprovalAnswer,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  isInterpreterArgv,
  type Policy,
  type PolicyRule,
} from "../src/index.js";

const EXEC = "mcp__sandbox__exec";
const A = "a".repeat(64);
const B = "b".repeat(64);

const policyOf = (...rules: PolicyRule[]): Policy => ({ default: "ask", rules });
const verdict = (policy: Policy, argv: unknown, extra: Record<string, unknown> = {}) =>
  evaluatePolicy(policy, EXEC, { argv, ...extra });

describe("politique de mcp__sandbox__exec", () => {
  it("applique les motifs command à l'argv, élément par élément", () => {
    const p = policyOf({ tool: EXEC, command: "npm test", decision: "allow" });
    expect(verdict(p, ["npm", "test"]).decision).toBe("allow");
    expect(verdict(p, ["npm", "test", "x"]).decision).toBe("ask");
    expect(verdict(p, ["npm test"]).decision).toBe("ask"); // un seul élément contenant un espace
    const wide = policyOf({ tool: EXEC, command: "git *", decision: "allow" });
    expect(verdict(wide, ["git", "status", "-s"]).decision).toBe("allow");
  });

  it("`allow sh *` ne couvre pas `sh -c …` (interpréteur : au mieux ask)", () => {
    const p = policyOf({ tool: EXEC, command: "sh *", decision: "allow" });
    const v = verdict(p, ["sh", "-c", "echo hi"]);
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("sandbox.interpreter");
  });

  it("un allow tout-outil ne couvre pas un interpréteur mais couvre le reste", () => {
    const p = policyOf({ tool: "mcp__sandbox__*", decision: "allow" });
    expect(verdict(p, ["ls"]).decision).toBe("allow");
    expect(verdict(p, ["python3", "-c", "1"]).decision).toBe("ask");
    expect(verdict(p, ["/usr/bin/env", "rm"]).decision).toBe("ask");
    expect(verdict(p, ["find", ".", "-delete"]).decision).toBe("ask");
  });

  it("un motif exact sans joker peut autoriser un interpréteur", () => {
    const p = policyOf({ tool: EXEC, command: "sh script.sh", decision: "allow" });
    expect(verdict(p, ["sh", "script.sh"]).decision).toBe("allow");
    expect(verdict(p, ["sh", "-c", "x"]).decision).toBe("ask");
  });

  it("`deny rm *` refuse aussi /bin/rm, rm.exe et la casse", () => {
    const p = policyOf(
      { tool: EXEC, command: "rm *", decision: "deny" },
      { tool: EXEC, decision: "allow" },
    );
    expect(verdict(p, ["rm", "-rf", "x"]).decision).toBe("deny");
    expect(verdict(p, ["/bin/rm", "x"]).decision).toBe("deny");
    expect(verdict(p, ["RM.exe", "x"]).decision).toBe("deny");
    expect(verdict(p, ["ls"]).decision).toBe("allow");
  });

  it("un deny sans motif sur l'outil refuse tout, même un interpréteur", () => {
    const p = policyOf({ tool: EXEC, decision: "deny" });
    expect(verdict(p, ["sh"]).decision).toBe("deny");
  });

  it("défaut deny : un interpréteur reste refusé", () => {
    const p: Policy = { default: "deny", rules: [] };
    expect(verdict(p, ["sh"]).decision).toBe("deny");
    expect(verdict(p, ["ls"]).decision).toBe("deny");
  });

  it("entrée invalide → deny sandbox.invalidArgument", () => {
    const p = policyOf({ tool: EXEC, decision: "allow" });
    for (const argv of [undefined, "ls", [], [""], [1], ["a\0b"], Array(257).fill("x")]) {
      const v = verdict(p, argv);
      expect(v).toMatchObject({ decision: "deny", reason: { code: "sandbox.invalidArgument" } });
    }
    expect(verdict(p, ["ls"], { cwd: 3 }).decision).toBe("deny");
    expect(verdict(p, ["ls"], { cwd: "/work\0" }).decision).toBe("deny");
  });

  it("cwd : absolu normalisé sous /work, sinon deny avec le bon champ", () => {
    const p = policyOf({ tool: EXEC, decision: "allow" });
    for (const cwd of [
      "/",
      "/etc",
      "/work/../etc",
      "/work//x",
      "/work/",
      "/work/./x",
      "work",
      "/workx",
    ]) {
      expect(verdict(p, ["ls"], { cwd })).toMatchObject({
        decision: "deny",
        reason: { code: "sandbox.invalidArgument", params: { field: "cwd" } },
      });
    }
    expect(verdict(p, ["ls"], { cwd: "/work/sub/dir" }).decision).toBe("allow");
    expect(verdict(p, "ls")).toMatchObject({ reason: { params: { field: "argv" } } });
  });

  it("deny : programme normalisé (chemin, casse, .exe)", () => {
    const p = policyOf({ tool: EXEC, command: "rm *", decision: "deny" });
    for (const a of ["rm", "/bin/rm", "RM", "rm.exe"])
      expect(verdict(p, [a, "x"]).decision).toBe("deny");
    for (const pat of ["/bin/rm *", "RM *", "rm.exe *"]) {
      const q = policyOf({ tool: EXEC, command: pat, decision: "deny" });
      expect(verdict(q, ["rm", "x"]).decision).toBe("deny");
    }
    // allow : pas de normalisation
    const a = policyOf({ tool: EXEC, command: "/bin/ls *", decision: "allow" });
    expect(verdict(a, ["ls", "x"]).decision).toBe("ask");
  });

  it("nouvelles enveloppes et interpréteurs", () => {
    for (const a of [
      "ash",
      "awk",
      "gawk",
      "mawk",
      "nawk",
      "ionice",
      "chroot",
      "unshare",
      "nsenter",
      "flock",
      "taskset",
      "chrt",
      "runuser",
      "setpriv",
      "strace",
      "ltrace",
      "gdb",
      "expect",
      "tclsh",
    ]) {
      expect(isInterpreterArgv([a, "x"])).toBe(true);
    }
  });

  it("DEFAULT_POLICY : exec demande, status n'est pas touché par S2", () => {
    expect(verdict(DEFAULT_POLICY, ["ls"]).decision).toBe("ask");
  });

  it("reconnaît les interpréteurs et enveloppes", () => {
    for (const a of ["sh", "/bin/bash", "python3.12", "node", "perl", "env", "busybox", "sudo"]) {
      expect(isInterpreterArgv([a])).toBe(true);
    }
    expect(isInterpreterArgv(["npm", "test"])).toBe(false);
    expect(isInterpreterArgv(["find", ".", "-name", "x"])).toBe(false);
  });
});

describe("gate : mémorisation de mcp__sandbox__exec", () => {
  const setup = (containerId: { current: string | undefined } | undefined, policy = policyOf()) => {
    const asked: string[] = [];
    let answer: ApprovalAnswer = { decision: "allow", remember: "session" };
    const persisted: PolicyRule[] = [];
    let hook: (() => void) | undefined;
    const gate = createApprovalGate({
      policy,
      recorder: createRecorder({ runId: "r" }),
      ask: async (r) => {
        hook?.();
        asked.push(JSON.stringify(r.input));
        return answer;
      },
      persistRule: (rule) => {
        persisted.push(rule);
      },
      ...(containerId && { sandboxContainerId: () => containerId.current }),
    });
    const decide = (input: Record<string, unknown>, tool = EXEC) =>
      gate.decide({ toolUseId: `t${asked.length}`, tool, input }, new AbortController().signal);
    return {
      decide,
      asked,
      persisted,
      onAsk: (f: () => void) => {
        hook = f;
      },
      setAnswer: (a: ApprovalAnswer) => {
        answer = a;
      },
    };
  };

  it("session sur `npm test` n'autorise ni `npm test x`, ni un autre cwd, ni un autre conteneur", async () => {
    const id = { current: A as string | undefined };
    const s = setup(id);
    await s.decide({ argv: ["npm", "test"] });
    expect(s.asked).toHaveLength(1);

    const again = await s.decide({ argv: ["npm", "test"] });
    expect(again.reason.code).toBe("approval.remembered");
    expect(s.asked).toHaveLength(1);
    // cwd absent == "/work"
    await s.decide({ argv: ["npm", "test"], cwd: "/work" });
    expect(s.asked).toHaveLength(1);

    await s.decide({ argv: ["npm", "test", "x"] });
    await s.decide({ argv: ["npm", "test"], cwd: "/work/sub" });
    expect(s.asked).toHaveLength(3);

    id.current = B; // autre conteneur
    await s.decide({ argv: ["npm", "test"] });
    expect(s.asked).toHaveLength(4);
  });

  it("la clé de session est calculée une seule fois par decide", async () => {
    const id = { current: A as string | undefined };
    const s = setup(id);
    s.onAsk(() => {
      id.current = B; // le conteneur change pendant la question
    });
    await s.decide({ argv: ["ls"] });
    id.current = A;
    const again = await s.decide({ argv: ["ls"] });
    expect(again.reason.code).toBe("approval.remembered");
  });

  it("l'identifiant du conteneur n'est jamais lu depuis l'entrée de l'outil", async () => {
    const s = setup({ current: A });
    await s.decide({ argv: ["ls"] });
    // Une entrée qui prétend viser un autre conteneur ne change ni la clé ni ne contourne rien.
    await s.decide({ argv: ["ls"], container: B, containerId: B, id: B });
    expect(s.asked).toHaveLength(1);
  });

  it("la clé n'est jamais le nom d'outil seul : une autre commande redemande", async () => {
    const s = setup({ current: A });
    await s.decide({ argv: ["ls"] });
    await s.decide({ argv: ["cat", "f"] });
    expect(s.asked).toHaveLength(2);
  });

  it("sans fournisseur d'identifiant : jamais mémorisé", async () => {
    const s = setup(undefined);
    await s.decide({ argv: ["ls"] });
    await s.decide({ argv: ["ls"] });
    expect(s.asked).toHaveLength(2);
  });

  it("registre sans bac à sable → deny sandbox.unavailable", async () => {
    const s = setup({ current: undefined });
    const out = await s.decide({ argv: ["ls"] });
    expect(out).toMatchObject({ decision: "deny", reason: { code: "sandbox.unavailable" } });
    expect(s.asked).toHaveLength(0);
  });

  it("always se réduit à session : aucune règle persistée", async () => {
    const s = setup({ current: A });
    s.setAnswer({ decision: "allow", remember: "always" });
    await s.decide({ argv: ["ls"] });
    expect(s.persisted).toEqual([]);
    await s.decide({ argv: ["ls"] });
    expect(s.asked).toHaveLength(1);
  });

  it("un interpréteur est mémorisable seulement par argv exact", async () => {
    const s = setup({ current: A });
    await s.decide({ argv: ["sh", "-c", "make"] });
    await s.decide({ argv: ["sh", "-c", "make"] });
    expect(s.asked).toHaveLength(1);
    await s.decide({ argv: ["sh", "-c", "make clean"] });
    expect(s.asked).toHaveLength(2);
  });

  it("put/get/autres outils du bac à sable ne sont jamais mémorisés", async () => {
    const s = setup({ current: A });
    for (const tool of ["mcp__sandbox__put", "mcp__sandbox__get", "mcp__sandbox__exec2"]) {
      s.setAnswer({ decision: "allow", remember: "always" });
      await s.decide({ hostPath: "x", containerPath: "/work/x" }, tool);
      await s.decide({ hostPath: "x", containerPath: "/work/x" }, tool);
    }
    expect(s.asked).toHaveLength(6);
    expect(s.persisted).toEqual([]);
  });

  it("un deny de politique n'est jamais contourné par une mémorisation", async () => {
    const s = setup(
      { current: A },
      policyOf({ tool: EXEC, command: "rm *", decision: "deny" }, { tool: EXEC, decision: "ask" }),
    );
    await s.decide({ argv: ["ls"] });
    const out = await s.decide({ argv: ["/bin/rm", "x"] });
    expect(out.decision).toBe("deny");
  });

  it("les autres outils restent mémorisables par nom", async () => {
    const s = setup({ current: A });
    await s.decide({ x: 1 }, "mcp__other__tool");
    await s.decide({ x: 2 }, "mcp__other__tool");
    expect(s.asked).toHaveLength(1);
  });
});
