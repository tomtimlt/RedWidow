import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatHtml } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const FILES = ["logo.svg", "icon.svg"] as const;
const svgs = Object.fromEntries(FILES.map((f) => [f, read(`../media/${f}`)])) as Record<
  (typeof FILES)[number],
  string
>;
const logoSmall = read("../media/logo-small.svg");
const html = chatHtml({
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
});
const brand = /<svg class="brand"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
const css = read("../media/chat.css");

/** Géométrie peinte : chemins, cercles, polygones, sans couleurs ni attributs de présentation. */
function shapes(svg: string): string[] {
  return [...svg.matchAll(/<(?:path|circle|polygon|rect)\b[^>]*>/g)].map((m) =>
    m[0]
      .replace(/\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|class)="[^"]*"/g, "")
      .replace(/\s+/g, " "),
  );
}

describe("logo : chevrons", () => {
  it("BRAND est le SVG inline de 18 px avec classes CSS", () => {
    expect(brand).toContain('class="brand"');
    expect(brand).toContain('width="18"');
    expect(brand).toContain('height="18"');
    expect(brand).toContain('viewBox="0 0 24 24"');
    expect(brand).toContain('aria-hidden="true"');
    expect(brand).toMatch(/class="brand-(wing|lead|cursor)"/);
  });

  describe("logo.svg et icon.svg", () => {
    it("mêmes formes : deux ailes, une pointe, un curseur", () => {
      const logoShapes = shapes(svgs["logo.svg"]);
      const iconShapes = shapes(svgs["icon.svg"]);
      expect(logoShapes).toEqual(iconShapes);
      expect(logoShapes.length).toBe(4);
    });

    it("logo.svg : couleurs en dur (gris et or)", () => {
      expect(svgs["logo.svg"]).toContain('fill="#7A8899"');
      expect(svgs["logo.svg"]).toContain('fill="#FFD60A"');
    });

    it("icon.svg : currentColor pour adaptation au thème", () => {
      expect(svgs["icon.svg"]).toContain('fill="currentColor"');
    });

    it("ni animation, ni script, ni référence externe", () => {
      for (const f of FILES) {
        expect(svgs[f]).not.toMatch(/<animate|<script|<set\b|\bon\w+\s*=|href\s*=|<style|url\(/i);
      }
    });
  });

  describe("logo-small.svg", () => {
    it("version simplifiée : une pointe et un curseur, or #FFD60A", () => {
      expect(logoSmall).toContain('fill="#FFD60A"');
      expect(logoSmall).toContain("<polygon");
      expect(logoSmall).toContain("<rect");
      expect(logoSmall).not.toMatch(/<animate|<script/i);
    });
  });

  it("BRAND (HTML inline) et logo.svg/icon.svg ont la même géométrie", () => {
    expect(brand).not.toMatch(/<animate|<script|\bon\w+\s*=|href\s*=|<style|style=/i);
    const brandShapes = shapes(brand);
    expect(brandShapes.length).toBe(4);
    for (const f of FILES) expect(shapes(svgs[f])).toEqual(brandShapes);
  });
});

describe("logo : CSS", () => {
  it("classes brand CSS : ailes acier, pointe et curseur rouge", () => {
    expect(css).toMatch(/\.brand-wing/);
    expect(css).toMatch(/\.brand-lead/);
    expect(css).toMatch(/\.brand-cursor/);
    expect(css).toMatch(/fill:\s*var\(--jn-steel\)/);
    expect(css).toMatch(/fill:\s*var\(--jn-accent\)/);
  });
  it("contraste élevé : la marque prend la couleur du thème si nécessaire", () => {
    expect(css).toMatch(/body\.vscode-high-contrast.*\.brand/);
  });
});
