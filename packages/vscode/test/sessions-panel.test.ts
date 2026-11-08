import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sessionsHtml } from "../src/logic/html.js";
import { parseSessionsMessage } from "../src/logic/session-grid.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

describe("panneau Sessions", () => {
  it("n'accepte que « ready » et l'ouverture d'un chat par identifiant valide", () => {
    expect(parseSessionsMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseSessionsMessage({ type: "open", chatId: "sidebar" })).toEqual({
      type: "open",
      chatId: "sidebar",
    });
    expect(parseSessionsMessage({ type: "open", chatId: "c0123abc" })).toEqual({
      type: "open",
      chatId: "c0123abc",
    });
    expect(parseSessionsMessage({ type: "open", chatId: "../x" })).toBeNull();
    expect(parseSessionsMessage({ type: "open" })).toBeNull();
    expect(parseSessionsMessage({ type: "open", chatId: "a", extra: 1 })).toBeNull();
    expect(parseSessionsMessage({ type: "ready", extra: 1 })).toBeNull();
    // Aucune réponse d'approbation ne passe par la grille.
    expect(parseSessionsMessage({ type: "approve", chatId: "a" })).toBeNull();
    expect(parseSessionsMessage({ type: "decide", toolUseId: "t", allow: true })).toBeNull();
    expect(parseSessionsMessage(null)).toBeNull();
    expect(parseSessionsMessage("open")).toBeNull();
  });

  it("la page : CSP stricte, base puis feuille, script unique, aucune donnée dans le HTML", () => {
    const html = sessionsHtml({
      nonce: "abc123",
      cspSource: "https://x.vscode-cdn.net",
      scriptUri: "https://x.vscode-cdn.net/media/sessions.js",
      styleUri: "https://x.vscode-cdn.net/media/css/sessions.css",
    });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("media/sessions.js");
    expect(html).toContain('id="filter-awaiting"');
    expect(html).toContain("En attente de toi");
    for (const size of ["s", "m", "l"]) expect(html).toContain(`id="size-${size}"`);
    expect(html).not.toContain("onclick");
  });

  it("le script rend par textContent seul, mémorise la taille par setState et ne répond à rien", () => {
    const script = read("../media/sessions.js");
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(script).toContain("vscode.setState");
    expect(script).toContain("vscode.getState");
    expect(script).toContain('type: "open"');
    // Même règle de filtre que filterSessionGrid.
    expect(script).toContain('tile.state === "approval" || tile.state === "error"');
    // Seuls « ready » et « open » partent vers l'hôte.
    const sent = [...script.matchAll(/postMessage\(\{ type: "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(sent)).toEqual(new Set(["open", "ready"]));
  });

  it("l'hôte ouvre le chat (éditeur ou latéral) sans toucher à la gate", () => {
    const extension = read("../src/extension/extension.ts");
    const start = extension.indexOf("const openSessions = ");
    const body = extension.slice(start, extension.indexOf("Fiche programme (ADR 0040)", start));
    expect(body).toContain("openEditorChat(message.chatId)");
    expect(body).toContain('executeCommand("warband.chat.focus")');
    expect(body).not.toMatch(/approv|decide|resolve|allow|deny/i);
    expect(extension).toContain('registerCommand("warband.openSessions"');
  });
});
