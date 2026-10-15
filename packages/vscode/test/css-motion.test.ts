import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../media/chat.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  body: string;
  /** Prélude de la règle @ englobante (media, container), le cas échéant. */
  within: string;
}

/** Aplatit les règles (y compris sous @media/@container) ; les @keyframes sont renvoyées à part. */
function parse(src: string, within = ""): { rules: Rule[]; keyframes: Map<string, string[]> } {
  const rules: Rule[] = [];
  const keyframes = new Map<string, string[]>();
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const prelude = src.slice(i, open).trim();
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@keyframes")) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1] as string);
      keyframes.set(prelude.replace("@keyframes", "").trim(), props);
    } else if (prelude.startsWith("@")) {
      const inner = parse(body, prelude);
      rules.push(...inner.rules);
      for (const [k, v] of inner.keyframes) keyframes.set(k, v);
    } else {
      rules.push({ selector: prelude, body, within });
    }
    i = j;
  }
  return { rules, keyframes };
}

const { rules, keyframes } = parse(css);
const decls = (r: Rule) =>
  r.body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(":");
      return [d.slice(0, k).trim(), d.slice(k + 1).trim()] as const;
    });

describe("chat.css : budget de performance (design-chat-ui.md §2)", () => {
  it("les @keyframes n'animent que transform et opacity", () => {
    expect(keyframes.size).toBeGreaterThan(5);
    for (const [name, props] of keyframes) {
      for (const p of props) expect(["transform", "opacity"], `${name}: ${p}`).toContain(p);
    }
  });

  it("transition : seulement la liste E6, jamais all", () => {
    const allowed = ["color", "background-color", "border-color", "opacity", "transform", "none"];
    let seen = 0;
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (k !== "transition" && k !== "transition-property") continue;
        seen++;
        expect(v, r.selector).not.toMatch(/\ball\b/);
        for (const part of v.replace(/\([^)]*\)/g, "").split(",")) {
          expect(allowed, `${r.selector}: ${part}`).toContain(part.trim().split(/\s+/)[0]);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("aucun backdrop-filter, blur(, filter ni animation de box-shadow", () => {
    expect(css).not.toMatch(/backdrop-filter|blur\(|[\s;{]filter\s*:/);
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (k === "animation" || k === "animation-name") expect(v).not.toMatch(/shadow/);
      }
    }
  });

  it("au plus 3 animations infinies, toutes sous #thinking", () => {
    const infinite = rules.flatMap((r) =>
      decls(r)
        .filter(([k, v]) => k === "animation" && /\binfinite\b/.test(v))
        .map(() => r),
    );
    expect(infinite.length).toBeGreaterThan(0);
    expect(infinite.length).toBeLessThanOrEqual(3);
    for (const r of infinite) expect(r.selector.startsWith("#thinking"), r.selector).toBe(true);
  });

  it("will-change seulement sur la bande du spinner", () => {
    for (const r of rules) {
      if (decls(r).some(([k]) => k === "will-change")) expect(r.selector).toContain("spin-strip");
    }
  });

  it("interrupteur global : mouvement réduit, contraste élevé, couleurs forcées", () => {
    const kill = (within: RegExp, selector: RegExp) =>
      rules.some(
        (r) =>
          within.test(r.within) &&
          selector.test(r.selector) &&
          r.body.includes("animation: none !important") &&
          r.body.includes("transition: none !important"),
      );
    expect(kill(/prefers-reduced-motion:\s*reduce/, /^body \*/)).toBe(true);
    expect(kill(/forced-colors:\s*active/, /^body \*/)).toBe(true);
    expect(kill(/^$/, /body\.vscode-high-contrast \*/)).toBe(true);
    expect(kill(/^$/, /body\.vscode-high-contrast-light \*/)).toBe(true);
  });

  it("repères de responsive : container queries 360 et 600 px sur body", () => {
    expect(css).toMatch(/container:\s*app\s*\/\s*inline-size/);
    expect(css).toContain("@container app (max-width: 359px)");
    expect(css).toContain("@container app (min-width: 600px)");
  });

  it("aucune couleur figée hors repli de var() (hors #0006 de l'ombre et mots-clés système)", () => {
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const before = css.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
      expect(before, m[0]).toMatch(/var\(--[\w-]+,\s*$/);
    }
  });
});
