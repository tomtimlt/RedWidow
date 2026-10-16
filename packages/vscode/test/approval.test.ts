import type { PendingApproval, PolicyVerdict } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import {
  alwaysConfirmText,
  answerFor,
  cleanText,
  LAYOUT_LABELS,
  LAYOUTS,
  nextLayout,
  parseWebviewMessage,
  readLayout,
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

describe("setLayout : liste blanche de la disposition (lot P4)", () => {
  it("accepte editor, chat et monitor", () => {
    for (const layout of ["editor", "chat", "monitor"]) {
      expect(parseWebviewMessage({ type: "setLayout", layout })).toEqual({
        type: "setLayout",
        layout,
      });
    }
  });
  it("rejette toute autre valeur, casse incluse, et les clés en trop", () => {
    for (const raw of [
      { type: "setLayout" },
      { type: "setLayout", layout: "" },
      { type: "setLayout", layout: "Chat" },
      { type: "setLayout", layout: "bypass" },
      { type: "setLayout", layout: "editor " },
      { type: "setLayout", layout: ["chat"] },
      { type: "setLayout", layout: { value: "chat" } },
      { type: "setLayout", layout: null },
      { type: "setLayout", layout: "chat", extra: 1 },
      { type: "setLayout", layout: "chat", workspace: "x" },
    ]) {
      expect(parseWebviewMessage(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("disposition : lecture, cycle, libellés", () => {
  it("LAYOUTS et libellés couvrent les trois dispositions", () => {
    expect(LAYOUTS).toEqual(["editor", "chat", "monitor"]);
    expect(LAYOUT_LABELS).toEqual({ editor: "Éditeur", chat: "Chat", monitor: "Monitor" });
  });
  it("readLayout : valeur connue gardée, tout le reste donne editor (défaut)", () => {
    expect(readLayout("chat")).toBe("chat");
    expect(readLayout("monitor")).toBe("monitor");
    for (const stored of [undefined, null, "", "Chat", "bypass", 1, { layout: "chat" }]) {
      expect(readLayout(stored), JSON.stringify(stored)).toBe("editor");
    }
  });
  it("nextLayout : cycle editor -> chat -> monitor -> editor", () => {
    expect(nextLayout("editor")).toBe("chat");
    expect(nextLayout("chat")).toBe("monitor");
    expect(nextLayout("monitor")).toBe("editor");
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
  });
});
