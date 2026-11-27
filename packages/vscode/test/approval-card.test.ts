import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type PendingApproval, reason } from "@warband/core";
import { describe, expect, it } from "vitest";
import { toCard } from "../src/logic/approval.js";
import { createChatState } from "../src/logic/chat.js";
import { readCss } from "./css.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const js = read("../media/chat.js");
const css = readCss().replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps de `renderCard`, du début de la fonction à la section suivante. */
const start = js.indexOf("function renderCard(card, isNew, previous)");
const end = js.indexOf("  const ctlGroup =", start);
const card = start >= 0 && end > start ? js.slice(start, end) : "";

/** Corps d'une règle CSS dont le sélecteur est exactement `selector`. */
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

describe("carte d'approbation (lot P2)", () => {
  it("la fonction renderCard est isolée", () => {
    expect(card).toContain("renderCard");
  });

  it("titre fixe « Autorisation requise » et icône décorative masquée aux lecteurs d'écran", () => {
    expect(card).toContain('"Autorisation requise"');
    expect(card).toContain('icon.setAttribute("aria-hidden", "true")');
  });

  it("boutons exactement once, deny, always ; always seulement si canRemember", () => {
    const calls = [...card.matchAll(/button\(l\("([^"]+)"\), "(\w+)", "(\w+)"\)/g)].map((m) => [
      m[2],
      m[3],
    ]);
    expect(calls).toEqual([
      ["once", "primary"],
      ["deny", "danger"],
      ["always", "link"],
    ]);
    expect(card).toMatch(/if \(card\.canRemember\) button\(l\("Toujours"\), "always", "link"\);/);
    expect(card.match(/canRemember/g)).toHaveLength(1);
  });

  it("le choix envoyé reste le message approve inchangé", () => {
    expect(card).toContain(
      'vscode.postMessage({ type: "approve", toolUseId: card.toolUseId, choice });',
    );
  });

  it("Échap sur la carte refuse (choix deny)", () => {
    expect(card).toContain('e.key === "Escape" && e.target === box');
    expect(card).toContain("buttons.deny.click()");
  });

  it("aucune ligne conteneur, workdir ni puce de règle", () => {
    expect(card).not.toMatch(/conteneur|container|workdir|cwd|règle|allow|deny\s*:/i);
  });

  it("grille clé/valeur : outil, action, raison ; détail repliable", () => {
    for (const key of ['"Outil"', '"Action"', '"Raison"']) expect(card).toContain(key);
    expect(card).toContain('el("details", "card-details")');
    expect(card).toContain('el("code", "card-summary"');
  });

  it("aucun HTML dynamique ni balise hors liste blanche dans la carte", () => {
    expect(card).not.toMatch(/innerHTML|insertAdjacentHTML|style=/);
    for (const m of card.matchAll(/\bel\(\s*"(\w+)"/g)) {
      expect(["div", "span", "p", "code", "pre", "button", "details", "summary"]).toContain(m[1]);
    }
  });

  it("bande d'accent orange avec repli, fond d'éditeur, rayon md", () => {
    const body = rule(".card");
    expect(body).toContain("--vscode-editorWarning-foreground");
    expect(body).toContain("--vscode-inputValidation-warningBorder");
    expect(body).toContain("box-shadow: inset 3px 0 0 var(--jn-card-accent)");
    expect(body).toContain("var(--jn-widget)");
    expect(body).toContain("border-radius: var(--jn-r-md)");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("le résumé est en police monospace de l'éditeur", () => {
    expect(rule(".card-summary")).toContain("var(--jn-mono)");
    expect(css).toContain("--vscode-editor-font-family");
  });

  it("la carte n'impose aucune largeur fixe (pas de débordement à 280 px)", () => {
    for (const sel of [".card", ".card-grid", ".card-summary", ".card-val"]) {
      expect(rule(sel), sel).not.toMatch(/(?:^|[;\s])(?:min-)?width:\s*\d{3,}px/);
    }
    expect(rule(".card-grid")).toContain("minmax(0, 1fr)");
  });
});

describe("carte d'un sous-agent (ADR 0054, lot C)", () => {
  const pending = (agentId?: string): PendingApproval => ({
    toolUseId: "p1",
    tool: "Read",
    input: { file_path: "/a" },
    verdict: { decision: "ask", reason: reason("policy.default"), rule: null },
    ...(agentId !== undefined && { agentId }),
  });
  const named = (agentId: string, known: boolean) => {
    const state = createChatState();
    if (known) {
      const ev = (e: Record<string, unknown>, id: string) =>
        state.event({ v: 1, id, seq: 1, ts: "t", runId: "r", parentId: null, ...e } as never);
      ev(
        {
          kind: "tool.requested",
          toolUseId: "t1",
          tool: "Task",
          input: { description: "Domaines" },
        },
        "e1",
      );
      ev(
        {
          kind: "tool.requested",
          toolUseId: "c1",
          tool: "Read",
          input: {},
          agentToolUseId: "t1",
          agentId,
        },
        "e2",
      );
    }
    state.approvals.set("p1", toCard(pending(agentId)));
    return state.view().approvals[0];
  };

  it("toCard recopie l'identifiant du sous-agent, neutralisé et plafonné", () => {
    expect(toCard(pending("a1")).agentId).toBe("a1");
    expect(toCard(pending("a\x1b[2K1‮")).agentId).toBe("a1");
    const long = toCard(pending("x".repeat(300))).agentId ?? "";
    expect(long).toHaveLength(201);
    expect(long.endsWith("…")).toBe(true);
  });

  it("une carte sans agentId n'a ni agentId ni agent, dans la carte comme dans la vue", () => {
    expect(toCard(pending())).not.toHaveProperty("agentId");
    const state = createChatState();
    state.approvals.set("p1", toCard(pending()));
    const [view] = state.view().approvals;
    expect(view).not.toHaveProperty("agent");
    expect(view).not.toHaveProperty("agentId");
  });

  it("avec un agentId connu, la vue donne le nom ; inconnu, elle donne une chaîne vide", () => {
    expect(named("a1", true)?.agent).toBe("Domaines");
    expect(named("a1", false)?.agent).toBe("");
    // La vue ne transmet que le nom, pas l'identifiant.
    expect(named("a1", true)).not.toHaveProperty("agentId");
  });

  it("le nom est résolu à chaque vue : la demande peut précéder l'appel", () => {
    const state = createChatState();
    state.approvals.set("p1", toCard(pending("a1")));
    expect(state.view().approvals[0]?.agent).toBe("");
    state.event({
      v: 1,
      id: "e1",
      seq: 1,
      ts: "t",
      runId: "r",
      parentId: null,
      kind: "tool.requested",
      toolUseId: "t1",
      tool: "Task",
      input: { description: "Domaines" },
    } as never);
    state.event({
      v: 1,
      id: "e2",
      seq: 2,
      ts: "t",
      runId: "r",
      parentId: null,
      kind: "tool.requested",
      toolUseId: "c1",
      tool: "Read",
      input: {},
      agentToolUseId: "t1",
      agentId: "a1",
    } as never);
    expect(state.view().approvals[0]?.agent).toBe("Domaines");
  });

  it("la ligne « Sous-agent » est une balise p posée par el() ; le contenu et les boutons ne changent pas", () => {
    expect(card).toContain('"card-agent"');
    expect(card).toMatch(/el\(\s*"p",\s*"card-agent"/);
    expect(card).toContain('l("Sous-agent « {0} »", { 0: card.agent })');
    expect(card).toContain('l("Sous-agent")');
    expect(card).not.toMatch(/innerHTML|insertAdjacentHTML/);
    expect(card).toContain("card.agent === void 0");
  });

  it("la ligne a son style, sans largeur fixe", () => {
    expect(rule(".card-agent")).toContain("overflow-wrap: anywhere");
    expect(rule(".card-agent")).not.toMatch(/(?:^|[;\s])(?:min-)?width:\s*\d{3,}px/);
  });
});
