import { readFileSync } from "node:fs";
import { createUiTranslator } from "@warband/messages";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/extension/extension.ts", import.meta.url), "utf8");
const launcher = source.match(/ {2}const openLauncher = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";

describe("lanceur", () => {
  it("expose les destinations par usage et conserve le chargement asynchrone des terminaux", () => {
    expect(launcher).not.toBe("");
    for (const label of [
      "Conversations",
      "Suivi et résultats",
      "Configuration",
      "Terminaux Exegol",
    ]) {
      expect(launcher).toContain(`label: t("${label}"), kind: vscode.QuickPickItemKind.Separator`);
    }
    for (const [label, command] of [
      ["$(history) Journal d’audit", "warband.openAudit"],
      ["$(preview) Aperçu du rapport", "warband.previewReport"],
    ]) {
      expect(launcher).toContain(
        `label: t("${label}"),\n        run: () => vscode.commands.executeCommand("${command}")`,
      );
      expect(source).toContain(`registerCommand("${command}"`);
    }
    expect(launcher).toContain("pick.items = actions;");
    expect(launcher).toContain("...actions,");
    expect(launcher).toContain('label: t("Aucun conteneur Exegol")');
    expect(launcher).toContain("pick.onDidAccept(");
    expect(launcher).toContain("chosen?.run?.()");
    expect(launcher).toContain("void loadCockpitView()");
    expect(launcher).toContain("openEditorShell(c.name)");
  });

  it("traduit les nouvelles destinations en anglais", () => {
    const t = createUiTranslator(() => "en");
    expect(t("Suivi et résultats")).toBe("Monitoring and results");
    expect(t("$(history) Journal d’audit")).toBe("$(history) Audit log");
    expect(t("$(preview) Aperçu du rapport")).toBe("$(preview) Report preview");
  });
});
