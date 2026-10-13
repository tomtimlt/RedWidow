import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  evaluatePolicy,
  matchCommand,
  type Policy,
  parsePolicy,
  parseShell,
} from "../src/index.js";

const parsed = (cmd: string) => {
  const r = parseShell(cmd);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("parseShell", () => {
  it("découpe en segments sur les opérateurs", () => {
    expect(parsed("docker ps -a && docker images | grep foo; echo ok").segments).toEqual([
      ["docker", "ps", "-a"],
      ["docker", "images"],
      ["grep", "foo"],
      ["echo", "ok"],
    ]);
  });

  it("respecte les guillemets et échappements", () => {
    expect(parsed(`docker run --name 'a b' "c\\"d" e\\ f`).segments).toEqual([
      ["docker", "run", "--name", "a b", 'c"d', "e f"],
    ]);
    expect(parsed("echo '$(rm -rf /)'").hazards.size).toBe(0);
    expect(parsed("docker ps --format '{{json .}}'").hazards.size).toBe(0);
  });

  it.each([
    ["docker ps $(rm -rf /)", "substitution"],
    ["docker ps `id`", "substitution"],
    ['echo "$(id)"', "substitution"],
    ["docker logs $NAME", "expansion"],
    ["docker ps *", "expansion"],
    ["docker logs {web,--help}", "expansion"],
    ["cat ~/.ssh/id_rsa", "expansion"],
    ["docker ps > out", "redirect"],
    ["docker logs web 2>&1", "redirect"],
    ["DOCKER_HOST=tcp://x docker ps", "assignment"],
    ["docker run x &", "background"],
  ])("signale %s → %s", (cmd, hazard) => {
    expect(parsed(cmd).hazards).toContain(hazard);
  });

  it("ignore les commentaires", () => {
    expect(parsed("docker ps # ; rm -rf /").segments).toEqual([["docker", "ps"]]);
  });

  it("échoue sur un guillemet non fermé", () => {
    expect(parseShell("echo 'abc").ok).toBe(false);
  });
});

describe("matchCommand", () => {
  it("exact sans *", () => {
    expect(matchCommand("docker ps", ["docker", "ps"])).toBe(true);
    expect(matchCommand("docker ps", ["docker", "ps", "-a"])).toBe(false);
  });
  it("* final = zéro ou plus", () => {
    expect(matchCommand("docker logs *", ["docker", "logs"])).toBe(true);
    expect(matchCommand("docker logs *", ["docker", "logs", "-f", "web"])).toBe(true);
    expect(matchCommand("docker logs *", ["docker", "rm"])).toBe(false);
  });
  it("* médian = exactement un", () => {
    expect(matchCommand("docker * --help", ["docker", "run", "--help"])).toBe(true);
    expect(matchCommand("docker * --help", ["docker", "--help"])).toBe(false);
  });
});

describe("evaluatePolicy", () => {
  const bash = (command: string, policy: Policy = DEFAULT_POLICY) =>
    evaluatePolicy(policy, "Bash", { command }).decision;

  it("autorise les lectures allowlistées", () => {
    expect(bash("docker ps -a")).toBe("allow");
    expect(bash("docker logs --tail 50 web")).toBe("allow");
    expect(bash("docker ps | docker images")).toBe("allow");
  });

  it("demande pour l'inconnu", () => {
    expect(bash("docker run -d nginx")).toBe("ask");
    expect(bash("docker ps && docker run nginx")).toBe("ask");
  });

  it("refuse si un segment est refusé, même chaîné à un segment autorisé", () => {
    expect(bash("docker ps && rm -rf /")).toBe("deny");
    expect(bash("docker system prune -af")).toBe("deny");
  });

  it("ne valide jamais automatiquement une commande à risque", () => {
    expect(bash("docker ps $(curl evil)")).toBe("ask");
    expect(bash("docker logs web > /etc/passwd")).toBe("ask");
    expect(bash("LD_PRELOAD=x.so docker ps")).toBe("ask");
    expect(bash("echo 'unterminated")).toBe("ask");
  });

  it("défaut deny : le non-analysable devient deny", () => {
    const strict: Policy = { default: "deny", rules: DEFAULT_POLICY.rules };
    expect(bash("docker ps $(x)", strict)).toBe("deny");
    expect(bash("docker run nginx", strict)).toBe("deny");
  });

  it("deny prime sur allow quel que soit l'ordre", () => {
    const p: Policy = {
      default: "ask",
      rules: [
        { tool: "Bash", command: "docker *", decision: "allow" },
        { tool: "Bash", command: "docker rm *", decision: "deny" },
      ],
    };
    expect(bash("docker rm web", p)).toBe("deny");
    expect(bash("docker start web", p)).toBe("allow");
  });

  it("rapporte l'index de la règle dans policy.rules", () => {
    const rm = DEFAULT_POLICY.rules.findIndex((r) => r.command === "rm *");
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "rm -rf /" }).rule).toBe(rm);
    expect(evaluatePolicy(DEFAULT_POLICY, "Grep", {}).rule).toBe(
      DEFAULT_POLICY.rules.findIndex((r) => r.tool === "Grep"),
    );
  });

  it("outils non-Bash avec glob", () => {
    const p: Policy = { default: "deny", rules: [{ tool: "mcp__docker__*", decision: "allow" }] };
    expect(evaluatePolicy(p, "mcp__docker__ps", {}).decision).toBe("allow");
    expect(evaluatePolicy(p, "mcp__other__x", {}).decision).toBe("deny");
    expect(evaluatePolicy(DEFAULT_POLICY, "Read", { file_path: "x" }).decision).toBe("allow");
    expect(evaluatePolicy(DEFAULT_POLICY, "Write", { file_path: "x" }).decision).toBe("ask");
  });

  it("une règle avec command ne s'applique pas à un autre outil", () => {
    const p: Policy = { default: "deny", rules: [{ tool: "*", command: "ls", decision: "allow" }] };
    expect(evaluatePolicy(p, "Write", {}).decision).toBe("deny");
  });
});

describe("parsePolicy", () => {
  it("accepte une politique valide", () => {
    expect(
      parsePolicy({ rules: [{ tool: "Bash", command: "docker ps", decision: "allow" }] }),
    ).toEqual({
      default: "ask",
      rules: [{ tool: "Bash", command: "docker ps", decision: "allow" }],
    });
  });
  it.each([
    [null],
    [{ rules: "x" }],
    [{ default: "maybe", rules: [] }],
    [{ rules: [{ tool: "Bash", decision: "yes" }] }],
    [{ rules: [{ decision: "allow" }] }],
  ])("rejette %j", (raw) => {
    expect(() => parsePolicy(raw)).toThrow(/politique invalide/);
  });
});

describe("createApprovalGate", () => {
  const setup = (ask?: Parameters<typeof createApprovalGate>[0]["ask"]) => {
    const recorder = createRecorder({ runId: "r" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, ...(ask && { ask }) });
    return { gate, events };
  };
  const signal = new AbortController().signal;

  it("tranche par la politique et journalise", async () => {
    const { gate, events } = setup();
    const out = await gate.decide(
      { toolUseId: "t1", tool: "Bash", input: { command: "docker ps" } },
      signal,
      "parent",
    );
    expect(out).toMatchObject({ decision: "allow", source: "policy" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "approval.decided",
      toolUseId: "t1",
      parentId: "parent",
    });
  });

  it("refuse les cas ask sans approbateur", async () => {
    const { gate } = setup();
    const out = await gate.decide(
      { toolUseId: "t", tool: "Bash", input: { command: "docker run x" } },
      signal,
    );
    expect(out.decision).toBe("deny");
  });

  it("délègue les cas ask à l'approbateur", async () => {
    const { gate } = setup(async () => ({ decision: "allow" }));
    const out = await gate.decide(
      { toolUseId: "t", tool: "Bash", input: { command: "docker run x" } },
      signal,
    );
    expect(out).toMatchObject({ decision: "allow", source: "user" });
  });

  it("n'appelle pas l'approbateur pour un deny", async () => {
    let called = false;
    const { gate } = setup(async () => {
      called = true;
      return { decision: "allow" };
    });
    const out = await gate.decide(
      { toolUseId: "t", tool: "Bash", input: { command: "sudo rm -rf /" } },
      signal,
    );
    expect(out.decision).toBe("deny");
    expect(called).toBe(false);
  });

  it("refuse si l'approbateur échoue", async () => {
    const { gate } = setup(async () => {
      throw new Error("aborted");
    });
    const out = await gate.decide(
      { toolUseId: "t", tool: "Bash", input: { command: "docker run x" } },
      signal,
    );
    expect(out.decision).toBe("deny");
  });
});
