import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { engagementHtml } from "../src/logic/html.js";

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, "..", "media", "engagement.js"), "utf8");

describe("page Engagement : HTML et script", () => {
  const html = (locale: "fr" | "en") =>
    engagementHtml({
      nonce: "abc123",
      cspSource: "https://x.vscode-cdn.net",
      scriptUri: "https://x.vscode-cdn.net/media/engagement.js",
      styleUri: "https://x.vscode-cdn.net/media/css/engagement.css",
      locale,
    });

  it("CSP stricte, un seul script, base puis feuille de la page, aucune donnée dans le HTML", () => {
    const out = html("en");
    expect(out).toContain("default-src 'none'; script-src 'nonce-abc123'");
    expect(out).toContain('<title data-i18n="Engagement">Engagement</title>');
    expect(out).toContain("media/engagement.js");
    expect(out).toContain('class="cockpit engagement"');
    expect(out.match(/<script /g)).toHaveLength(3);
    expect(html("fr")).toContain('lang="fr"');
  });

  it("une valeur dangereuse est refusée", () => {
    expect(() =>
      engagementHtml({
        nonce: "abc123",
        cspSource: "https://x.vscode-cdn.net",
        scriptUri: 'x" onload="alert(1)',
        styleUri: "https://x.vscode-cdn.net/media/css/engagement.css",
      }),
    ).toThrow("scriptUri");
  });

  it("le script n'insère jamais de HTML et n'envoie ni empreinte ni donnée", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(script).not.toMatch(/postMessage\(\{[^}]*digest/);
    // Seuls des types sans charge utile partent vers l'hôte, plus le champ de citation.
    const sent = [...script.matchAll(/postMessage\(\{ type(?:: "(\w+)")?/g)];
    expect(sent.length).toBeGreaterThan(0);
    expect(script).toContain('type: "openCitation", field');
    expect(script).not.toMatch(/postMessage\(\{[^}]*(path|content|text|url|host)\b/);
  });

  it("les gestes sensibles passent par des types validés côté hôte", () => {
    for (const type of [
      "halt",
      "resume",
      "validateEngagement",
      "suspendEngagement",
      "validateCampaign",
      "suspendCampaign",
      "importEngagement",
      "importCampaign",
      "refresh",
      "ready",
    ])
      expect(script, type).toMatch(new RegExp(`["']${type}["']`));
  });

  it("le bandeau d'arrêt d'urgence est en tête de page, avant l'engagement", () => {
    const render = script.slice(script.indexOf("function render("));
    expect(render.indexOf("haltBanner(")).toBeLessThan(render.indexOf("engagementSection("));
    expect(render.indexOf("engagementSection(")).toBeLessThan(render.indexOf("campaignSection("));
    expect(render.indexOf("campaignSection(")).toBeLessThan(render.indexOf("journalSection("));
    expect(render.indexOf("journalSection(")).toBeLessThan(render.indexOf("closureSection("));
  });
});
