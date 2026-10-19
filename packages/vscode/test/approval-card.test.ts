import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const js = read("../media/chat.js");
const css = read("../media/chat.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps de `renderCard`, du début de la fonction à la section suivante. */
const start = js.indexOf("function renderCard(card, isNew)");
const end = js.indexOf("// --- Modèle", start);
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
    const calls = [...card.matchAll(/button\("([^"]+)", "(\w+)", "(\w+)"\)/g)].map((m) => [
      m[2],
      m[3],
    ]);
    expect(calls).toEqual([
      ["once", "primary"],
      ["deny", "danger"],
      ["always", "link"],
    ]);
    expect(card).toMatch(/if \(card\.canRemember\) button\("Toujours", "always", "link"\);/);
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
      expect(["div", "span", "code", "pre", "button", "details", "summary"]).toContain(m[1]);
    }
  });

  it("bande d'accent orange avec repli, fond d'éditeur, rayon md", () => {
    const body = rule(".card");
    expect(body).toContain("--vscode-editorWarning-foreground");
    expect(body).toContain("--vscode-inputValidation-warningBorder");
    expect(body).toContain("border-left: 2px solid var(--jn-card-accent)");
    expect(body).toContain("background: var(--vscode-editorWidget-background");
    expect(body).toContain("border-radius: var(--jn-r-md)");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("le résumé est en police monospace de l'éditeur", () => {
    expect(rule(".card-summary")).toContain("var(--jn-mono)");
    expect(css).toMatch(/--jn-mono: var\(--vscode-editor-font-family/);
  });

  it("la carte n'impose aucune largeur fixe (pas de débordement à 280 px)", () => {
    for (const sel of [".card", ".card-grid", ".card-summary", ".card-val"]) {
      expect(rule(sel), sel).not.toMatch(/(?:^|[;\s])(?:min-)?width:\s*\d{3,}px/);
    }
    expect(rule(".card-grid")).toContain("minmax(0, 1fr)");
  });
});
