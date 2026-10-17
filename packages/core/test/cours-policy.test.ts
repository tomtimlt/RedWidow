import { describe, expect, it } from "vitest";
import {
  type ApprovalRequest,
  BYPASS_DEFAULT_MS,
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  type EngineEvent,
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  evaluatePolicy,
  LEARNING_POLICY,
} from "../src/index.js";

const ctx = { cwd: process.cwd(), posixShell: true };

describe("LEARNING_POLICY", () => {
  it("autorise exactement les deux outils cours", () => {
    for (const tool of ["mcp__cours__chercher", "mcp__cours__lire"]) {
      expect(evaluatePolicy(LEARNING_POLICY, tool, { requete: "x" }, ctx).decision).toBe("allow");
    }
  });

  it.each([
    ["Bash", { command: "ls" }],
    ["PowerShell", { command: "ls" }],
    ["Read", { file_path: `${process.cwd()}/README.md` }],
    ["Read", { file_path: "/etc/hostname" }],
    ["Read", { file_path: `${process.env.HOME ?? "/root"}/.ssh/id_rsa` }],
    ["Write", { file_path: `${process.cwd()}/x`, content: "" }],
    ["Edit", { file_path: `${process.cwd()}/x` }],
    ["Grep", { pattern: "x" }],
    ["Glob", { pattern: "*" }],
    ["WebFetch", { url: "https://example.com" }],
    ["Task", { prompt: "x" }],
    ["mcp__exegol__exec", { container: "a", argv: ["id"] }],
    ["mcp__exegol__note", { label: "x" }],
    ["mcp__docker__ps", {}],
    ["mcp__cours__ecrire", {}],
    ["MCP__COURS__LIRE", { chemin: "a.md" }],
    [EXTERNAL_DIRECTORY_TOOL, { path: "/tmp" }],
    ["mcp__cours__lire", { chemin: "a.md", [EXTERNAL_PATTERNS_FIELD]: ["/etc/*"] }],
  ])("refuse %s", (tool, input) => {
    expect(evaluatePolicy(LEARNING_POLICY, tool, input, ctx).decision).toBe("deny");
  });

  it("est figée en profondeur", () => {
    expect(Object.isFrozen(LEARNING_POLICY)).toBe(true);
    expect(Object.isFrozen(LEARNING_POLICY.rules)).toBe(true);
    expect(LEARNING_POLICY.rules.every((r) => Object.isFrozen(r))).toBe(true);
    expect(LEARNING_POLICY.rules.every((r) => !r.tool.includes("*"))).toBe(true);
  });
});

describe("gate sous LEARNING_POLICY", () => {
  const request = (tool: string, id = "t"): ApprovalRequest => ({
    toolUseId: id,
    tool,
    input: { command: "id" },
  });
  const signal = new AbortController().signal;

  async function run(withAsker: boolean) {
    const recorder = createRecorder({ runId: "r" });
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    let asked = 0;
    const bypass = createBypassSwitch({ now: Date.now });
    bypass.enable(BYPASS_DEFAULT_MS);
    const gate = createApprovalGate({
      policy: LEARNING_POLICY,
      recorder,
      workspace: ctx,
      bypass,
      ...(withAsker && {
        ask: async () => {
          asked++;
          return { decision: "allow" as const, remember: "always" as const };
        },
      }),
    });
    const first = await gate.decide(request("Bash", "a"), signal);
    const second = await gate.decide(request("Bash", "b"), signal);
    const exec = await gate.decide(request("mcp__exegol__exec", "c"), signal);
    return { events, asked: () => asked, outcomes: [first, second, exec] };
  }

  it.each([true, false])(
    "refuse sous Bypass, sans mémorisation (Asker : %s)",
    async (withAsker) => {
      const { events, asked, outcomes } = await run(withAsker);
      for (const o of outcomes) {
        expect(o.decision).toBe("deny");
        expect(o.source).toBe("policy");
      }
      expect(asked()).toBe(0);
      expect(events.some((e) => e.kind === "approval.requested")).toBe(false);
      expect(events.some((e) => e.kind === "approval.decided" && e.source === "bypass")).toBe(
        false,
      );
      expect(outcomes[0]?.reason).toEqual(outcomes[1]?.reason);
    },
  );
});
