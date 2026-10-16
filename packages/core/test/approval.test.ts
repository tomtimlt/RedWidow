import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  dockerRunHazard,
  type EngineEvent,
  evaluatePolicy,
  matchCommand,
  type Policy,
  type PolicyContext,
  parsePolicy,
  parseShell,
  ValidationError,
} from "../src/index.js";

/** Contexte pour tester la logique POSIX de Bash : sous win32, Bash est non POSIX sauf déclaration explicite (fail-closed). */
const POSIX_BASH: PolicyContext = { cwd: process.cwd(), posixShell: true };

const parsed = (cmd: string) => {
  const r = parseShell(cmd);
  if (!r.ok) throw new Error(r.error.code);
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
    expect(parseShell("echo 'abc")).toEqual({
      ok: false,
      error: { code: "shell.unclosedQuote", params: { quote: "'" } },
    });
  });

  it("échoue sur un backslash final", () => {
    expect(parseShell("echo abc\\")).toEqual({
      ok: false,
      error: { code: "shell.trailingBackslash" },
    });
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
    evaluatePolicy(policy, "Bash", { command }, POSIX_BASH).decision;

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

  it("expose le motif sous forme de code et de paramètres", () => {
    const why = (tool: string, input: Record<string, unknown>, policy: Policy = DEFAULT_POLICY) =>
      evaluatePolicy(policy, tool, input, POSIX_BASH).reason;
    expect(why("Bash", { command: "docker ps -a" })).toEqual({
      code: "policy.rule",
      params: { index: 3, decision: "allow", target: "Bash(docker ps *)" },
    });
    expect(why("mcp__docker__rm", {})).toEqual({
      code: "policy.rule.custom",
      params: { text: "suppression de conteneur : à faire à la main" },
    });
    expect(why("Write", { file_path: "x" })).toEqual({
      code: "policy.default",
      params: { tool: "Write" },
    });
    expect(why("Bash", { command: "docker run -d nginx" })).toEqual({
      code: "bash.noRule",
      params: { command: "docker run -d nginx" },
    });
    expect(why("Bash", { command: "docker ps $(id) > x" })).toEqual({
      code: "bash.hazard",
      params: { hazards: "substitution,redirect" },
    });
    expect(why("Bash", { command: "docker run -v /:/h alpine" })).toEqual({
      code: "docker.hostAccess",
      params: { flag: "-v" },
    });
    expect(why("Bash", { command: "echo 'x" })).toEqual({
      code: "bash.unparseable",
      cause: { code: "shell.unclosedQuote", params: { quote: "'" } },
    });
    expect(why("Bash", { command: "  " })).toEqual({ code: "bash.empty" });
    expect(why("Bash", {})).toEqual({ code: "bash.missingCommand" });
  });

  it("rapporte l'index de la règle dans policy.rules", () => {
    const rm = DEFAULT_POLICY.rules.findIndex((r) => r.command === "rm *");
    expect(evaluatePolicy(DEFAULT_POLICY, "Bash", { command: "rm -rf /" }, POSIX_BASH).rule).toBe(
      rm,
    );
    expect(evaluatePolicy(DEFAULT_POLICY, "Grep", {}).rule).toBe(
      DEFAULT_POLICY.rules.findIndex((r) => r.tool === "Grep"),
    );
  });

  it("politique par défaut pour les outils MCP docker", () => {
    const d = (tool: string) => evaluatePolicy(DEFAULT_POLICY, tool, {}).decision;
    for (const t of ["ps", "images", "logs", "inspect"])
      expect(d(`mcp__docker__${t}`)).toBe("allow");
    for (const t of ["run", "start", "stop"]) expect(d(`mcp__docker__${t}`)).toBe("ask");
    expect(d("mcp__docker__rm")).toBe("deny");
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
    expect(() => parsePolicy(raw)).toThrow(ValidationError);
    expect(() => parsePolicy(raw)).toThrow(/policy\.invalid\./);
  });

  it("décrit le champ fautif par un code et des paramètres", () => {
    const codeOf = (raw: unknown) => {
      try {
        parsePolicy(raw);
      } catch (err) {
        return err instanceof ValidationError ? { code: err.code, params: err.params } : err;
      }
    };
    expect(codeOf(null)).toEqual({ code: "policy.invalid.object", params: undefined });
    expect(codeOf({ default: "maybe", rules: [] })).toEqual({
      code: "policy.invalid.default",
      params: { value: "maybe" },
    });
    expect(codeOf({ rules: "x" })).toMatchObject({ code: "policy.invalid.rules" });
    expect(codeOf({ rules: [1] })).toEqual({
      code: "policy.invalid.ruleObject",
      params: { index: 0 },
    });
    expect(codeOf({ rules: [{ tool: "Bash", decision: "yes" }] })).toEqual({
      code: "policy.invalid.ruleField",
      params: { index: 0, field: "decision" },
    });
  });
});

describe("parsePolicy : joker partiel", () => {
  it("refuse un * qui n'est pas un jeton entier, accepte * seul", () => {
    for (const command of ["rm -rf /work/*", "git*", "*x y"]) {
      expect(() => parsePolicy({ rules: [{ tool: "Bash", command, decision: "allow" }] })).toThrow(
        expect.objectContaining({ code: "policy.invalid.commandWildcard", params: { index: 0 } }),
      );
    }
    expect(() =>
      parsePolicy({ rules: [{ tool: "Bash", command: "git * --help *", decision: "allow" }] }),
    ).not.toThrow();
  });
});

describe("createApprovalGate", () => {
  const setup = (ask?: Parameters<typeof createApprovalGate>[0]["ask"]) => {
    const recorder = createRecorder({ runId: "r" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: POSIX_BASH,
      ...(ask && { ask }),
    });
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
    expect(out.reason).toEqual({
      code: "approval.noAsker",
      cause: { code: "bash.noRule", params: { command: "docker run x" } },
    });
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
    expect(out.reason).toEqual({
      code: "approval.interrupted",
      cause: { code: "error.unknown", message: "aborted" },
    });
  });

  it("journalise le motif structuré dans approval.decided", async () => {
    const { gate, events } = setup();
    await gate.decide({ toolUseId: "t", tool: "Bash", input: { command: "sudo ls" } }, signal);
    expect(events[0]).toMatchObject({
      kind: "approval.decided",
      decision: "deny",
      reason: { code: "policy.rule", params: { decision: "deny", target: "Bash(sudo *)" } },
    });
  });
});

describe("garde des chemins (outils fichiers)", () => {
  const root = mkdtempSync(join(tmpdir(), "john-ws-"));
  const outside = mkdtempSync(join(tmpdir(), "john-out-"));
  const home = mkdtempSync(join(tmpdir(), "john-home-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "x");
  writeFileSync(join(outside, "secret.txt"), "s");
  // « junction » : sans privilège sous Windows (ignoré ailleurs).
  symlinkSync(outside, join(root, "link"), "junction");
  mkdirSync(join(home, ".ssh"), { recursive: true });
  writeFileSync(join(home, ".ssh", "id_rsa"), "k");

  const ctx: PolicyContext = { cwd: root, home, posixShell: true };
  const d = (tool: string, input: Record<string, unknown>) =>
    evaluatePolicy(DEFAULT_POLICY, tool, input, ctx).decision;

  it("autorise les lectures dans l'espace de travail", () => {
    expect(d("Read", { file_path: "src/a.ts" })).toBe("allow");
    expect(d("Read", { file_path: join(root, "src", "a.ts") })).toBe("allow");
    expect(d("Grep", { pattern: "x" })).toBe("allow");
    expect(d("Glob", { pattern: "src/**/*.ts" })).toBe("allow");
  });

  it("refuse les chemins sensibles, quelles que soient les règles", () => {
    expect(d("Read", { file_path: join(home, ".ssh", "id_rsa") })).toBe("deny");
    expect(d("Read", { file_path: "~/.ssh/id_rsa" })).toBe("deny");
    expect(d("Grep", { pattern: "x", path: join(home, ".ssh") })).toBe("deny");
    // /etc/shadow : refus testé sur plateforme simulée (paths.test.ts) ; ici, jamais « allow ».
    expect(d("Read", { file_path: "/etc/shadow" })).not.toBe("allow");
    // Identifiants et configuration des fournisseurs de modèles d'OpenCode.
    expect(d("Read", { file_path: join(home, ".local", "share", "opencode", "auth.json") })).toBe(
      "deny",
    );
    expect(d("Read", { file_path: "~/.config/opencode/opencode.json" })).toBe("deny");
    const allowAll: Policy = { default: "allow", rules: [] };
    expect(
      evaluatePolicy(allowAll, "Read", { file_path: "~/.aws/credentials" }, ctx).decision,
    ).toBe("deny");
  });

  it("rétrograde en ask tout chemin hors de l'espace de travail", () => {
    expect(d("Read", { file_path: join(outside, "secret.txt") })).toBe("ask");
    expect(d("Read", { file_path: "../x" })).toBe("ask");
    expect(d("Glob", { pattern: "/home/**/*.key" })).toBe("ask");
    expect(d("Glob", { pattern: "../../**" })).toBe("ask");
    expect(d("Grep", { pattern: "x", path: "/" })).toBe("ask");
    const allowAll: Policy = { default: "allow", rules: [] };
    expect(evaluatePolicy(allowAll, "Read", { file_path: "/etc/hosts" }, ctx).decision).toBe("ask");
  });

  it("suit les liens symboliques vers l'extérieur", () => {
    expect(d("Read", { file_path: "link/secret.txt" })).toBe("ask");
    expect(d("Read", { file_path: "link/nouveau.txt" })).toBe("ask");
  });

  it("évalue le chemin d'un fichier qui n'existe pas encore", () => {
    expect(d("Write", { file_path: "src/nouveau.ts" })).toBe("ask"); // règle par défaut, pas le chemin
    expect(d("Read", { file_path: "src/absent/x.ts" })).toBe("allow");
  });

  it("un deny de règle reste un deny même hors espace de travail", () => {
    const p: Policy = { default: "ask", rules: [{ tool: "Read", decision: "deny" }] };
    expect(evaluatePolicy(p, "Read", { file_path: "/etc/hosts" }, ctx).decision).toBe("deny");
  });
});

describe("durcissement de Bash", () => {
  const bash = (command: string) =>
    evaluatePolicy(DEFAULT_POLICY, "Bash", { command }, POSIX_BASH).decision;

  it.each([
    "bash -c 'docker ps'",
    "sh -c 'docker ps'",
    "/bin/sh -c 'docker ps'",
    "env FOO=1 docker ps",
    "docker ps | xargs docker logs",
    "find . -exec docker ps ;",
    "find . -name x -delete",
    "nohup docker ps",
    "timeout 5 docker ps",
    "eval docker ps",
  ])("n'approuve jamais automatiquement %s", (command) => {
    expect(parseShell(command)).toMatchObject({ ok: true });
    expect(bash(command)).not.toBe("allow");
    const parsed = parseShell(command);
    if (parsed.ok) expect(parsed.value.hazards.has("indirection")).toBe(true);
  });

  it("signale $'…' et les heredocs", () => {
    const hazards = (c: string) => {
      const r = parseShell(c);
      return r.ok ? r.value.hazards : new Set();
    };
    expect(hazards("docker $'ps'").has("expansion")).toBe(true);
    expect(hazards("echo $'\\x72\\x6d'").has("expansion")).toBe(true);
    expect(hazards("cat <<EOF\nx\nEOF").has("redirect")).toBe(true);
    expect(bash("docker $'ps'")).toBe("ask");
    expect(bash("docker logs web <<EOF\nx\nEOF")).toBe("ask");
  });

  it("garde l'allowlist stricte pour les commandes simples", () => {
    expect(bash("docker ps")).toBe("allow");
    expect(bash("find . -name x")).toBe("ask"); // aucune règle
  });

  it.each([
    "docker run -v /:/host alpine",
    "docker run -v/:/host alpine",
    "docker run -itv /:/host alpine",
    "docker run --volume /:/host alpine",
    "docker run --volume=/:/host alpine",
    "docker run --mount type=bind,src=/,dst=/h alpine",
    "docker run --privileged alpine",
    "docker run --pid=host alpine",
    "docker run --network host alpine",
    "docker run --net=host alpine",
    "docker create --cap-add SYS_ADMIN alpine",
    "docker run --device /dev/sda alpine",
    "docker run --security-opt seccomp=unconfined alpine",
    "docker container run -v /:/h alpine",
    "podman run -v /:/h alpine",
    "docker ps && docker run -v /:/h alpine",
  ])("refuse %s", (command) => {
    expect(bash(command)).toBe("deny");
  });

  it("laisse un docker run ordinaire à l'approbation", () => {
    expect(bash("docker run -d --name web -p 8080:80 nginx")).toBe("ask");
    expect(dockerRunHazard(["docker", "ps", "-v"])).toBeNull();
  });
});
