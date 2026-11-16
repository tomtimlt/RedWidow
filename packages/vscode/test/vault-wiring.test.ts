import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("coffre à clés : câblage de l'extension (ADR 0056)", () => {
  const extension = read("../src/extension/extension.ts");

  it("chaque recorder de l'hôte masque les valeurs de tous les coffres (extraSecrets)", () => {
    const all = extension.match(/createRecorder\(/g) ?? [];
    const masked =
      extension.match(/createRecorder\(\{ extraSecrets: \(\) => vaultSecrets \}\)/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(masked).toHaveLength(all.length);
  });

  it("le chat reçoit le coffre et la liste de secrets, et la liste suit les modifications", () => {
    expect(extension).toContain("vault: { store: vaultStore }");
    expect(extension).toContain("extraSecrets: () => vaultSecrets");
    expect(extension).toContain("vaultStore.onChange(refreshVaultSecrets)");
    expect(extension).toContain('event.key.startsWith("warband.vault.")');
  });

  it("la valeur d'une clé du coffre n'est jamais passée à la webview ni à un message", () => {
    // Seules les commandes de l'hôte lisent le coffre ; elles affichent rang et empreinte, jamais `value`.
    const commands = extension.slice(extension.indexOf('"warband.vault.addKey"'));
    const section = commands.slice(0, commands.indexOf('"warband.clearToken"'));
    expect(section).not.toMatch(/\.value\b[^;]*(showInformationMessage|postMessage)/);
    expect(section).toContain("keyDescription(");
    expect(section).toContain("password: true");
  });
});
