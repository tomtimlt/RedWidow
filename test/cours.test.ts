import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validerEntree, validerManifeste } from "../scripts/cours-validation.mjs";

const valide = {
  nom: "owasp-wstg",
  url: "https://github.com/OWASP/wstg.git",
  ref: "v4.2",
  licence: "CC-BY-SA-4.0",
  sousDossier: "document",
};
const avec = (patch: Record<string, unknown>) => ({ ...valide, ...patch });

describe("validerEntree", () => {
  it("accepte une entrée valide (étiquette, SHA, sans sousDossier)", () => {
    expect(validerEntree(valide)).toEqual([]);
    expect(validerEntree(avec({ ref: "3e2db6bf3f5f0c807aef8a8fc84e395acce0292c" }))).toEqual([]);
    const { sousDossier: _, ...sans } = valide;
    expect(validerEntree(sans)).toEqual([]);
  });

  it.each([
    ["nom majuscule", { nom: "Cours" }],
    ["nom vide", { nom: "" }],
    ["nom avec point", { nom: "a.b" }],
    ["nom trop long", { nom: `a${"b".repeat(41)}` }],
    ["url http", { url: "http://github.com/x/y.git" }],
    ["url ssh", { url: "git@github.com:x/y.git" }],
    ["url fichier", { url: "file:///etc" }],
    ["url avec identifiants", { url: "https://u:p@github.com/x/y.git" }],
    ["ref vide", { ref: "" }],
    ["ref branche", { ref: "main" }],
    ["ref option", { ref: "--upload-pack=x" }],
    ["licence absente", { licence: undefined }],
    ["licence vide", { licence: "" }],
    ["sousDossier avec ..", { sousDossier: "a/../b" }],
    ["sousDossier absolu", { sousDossier: "/etc" }],
    ["sousDossier Windows absolu", { sousDossier: "C:\\x" }],
    ["sousDossier .. antislash", { sousDossier: "a\\..\\b" }],
    ["clé inconnue", { extra: 1 }],
  ])("refuse : %s", (_titre, patch) => {
    expect(validerEntree(avec(patch)).length).toBeGreaterThan(0);
  });

  it("refuse une entrée qui n'est pas un objet", () => {
    expect(validerEntree(null).length).toBeGreaterThan(0);
    expect(validerEntree([]).length).toBeGreaterThan(0);
  });
});

describe("validerManifeste", () => {
  it("accepte un manifeste vide et refuse un doublon", () => {
    expect(validerManifeste([])).toEqual([]);
    expect(() => validerManifeste([valide, valide])).toThrow(/double/);
    expect(() => validerManifeste({})).toThrow();
  });

  it("le manifeste du dépôt est valide", () => {
    const url = new URL("../cours/sources.json", import.meta.url);
    expect(validerManifeste(JSON.parse(readFileSync(url, "utf8"))).length).toBeGreaterThan(0);
  });
});

describe("scripts/cours-sync.mjs", () => {
  const script = fileURLToPath(new URL("../scripts/cours-sync.mjs", import.meta.url));
  const lancer = (contenu: string) => {
    const dir = mkdtempSync(join(tmpdir(), "cours-test-"));
    try {
      const manifeste = join(dir, "m.json");
      writeFileSync(manifeste, contenu);
      // PATH vide : toute tentative d'appeler git (donc le réseau) échouerait.
      return spawnSync(
        process.execPath,
        [script, "--manifeste", manifeste, "--racine", join(dir, "r")],
        { encoding: "utf8", env: { PATH: "" } },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("manifeste vide : sortie 0 sans réseau", () => {
    expect(lancer("[]").status).toBe(0);
  });

  it("entrée invalide : refusée avant tout réseau", () => {
    const r = lancer(JSON.stringify([avec({ url: "http://x.test/y.git" })]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("url invalide");
  });
});
