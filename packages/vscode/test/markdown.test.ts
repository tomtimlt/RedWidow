import { describe, expect, it } from "vitest";
import { type Block, type Inline, parseMarkdown } from "../src/logic/markdown.js";
import { summarizeInput, toolLabel } from "../src/logic/present.js";

const ALLOWED = new Set(["p", "h", "code", "ul", "ol", "text", "b", "i"]);
/** Parcourt l'arbre : tout type de nœud doit être dans la liste blanche (pas de lien, image, HTML). */
function types(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) for (const v of x) types(v, out);
  else if (typeof x === "object" && x !== null) {
    const o = x as Record<string, unknown>;
    if (typeof o.t === "string") out.push(o.t);
    for (const v of Object.values(o)) types(v, out);
  }
  return out;
}

describe("parseMarkdown", () => {
  it("paragraphes, titres, listes, gras, italique, code en ligne", () => {
    const b = parseMarkdown("# Titre\nUn **gras**, un *it* et `code`.\n\n- a\n- b\n\n1. x\n2. y");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol"]);
    const p = b[1] as Extract<Block, { t: "p" }>;
    expect(p.c.map((n: Inline) => n.t)).toEqual(["text", "b", "text", "i", "text", "code", "text"]);
    expect((b[2] as { items: Inline[][] }).items).toHaveLength(2);
  });
  it("bloc de code avec langage, contenu non interprété", () => {
    const b = parseMarkdown("```ts\nconst a = **x**;\n```\nfin");
    expect(b[0]).toEqual({ t: "code", lang: "ts", text: "const a = **x**;" });
    expect(b[1]?.t).toBe("p");
  });
  it("bloc non fermé : tout est du code, sans planter", () => {
    expect(parseMarkdown("```\nabc")[0]).toEqual({ t: "code", lang: "", text: "abc" });
  });
  it("entrée hostile : jamais de nœud script/a/img/on*, le HTML reste du texte", () => {
    const hostile = [
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>",
      "[clic](javascript:alert(1)) ![i](http://x/y.png) <a href=x onclick=y>z</a>",
      "**<b onmouseover=x>** *`<svg onload=1>`*",
      "```<script>\n<img src=x onerror=1>\n```",
    ].join("\n\n");
    const tree = parseMarkdown(hostile);
    for (const t of types(tree)) expect(ALLOWED.has(t), t).toBe(true);
    const flat = JSON.stringify(tree);
    expect(flat).toContain("<img src=x onerror=alert(1)>");
    expect(flat).toContain("[clic](javascript:alert(1))");
  });
  it("imbrication profonde bornée", () => {
    expect(() => parseMarkdown(`${"*a ".repeat(5000)}${"*".repeat(5000)}`)).not.toThrow();
  });
});

describe("present", () => {
  it("noms lisibles", () => {
    expect(toolLabel("Read")).toBe("Lecture");
    expect(toolLabel("mcp__sandbox__exec")).toBe("Bac à sable · exec");
    expect(toolLabel("Inconnu")).toBe("Inconnu");
  });
  it("résumé d'une ligne, tronqué, sans JSON", () => {
    expect(summarizeInput({ file_path: "/a/b.ts", limit: 3 })).toBe("/a/b.ts");
    expect(summarizeInput({ pattern: "**/*.ts" })).toBe("**/*.ts");
    expect(summarizeInput({ command: `echo\n${"x".repeat(300)}` }).length).toBe(120);
    expect(summarizeInput({ command: "a\x1b[2Kb" })).toBe("ab");
    expect(summarizeInput({ n: 1 })).toBe("");
  });
});
