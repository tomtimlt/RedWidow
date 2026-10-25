import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contraste WCAG des paires figées de la charte (design-chat-ui.md §1.1-1.2) contre les fonds des fixtures
 * de `preview.test.ts` (Dark Modern, Light Modern, Contraste élevé). Texte ≥ 4,5 ; focus et bordure active ≥ 3.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const chatCss = readFileSync(here("../media/chat.css"), "utf8");
const previewSrc = readFileSync(here("./preview.test.ts"), "utf8");

/** Valeur hex d'un jeton de marque, lue dans chat.css (jamais recopiée). */
function brand(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(chatCss);
  if (!m) throw new Error(`jeton introuvable : ${name}`);
  return m[1] as string;
}

/** Variables `--vscode-*` d'une fixture de thème de preview.test.ts. */
function fixture(key: "dark" | "light" | "hc"): { vars: Map<string, string>; body: string } {
  const start = previewSrc.indexOf(`  ${key}: {`);
  const css = /css: `([^`]*)`/.exec(previewSrc.slice(start));
  if (!css) throw new Error(`fixture introuvable : ${key}`);
  const vars = new Map<string, string>();
  for (const m of (css[1] as string).matchAll(/(--vscode-[\w-]+):(#[0-9a-fA-F]{3,8})/g)) {
    vars.set(m[1] as string, m[2] as string);
  }
  const body = /body\{background:(#[0-9a-fA-F]{3,6})\}/.exec(css[1] as string);
  if (!body) throw new Error(`fond de body introuvable : ${key}`);
  return { vars, body: body[1] as string };
}

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Ratio de contraste WCAG 2.x. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BRAND = brand("--jn-brand");
const STEEL = brand("--jn-steel");
const INK = brand("--jn-ink");

/** Fonds sur lesquels la charte pose ses couleurs (corps, widget, champ) dans une fixture. */
function backgrounds(key: "dark" | "light" | "hc"): Record<string, string> {
  const f = fixture(key);
  const out: Record<string, string> = { body: f.body };
  for (const [label, v] of [
    ["widget", "--vscode-editorWidget-background"],
    ["input", "--vscode-input-background"],
  ] as const) {
    const hex = f.vars.get(v);
    if (hex) out[label] = hex;
  }
  return out;
}

describe("contraste WCAG des paires figées (design-chat-ui.md §1)", () => {
  it("le calcul reproduit des paires connues de la marque", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(ratio(INK, BRAND)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(BRAND, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(STEEL, "#000000")).toBeGreaterThanOrEqual(3);
  });

  it("les actions suivent les couleurs du thème, indépendamment de la marque", () => {
    expect(chatCss).toContain("--jn-accent-fill: var(--vscode-button-background)");
    expect(chatCss).toContain("--jn-on-accent: var(--vscode-button-foreground)");
    for (const key of ["dark", "light", "hc"] as const) {
      const { vars } = fixture(key);
      expect(
        ratio(
          vars.get("--vscode-button-foreground") as string,
          vars.get("--vscode-button-background") as string,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  for (const key of ["dark", "light", "hc"] as const) {
    describe(`thème ${key}`, () => {
      const bgs = backgrounds(key);
      const f = fixture(key);

      it("a des fonds exploitables", () => {
        expect(Object.keys(bgs).length).toBeGreaterThanOrEqual(2);
      });

      it("texte courant (foreground) ≥ 4,5 sur chaque fond", () => {
        const fg = f.vars.get("--vscode-foreground") as string;
        for (const [n, bg] of Object.entries(bgs)) {
          expect(ratio(fg, bg), `foreground / ${n} ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("liens et accent fonctionnel ≥ 4,5 sur le fond de lecture", () => {
        const accent = f.vars.get("--vscode-textLink-foreground") as string;
        expect(ratio(accent, f.body)).toBeGreaterThanOrEqual(4.5);
      });

      if (key === "hc") {
        it("accent = contrastActiveBorder du thème : focus et bordure active ≥ 3", () => {
          const accent = f.vars.get("--vscode-contrastActiveBorder") as string;
          for (const [n, bg] of Object.entries(bgs)) {
            expect(ratio(accent, bg), `contrastActiveBorder / ${n} ${bg}`).toBeGreaterThanOrEqual(
              3,
            );
          }
        });
        it("texte du bouton primaire (button-foreground sur button-background) ≥ 4,5", () => {
          const bg = f.vars.get("--vscode-button-background") as string;
          const fg = f.vars.get("--vscode-button-foreground") as string;
          expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        });
        it("le bandeau de marque s'efface : le texte du thème reste ≥ 4,5 sur le fond", () => {
          const fg = f.vars.get("--vscode-foreground") as string;
          expect(ratio(fg, bgs.body as string)).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});

/** Mélange sRGB opaque (équivalent de `color-mix(in srgb, fg p%, bg)` sur un fond opaque). */
function mix(fg: string, pct: number, bg: string): string {
  const [a, b] = [rgb(fg), rgb(bg)];
  const out = a.map((v, i) => Math.round((v * pct) / 100 + (b[i] as number) * (1 - pct / 100)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Pourcentages d'un jeton de teinte, dans l'ordre des blocs de chat.css : [sombre, clair]. */
function tintPercents(token: string, over: string): [number, number] {
  const re = new RegExp(
    `${token}:\\s*color-mix\\(in srgb, var\\(--jn-accent\\) (\\d+)%, ${over}\\)`,
    "g",
  );
  const found = [...chatCss.matchAll(re)].map((m) => Number(m[1]));
  if (found.length !== 2)
    throw new Error(`${token} : attendu un jeton sombre et un clair, trouvé ${found.length}`);
  return [found[0] as number, found[1] as number];
}

describe("teintes d'accent calibrées (lot D4)", () => {
  const [washDark, washLight] = tintPercents(
    "--jn-accent-wash",
    "var\\(--vscode-input-background\\)",
  );
  const [tintDark, tintLight] = tintPercents("--jn-tint", "transparent");

  for (const [key, accent, wash, tint] of [
    [
      "dark",
      fixture("dark").vars.get("--vscode-textLink-foreground") as string,
      washDark,
      tintDark,
    ],
    [
      "light",
      fixture("light").vars.get("--vscode-textLink-foreground") as string,
      washLight,
      tintLight,
    ],
  ] as const) {
    describe(`thème ${key}`, () => {
      const f = fixture(key);
      const fg = f.vars.get("--vscode-foreground") as string;
      const bgs = backgrounds(key);

      it("texte courant ≥ 4,5 sur la bulle utilisateur (accent-wash sur le fond du champ)", () => {
        const input = f.vars.get("--vscode-input-background") as string;
        expect(ratio(fg, mix(accent, wash, input))).toBeGreaterThanOrEqual(4.5);
      });

      it("texte courant ≥ 4,5 sur la teinte de sélection (tint sur chaque fond)", () => {
        for (const [n, bg] of Object.entries(bgs)) {
          expect(ratio(fg, mix(accent, tint, bg)), `tint / ${n} ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }

  for (const key of ["dark", "light", "hc"] as const) {
    it(`texte d'accent des liens et actions secondaires ≥ 4,5 sur le fond secondaire (${key})`, () => {
      const f = fixture(key);
      const accent =
        key === "hc"
          ? (f.vars.get("--vscode-contrastActiveBorder") as string)
          : (f.vars.get("--vscode-textLink-foreground") as string);
      const secondary = f.vars.get("--vscode-button-secondaryBackground") as string;
      // « ghost » : texte d'accent posé directement sur le fond du corps.
      expect(ratio(accent, f.body)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(accent, secondary)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("danger en trait : --jn-err ≥ 4,5 sur le fond du corps (sombre, clair)", () => {
    for (const key of ["dark", "light"] as const) {
      const f = fixture(key);
      expect(
        ratio(f.vars.get("--vscode-errorForeground") as string, f.body),
        key,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
