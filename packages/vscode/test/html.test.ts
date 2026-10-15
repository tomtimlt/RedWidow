import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatHtml, makeNonce } from "../src/logic/html.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/chat.js",
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
  it("un seul script, avec nonce et source externe ; aucun script ou style inline, aucun handler", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[1]).toContain('nonce="abc123_-XYZ"');
    expect(scripts[0]?.[1]).toContain(`src="${opts.scriptUri}"`);
    expect(scripts[0]?.[2]).toBe("");
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    // Toutes les ressources viennent de l'origine webview.
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1]?.startsWith("https://x.vscode-cdn.net/")).toBe(true);
    }
  });
  it("refuse une valeur capable de sortir d'un attribut", () => {
    expect(() => chatHtml({ ...opts, nonce: 'a"onload="x' })).toThrow();
    expect(() => chatHtml({ ...opts, scriptUri: 'x" onerror="y' })).toThrow();
    expect(() => chatHtml({ ...opts, cspSource: 'a"><script>' })).toThrow();
  });
  it("nonce aléatoire à chaque rendu", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("script de la webview", () => {
  const js = read("../media/chat.js");
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
