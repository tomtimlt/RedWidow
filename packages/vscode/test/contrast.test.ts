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

function backgrounds(key: "dark" | "light" | "hc"): Record<string, string> {
  const f = fixture(key);
  return {
    body: f.body,
    widget: f.vars.get("--vscode-editorWidget-background") as string,
    input: f.vars.get("--vscode-input-background") as string,
  };
}
/** Mélange sRGB d’un texte semi-transparent sur un fond opaque. */
function mix(fg: string, pct: number, bg: string): string {
  const a = rgb(fg),
    b = rgb(bg);
  return `#${a
    .map((v, i) =>
      Math.round((v * pct) / 100 + (b[i] ?? 0) * (1 - pct / 100))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function signature(palette: string, theme: "dark" | "light"): string {
  if (palette === "editeur")
    return fixture(theme).vars.get("--vscode-textLink-foreground") as string;
  const selector =
    theme === "light"
      ? `body.vscode-light[data-palette="${palette}"]`
      : `body[data-palette="${palette}"]`;
  const start = chatCss.indexOf(selector);
  const block = chatCss.slice(start, chatCss.indexOf("}", start));
  const hex = /--jn-brand:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
  if (!hex) throw new Error(`Palette absente : ${palette}/${theme}`);
  return hex;
}
describe("contraste de la refonte", () => {
  it("le calcul reproduit noir/blanc et les boutons restent lisibles", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    for (const key of ["dark", "light", "hc"] as const) {
      const { vars } = fixture(key);
      expect(
        ratio(
          vars.get("--vscode-button-foreground") as string,
          vars.get("--vscode-button-background") as string,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(chatCss).toContain("--jn-accent-fill: var(--vscode-button-background)");
    expect(chatCss).toContain("--jn-on-accent: var(--vscode-button-foreground)");
  });
  for (const theme of ["dark", "light"] as const) {
    it(`le badge Bypass et son compteur restent lisibles en ${theme}`, () => {
      const { vars, body } = fixture(theme);
      const fg = vars.get("--vscode-foreground") as string;
      const editor = vars.get("--vscode-editor-background") as string;
      const magenta = vars.get("--vscode-terminal-ansiMagenta") as string;
      const pct = Number(
        /var\(--vscode-terminal-ansiMagenta, #[a-f0-9]+\) ([0-9.]+)%/.exec(chatCss)?.[1],
      );
      expect(pct).toBeGreaterThan(0);
      const bypass = mix(magenta, pct, fg);
      expect(ratio(editor, bypass)).toBeGreaterThanOrEqual(4.5);
      const clock = /\.roe-left \{([^}]*)\}/.exec(chatCss)?.[1] ?? "";
      expect(clock).toContain("color: var(--vscode-foreground)");
      for (const bg of [body, editor]) {
        expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(fg, mix(bypass, 16, bg))).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  for (const theme of ["dark", "light"] as const)
    for (const palette of ["sentinelle", "braise", "bastion", "spectre", "editeur"]) {
      it(`signature lisible sur les surfaces de ${palette}/${theme}`, () => {
        for (const [name, bg] of Object.entries(backgrounds(theme)))
          expect(ratio(signature(palette, theme), bg), name).toBeGreaterThanOrEqual(4.5);
      });
    }
  for (const theme of ["dark", "light"] as const) {
    it(`textes secondaires et métadonnées restent lisibles en ${theme}`, () => {
      const fg = fixture(theme).vars.get("--vscode-foreground") as string;
      for (const token of ["muted", "faint"]) {
        const matches = [
          ...chatCss.matchAll(
            new RegExp(
              `--jn-${token}:\\s*color-mix\\(in srgb, var\\(--vscode-foreground\\) ([0-9.]+)%`,
              "g",
            ),
          ),
        ];
        const pct = Number(matches[theme === "dark" ? 0 : 1]?.[1]);
        expect(pct).toBeGreaterThan(0);
        for (const [name, bg] of Object.entries(backgrounds(theme)))
          expect(ratio(mix(fg, pct, bg), bg), `${token}/${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`sélection et bulle utilisateur conservent un contraste ≥4,5 en ${theme}`, () => {
      const f = fixture(theme),
        fg = f.vars.get("--vscode-foreground") as string,
        accent = f.vars.get("--vscode-textLink-foreground") as string;
      for (const bg of Object.values(backgrounds(theme)))
        for (const pct of [7, 11])
          expect(ratio(fg, mix(accent, pct, bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
