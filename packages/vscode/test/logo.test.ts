import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatHtml } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const FILES = ["logo.svg", "icon.svg", "logo-small.svg"] as const;
const svgs = Object.fromEntries(FILES.map((f) => [f, read(`../media/${f}`)])) as Record<
  (typeof FILES)[number],
  string
>;
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
  return [...svg.matchAll(/<(?:path|circle|polygon)\b[^>]*>/g)].map((m) =>
    m[0]
      .replace(/\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g, "")
      .replace(/\s+/g, " "),
  );
}

describe("logo : treillis et flèches", () => {
  it("BRAND est le SVG inline de 18 px", () => {
    expect(brand).toContain('class="brand"');
    expect(brand).toContain('width="18"');
    expect(brand).toContain('height="18"');
    expect(brand).toContain('viewBox="0 0 24 24"');
    expect(brand).toContain('aria-hidden="true"');
  });

  for (const f of FILES) {
    describe(f, () => {
      const svg = svgs[f];
      it('viewBox="0 0 24 24", fond transparent, couleurs de marque en dur', () => {
        expect(svg).toContain('viewBox="0 0 24 24"');
        expect(svg).toContain('fill="#cc1c40"');
        expect(svg).toContain('stroke="#495f73"');
        expect(svg).toContain('fill="#495f73"');
        expect(svg).not.toMatch(/fill="(?:black|#000(?:000)?)"|rect\b/i);
        const hexes = [...svg.matchAll(/#([0-9a-f]{3,8})\b/gi)].map((m) =>
          (m[1] ?? "").toLowerCase(),
        );
        expect(new Set(hexes)).toEqual(new Set(["cc1c40", "495f73"]));
      });
      it("ni animation, ni script, ni handler, ni référence externe", () => {
        expect(svg).not.toMatch(/<animate|<script|<set\b|\bon\w+\s*=|href\s*=|<style|url\(/i);
      });
      it("trait et nœuds assez gros pour rester lisibles à 18 px", () => {
        expect(svg).toMatch(/stroke-width="1\.[6-9]/);
        for (const r of svg.matchAll(/\sr="([^"]+)"/g)) {
          expect(Number(r[1])).toBeGreaterThanOrEqual(1);
        }
      });
    });
  }

  it("les trois fichiers et BRAND ont la même géométrie, couleurs en dur", () => {
    expect(brand).toContain('fill="#cc1c40"');
    expect(brand).toContain('stroke="#495f73"');
    expect(brand).not.toMatch(/<animate|<script|\bon\w+\s*=|href\s*=|<style|style=/i);
    const brandShapes = shapes(brand);
    expect(brandShapes.length).toBeGreaterThan(0);
    for (const f of FILES) expect(shapes(svgs[f])).toEqual(brandShapes);
  });
});

describe("logo : CSS", () => {
  it("pas de curseur clignotant : la marque est statique", () => {
    expect(css).not.toMatch(/\.brand-cursor|jn-blink|brand-wing|brand-lead/);
  });
  it("contraste élevé et couleurs forcées : la marque inline prend la couleur du thème", () => {
    expect(css).toMatch(/body\.vscode-high-contrast-light \.brand \[fill\]:not\(\[fill="none"\]\)/);
    expect(css).toMatch(/fill:\s*currentColor/);
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.brand \[stroke\]\s*\{\s*stroke:\s*CanvasText/,
    );
  });
});
