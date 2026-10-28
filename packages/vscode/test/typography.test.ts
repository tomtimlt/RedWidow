import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTES } from "../src/logic/palette.js";

const css = readFileSync(new URL("../media/chat.css", import.meta.url), "utf8");
describe("Acier et signature — typographie et composants", () => {
  it("embarque les deux fontes Geist avec leurs replis et la licence", () => {
    expect(css).toContain('font-family: "Warband Geist"');
    expect(css).toContain('font-family: "Warband Geist Mono"');
    expect(css).toContain("--vscode-font-family");
    expect(css).toContain("--vscode-editor-font-family");
    for (const path of ["geist-latin.woff2", "geist-mono-latin.woff2", "OFL-Geist.txt"])
      expect(existsSync(new URL(`../media/fonts/${path}`, import.meta.url))).toBe(true);
    expect(
      readFileSync(new URL("../media/fonts/OFL-Geist.txt", import.meta.url), "utf8"),
    ).toContain("SIL OPEN FONT LICENSE");
  });
  it("conserve le zoom de police et sépare la police du code", () => {
    expect(css).toMatch(/--jn-fs:\s*var\(--vscode-font-size/);
    expect(css).toMatch(/--jn-code:\s*var\(--vscode-editor-font-family/);
    expect(css).toMatch(/\b(?:code|pre)[\s\S]*?font-family:\s*var\(--jn-code\)/);
  });
  it("les états de focus et les boutons primaires utilisent les couleurs du thème", () => {
    expect(css).toContain("--jn-accent-fill: var(--vscode-button-background)");
    expect(css).toContain("--jn-on-accent: var(--vscode-button-foreground)");
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--jn-focus\)/);
    expect(css).toContain("--vscode-contrastActiveBorder");
  });
  it("prend en charge les cinq palettes, les pilules et les grands panneaux", () => {
    for (const [key] of PALETTES) expect(css).toContain(`data-palette="${key}"`);
    expect(css).toMatch(/--jn-r-pill:\s*999px/);
    expect(css).toMatch(/--jn-r-lg:\s*18px/);
    for (const marker of [".tool", ".card", ".mon-row", ".kc-node", ".studio-kc", ".report"])
      expect(css).toContain(marker);
  });
  it("le compositeur et les sorties préservent le défilement dans des vues étroites", () => {
    expect(css).toMatch(/#log\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toContain("min-width: 0");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("#toolbar");
    expect(css).toContain(".mon-out");
  });
});
