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

/** Tous les nombres portés par points, x, y, width, height. */
function coords(svg: string): number[] {
  const out: number[] = [];
  for (const m of svg.matchAll(/\bpoints="([^"]+)"/g)) {
    out.push(
      ...(m[1] ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number),
    );
  }
  for (const m of svg.matchAll(/<rect\b([^>]*)>/g)) {
    for (const a of (m[1] ?? "").matchAll(/\b(?:x|y|width|height)="([^"]+)"/g)) {
      out.push(Number(a[1]));
    }
  }
  return out;
}

/** Sommets des polygones (liste de paires). */
function polygons(svg: string): [number, number][][] {
  return [...svg.matchAll(/<polygon\b[^>]*\bpoints="([^"]+)"/g)].map((m) => {
    const n = (m[1] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i < n.length; i += 2) pts.push([n[i] as number, n[i + 1] as number]);
    return pts;
  });
}

describe("logo : SVG de marque", () => {
  it("le chevron inline BRAND est bien extrait", () => {
    expect(brand).toContain("brand-lead");
  });
  for (const f of FILES) {
    describe(f, () => {
      const svg = svgs[f];
      it('viewBox="0 0 24 24" sans décalage', () => {
        expect(svg).toContain('viewBox="0 0 24 24"');
      });
      it("coordonnées entières ou demi-entières, dans la grille avec 1 unité de marge", () => {
        const c = coords(svg);
        expect(c.length).toBeGreaterThan(0);
        for (const v of c) {
          expect(Number.isFinite(v), String(v)).toBe(true);
          expect((v * 2) % 1, `${f} : ${v}`).toBe(0);
        }
        for (const [x, y] of polygons(svg).flat()) {
          expect(x).toBeGreaterThanOrEqual(1);
          expect(x).toBeLessThanOrEqual(23);
          expect(y).toBeGreaterThanOrEqual(1);
          expect(y).toBeLessThanOrEqual(23);
        }
      });
      it("ni animation, ni script, ni handler, ni référence externe", () => {
        expect(svg).not.toMatch(/<animate|<script|<set\b|\bon\w+\s*=|href\s*=|<style|url\(/i);
      });
      if (f === "logo.svg" || f === "icon.svg") {
        it("couleurs en dur (acier et rouge de marque)", () => {
          expect(svg).toContain('fill="#495F73"');
          expect(svg).toContain('fill="#CC1C40"');
        });
      }
      if (f === "logo-small.svg") {
        it("rouge #CC1C40 sur la pointe et le curseur", () => {
          expect(svg).toContain('fill="#CC1C40"');
        });
      }
    });
  }

  it("BRAND : mêmes interdits, aucun fill hex, classes portées, coordonnées à demi-entiers", () => {
    expect(brand).not.toMatch(/<animate|<script|\bon\w+\s*=|href\s*=|<style|style=/i);
    expect(brand).not.toMatch(/\bfill\s*=\s*"#/i);
    expect(brand).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(brand).toContain('viewBox="0 0 24 24"');
    for (const cls of ["brand-wing", "brand-lead", "brand-cursor"]) expect(brand).toContain(cls);
    for (const v of coords(brand)) expect((v * 2) % 1).toBe(0);
  });

  it("la version pleine et BRAND ont la même géométrie", () => {
    const strip = (s: string) =>
      [...s.matchAll(/<(?:polygon|rect)\b[^>]*>/g)].map((m) =>
        m[0].replace(/\s(?:fill|class)="[^"]*"/g, ""),
      );
    expect(strip(brand)).toEqual(strip(svgs["logo.svg"]));
    expect(strip(svgs["icon.svg"])).toEqual(strip(svgs["logo.svg"]));
  });

  it("icon.svg : mêmes couleurs de marque que logo.svg (barre d'activité)", () => {
    expect(svgs["icon.svg"]).toContain('fill="#495F73"');
    expect(svgs["icon.svg"]).toContain('fill="#CC1C40"');
  });

  it("géométrie : diagonales à 45°, trois chevrons de même épaisseur, pointes alignées, curseur à bord droit de la tête", () => {
    const [w1, w2, head] = polygons(svgs["logo.svg"]);
    expect(w1 && w2 && head).toBeTruthy();
    for (const poly of [w1, w2, head] as [number, number][][]) {
      expect(poly).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        const [x0, y0] = poly[i] as [number, number];
        const [x1, y1] = poly[(i + 1) % 6] as [number, number];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        // chaque côté est horizontal, vertical ou à 45°
        expect(dx === 0 || dy === 0 || dx === dy, `côté ${i}`).toBe(true);
      }
    }
    // épaisseur de bras = largeur du côté horizontal du haut
    const thick = (p: [number, number][]) =>
      (p[1] as [number, number])[0] - (p[0] as [number, number])[0];
    expect(thick(w1 as [number, number][])).toBe(thick(head as [number, number][]));
    expect(thick(w2 as [number, number][])).toBe(thick(head as [number, number][]));
    // ailiers symétriques autour de l'axe de la tête (y = 12), pointes au même x
    const tip = (p: [number, number][]) => p[2] as [number, number];
    expect(tip(head as [number, number][])[1]).toBe(12);
    expect(tip(w1 as [number, number][])[0]).toBe(tip(w2 as [number, number][])[0]);
    expect(tip(w1 as [number, number][])[1] + tip(w2 as [number, number][])[1]).toBe(24);
    // curseur : hauteur = épaisseur d'un bras, bord droit = pointe de la tête
    const r = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
      svgs["logo.svg"],
    );
    expect(Number(r?.[4])).toBe(thick(head as [number, number][]));
    expect(Number(r?.[1]) + Number(r?.[3])).toBe(tip(head as [number, number][])[0]);
    // centre optique : l'emprise de l'ensemble est centrée sur (12, 12)
    const all = [
      ...polygons(svgs["logo.svg"]).flat(),
      [Number(r?.[1]) + Number(r?.[3]), Number(r?.[2]) + Number(r?.[4])],
    ] as [number, number][];
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    expect(Math.min(...xs) + Math.max(...xs)).toBe(24);
    expect(Math.min(...ys) + Math.max(...ys)).toBe(24);
  });

  it("logo-small.svg : chevron de tête et curseur seuls, sans ailiers, bras ≥ 2 px rendus à 16 px", () => {
    const small = svgs["logo-small.svg"];
    expect(polygons(small)).toHaveLength(1);
    expect(small.match(/<rect\b/g)).toHaveLength(1);
    const p = polygons(small)[0] as [number, number][];
    const t = (p[1] as [number, number])[0] - (p[0] as [number, number])[0];
    // épaisseur perpendiculaire t/√2, à l'échelle 16/24
    expect((t / Math.SQRT2) * (16 / 24)).toBeGreaterThanOrEqual(2);
  });
});

describe("logo : CSS", () => {
  it("curseur immobile hors run : l'animation n'existe que sous body.running", () => {
    for (const m of css.matchAll(/([^{}]*\.brand-cursor[^{}]*)\{([^}]*)\}/g)) {
      if (/animation\s*:/.test(m[2] ?? "")) {
        expect(m[1]).toMatch(/body\.running:not\(\.waiting\):not\(\.paused\)/);
      }
    }
  });
  it("classes .brand-* remplies par jetons, sans hex", () => {
    const rules = [...css.matchAll(/([^{}]*\.brand-(?:wing|lead|cursor)[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const m of rules) expect(m[2]).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
  it("monochrome en contraste élevé clair et en forced-colors", () => {
    expect(css).toMatch(
      /body\.vscode-high-contrast-light \.brand-cursor\s*\{\s*fill:\s*currentColor/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.brand-cursor\s*\{\s*fill:\s*CanvasText/,
    );
  });
});
