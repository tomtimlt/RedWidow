import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatHtml, makeNonce } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
  uiUri: "https://x.vscode-cdn.net/media/ui.js",
  styleUri: "https://x.vscode-cdn.net/media/chat.css",
};

describe("HTML du chat : CSP stricte", () => {
  const html = chatHtml(opts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique exacte, sans unsafe-* ni source distante", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net",
    );
    expect(csp).not.toMatch(/unsafe|\*|http:|data:/);
  });
  it("deux scripts (ui.js puis chat.js), chacun avec nonce et source de l'extension ; aucun script ou style inline, aucun handler", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(2);
    expect(scripts.map((m) => /src="([^"]+)"/.exec(m[1] ?? "")?.[1])).toEqual([
      opts.uiUri,
      opts.scriptUri,
    ]);
    for (const m of scripts) {
      expect(m[1]).toContain('nonce="abc123_-XYZ"');
      expect(m[2]).toBe("");
    }
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    // Toutes les ressources viennent de l'origine webview.
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1]?.startsWith("https://x.vscode-cdn.net/")).toBe(true);
    }
  });
  it("refuse une valeur capable de sortir d'un attribut", () => {
    expect(() => chatHtml({ ...opts, nonce: 'a"onload="x' })).toThrow();
    expect(() => chatHtml({ ...opts, scriptUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, uiUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, cspSource: 'a"><script>' })).toThrow();
  });
  it("nonce aléatoire à chaque rendu", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("scripts de la webview", () => {
  const js = read("../media/chat.js");
  const ui = read("../media/ui.js");
  it("liste noire : pas d'horloge visuelle, de style en ligne ni de HTML dynamique", () => {
    for (const src of [js, ui]) {
      for (const bad of [
        'setAttribute("style"',
        "setAttribute('style'",
        "requestAnimationFrame",
        "setInterval",
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function",
      ]) {
        expect(src, bad).not.toContain(bad);
      }
      expect(src).not.toMatch(/addEventListener\(\s*["']scroll/);
    }
  });
  it("seules écritures de style : propriétés --jn-* et hauteur du champ", () => {
    for (const m of js.matchAll(/\.style\.(\w+)/g))
      expect(["setProperty", "height"]).toContain(m[1]);
    for (const m of js.matchAll(/style\.setProperty\(\s*("[^"]*")/g)) {
      expect(m[1]).toMatch(/^"--jn-[a-z]+"$/);
    }
  });
  it("n'insère jamais de HTML ni ne lance de code dynamique", () => {
    for (const bad of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
    ]) {
      expect(js, bad).not.toContain(bad);
    }
    expect(js).toContain("textContent");
  });
  it("ne propose que les trois choix de la gate (pas de « tout autoriser »)", () => {
    const choices = [...js.matchAll(/button\("[^"]+", "(\w+)"/g)].map((m) => m[1]);
    expect(choices.sort()).toEqual(["always", "deny", "once"]);
  });
});

describe("manifeste de l'extension", () => {
  const m = JSON.parse(read("../extension.manifest.json"));
  it("inerte en espace non approuvé", () => {
    expect(m.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(m.capabilities.virtualWorkspaces).toBe(false);
  });
  it("tous les réglages sont en scope machine", () => {
    const props = Object.entries(m.contributes.configuration.properties) as [
      string,
      { scope: string },
    ][];
    expect(props.length).toBeGreaterThan(0);
    for (const [key, p] of props) expect(p.scope, key).toBe("machine");
  });
  it("aucun réglage ne désactive ou ne contourne la gate", () => {
    const keys = Object.keys(m.contributes.configuration.properties).join(" ");
    expect(keys).not.toMatch(/bash|allow|auto|yolo|permission|binary|path/i);
  });
});
