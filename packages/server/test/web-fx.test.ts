import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const fx = await load("../web/assets/fx.js");
const fxLib = await load("../web/lib/fx.js");
const fonts = await load("../scripts/vendor-fonts.mjs");

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const text = (rel: string) => read(rel).toString("utf8");

/** Élément minimal : texte et attributs. */
function fakeEl() {
  const attrs = new Map<string, string>();
  return {
    textContent: "",
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    attrs,
  };
}

describe("fx : déchiffrement de titre", () => {
  it("lib/fx.js ré-exporte le module public", () => {
    expect(fxLib.decryptText).toBe(fx.decryptText);
    expect(fxLib.fxActive).toBe(fx.fxActive);
  });

  it("scrambleText : révèle un préfixe, garde les espaces et la longueur", () => {
    const rand = () => 0;
    expect(fx.scrambleText("Red Widow", 0, rand)).toBe(
      `${fx.GLYPHS[0]?.repeat(3)} ${fx.GLYPHS[0]?.repeat(5)}`,
    );
    expect(fx.scrambleText("Red Widow", 1, rand)).toBe("Red Widow");
    const half = fx.scrambleText("abcdefgh", 0.5, rand);
    expect(half.startsWith("abcd")).toBe(true);
    expect(Array.from(half)).toHaveLength(8);
  });

  it("fxActive : exige data-fx=on et refuse prefers-reduced-motion", () => {
    const doc = (fxValue?: string) => ({
      documentElement: { dataset: fxValue === undefined ? {} : { fx: fxValue } },
    });
    const win = (reduce: boolean) => ({ matchMedia: () => ({ matches: reduce }) });
    expect(fx.fxActive(doc("on"), win(false))).toBe(true);
    expect(fx.fxActive(doc("on"), win(true))).toBe(false);
    expect(fx.fxActive(doc("off"), win(false))).toBe(false);
    expect(fx.fxActive(doc(), win(false))).toBe(false);
  });

  it("decryptText sans effets : texte posé tel quel, aucune animation", () => {
    const el = fakeEl();
    let frames = 0;
    fx.decryptText(el, "RedWidow", { active: false, raf: () => frames++ });
    expect(el.textContent).toBe("RedWidow");
    expect(frames).toBe(0);
    expect(el.attrs.size).toBe(0);
  });

  it("decryptText avec effets : brouillé, aria-label, texte final ≤ 400 ms, une seule fois", () => {
    const el = fakeEl();
    let t = 0;
    let pending: (() => void) | null = null;
    fx.decryptText(el, "RedWidow", {
      active: true,
      rand: () => 0,
      now: () => t,
      raf: (cb: (n: number) => void) => {
        pending = () => cb(t);
      },
    });
    expect(el.attrs.get("aria-label")).toBe("RedWidow");
    expect(el.textContent).not.toBe("RedWidow");
    t = 200;
    (pending as unknown as () => void)();
    expect(el.textContent.startsWith("Red")).toBe(true);
    expect(el.textContent).not.toBe("RedWidow");
    t = 400;
    (pending as unknown as () => void)();
    expect(el.textContent).toBe("RedWidow");
    expect(el.attrs.has("aria-label")).toBe(false);
  });

  it("l'annulation pose aussitôt le texte final", () => {
    const el = fakeEl();
    const cancel = fx.decryptText(el, "Titre", { active: true, raf: () => {}, now: () => 0 });
    cancel();
    expect(el.textContent).toBe("Titre");
  });
});

describe("polices vendorisées (Chakra Petch)", () => {
  it("les fichiers commités correspondent à une copie fraîche (sinon : pnpm vendor:fonts)", () => {
    const built = fonts.buildFonts();
    expect(Object.keys(built)).toHaveLength(5);
    for (const [name, content] of Object.entries(built)) {
      const shipped = read(`../web/assets/fonts/${name}`);
      expect(shipped.equals(content as Buffer), name).toBe(true);
    }
    expect(text("../web/assets/fonts/LICENSE-chakra-petch.txt")).toContain("Open Font License");
  });
});

describe("écran de connexion : forme", () => {
  it("aucun attribut style, aucun script en ligne, aucune ressource distante", () => {
    const html = text("../web/login.html");
    expect(/\sstyle\s*=/i.test(html)).toBe(false);
    expect(/<script(?![^>]*\bsrc=)/i.test(html)).toBe(false);
    for (const rel of ["../web/login.html", "../web/assets/login.css", "../web/login.js"]) {
      expect(/https?:\/\//.test(text(rel)), rel).toBe(false);
    }
    expect(html).toContain('role="alert"');
  });

  it("le titre est déchiffré par le module public, sans CDN", () => {
    const js = text("../web/login.js");
    expect(js).toContain('from "/assets/fx.js"');
    expect(js).toContain("decryptText");
  });
});
