import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
    expect(when("warband.disableBypass")).toBe("warband.bypassActive");
    expect(extension).toContain('"setContext", "warband.bypassActive"');
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
