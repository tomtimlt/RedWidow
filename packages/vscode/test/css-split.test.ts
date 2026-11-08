import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CockpitHtmlOptions,
  chatHtml,
  cockpitHtml,
  killchainHtml,
  programHtml,
  sessionsHtml,
  studioHtml,
} from "../src/logic/html.js";
import { CSS_FILES, readCssFile } from "./css.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const common = {
  nonce: "n0nce",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/page.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
} as const;
const PAGES: [string, string, (o: CockpitHtmlOptions & { uiUri: string }) => string][] = [
  ["chat", "chat", chatHtml],
  ["cockpit", "cockpit", cockpitHtml],
  ["program", "program", programHtml],
  ["sessions", "sessions", sessionsHtml],
  ["studio", "studio", studioHtml],
  ["killchain", "killchain", killchainHtml],
];
const links = (html: string) =>
  [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

describe("feuilles de style : base commune puis feuille de page", () => {
  for (const [name, sheet, make] of PAGES) {
    it(`${name} charge base.css puis ${sheet}.css, dans cet ordre`, () => {
      const html = make({ ...common, styleUri: `https://x.vscode-cdn.net/media/css/${sheet}.css` });
      expect(links(html)).toEqual([
        "https://x.vscode-cdn.net/media/css/base.css",
        `https://x.vscode-cdn.net/media/css/${sheet}.css`,
      ]);
      // la CSP n'autorise que les ressources de l'extension : aucune feuille ni police distante
      expect(html).toContain("style-src https://x.vscode-cdn.net;");
      expect(html).toContain("font-src https://x.vscode-cdn.net");
    });
  }

  it("la base peut être fournie explicitement ; une valeur dangereuse est refusée", () => {
    const html = chatHtml({
      ...common,
      styleUri: "https://x.vscode-cdn.net/media/css/chat.css",
      baseStyleUri: "https://x.vscode-cdn.net/autre/base.css",
    });
    expect(links(html)[0]).toBe("https://x.vscode-cdn.net/autre/base.css");
    expect(() =>
      studioHtml({
        ...common,
        styleUri: "https://x.vscode-cdn.net/media/css/studio.css",
        baseStyleUri: 'x" onload="alert(1)',
      }),
    ).toThrow("baseStyleUri");
  });
});

describe("fichiers de media/css", () => {
  it("six feuilles non vides, et plus aucun media/chat.css", () => {
    for (const name of CSS_FILES) expect(readCssFile(name).length).toBeGreaterThan(200);
    expect(existsSync(here("../media/chat.css"))).toBe(false);
  });

  it("les polices ne sont déclarées que dans la base, avec un chemin relatif au dossier css", () => {
    for (const name of CSS_FILES) {
      const css = readCssFile(name);
      if (name === "base") expect(css).toMatch(/@font-face/);
      else expect(css).not.toMatch(/@font-face/);
      for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (!url || url.startsWith("data:") || url.startsWith("#")) continue;
        expect(existsSync(resolve(dirname(here(`../media/css/${name}.css`)), url)), url).toBe(true);
      }
    }
  });

  it("aucun @keyframes défini deux fois (la dernière définition gagnerait selon l'ordre de chargement)", () => {
    const seen = new Map<string, string>();
    for (const name of CSS_FILES) {
      for (const [, id] of readCssFile(name).matchAll(/@keyframes\s+([\w-]+)/g)) {
        expect(seen.get(id ?? ""), `${id} dans ${name}`).toBeUndefined();
        seen.set(id ?? "", name);
      }
    }
  });

  it("chaque page nomme sa feuille dans l'extension, et le VSIX embarque media/ en entier", () => {
    const extension = readFileSync(here("../src/extension/extension.ts"), "utf8");
    for (const sheet of ["chat", "cockpit", "program", "sessions", "studio", "killchain"])
      expect(extension).toContain(`"css", "${sheet}.css"`);
    const pack = readFileSync(here("../scripts/package-vsix.mjs"), "utf8");
    expect(pack).toMatch(
      /cpSync\(join\(pkgDir, "media"\), join\(stage, "media"\), \{ recursive: true \}\)/,
    );
  });

  it("la fiche programme n'emprunte pas cockpit.css : ses règles propres sont recopiées dans les deux feuilles", () => {
    const program = readCssFile("program");
    const cockpit = readCssFile("cockpit");
    const rules = program.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) expect(cockpit, rule.slice(0, 60)).toContain(rule.trim());
  });
});
