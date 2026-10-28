import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatHtml } from "../src/logic/html.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = chatHtml({
  nonce: "testNonce123",
  cspSource: "https://local.invalid",
  scriptUri: "https://local.invalid/media/chat.js",
  uiUri: "https://local.invalid/media/ui.js",
  styleUri: "https://local.invalid/media/chat.css",
});
function shapes(svg: string) {
  return [...svg.matchAll(/<(?:path|circle|polygon|rect)\b[^>]*>/g)].map((m) =>
    m[0]
      .replace(/\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|class)="[^"]*"/g, "")
      .replace(/\s+/g, " "),
  );
}
describe("nouvelle marque — géométrie et ressources sûres", () => {
  it("crochets, étincelle et satellite cohérents dans les versions inline et fichier", () => {
    const inline = /<svg class="brand"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
    expect(inline).toContain('aria-hidden="true"');
    expect(shapes(inline)).toHaveLength(3);
    for (const file of ["logo.svg", "logo-small.svg", "icon.svg"]) {
      const svg = read(`../media/${file}`);
      expect(shapes(svg).slice(0, 2)).toEqual(shapes(inline).slice(0, 2));
      expect(shapes(svg)[2]).toMatch(/cx="17.4" cy="6.6" r="1.[36]"/);
      expect(svg).not.toMatch(/<animate|<script|<set\b|\bon\w+\s*=|href\s*=|<style|url\(/i);
    }
  });
  it("icône monochrome, marque animable via CSS et réduction du mouvement", () => {
    expect(read("../media/icon.svg")).toContain("currentColor");
    const css = read("../media/chat.css");
    for (const part of ["brand-wing", "brand-core", "brand-lead", "brand-orbit", "brand-node"])
      expect(css).toContain(part);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
  it("chaque pictogramme HTML est disponible dans le catalogue local", () => {
    const source = read("../media/icons.js");
    for (const match of html.matchAll(/data-icon="([^"]+)"/g))
      expect(source.includes(`${match[1]}:`) || match[1] === "killchain", match[1]).toBe(true);
  });
});
