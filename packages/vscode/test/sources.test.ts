import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LICENSE_MISSING,
  MAX_LICENSE_BYTES,
  MAX_SOURCES,
  readSources,
} from "../src/logic/sources.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warband-cours-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const source = (name: string, files: Record<string, string> = {}) => {
  mkdirSync(join(root, name));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, name, file), text);
};

describe("readSources (Atlas)", () => {
  it("liste les sous-dossiers triés avec la première ligne non vide de la licence", async () => {
    source("b-cours", { LICENSE: "\n\n  MIT License \nsuite" });
    source("a-cours", { "COPYING.txt": "GPL-3.0-or-later\n" });
    source("c-cours", { LICENCE: "CC-BY-4.0" });
    expect(await readSources(root)).toEqual([
      { name: "a-cours", droits: "GPL-3.0-or-later" },
      { name: "b-cours", droits: "MIT License" },
      { name: "c-cours", droits: "CC-BY-4.0" },
    ]);
  });

  it("licence absente ou vide", async () => {
    source("sans");
    source("vide", { LICENSE: "\n  \n" });
    source("autre", { "README.md": "MIT" });
    expect(await readSources(root)).toEqual([
      { name: "autre", droits: LICENSE_MISSING },
      { name: "sans", droits: LICENSE_MISSING },
      { name: "vide", droits: LICENSE_MISSING },
    ]);
  });

  it("ignore les fichiers simples à la racine et les liens symboliques", async () => {
    source("reel", { LICENSE: "MIT" });
    writeFileSync(join(root, "notes.md"), "x");
    const outside = mkdtempSync(join(tmpdir(), "warband-hors-"));
    try {
      writeFileSync(join(outside, "LICENSE"), "SECRET");
      try {
        symlinkSync(outside, join(root, "lien"), "dir");
        source("avec-lien");
        symlinkSync(join(outside, "LICENSE"), join(root, "avec-lien", "LICENSE"));
      } catch {
        // Liens indisponibles (droits Windows) : le reste du test suffit.
      }
      const list = await readSources(root);
      expect(list.map((s) => s.name)).not.toContain("lien");
      expect(list.map((s) => s.name)).not.toContain("notes.md");
      expect(list.find((s) => s.name === "reel")?.droits).toBe("MIT");
      const withLink = list.find((s) => s.name === "avec-lien");
      if (withLink) expect(withLink.droits).toBe(LICENSE_MISSING);
      expect(JSON.stringify(list)).not.toContain("SECRET");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("lecture bornée à 4 Kio et ligne plafonnée", async () => {
    source("long", { LICENSE: "x".repeat(MAX_LICENSE_BYTES * 3) });
    const [entry] = await readSources(root);
    expect(entry?.droits.length).toBeLessThanOrEqual(201);
  });

  it("50 entrées au plus", async () => {
    for (let i = 0; i < MAX_SOURCES + 10; i++)
      mkdirSync(join(root, `s${String(i).padStart(3, "0")}`));
    expect(await readSources(root)).toHaveLength(MAX_SOURCES);
  });

  it("neutralise les contrôles du texte affiché", async () => {
    source("nom", { LICENSE: `MIT${String.fromCharCode(0x202e, 7)} License` });
    const [entry] = await readSources(root);
    const codes = [...(entry?.droits ?? "")].map((c) => c.charCodeAt(0));
    expect(codes.some((c) => c < 9 || c === 0x202e)).toBe(false);
    expect(entry?.droits).toContain("MIT");
  });

  it("racine absente : liste vide", async () => {
    expect(await readSources(join(root, "inexistant"))).toEqual([]);
  });
});
