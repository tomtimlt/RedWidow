import type { PendingApproval, PolicyVerdict } from "@warband/core";
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
  it("outil historique mcp__sandbox__* : comme tout autre outil sans règle", () => {
    const exec = { argv: ["ls"], cwd: "/work" };
    expect(toCard(pending("mcp__sandbox__exec", exec, verdict("policy.default"))).canRemember).toBe(
      true,
    );
    expect(toCard(pending("mcp__sandbox__put", exec, verdict("policy.default"))).canRemember).toBe(
      true,
    );
  });
});

describe("answerFor / texte de confirmation", () => {
  it("mappe comme la CLI, sans « tout autoriser »", () => {
    expect(answerFor("deny")).toEqual({ decision: "deny" });
    expect(answerFor("once")).toEqual({ decision: "allow" });
    expect(answerFor("always")).toEqual({ decision: "allow", remember: "always" });
  });
  it("la modale décrit l'outil", () => {
    const card = toCard(pending("Bash", { command: "ls" }, verdict("bash.noRule")));
    expect(alwaysConfirmText(card)).toContain("Bash");
    expect(alwaysConfirmText(card)).not.toContain("bac à sable");
  });
});

describe("parseWebviewMessage", () => {
  it("variante exacte ou Auto : champs supplémentaires, types et identifiants hostiles refusés", () => {
    for (const variant of [null, "low", "custom.full-2", "x".repeat(64)]) {
      expect(parseWebviewMessage({ type: "setVariant", variant })).toEqual({
        type: "setVariant",
        variant,
      });
    }
    for (const variant of [undefined, "", "high\n", "a b", "x".repeat(65), 1, {}]) {
      expect(parseWebviewMessage({ type: "setVariant", variant })).toBeNull();
    }
    expect(parseWebviewMessage({ type: "setVariant", variant: "high", effort: "max" })).toBeNull();
  });
  it("accepte les messages exacts", () => {
    expect(parseWebviewMessage({ type: "send", text: "salut" })).toEqual({
      type: "send",
      text: "salut",
    });
    expect(parseWebviewMessage({ type: "stop" })).toEqual({ type: "stop" });
    expect(parseWebviewMessage({ type: "openMonitor" })).toEqual({ type: "openMonitor" });
    expect(parseWebviewMessage({ type: "openKillchain" })).toEqual({ type: "openKillchain" });
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
      { type: "openMonitor", extra: 1 },
      { type: "openKillchain", extra: 1 },
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

describe("setLayout n'est plus un message", () => {
  it("toute forme setLayout est refusée", () => {
    for (const raw of [
      { type: "setLayout", layout: "editor" },
      { type: "setLayout", layout: "chat" },
      { type: "setLayout", layout: "monitor" },
      { type: "setLayout" },
    ]) {
      expect(parseWebviewMessage(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("parseWebviewMessage : setBypass (ADR 0006)", () => {
  it("accepte exactement { type, enabled: boolean }", () => {
    expect(parseWebviewMessage({ type: "setBypass", enabled: true })).toEqual({
      type: "setBypass",
      enabled: true,
    });
    expect(parseWebviewMessage({ type: "setBypass", enabled: false })).toEqual({
      type: "setBypass",
      enabled: false,
    });
  });
  it("rejette un champ en trop, notamment une durée", () => {
    expect(parseWebviewMessage({ type: "setBypass", enabled: true, duration: 60 })).toBeNull();
    expect(parseWebviewMessage({ type: "setBypass", enabled: true, expiresAt: 1 })).toBeNull();
  });
  it("rejette un enabled non booléen ou absent", () => {
    expect(parseWebviewMessage({ type: "setBypass", enabled: "true" })).toBeNull();
    expect(parseWebviewMessage({ type: "setBypass", enabled: 1 })).toBeNull();
    expect(parseWebviewMessage({ type: "setBypass", enabled: null })).toBeNull();
    expect(parseWebviewMessage({ type: "setBypass" })).toBeNull();
  });
  it("aucun autre message ne se traduit en activation du Bypass", () => {
    expect(parseWebviewMessage({ type: "enableBypass", enabled: true })).toBeNull();
    expect(
      parseWebviewMessage({ type: "approve", toolUseId: "t", choice: "once", bypass: true }),
    ).toBeNull();
    expect(parseWebviewMessage({ type: "setLayout", layout: "editor", bypass: true })).toBeNull();
    expect(parseWebviewMessage({ type: "ready", bypass: true })).toBeNull();
    expect(parseWebviewMessage({ type: "refreshTerminals" })).toEqual({ type: "refreshTerminals" });
    expect(parseWebviewMessage({ type: "watch", toolUseId: "tool-1" })).toEqual({
      type: "watch",
      toolUseId: "tool-1",
    });
    expect(parseWebviewMessage({ type: "watch" })).toBeNull();
    expect(parseWebviewMessage({ type: "watch", toolUseId: "t", command: "nmap" })).toBeNull();
    expect(parseWebviewMessage({ type: "refreshTerminals", token: "x" })).toBeNull();
  });
});

describe("parseWebviewMessage : setLearning (ADR 0010)", () => {
  it("accepte un booléen seul", () => {
    expect(parseWebviewMessage({ type: "setLearning", enabled: true })).toEqual({
      type: "setLearning",
      enabled: true,
    });
    expect(parseWebviewMessage({ type: "setLearning", enabled: false })).toEqual({
      type: "setLearning",
      enabled: false,
    });
  });
  it("refuse toute clé supplémentaire", () => {
    expect(
      parseWebviewMessage({ type: "setLearning", enabled: true, mode: "learning" }),
    ).toBeNull();
    expect(
      parseWebviewMessage({ type: "setLearning", enabled: true, systemPrompt: "x" }),
    ).toBeNull();
  });
  it("refuse un non-booléen ou l'absence de champ", () => {
    for (const enabled of ["true", 1, 0, null, {}, []]) {
      expect(parseWebviewMessage({ type: "setLearning", enabled })).toBeNull();
    }
    expect(parseWebviewMessage({ type: "setLearning" })).toBeNull();
  });
});

describe("sélection du fournisseur depuis la webview", () => {
  it("accepte les trois fournisseurs et aucun champ supplémentaire", () => {
    for (const provider of ["claude", "openai", "opencode"]) {
      expect(parseWebviewMessage({ type: "setProvider", provider })).toEqual({
        type: "setProvider",
        provider,
      });
      expect(parseWebviewMessage({ type: "setProvider", provider, token: "secret" })).toBeNull();
    }
    for (const provider of ["OPENAI", "<script>", null, {}, 1]) {
      expect(parseWebviewMessage({ type: "setProvider", provider })).toBeNull();
    }
    expect(parseWebviewMessage({ type: "setProvider" })).toBeNull();
    expect(parseWebviewMessage({ type: "addProvider" })).toEqual({ type: "addProvider" });
    expect(parseWebviewMessage({ type: "addProvider", provider: "openai" })).toBeNull();
  });
});
