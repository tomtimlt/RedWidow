import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../media/chat.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
function frames() {
  return [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((match) => {
    let end = (match.index ?? 0) + match[0].length;
    const start = end;
    let depth = 1;
    while (depth && end < css.length) {
      depth += Number(css[end] === "{") - Number(css[end] === "}");
      end++;
    }
    return { name: match[1], body: css.slice(start, end - 1) };
  });
}

describe("mouvement de la refonte — budget et accessibilité", () => {
  it("les animations évitent de recalculer la disposition ou les ombres", () => {
    expect(frames().length).toBeGreaterThan(0);
    for (const frame of frames())
      for (const property of frame.body.matchAll(/([\w-]+)\s*:/g))
        expect(
          [
            "transform",
            "translate",
            "rotate",
            "opacity",
            "stroke-dashoffset",
            "background-position",
            ...(frame.name === "jn-aura-spin" ? ["--jn-aura-turn"] : []),
          ],
          `${frame.name}: ${property[1]}`,
        ).toContain(property[1]);
  });
  it("aucune transition globale, aucun flou ni filtre coûteux", () => {
    expect(css).not.toMatch(/transition(?:-property)?\s*:\s*all\b/);
    expect(css).not.toMatch(/backdrop-filter|blur\(|[;{\s]filter\s*:/);
    expect(css).not.toMatch(/animation:\s*[^;]*(?:box-shadow|width|height)/);
  });
  it("mouvement réduit, couleurs forcées et contraste élevé neutralisent les effets", () => {
    for (const marker of [
      "prefers-reduced-motion: reduce",
      "forced-colors: active",
      "body.vscode-high-contrast *",
      "body.vscode-high-contrast-light *",
    ])
      expect(css.includes(marker), marker).toBe(true);
    expect(css).toMatch(/animation: none !important/);
    expect(css).toMatch(/transition: none !important/);
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
  });
  it("les vues cachées suspendent aussi les animations au repos", () => {
    const icons = readFileSync(new URL("../media/icons.js", import.meta.url), "utf8");
    expect(icons).toContain('"visibilitychange"');
    expect(icons).toContain('"page-hidden"');
    expect(css).toMatch(/body\.page-hidden \*[\s\S]*?animation-play-state: paused !important/);
  });
  it("fonts locales et grille responsive sans chargement distant", () => {
    for (const path of css.matchAll(/url\(["']?([^)'"\s]+)/g))
      expect(path[1]).not.toMatch(/^(https?:|\/\/|data:)/);
    expect(css).toMatch(/container:\s*app\s*\/\s*inline-size/);
    expect(css).toContain("@container app (max-width: 359px)");
    expect(css).toContain("@container app (min-width: 600px)");
  });
});
