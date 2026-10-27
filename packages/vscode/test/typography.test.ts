import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Typographie et composants (docs/design-interface-2026.md) : règles vérifiables de `media/chat.css`,
 * partagée par le chat, le cockpit et les réglages.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("../media/chat.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
  /** Prélude de la règle @ englobante (media, container), le cas échéant. */
  within: string;
}

/** Aplatit les règles, y compris sous @media/@container ; les @keyframes sont ignorées. */
function parse(src: string, within = ""): Rule[] {
  const rules: Rule[] = [];
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
      // rien : les images clés n'ont ni police ni graisse
    } else if (prelude.startsWith("@")) {
      rules.push(...parse(body, prelude));
    } else {
      rules.push({ selectors: prelude.split(",").map((s) => s.trim()), body, within });
    }
    i = j;
  }
  return rules;
}

const rules = parse(css);
const decls = (r: Rule) =>
  r.body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(":");
      return [d.slice(0, k).trim(), d.slice(k + 1).trim()] as const;
    });
/** Déclarations d'une propriété, pour toutes les règles dont la liste de sélecteurs contient `selector`. */
const valuesOf = (selector: string, prop: string, within = ""): string[] =>
  rules
    .filter((r) => r.selectors.includes(selector) && r.within === within)
    .flatMap((r) =>
      decls(r)
        .filter(([k]) => k === prop)
        .map(([, v]) => v),
    );
const has = (selector: string, prop: string, value: string | RegExp, within = "") =>
  valuesOf(selector, prop, within).some((v) =>
    typeof value === "string" ? v === value : value.test(v),
  );

describe("typographie (§1.4)", () => {
  it("tailles : xs 11, sm 12, lg 14 px ; interface et mono dérivées du thème", () => {
    expect(css).toMatch(/--jn-fs-xs: 11px;/);
    expect(css).toMatch(/--jn-fs-sm: 12px;/);
    expect(css).toMatch(/--jn-fs-lg: 14px;/);
    expect(css).toMatch(/--jn-font: "Warband Inter", var\(--vscode-font-family/);
    expect(css).toMatch(/--jn-mono: var\(--vscode-editor-font-family/);
  });

  it("graisses lisibles : 400, 500 et 600", () => {
    let seen = 0;
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (k !== "font-weight") continue;
        seen++;
        expect(["400", "500", "600"], `${r.selectors.join(", ")} : ${v}`).toContain(v);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(css).not.toMatch(/\bbold(er)?\b/);
  });

  it("aucun interlettrage négatif", () => {
    let seen = 0;
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (k !== "letter-spacing") continue;
        seen++;
        expect(Number.parseFloat(v), `${r.selectors.join(", ")} : ${v}`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("mono pour le code, les commandes, les identifiants et les compteurs", () => {
    const mono = [
      // code
      "code",
      "pre",
      ".card-summary",
      ".mon-cmd",
      ".mon-out",
      ".cmd",
      // noms d'outils et identifiants (le chrome des pastilles reste en police d'interface)
      ".tool-summary",
      ".opt-label",
      // compteurs
      ".badge",
      ".cockpit-count",
      ".studio-count",
      ".hist-meta",
      // étiquettes d'état et clés
      ".card-key",
      ".cockpit-row-state",
      ".cockpit-row-image",
      ".kc-node-meta",
      ".studio-node-meta",
    ];
    for (const sel of mono) {
      expect(has(sel, "font-family", "var(--jn-mono)"), `${sel} en mono`).toBe(true);
    }
  });

  it("titres et noms d’interface utilisent la police du thème", () => {
    for (const sel of [
      ".tool-name",
      ".label",
      ".cfg-col h3",
      ".cockpit-h",
      ".studio-nav-title",
      ".studio-group-title",
      ".studio-kicker",
      ".studio-name",
      ".cockpit-row-name",
      ".cockpit-hero-name",
      ".cockpit-pill",
      ".cockpit-linked-tag",
    ]) {
      expect(has(sel, "font-family", "var(--jn-font)"), sel).toBe(true);
    }
    for (const sel of [".label", ".cfg-col h3", ".studio-kicker"]) {
      expect(has(sel, "font-size", "var(--jn-fs-xs)"), sel).toBe(true);
      expect(has(sel, "text-transform", "uppercase"), sel).toBe(true);
    }
    expect(has(".cockpit-h", "text-transform", "none")).toBe(true);
  });
  it("prose, pastilles et boutons hors code restent dans la police d'interface", () => {
    expect(has("body", "font-family", "var(--jn-font)")).toBe(true);
    for (const sel of [
      ".msg",
      ".hint",
      ".card-title",
      ".welcome h2",
      "button",
      ".chip-label",
      ".cfg-level",
      ".cfg-off em",
      ".kc-zoom",
    ]) {
      expect(
        valuesOf(sel, "font-family").filter((v) => v.includes("mono")),
        sel,
      ).toEqual([]);
    }
  });

  it("tabular-nums sur les compteurs", () => {
    const tabular = rules.find((r) =>
      decls(r).some(([k, v]) => k === "font-variant-numeric" && v === "tabular-nums"),
    );
    expect(tabular).toBeTruthy();
    for (const sel of [".badge", ".cockpit-count", ".studio-count", ".cfg-level", ".hist-meta"]) {
      expect(tabular?.selectors, sel).toContain(sel);
    }
  });
});

describe("composants (§5)", () => {
  it("accent courant dérivé des liens du thème", () => {
    expect(css).toContain(
      "--jn-accent: var(--vscode-textLink-foreground, var(--vscode-button-background))",
    );
  });

  it("liens et actions secondaires : texte d'accent, jamais de fond bleu", () => {
    expect(has("button.link", "color", "var(--jn-accent)")).toBe(true);
    expect(has("button.copy", "color", "var(--jn-accent)")).toBe(true);
    // link = secondary (fond et bordure de bouton secondaire), copy = ghost (transparent)
    expect(valuesOf("button.link", "background")).toEqual([]);
    expect(has("button.copy", "background", "transparent")).toBe(true);
  });

  it("secondary : fond secondaire du thème et bordure --jn-line", () => {
    expect(has("button", "background", "var(--vscode-button-secondaryBackground)")).toBe(true);
    expect(has("button", "border", "1px solid var(--jn-line)")).toBe(true);
  });

  it("ghost : transparent, survol en teinte d'accent", () => {
    expect(has("button.ghost", "background", "transparent")).toBe(true);
    expect(
      has(
        'button.ghost:hover:not(:disabled):not([aria-disabled="true"])',
        "background",
        "var(--jn-tint)",
      ),
    ).toBe(true);
  });

  it("danger : en trait, couleur --jn-err", () => {
    expect(has("button.danger", "background", "transparent")).toBe(true);
    expect(has("button.danger", "color", "var(--jn-err)")).toBe(true);
    expect(has("button.danger", "border-color", "var(--jn-err)")).toBe(true);
  });

  it("primary : accent plein, texte on-accent", () => {
    expect(has("button.primary", "background", "var(--jn-accent-fill)")).toBe(true);
    expect(has("button.primary", "color", "var(--jn-on-accent)")).toBe(true);
  });

  it("disabled : opacité .5", () => {
    expect(has("button:disabled", "opacity", "0.5")).toBe(true);
  });

  it("étiquettes : rectangle sm, bordure 1 px, mono sm", () => {
    expect(has(".badge", "border", "1px solid var(--jn-line)")).toBe(true);
    expect(has(".badge", "border-radius", "var(--jn-r-sm)")).toBe(true);
    expect(has(".badge", "font-size", "var(--jn-fs-sm)")).toBe(true);
    expect(has(".cockpit-pill", "border", "1px solid var(--jn-line)")).toBe(true);
  });

  it("sélection : teinte et liseré gauche d'accent (option, entrée de réglages, historique)", () => {
    expect(has('.opt[aria-selected="true"]', "background", "var(--jn-tint)")).toBe(true);
    expect(has('.opt[aria-selected="true"]', "border-left-color", "var(--jn-accent)")).toBe(true);
    expect(has(".hist.current", "background", "var(--jn-tint)")).toBe(true);
    expect(has(".hist.current", "border-left-color", "var(--jn-accent)")).toBe(true);
  });

  it("bascules : état actif en accent plein sur texte on-accent", () => {
    expect(has('.chip-switch[aria-checked="true"]', "background", "var(--jn-accent-fill)")).toBe(
      true,
    );
    expect(has('.chip-switch[aria-checked="true"]', "color", "var(--jn-on-accent)")).toBe(true);
    expect(
      has('#learning-switch[aria-checked="true"]::after', "background", "var(--jn-accent-fill)"),
    ).toBe(true);
  });

  it("contrôles compacts à rayon sm et compositeur à rayon lg", () => {
    for (const sel of [
      "#toolbar #stop",
      "#bar button.ghost",
      "#composer button.ghost",
      ".tool-btn",
    ]) {
      expect(has(sel, "border-radius", "var(--jn-r-sm)"), sel).toBe(true);
    }
    expect(has("#toolbar #send", "border-radius", "50%")).toBe(true);
    expect(has(".dot", "border-radius", "50%")).toBe(true);
    expect(has("#composer", "border-radius", "var(--jn-r-lg)")).toBe(true);
    expect(has(".msg.user", "border-radius", "var(--jn-r-md)")).toBe(true);
  });
  it("slider natif : piste remplie et pouce rond, focus clavier visible", () => {
    expect(has("#effort", "appearance", "none")).toBe(true);
    expect(has("#effort-scale::before", "background", "var(--jn-accent-fill)")).toBe(true);
    expect(has("#effort::-webkit-slider-thumb", "border-radius", "50%")).toBe(true);
    expect(has("#effort:focus-visible", "outline-offset", "-2px")).toBe(true);
  });

  it("liseré gauche : 2 px au plus, carte d'approbation en --jn-warn", () => {
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        const m =
          k === "border-left"
            ? /^(\d+)px\b/.exec(v)
            : k === "border-left-width"
              ? /^(\d+)px$/.exec(v)
              : null;
        if (m) expect(Number(m[1]), `${r.selectors.join(", ")} : ${k} ${v}`).toBeLessThanOrEqual(2);
      }
    }
    expect(has(".card", "border-left", "2px solid var(--jn-card-accent)")).toBe(true);
    expect(css).toMatch(/--jn-card-accent: var\(\s*--vscode-editorWarning-foreground/);
  });

  it("teintes d'accent : jetons --jn-accent-wash et --jn-accent-edge, par thème, sans pourcentage figé ailleurs", () => {
    for (const tok of ["--jn-accent-wash", "--jn-accent-edge"]) {
      expect(css.match(new RegExp(`${tok}:`, "g"))?.length, tok).toBeGreaterThanOrEqual(4);
    }
    // plus de color-mix direct sur l'accent hors des jetons de teinte
    for (const r of rules) {
      for (const [k, v] of decls(r)) {
        if (k.startsWith("--jn-")) continue;
        expect(v, `${r.selectors.join(", ")} : ${k}`).not.toMatch(
          /color-mix\([^)]*var\(--jn-accent\)/,
        );
      }
    }
    expect(has(".msg.user", "background", "var(--jn-accent-wash)")).toBe(true);
    expect(has(".msg.user", "border", "1px solid var(--jn-accent-edge)")).toBe(true);
  });
});

describe("débordement à 280 px : barre d'outils du composer", () => {
  it("les outils secondaires ont leur rangée, le modèle et les actions restent groupés", () => {
    expect(has("#toolbar", "flex-wrap", "wrap")).toBe(true);
    expect(has(".composer-tools", "flex", "1 1 100%")).toBe(true);
    expect(has("#ctl-group", "flex", "1 1 100px")).toBe(true);
  });

  it("le modèle peut rétrécir et reste borné à la largeur disponible", () => {
    expect(has("#ctl-group", "min-width", "0")).toBe(true);
    expect(has("#model-chip", "max-width", "100%")).toBe(true);
    expect(has("#ctl-group > *", "min-width", "0")).toBe(true);
  });

  it("le groupe de pastilles peut passer à la ligne et ses enfants rétrécir", () => {
    expect(has("#ctl-group", "flex-wrap", "wrap")).toBe(true);
    expect(has("#ctl-group > *", "min-width", "0")).toBe(true);
  });

  it("compact : Configurer en icône seule (libellé masqué visuellement)", () => {
    const within = "@container app (max-width: 359px)";
    expect(has("#cfg-btn .cfg-text", "clip-path", "inset(50%)", within)).toBe(true);
  });
});

describe("logo d'accueil", () => {
  it("sombre et clair : logo.svg en couleurs de marque, fond transparent", () => {
    expect(has(".welcome::before", "background", /url\("logo\.svg"\)/)).toBe(true);
    expect(has("body.vscode-light .welcome::before", "background", "var(--jn-brand-ink)")).toBe(
      false,
    );
    expect(css).not.toMatch(/welcome::after/);
  });

  it("contraste élevé clair et couleurs forcées : icon.svg en masque monochrome", () => {
    expect(
      has("body.vscode-high-contrast-light .welcome::before", "mask", /^url\("icon\.svg"\)/),
    ).toBe(true);
    expect(
      has(
        "body.vscode-light .welcome::before",
        "mask",
        /^url\("icon\.svg"\)/,
        "@media (forced-colors: active)",
      ),
    ).toBe(true);
  });
});

describe("défilement du chat", () => {
  it("verrouille la page : html et body à 100 %, colonne flex, sans 100vh", () => {
    expect(has("html", "height", "100%")).toBe(true);
    expect(has("html", "overflow", "hidden")).toBe(true);
    expect(has("body", "height", "100%")).toBe(true);
    expect(has("body", "overflow", "hidden")).toBe(true);
    expect(has("body", "display", "flex")).toBe(true);
    expect(has("body", "flex-direction", "column")).toBe(true);
    expect(css).not.toMatch(/height:\s*100vh/);
  });

  it("seul #log défile ; le compositeur reste en bas du cadre", () => {
    expect(has("#log", "flex", "1")).toBe(true);
    expect(has("#log", "min-height", "0")).toBe(true);
    expect(has("#log", "overflow-y", "auto")).toBe(true);
    expect(has("#form", "flex", "none")).toBe(true);
  });

  it("les longues sorties d’outil défilent dans une zone bornée", () => {
    expect(has(".tool-body pre", "max-height", "420px")).toBe(true);
    expect(has(".tool-body pre", "overflow", "auto")).toBe(true);
  });
  it("Kill chain plein éditeur : la page remplit la webview, le viewport partage la rangée avec le panneau légende", () => {
    expect(has("body.killchain-full .studio-kc-page", "height", "100%")).toBe(true);
    expect(has("body.killchain-full .studio-kc", "height", "100%")).toBe(true);
    expect(has("body.killchain-full .studio-kc", "display", "grid")).toBe(true);
    expect(has("body.killchain-full .kc-bar", "grid-column", "1 / -1")).toBe(true);
    expect(has("body.killchain-full .kc-viewport", "height", "100%")).toBe(true);
    expect(has("body.killchain-full .kc-viewport", "flex", "1 1 auto")).toBe(true);
    expect(has("body.killchain-full .kc-viewport", "min-width", "0")).toBe(true);
    expect(has("body.killchain-full .studio-kc-page", "max-width", "none")).toBe(true);
    expect(has("body.killchain-full .studio-kc-page", "inset", "0")).toBe(true);
    expect(has("body.killchain-full .kc-empty", "inset", "0")).toBe(true);
    expect(has("body.killchain-full .kc-viewport", "border", "0")).toBe(true);
  });

  it("le monitor hors chat est hors flux ; sa zone ne défile qu'en monitor ou suivi", () => {
    expect(has("#monitor", "display", "none")).toBe(true);
    expect(has("body.mode-monitor #monitor", "overflow-y", "auto")).toBe(true);
    expect(has("body.mode-watch #monitor", "overflow-y", "auto")).toBe(true);
    expect(has("body.mode-monitor #monitor", "min-height", "0")).toBe(true);
    expect(has("body.mode-watch #monitor", "min-height", "0")).toBe(true);
  });
});
