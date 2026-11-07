import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const studioJs = read("../media/studio.js");
const chatJs = read("../media/chat.js");
const extension = read("../src/extension/extension.ts");

/** Corps d'une fonction de page de studio.js (de sa déclaration à la suivante). */
const section = (name: string): string => {
  const start = studioJs.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = studioJs.indexOf("\n  function ", start + 10);
  return studioJs.slice(start, next);
};

describe("page Fournisseurs", () => {
  it("n'affiche que la présence d'une clé, sans champ de secret ni valeur", () => {
    const page = section("providersPage");
    expect(page).toContain("clé présente : oui");
    expect(page).not.toMatch(/password|\.type = "text"|secret|apiKey|token/i);
    expect(page).not.toMatch(/setToken|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
    // La saisie passe par la commande sécurisée, déclenchée côté hôte.
    expect(page).toContain('type: "configureProvider"');
    expect(studioJs).not.toMatch(/type = "password"/);
  });

  it("l'hôte n'envoie que des booléens de présence", () => {
    expect(extension).toMatch(
      /providerAuth: \{\s+claude: \(await getToken\("claude"\)[^)]*\)[^,]*!== undefined,/,
    );
    expect(parseStudioMessage({ type: "setToken", token: "sk-secret" })).toBeNull();
    expect(parseStudioMessage({ type: "configureProvider", id: "claude", token: "x" })).toBeNull();
  });
});

describe("liens du chat vers Réglages › Fournisseurs", () => {
  it("« Configurer la connexion » et « Configurer les outils et fournisseurs » ouvrent la page", () => {
    expect(chatJs).toMatch(
      /\$\("composer-settings"\)\.addEventListener\("click", \(\) =>\s+vscode\.postMessage\(\{ type: "openSystem" \}\)/,
    );
    expect(chatJs).toMatch(/\$\("models-connect"\)[\s\S]{0,120}type: "addProvider"/);
    expect(chatJs).toMatch(/\$\("provider-connect"\)[\s\S]{0,120}type: "addProvider"/);
    expect(extension).toMatch(
      /message\.type === "addProvider" \|\| message\.type === "openSystem"\) \{\s+openStudio\("providers"\);/,
    );
    expect(parseWebviewMessage({ type: "openSystem" })).toEqual({ type: "openSystem" });
  });
});

describe("aucun réglage propre au chat modifiable depuis les réglages", () => {
  it("studio.js ne poste ni setSelection, ni skills, ni MCP, ni recherche web", () => {
    expect(studioJs).not.toMatch(
      /type: "(setSelection|setLearning|setBypass|setEffort|setSupervision|setModel|setVariant|selectProvider)"/,
    );
    expect(studioJs).not.toMatch(/kind: "(skill|mcp|web)"/);
    expect(studioJs).not.toMatch(
      /capabilityRow|skillCatalog|chat\.skills|chat\.integrations|chat\.webSearch/,
    );
  });

  it("le message de réglages setCapability n'accepte que les fournisseurs", () => {
    const base = { type: "setCapability", id: "claude", enabled: true };
    expect(parseStudioMessage({ ...base, kind: "provider" })).toEqual({
      ...base,
      kind: "provider",
    });
    for (const kind of ["skill", "mcp", "web"])
      expect(parseStudioMessage({ ...base, kind })).toBeNull();
  });

  it("le chat propose tout le catalogue ; choisir une entrée l'active côté hôte", () => {
    expect(chatJs).toContain("caps.available.skills");
    expect(chatJs).toContain("caps.available.integrations");
    expect(chatJs).toContain('type: "setCapability"');
    expect(chatJs).not.toContain('type: "setSelection"');
    expect(extension).toMatch(/await toggleCapability\(message\.toggle, current\)/);
  });
});

describe("réglages déplacés", () => {
  it("Projet › Intégrations porte MCP, Burp et profil ; Système les limites globales", () => {
    const integrations = section("integrationsPage");
    expect(integrations).toContain('type: "configureMcp"');
    expect(integrations).toContain('type: "configureBurp"');
    expect(integrations).toContain('type: "testBurp"');
    expect(integrations).toContain("agentProfile");
    expect(studioJs).toContain("ultracodeMaxTurns");
    expect(studioJs).toContain("view.limits");
  });
});
