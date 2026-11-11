import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCockpitMessage } from "../src/logic/cockpit.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("commandes du manifeste", () => {
  const manifest = JSON.parse(read("../extension.manifest.json"));
  const extension = read("../src/extension/extension.ts");
  const declared: string[] = manifest.contributes.commands.map(
    (c: { command: string }) => c.command,
  );
  const registered = [
    ...extension.matchAll(/registerCommand\(\s*"(warband\.[A-Za-z.]+)"/g),
  ].flatMap((m) => (m[1] ? [m[1]] : []));

  it("les commandes déclarées sont exactement les commandes enregistrées", () => {
    expect([...declared].sort()).toEqual([...new Set(registered)].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("les commandes internes sont hors palette, et le Bypass n'y figure que s'il est actif", () => {
    const palette: { command: string; when: string }[] = manifest.contributes.menus.commandPalette;
    const when = (command: string) => palette.find((p) => p.command === command)?.when;
    expect(when("warband.openAudit")).toBe("false");
    expect(when("warband.previewReport")).toBe("false");
    expect(when("warband.configureProvider")).toBe("false");
    expect(when("warband.revealPendingApproval")).toBe("false");
    expect(when("warband.disableBypass")).toBe("warband.bypassActive");
    expect(extension).toContain('"setContext", "warband.bypassActive"');
  });

  it("la palette expose exactement les commandes utiles ; le reste est ouvert ailleurs", () => {
    const palette: { command: string; when: string }[] = manifest.contributes.menus.commandPalette;
    const hidden = new Set(palette.filter((p) => p.when === "false").map((p) => p.command));
    const visible = declared.filter((c) => !hidden.has(c) && c !== "warband.disableBypass").sort();
    // Liste exacte : tout ajout ou retrait de la palette doit être décidé ici.
    expect(visible).toEqual(
      [
        "warband.captureEditorEvidence",
        "warband.captureTerminalEvidence",
        "warband.clearToken",
        "warband.diagnostic",
        "warband.exportChat",
        "warband.launcher",
        "warband.missionContext",
        "warband.openChat",
        "warband.openCockpit",
        "warband.openEngagement",
        "warband.openProgram",
        "warband.openSessions",
        "warband.openStudio",
        "warband.setToken",
        "warband.trustRepoPolicy",
      ].sort(),
    );
    // Masquées car ouvertes plus directement : Réglages (pages Projet/Global), cockpit, barre de titre.
    expect([...hidden].sort()).toEqual(
      [
        "warband.chooseProfile",
        "warband.choosePalette",
        "warband.configureBurp",
        "warband.configureIntegrations",
        "warband.configureProvider",
        "warband.exportAttackFlow",
        "warband.exportAudit",
        "warband.exportKillchain",
        "warband.exportReport",
        "warband.focusChat",
        "warband.listProjectEvidence",
        "warband.openAudit",
        "warband.openKillchain",
        "warband.openMonitor",
        "warband.openTerminal",
        "warband.openWorkspace",
        "warband.prepareMission",
        "warband.previewReport",
        "warband.revealPendingApproval",
        "warband.testBurp",
      ].sort(),
    );
    expect(palette.find((p) => p.command === "warband.disableBypass")?.when).toBe(
      "warband.bypassActive",
    );
    expect(palette.length).toBe(declared.length - visible.length);
  });

  it("au plus 5 entrées principales dans view/title, 6 dans editor/title, avec les accès rapides", () => {
    for (const menu of ["view/title", "editor/title"]) {
      const entries: { command: string; group: string }[] = manifest.contributes.menus[menu];
      const main = entries.filter((e) => e.group.startsWith("navigation")).map((e) => e.command);
      expect(main.length).toBeLessThanOrEqual(menu === "editor/title" ? 6 : 5);
      expect(main).toContain("warband.openStudio");
      if (menu === "view/title") expect(main).toContain("warband.openProgram");
      else {
        for (const command of [
          "warband.openChat",
          "warband.openMonitor",
          "warband.openTerminal",
          "warband.openCockpit",
          "warband.openKillchain",
        ])
          expect(main).toContain(command);
      }
      // Le reste passe dans le menu « … », rien n'est supprimé.
      expect(entries.length).toBe(9);
      expect(entries.filter((e) => !e.group.startsWith("navigation")).length).toBe(
        menu === "editor/title" ? 3 : 4,
      );
      expect(entries.map((e) => e.command)).toContain("warband.openSessions");
    }
  });

  it("barre d'icônes des onglets : ordre exact de gauche à droite", () => {
    const entries: { command: string; group: string }[] =
      manifest.contributes.menus["editor/title"];
    const ordered = entries
      .filter((e) => e.group.startsWith("navigation@"))
      .sort((a, b) => Number(a.group.split("@")[1]) - Number(b.group.split("@")[1]))
      .map((e) => e.command);
    expect(ordered).toEqual([
      "warband.openChat",
      "warband.openTerminal",
      "warband.openMonitor",
      "warband.openCockpit",
      "warband.openKillchain",
      "warband.openStudio",
    ]);
  });

  it("palette, intégrations et Burp ouvrent les réglages, sans sélecteur propre", () => {
    expect(extension).toMatch(/"warband\.choosePalette", \(\) => openStudio\("appearance"\)/);
    expect(extension).toMatch(
      /"warband\.configureIntegrations", \(\) =>\s*openStudio\("integrations"\)/,
    );
    expect(extension).toMatch(/"warband\.configureBurp", \(\) => openStudio\("integrations"\)/);
  });

  it("cockpit et réglages ouvrent la fiche programme par le même message", () => {
    expect(read("../media/cockpit.js")).toContain('vscode.postMessage({ type: "openProgram" })');
    const studioJs = read("../media/studio.js");
    expect(studioJs).toContain('["program", "Fiche programme", "book", "openProgram"]');
    expect(studioJs).toContain("{ type: item.action }");
    expect(studioJs).toContain('vscode.postMessage({ type: "openProgram" })');
    expect(parseStudioMessage({ type: "openProgram" })).toEqual({ type: "openProgram" });
    expect(parseCockpitMessage({ type: "openProgram" })).toEqual({ type: "openProgram" });
    expect(
      extension.match(/message\.type === "openProgram"[\s\S]{0,40}openProgram\(\)/g),
    ).toHaveLength(1);
    expect(extension).toMatch(/case "openProgram":\s*openProgram\(\)/);
  });

  it("aucune route morte openCatalog / chooseProfile côté webview", () => {
    expect(parseStudioMessage({ type: "openCatalog" })).toBeNull();
    expect(parseStudioMessage({ type: "chooseProfile" })).toBeNull();
    expect(extension).not.toMatch(/message\.type === "(openCatalog|chooseProfile)"/);
    for (const file of ["studio.js", "chat.js", "cockpit.js", "program.js"]) {
      expect(read(`../media/${file}`)).not.toMatch(/"(openCatalog|chooseProfile)"/);
    }
  });

  it("la Kill chain s'ouvre dans la colonne RedWidow, comme les autres panneaux", () => {
    expect(extension).not.toContain("ViewColumn.One");
  });
});
