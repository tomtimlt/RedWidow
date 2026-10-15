import type { PendingApproval, PolicyVerdict } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import {
  alwaysConfirmText,
  answerFor,
  cleanText,
  parseWebviewMessage,
  toCard,
} from "../src/logic/approval.js";

const verdict = (code: string, decision: PolicyVerdict["decision"] = "ask"): PolicyVerdict => ({
  decision,
  reason: { code } as PolicyVerdict["reason"],
  rule: null,
});
const pending = (
  tool: string,
  input: Record<string, unknown>,
  v: PolicyVerdict,
): PendingApproval => ({ toolUseId: "t1", tool, input, verdict: v });

describe("cleanText", () => {
  it("retire ESC, bidi et contrôles C0/C1, garde \\n et \\t", () => {
    expect(cleanText("a\x1b[2Kb‮c\u0007d\ne\tf\r")).toBe("abcd\ne\tf");
  });
  it("plafonne", () => {
    expect(cleanText("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("toCard", () => {
  it("neutralise l'entrée affichée et propose « toujours » pour un verdict mémorisable", () => {
    const card = toCard(pending("Bash", { command: "ls\x1b[2K ‮" }, verdict("bash.noRule")));
    expect(card.detail).toBe("ls ");
    expect(card.canRemember).toBe(true);
  });
  it("ne propose pas « toujours » pour un garde-fou, un deny ou un répertoire externe", () => {
    expect(toCard(pending("Read", {}, verdict("path.sensitive"))).canRemember).toBe(false);
    expect(toCard(pending("Bash", {}, verdict("bash.noRule", "deny"))).canRemember).toBe(false);
    expect(
      toCard(pending("Read", { externalDirectories: ["/etc"] }, verdict("policy.default")))
        .canRemember,
    ).toBe(false);
  });
  it("bac à sable : seul exec est mémorisable (pour la session)", () => {
    const exec = { argv: ["ls"], cwd: "/work" };
    expect(
      toCard(pending("mcp__sandbox__exec", exec, verdict("sandbox.interpreter"))).canRemember,
    ).toBe(true);
    expect(toCard(pending("mcp__sandbox__put", exec, verdict("policy.default"))).canRemember).toBe(
      false,
    );
  });
});

describe("answerFor / texte de confirmation", () => {
  it("mappe comme la CLI, sans « tout autoriser »", () => {
    expect(answerFor("deny")).toEqual({ decision: "deny" });
    expect(answerFor("once")).toEqual({ decision: "allow" });
    expect(answerFor("always")).toEqual({ decision: "allow", remember: "always" });
  });
  it("la modale décrit l'outil et la portée", () => {
    const card = toCard(pending("Bash", { command: "ls" }, verdict("bash.noRule")));
    expect(alwaysConfirmText(card)).toContain("Bash");
    const sb = toCard(
      pending("mcp__sandbox__exec", { argv: ["ls"], cwd: "/" }, verdict("sandbox.interpreter")),
    );
    expect(alwaysConfirmText(sb)).toContain("bac à sable");
  });
});

describe("parseWebviewMessage", () => {
  it("accepte les messages exacts", () => {
    expect(parseWebviewMessage({ type: "send", text: "salut" })).toEqual({
      type: "send",
      text: "salut",
    });
    expect(parseWebviewMessage({ type: "stop" })).toEqual({ type: "stop" });
    expect(parseWebviewMessage({ type: "approve", toolUseId: "a", choice: "always" })).toEqual({
      type: "approve",
      toolUseId: "a",
      choice: "always",
    });
  });
  it("rejette formes inconnues, clés en trop, choix invalide, texte vide ou énorme", () => {
    for (const raw of [
      null,
      "x",
      [],
      { type: "autre" },
      { type: "stop", extra: 1 },
      { type: "send", text: "  " },
      { type: "send", text: "x".repeat(100_001) },
      { type: "approve", toolUseId: "a", choice: "all" },
      { type: "approve", toolUseId: "", choice: "once" },
      { type: "approve", toolUseId: "a", choice: "once", remember: "always" },
    ]) {
      expect(parseWebviewMessage(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
