import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProject, importEngagementDraft, setActiveProject, setHalt } from "@warband/core";
import { describe, expect, it } from "vitest";
import { loadCockpitView, parseCockpitMessage } from "../src/logic/cockpit.js";
import { engagementHtml } from "../src/logic/html.js";
import { parseStudioMessage } from "../src/logic/studio.js";

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
      "suspendSheet",
      "validateCampaign",
      "suspendPlan",
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

describe("ouverture de la page : menu projet, cockpit et palette", () => {
  const read = (file: string) => readFileSync(join(here, "..", file), "utf8");

  it("messages studio et cockpit validés, sans donnée", () => {
    expect(parseStudioMessage({ type: "openEngagement" })).toEqual({ type: "openEngagement" });
    expect(parseStudioMessage({ type: "openEngagement", x: 1 })).toBeNull();
    expect(parseCockpitMessage({ type: "openEngagement" })).toEqual({ type: "openEngagement" });
    expect(parseCockpitMessage({ type: "openEngagement", x: 1 })).toBeNull();
    expect(read("media/studio.js")).toContain(
      '["engagement", "Engagement", "shield", "openEngagement"]',
    );
    expect(read("media/cockpit.js")).toContain('type: "openEngagement"');
  });

  it("l'extension câble la commande, les deux messages et la feuille de style", () => {
    const extension = read("src/extension/extension.ts");
    expect(extension).toContain('registerCommand("warband.openEngagement"');
    expect(extension).toMatch(/case "openEngagement":\s*openEngagement\(\)/);
    expect(extension).toMatch(/message\.type === "openEngagement"[\s\S]{0,40}openEngagement\(\)/);
    expect(extension).toContain('"css", "engagement.css"');
    const manifest = JSON.parse(read("extension.manifest.json"));
    expect(manifest.contributes.commands.map((c: { command: string }) => c.command)).toContain(
      "warband.openEngagement",
    );
    for (const nls of ["package.nls.json", "package.nls.en.json", "package.nls.fr.json"])
      expect(JSON.parse(read(nls))["command.openEngagement"]).toBeTruthy();
  });

  it("les gestes de l'hôte passent par une modale native et jamais par la webview", () => {
    const extension = read("src/extension/extension.ts");
    const start = extension.indexOf("const openEngagement = ");
    const body = extension.slice(start, extension.indexOf("const openMonitor = ", start));
    for (const gesture of [
      "controls.halt()",
      "controls.resume()",
      "controls.validateEngagement(digest)",
      "controls.validateCampaign(digest)",
      "controls.suspendSheet()",
      "controls.suspendPlan()",
    ])
      expect(body, gesture).toContain(gesture);
    // Chaque geste est précédé d'une confirmation modale ; l'empreinte vient de la vue de l'hôte.
    expect(body.match(/confirmModal\(/g)?.length).toBeGreaterThanOrEqual(7);
    expect(body).toContain("shown.view.digest");
    expect(body).toContain("shown.view.campaign.digest");
    expect(body).not.toMatch(/message\.(digest|path|url|host|text)/);
  });

  it("le cockpit n'expose la ligne Engagement que s'il existe un engagement ou un arrêt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-eng-cockpit-"));
    const project = await createProject(dir, { name: "p", workspace: dir });
    await setActiveProject(dir, project.id);
    const load = () =>
      loadCockpitView({
        configDir: dir,
        resolveBin: () => "/usr/bin/docker",
        createDocker: () => ({ listLabelPrefix: async () => [] }),
      });
    expect((await load()).engagement).toBeUndefined();
    await setHalt(dir, project.id);
    expect((await load()).engagement).toEqual({ state: "none", campaign: "none", halt: true });
    const cited = <T>(value: T) => ({
      value,
      quote: "Lettre de mission",
      url: "https://client.example/mission",
      retrievedAt: "2026-11-07T10:00:00Z",
      verified: true,
    });
    await importEngagementDraft(
      dir,
      project.id,
      JSON.stringify({
        version: 1,
        authorization: cited({ principal: "ACME", reference: "LM-1", signatory: "A. Martin" }),
        window: cited({ text: "novembre" }),
        inScope: cited(["*.acme.example"]),
        infrastructure: cited(["c2.redteam.example"]),
        outOfScope: cited([]),
        rulesOfEngagement: cited("Pas de déni de service."),
        whiteTeam: cited({ contact: "soc@acme.example", deconfliction: "Appel" }),
        osintPolicy: cited("Public seulement."),
      }),
    );
    expect((await load()).engagement).toEqual({ state: "draft", campaign: "none", halt: true });
  });
});
