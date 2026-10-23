import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Toutes les feuilles de `media/` (chat, cockpit, réglages, terminal…) : chacune suit les mêmes règles. */
const CSS_FILES = readdirSync(fileURLToPath(new URL("../media", import.meta.url)))
  .filter((f) => f.endsWith(".css"))
  .sort();

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

const decls = (r: Rule) =>
  r.body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(":");
      return [d.slice(0, k).trim(), d.slice(k + 1).trim()] as const;
    });

/** Les @keyframes gardées (design-chat-ui.md §2). Le curseur du logo (jn-blink) a disparu avec la marque. */
const KEPT = ["jn-braille", "jn-msg-in", "jn-pop-in", "jn-drawer-in", "jn-fade-in"];

describe.each(CSS_FILES)("%s : budget de performance (design-chat-ui.md §2)", (file) => {
  const css = readFileSync(
    fileURLToPath(new URL(`../media/${file}`, import.meta.url)),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const { rules, keyframes } = parse(css);
  it("aucun dégradé", () => {
    expect(css).not.toMatch(/linear-gradient/);
  });

  it("les @keyframes n'animent que transform et opacity", () => {
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

  it("une seule animation infinie : le spinner #thinking (M6)", () => {
    const infinite = rules.flatMap((r) =>
      decls(r)
        .filter(([k, v]) => k === "animation" && /\binfinite\b/.test(v))
        .map(() => r),
    );
    if (file === "chat.css") expect(infinite.length).toBe(1);
    expect(infinite.length).toBeLessThanOrEqual(1);
    for (const r of infinite) {
      expect(r.selector, r.selector).toMatch(/^#thinking\b/);
    }
  });

  it("l'ensemble des @keyframes est exactement les cinq gardés (M2 à M6)", () => {
    const expected = file === "chat.css" ? KEPT : [];
    expect([...keyframes.keys()].sort()).toEqual([...expected].sort());
  });

  it("toute durée finie ≤ 200 ms (jetons, animations, transitions)", () => {
    const ms = (v: string) =>
      v.endsWith("ms") ? Number.parseFloat(v) : Number.parseFloat(v) * 1000;
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (/^--jn-d\d$/.test(k)) expect(ms(v), `${k}`).toBeLessThanOrEqual(200);
        if (k !== "animation" && k !== "transition") continue;
        // Les tranches séparées par une virgule de premier niveau sont des animations distinctes.
        for (const part of v.replace(/\([^)]*\)/g, "()").split(",")) {
          if (/\binfinite\b/.test(part)) continue;
          const t = /(?:^|\s)(\d*\.?\d+m?s)(?=\s|$)/.exec(part)?.[1];
          if (t) expect(ms(t), `${r.selector}: ${part}`).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it("aucun cubic-bezier avec une ordonnée hors [0, 1]", () => {
    let seen = 0;
    for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      seen++;
      const [, y1, , y2] = (m[1] as string).split(",").map((n) => Number.parseFloat(n));
      for (const y of [y1, y2]) {
        expect(y, m[0]).toBeGreaterThanOrEqual(0);
        expect(y, m[0]).toBeLessThanOrEqual(1);
      }
    }
    if (file === "chat.css") expect(seen).toBeGreaterThan(0);
  });

  it("aucun scale( dans les @keyframes ni les transformations de transition/animation", () => {
    for (const [name, props] of keyframes) expect(props, name).not.toContain("scale");
    expect(css).not.toMatch(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*scale\(/);
    for (const r of rules) {
      if (!decls(r).some(([k]) => k === "transition")) continue;
      for (const [k, v] of decls(r))
        if (k === "transform") expect(v, r.selector).not.toMatch(/scale\(/);
    }
  });

  it("la marque chevrons : classes CSS statiques, pas d'animation", () => {
    if (file !== "chat.css") return;
    expect(css).toMatch(/\.brand-wing/);
    expect(css).toMatch(/\.brand-cursor/);
    expect(css).not.toMatch(/jn-blink|@keyframes.*brand/);
  });

  it("effets supprimés : sweep, curseur ▍ de #thinking, classes sweep/pop-a/pop-b", () => {
    expect(css).not.toMatch(/\.sweep|#thinking \.cursor|#thinking::after|\.pop-[ab]|\.chip\.pop/);
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

  it("aucune couleur figée hors repli de var() (hors #0004 de l'ombre, mots-clés système et jetons de marque)", () => {
    // Seuls --jn-accent, --jn-steel et --jn-ink peuvent porter un hex (marque).
    const brandDecl = /(^|[;{}\s])--jn-(accent|steel|ink)\s*:\s*#[0-9a-fA-F]{3,8}\s*;/g;
    const stripped = css.replace(brandDecl, "$1");
    for (const m of stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const before = stripped.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
      expect(before, m[0]).toMatch(/var\(--[\w-]+,\s*$/);
    }
  });

  it("jetons de marque et d'usage présents (§1.1 et §1.2)", () => {
    if (file !== "chat.css") return;
    for (const t of [
      "--jn-accent: #cc1c40",
      "--jn-steel: #495f73",
      "--jn-ink: #ffffff",
      "--jn-accent-fill:",
      "--jn-on-accent:",
      "--jn-tint:",
      "--jn-secondary:",
    ]) {
      expect(css, t).toContain(t);
    }
  });

  it("aucun jeton supprimé (§1.2, §1.3)", () => {
    expect(css).not.toMatch(/--jn-accent-2|--jn-cool|--jn-glow|--jn-r-pill|ease-spring/);
    // focusBorder n'est admis que dans les blocs de contraste élevé.
    for (const r of rules) {
      if (!r.body.includes("focusBorder")) continue;
      expect(r.selector, "focusBorder hors contraste élevé").toMatch(/vscode-high-contrast/);
    }
  });

  it("border-radius : 0, jeton ou pilule du chat ; jetons de rayon ≤ 12 px ; au plus une ombre non inset", () => {
    const pills = new Set([
      "#toolbar #send",
      "#bar button.ghost",
      "#composer button.ghost",
      ".chip",
      ".tool-btn",
      "#models-refresh",
      ".cmd-opt",
      ".chip-switch .sw-dot",
      "#bypass-switch::before",
      "#learning-switch::before",
    ]);
    let radii = 0;
    const shadows = new Set<string>();
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (v.includes("999px")) expect(k, r.selector).toBe("border-radius");
        if (k === "border-radius") {
          radii++;
          if (v === "999px") {
            for (const part of r.selector.split(",")) {
              expect(pills.has(part.trim()), r.selector).toBe(true);
            }
          } else {
            expect(v, r.selector).toMatch(/^(0|var\(--jn-r-(sm|md|lg)\))$/);
          }
        }
        if (/^--jn-r-(sm|md|lg)$/.test(k)) {
          expect(Number.parseFloat(v), `${k} (${r.selector})`).toBeLessThanOrEqual(12);
        }
        if (k === "box-shadow" && v !== "none" && !v.startsWith("inset")) shadows.add(v);
      }
    }
    if (file === "chat.css") expect(radii).toBeGreaterThan(10);
    expect([...shadows], "ombres non inset").toHaveLength(shadows.size > 0 ? 1 : 0);
    for (const v of shadows) expect(v).toBe("var(--jn-shadow-pop)");
  });
});
