import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUiTranslator } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, productTitleSuffix } from "../src/logic/brand.js";
import { planEditorShell } from "../src/logic/cockpit.js";
import { PALETTES, paletteOf } from "../src/logic/palette.js";
import { readCss } from "./css.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
class GraphicNode {
  readonly attrs = new Map<string, string>();
  readonly children: GraphicNode[] = [];
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value);
  }
  append(child: GraphicNode) {
    this.children.push(child);
  }
  all(): GraphicNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}
describe("intégration RedWidow en production", () => {
  it("préserve les identifiants et les terminaux des deux noms précédents", () => {
    const manifest = JSON.parse(read("../extension.manifest.json"));
    expect(PRODUCT_NAME).toBe("RedWidow");
    expect(manifest.displayName).toBe(PRODUCT_NAME);
    expect(manifest.name).toBe("warband");
    expect(manifest.publisher).toBe("warband");
    expect(
      manifest.contributes.commands.every((command: { command: string }) =>
        command.command.startsWith("warband."),
      ),
    ).toBe(true);
    for (const name of ["Warband", "Venator Ops", "RedWidow"])
      expect(productTitleSuffix(`${name} : kali-1 (2)`)).toBe("kali-1 (2)");
    expect(
      planEditorShell("kali-1", [{ name: "kali-1", state: "running" }], ["Venator Ops : kali-1"]),
    ).toEqual({ action: "launch", name: "kali-1", title: "RedWidow : kali-1 (2)" });
  });
  it("propose 23 palettes, conserve les anciennes préférences et traduit les nouvelles cartes", () => {
    expect(PALETTES).toHaveLength(23);
    const iconPalettes = /const PALETTES = new Set\((\[[\s\S]*?\])\)/.exec(
      read("../media/icons.js"),
    );
    expect(iconPalettes).not.toBeNull();
    expect(runInNewContext(iconPalettes?.[1] ?? "[]")).toEqual(PALETTES.map(([id]) => id));
    expect(paletteOf(undefined)).toBe("widow");
    for (const value of ["sentinelle", "braise", "spectre", "editeur", "multi"])
      expect(paletteOf(value)).toBe(value);
    const t = createUiTranslator(() => "en");
    expect(t("Rouge")).toBe("Red");
    expect(t("Venin")).toBe("Venom");
    expect(t("Lune de sang")).toBe("Blood moon");
  });
  it("construit l’araignée et le livre en SVG local décoratif, sans élément actif", () => {
    const context: {
      WarbandSpider?: { create(className: string): GraphicNode };
      window?: unknown;
      document: unknown;
    } = { document: { createElementNS: (_ns: string, tag: string) => new GraphicNode(tag) } };
    context.window = context;
    runInNewContext(read("../media/spider.js"), context);
    const spider = context.WarbandSpider?.create("rw-spider");
    expect(spider).toBeDefined();
    if (!spider) return;
    expect(spider.attrs.get("aria-hidden")).toBe("true");
    expect(spider.attrs.get("focusable")).toBe("false");
    const classes = spider.all().map((node) => node.attrs.get("class")?.split(" "));
    for (const side of ["l", "r"])
      for (let n = 1; n <= 4; n++)
        expect(classes.some((names) => names?.includes(`rw-leg-${side}${n}`))).toBe(true);
    expect(spider.all().some((node) => node.attrs.get("class") === "rw-book")).toBe(true);
    for (const node of spider.all()) {
      expect(["svg", "g", "path", "rect", "circle"]).toContain(node.tag);
      for (const attr of node.attrs.keys()) expect(attr).not.toMatch(/^(?:on|href|style)/i);
    }
    expect(read("../media/spider.js")).not.toMatch(/fetch\(|XMLHttpRequest|\.innerHTML\s*=/);
  });
  it("la petite icône conserve le cerveau et quatre pattes, sans viseur, livre ni identifiant dupliqué", () => {
    const context: {
      WarbandSpider?: { createMini(className: string): GraphicNode };
      window?: unknown;
      document: unknown;
    } = { document: { createElementNS: (_ns: string, tag: string) => new GraphicNode(tag) } };
    context.window = context;
    runInNewContext(read("../media/spider.js"), context);
    const minis = [
      context.WarbandSpider?.createMini("brand"),
      context.WarbandSpider?.createMini("avatar"),
    ];
    for (const mini of minis) {
      expect(mini).toBeDefined();
      if (!mini) continue;
      expect(mini.attrs.get("viewBox")).toBe("165 450 925 771");
      expect(mini.attrs.get("aria-hidden")).toBe("true");
      const all = mini.all();
      expect(
        all.filter((node) => node.attrs.get("class")?.split(" ").includes("rw-leg")),
      ).toHaveLength(4);
      expect(all.some((node) => node.attrs.get("class") === "rw-brain")).toBe(true);
      expect(all.some((node) => node.attrs.get("class") === "rw-eyes")).toBe(true);
      expect(all.some((node) => /rw-book|rw-crosshair/.test(node.attrs.get("class") ?? ""))).toBe(
        false,
      );
      expect(all.some((node) => node.attrs.has("id"))).toBe(false);
      const svg = read("../media/logo.svg");
      expect(all.filter((node) => node.tag === "path")).toHaveLength(23);
      for (const node of all.filter((node) => node.tag === "path"))
        expect(svg).toContain(`d="${node.attrs.get("d")}"`);
    }
  });
  it("l’aura anime uniquement un angle typé, sans affaiblir les garde-fous de mouvement", () => {
    const css = readCss();
    expect(css).toMatch(/@property --jn-aura-turn\s*\{[^}]*syntax:\s*"<angle>"/);
    expect(css).toMatch(
      /@keyframes jn-aura-spin\s*\{\s*to\s*\{\s*--jn-aura-turn:\s*360deg;\s*\}\s*\}/,
    );
    expect(css).toContain("body.page-hidden::after");
    expect(css).toContain("body.reduce-motion::after");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
  });
});
