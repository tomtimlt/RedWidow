import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createRecorder, DEFAULT_POLICY, loadPolicy, type Policy } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { createTerminalAsker, parseAnswer } from "../src/ask.js";
import { describeAuthIntent, formatEvent } from "../src/format.js";
import { appendUserRule } from "../src/policy-store.js";

describe("parseAnswer", () => {
  it.each([
    ["o", { decision: "allow", remember: "once" }],
    ["Oui", { decision: "allow", remember: "once" }],
    ["y", { decision: "allow", remember: "once" }],
    ["s", { decision: "allow", remember: "session" }],
    ["session", { decision: "allow", remember: "session" }],
    ["t", { decision: "allow", remember: "always" }],
    ["toujours", { decision: "allow", remember: "always" }],
    ["", { decision: "deny" }],
    ["n", { decision: "deny" }],
    ["peut-être", { decision: "deny" }],
  ])("%j", (text, expected) => {
    expect(parseAnswer(text)).toEqual(expected);
  });

  it("l'approbateur terminal renvoie la portée choisie", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const ask = createTerminalAsker(input, output);
    const pending = ask(
      { toolUseId: "t", tool: "Bash", input: { command: "docker stop web" } },
      {
        decision: "ask",
        reason: { code: "bash.noRule", params: { command: "docker stop web" } },
        rule: null,
      },
      new AbortController().signal,
    );
    input.write("t\n");
    await expect(pending).resolves.toEqual({ decision: "allow", remember: "always" });
    expect(output.read()?.toString()).toContain("[t]oujours");
  });
});

describe("appendUserRule", () => {
  const rule = { tool: "Bash", command: "docker stop web", decision: "allow" } as const;

  it("crée policy.json à partir de la politique effective si absent", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "john-cli-")), "cfg");
    const path = await appendUserRule(dir, rule, DEFAULT_POLICY);
    const saved = JSON.parse(readFileSync(path, "utf8")) as Policy;
    expect(saved.default).toBe(DEFAULT_POLICY.default);
    expect(saved.rules).toEqual([...DEFAULT_POLICY.rules, rule]);
    // La politique utilisateur est ensuite chargée telle quelle.
    const loaded = await loadPolicy({ cwd: tmpdir(), configDir: dir });
    expect(loaded.origin).toBe("user");
    expect(loaded.policy.rules.at(-1)).toEqual(rule);
  });

  it("ajoute à un fichier existant sans dupliquer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "john-cli-"));
    writeFileSync(
      join(dir, "policy.json"),
      JSON.stringify({ default: "deny", rules: [{ tool: "Read", decision: "allow" }] }),
    );
    await appendUserRule(dir, rule, DEFAULT_POLICY);
    await appendUserRule(dir, rule, DEFAULT_POLICY);
    const saved = JSON.parse(readFileSync(join(dir, "policy.json"), "utf8")) as Policy;
    expect(saved).toEqual({
      default: "deny",
      rules: [{ tool: "Read", decision: "allow" }, rule],
    });
  });

  it("n'écrase pas un fichier invalide", async () => {
    const dir = mkdtempSync(join(tmpdir(), "john-cli-"));
    writeFileSync(join(dir, "policy.json"), "{pas du json");
    await expect(appendUserRule(dir, rule, DEFAULT_POLICY)).rejects.toThrow();
    expect(readFileSync(join(dir, "policy.json"), "utf8")).toBe("{pas du json");
  });
});

describe("affichage", () => {
  const r = createRecorder({ runId: "r", redact: false });
  const opts = { color: false, verbose: false };

  it("décrit le mode d'authentification attendu", () => {
    expect(describeAuthIntent("auto", { PATH: "/bin" })).toBe("abonnement");
    expect(describeAuthIntent("auto", { ANTHROPIC_API_KEY: "k" })).toBe(
      "clé API (ANTHROPIC_API_KEY définie)",
    );
    expect(describeAuthIntent("subscription", { ANTHROPIC_API_KEY: "k" })).toBe("abonnement");
    expect(describeAuthIntent("api-key", {})).toBe("clé API");
    expect(describeAuthIntent("auto", { CLAUDE_CODE_USE_BEDROCK: "1" })).toBe(
      "fournisseur cloud (bedrock)",
    );
  });

  it("rend les nouveaux événements", () => {
    expect(
      formatEvent(
        r.emit({ kind: "auth.info", apiKeySource: "none", subscriptionType: "pro" }),
        opts,
      ),
    ).toBe("auth      abonnement pro");
    expect(
      formatEvent(
        r.emit({
          kind: "approval.requested",
          toolUseId: "t",
          tool: "Bash",
          input: { command: "docker stop web" },
          verdict: { code: "bash.empty" },
        }),
        opts,
      ),
    ).toBe("ask       Bash docker stop web · commande vide");
    const turn = r.emit({
      kind: "turn.finished",
      turns: 1,
      costUsd: 0.5,
      status: "success",
      result: null,
    });
    expect(formatEvent(turn, opts)).toBeNull();
    expect(formatEvent(turn, { ...opts, verbose: true })).toContain("1 tours");
    expect(
      formatEvent(
        r.emit({
          kind: "run.finished",
          status: "success",
          turns: 1,
          costUsd: 0,
          result: null,
          sessionId: "abc",
        }),
        opts,
      ),
    ).toContain("session abc");
    expect(
      formatEvent(r.emit({ kind: "auth.status", isAuthenticating: false, error: "raté" }), opts),
    ).toBe("auth      raté");
  });
});
