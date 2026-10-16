import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EXEGOL_EXEC_TOOL } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { terminalHtml } from "../src/logic/html.js";
import { parseTerminalMessage } from "../src/logic/terminal.js";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const opts = {
  nonce: "abc123_-XYZ",
  cspSource: "https://x.vscode-cdn.net",
  scriptUri: "https://x.vscode-cdn.net/media/terminal.js",
  styleUri: "https://x.vscode-cdn.net/media/terminal.css",
};

describe("HTML du terminal : CSP stricte", () => {
  const html = terminalHtml(opts);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

  it("politique exacte, identique au chat", () => {
    expect(csp).toBe(
      "default-src 'none'; script-src 'nonce-abc123_-XYZ'; style-src https://x.vscode-cdn.net; img-src https://x.vscode-cdn.net",
    );
    expect(csp).not.toMatch(/unsafe|\*|http:|data:/);
  });
  it("un seul script (terminal.js) avec nonce et source de l'extension, aucun script inline", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(/src="([^"]+)"/.exec(scripts[0]?.[1] ?? "")?.[1]).toBe(opts.scriptUri);
    expect(scripts[0]?.[1]).toContain('nonce="abc123_-XYZ"');
    expect(scripts[0]?.[2]).toBe("");
  });
  it("interdits HTML : pas de <style>, style=, handler on*= ni javascript:", () => {
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1]?.startsWith("https://x.vscode-cdn.net/")).toBe(true);
    }
  });
  it("onglet shell désactivé « bientôt » et bouton d'ouverture désactivé par défaut", () => {
    expect(html).toMatch(/id="tab-shell"[^>]*aria-disabled="true"/);
    expect(html).toContain("<em>bientôt</em>");
    expect(html).toMatch(/id="open-shell"[^>]*disabled/);
  });
  it("refuse une valeur capable de sortir d'un attribut", () => {
    expect(() => terminalHtml({ ...opts, nonce: 'a"onload="x' })).toThrow();
    expect(() => terminalHtml({ ...opts, scriptUri: 'x" onerror="y' })).toThrow();
    expect(() => terminalHtml({ ...opts, styleUri: 'x" onerror="y' })).toThrow();
    expect(() => terminalHtml({ ...opts, cspSource: 'a"><script>' })).toThrow();
  });
});

describe("terminal.js : liste noire et écritures", () => {
  const js = read("../media/terminal.js");
  it("aucune API de HTML dynamique, de code dynamique, de réseau ni de minuterie visuelle", () => {
    for (const bad of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
      "setInterval",
      "requestAnimationFrame",
      'setAttribute("style"',
      "setAttribute('style'",
    ]) {
      expect(js, bad).not.toContain(bad);
    }
  });
  it("seules écritures de style : hauteur ou propriétés --jn-* (aucune ici)", () => {
    for (const m of js.matchAll(/\.style\.(\w+)/g))
      expect(["setProperty", "height"]).toContain(m[1]);
    expect(js).not.toMatch(/\.style\b/);
  });
  it("le texte passe par textContent", () => {
    expect(js).toContain("textContent");
  });
  it("le seul message émis vers l'hôte est openShell", () => {
    const sent = [...js.matchAll(/postMessage\(\s*\{\s*type:\s*"(\w+)"/g)].map((m) => m[1]);
    expect(sent).toEqual(["openShell"]);
  });
});

interface TerminalApi {
  EXEC_TOOL: string;
  MAX_LINES: number;
  maxId(items: unknown[]): number;
  execEntries(items: unknown[], floor?: number, max?: number): { id: number }[];
  execStatus(item: object): { label: string; tone: string };
  entryModel(item: object): {
    container: string;
    command: string;
    output: string;
    truncated: boolean;
    label: string;
    tone: string;
  };
}
// terminal.js est un script (sans export) : il se publie sur globalThis, comme ui.js.
createRequire(import.meta.url)("../media/terminal.js");
const term = (globalThis as unknown as { JohnTerminal: TerminalApi }).JohnTerminal;

const exec = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "tool",
  toolUseId: `u${id}`,
  tool: EXEGOL_EXEC_TOOL,
  label: "Exec",
  summary: "",
  input: JSON.stringify({ container: "box", argv: ["nmap", "-sV", "10.0.0.1"] }),
  status: "pending",
  ...extra,
});

describe("terminal.js : fonctions pures", () => {
  it("le nom d'outil correspond à l'exec Exegol du cœur", () => {
    expect(term.EXEC_TOOL).toBe(EXEGOL_EXEC_TOOL);
  });

  it("plafond du DOM : au-delà de 200 lignes, les plus anciennes sont retirées", () => {
    expect(term.MAX_LINES).toBe(200);
    const items = Array.from({ length: 250 }, (_, i) => exec(i + 1));
    const shown = term.execEntries(items, 0, term.MAX_LINES);
    expect(shown).toHaveLength(200);
    expect(shown[0]?.id).toBe(51);
    expect(shown.at(-1)?.id).toBe(250);
  });

  it("ne garde que les appels d'exec Exegol, au-delà du seuil « Effacer »", () => {
    const items = [
      { id: 1, kind: "user", text: "salut" },
      exec(2),
      { id: 3, kind: "tool", tool: "Bash", status: "ok" },
      exec(4),
      { id: 5, kind: "agent", text: "ok", blocks: [] },
    ];
    expect(term.execEntries(items).map((i) => i.id)).toEqual([2, 4]);
    expect(term.execEntries(items, 2).map((i) => i.id)).toEqual([4]);
    expect(term.maxId(items)).toBe(5);
    expect(term.maxId([])).toBe(0);
  });

  it("statut lisible d'après la vue : en attente, approuvé, refusé, erreur", () => {
    expect(term.execStatus(exec(1)).label).toBe("en attente");
    expect(term.execStatus(exec(1, { decision: "allow" })).label).toBe("approuvé");
    expect(term.execStatus(exec(1, { status: "ok" })).label).toBe("approuvé");
    expect(term.execStatus(exec(1, { decision: "deny", status: "denied" })).label).toBe("refusé");
    expect(term.execStatus(exec(1, { status: "denied" })).label).toBe("refusé");
    const err = term.execStatus(exec(1, { status: "error", decision: "allow" }));
    expect(err).toEqual({ label: "erreur", tone: "err" });
  });

  it("commande reconstruite depuis l'argv, arguments à espaces entre guillemets", () => {
    const m = term.entryModel(
      exec(1, {
        input: JSON.stringify({ container: "box", argv: ["sh", "-c", "id && ls"] }),
        status: "ok",
        output: "uid=0",
      }),
    );
    expect(m.container).toBe("box");
    expect(m.command).toBe('sh -c "id && ls"');
    expect(m.output).toBe("uid=0");
    expect(m.label).toBe("approuvé");
  });

  it("entrée tronquée ou d'autre forme : affichée telle quelle, sortie tronquée signalée", () => {
    const raw = '{"container":"box","argv":["nmap","-sV","10.0';
    const m = term.entryModel(exec(1, { input: raw, truncated: true }));
    expect(m.command).toBe(raw);
    expect(m.container).toBe("");
    expect(m.truncated).toBe(true);
    expect(term.entryModel(exec(1, { input: '{"argv":"x"}' })).command).toBe('{"argv":"x"}');
  });
});

describe("messages acceptés depuis la webview du terminal (liste blanche)", () => {
  it("accepte exactement openShell, sans autre clé", () => {
    expect(parseTerminalMessage({ type: "openShell" })).toEqual({ type: "openShell" });
    expect(parseTerminalMessage({ type: "openShell", container: "box" })).toBeNull();
    expect(parseTerminalMessage({ type: "openShell", command: "id" })).toBeNull();
  });
  it("refuse les autres types du chat, du cockpit et des réglages", () => {
    for (const type of ["send", "reset", "approve", "setModel", "refresh", "terminal", "open"]) {
      expect(parseTerminalMessage({ type }), type).toBeNull();
    }
  });
  it("refuse les formes invalides", () => {
    expect(parseTerminalMessage(null)).toBeNull();
    expect(parseTerminalMessage("openShell")).toBeNull();
    expect(parseTerminalMessage(["openShell"])).toBeNull();
    expect(parseTerminalMessage({})).toBeNull();
    expect(parseTerminalMessage({ type: 1 })).toBeNull();
  });
});

describe("contribution de la commande", () => {
  const manifest = JSON.parse(read("../extension.manifest.json"));
  it("john.openTerminal est déclarée avec le titre prévu", () => {
    const cmd = manifest.contributes.commands.find(
      (c: { command: string }) => c.command === "john.openTerminal",
    );
    expect(cmd?.title).toBe("Exegol Studio : ouvrir le terminal");
  });
});
