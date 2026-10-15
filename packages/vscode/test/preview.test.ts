import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";
import { buildControls, DEFAULT_PREFS } from "../src/logic/controls.js";
import { chatHtml } from "../src/logic/html.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe("chat.js : balises créées", () => {
  it("liste blanche, jamais script/a/img/iframe", () => {
    const js = readFileSync(here("../media/chat.js"), "utf8");
    const allowed = [
      "div",
      "span",
      "p",
      "strong",
      "em",
      "code",
      "pre",
      "button",
      "details",
      "summary",
      "ul",
      "ol",
      "li",
      "h2",
      "option",
    ];
    for (const m of js.matchAll(/\bel\(\s*"(\w+)"/g)) expect(allowed).toContain(m[1]);
    expect(js).not.toMatch(/createElement\(\s*["'`](script|a|img|iframe)/);
    expect(js).not.toMatch(/\.on[a-z]+\s*=|setAttribute\(\s*["']on/);
  });
});

const THEME = `<style>
:root{--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;--vscode-foreground:#ccc;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-editorWidget-background:#252526;--vscode-panel-border:#454545;--vscode-focusBorder:#007fd4;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-badge-background:#4d4d4d;--vscode-badge-foreground:#fff;--vscode-textCodeBlock-background:#1e1e1e;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f48771;--vscode-progressBar-background:#0e70c0;--vscode-textLink-foreground:#3794ff;--vscode-inputValidation-errorBackground:#5a1d1d;--vscode-list-hoverBackground:#2a2d2e}
@media (prefers-color-scheme:light){:root{--vscode-foreground:#333;--vscode-input-background:#fff;--vscode-input-foreground:#333;--vscode-editorWidget-background:#f3f3f3;--vscode-panel-border:#ddd;--vscode-button-secondaryBackground:#e0e0e0;--vscode-button-secondaryForeground:#333;--vscode-textCodeBlock-background:#f0f0f0;--vscode-list-hoverBackground:#e8e8e8;--vscode-inputValidation-errorBackground:#f2dede}}
body{background:#1e1e1e}@media (prefers-color-scheme:light){body{background:#fff}}
</style>
<link rel="stylesheet" href="../media/chat.css">`;

/** Génère une page statique ouvrable dans un navigateur (ignorée par git) avec des messages d'exemple. */
describe("page de prévisualisation", () => {
  it("est générée avec le vrai HTML, CSS et JS de la webview", () => {
    const s = createChatState();
    s.setSandbox("node:22-slim");
    s.user("Liste les fichiers du dossier src");
    const ev = (e: unknown) => s.event(e as never);
    ev({
      kind: "agent.text",
      text: "Je regarde le dossier **src**.\n\n- un fichier `a.ts`\n- un autre",
    });
    const tool = (id: string, name: string, input: Record<string, unknown>, output: string) => {
      ev({ kind: "tool.requested", toolUseId: id, tool: name, input });
      ev({ kind: "tool.result", toolUseId: id, isError: false, output, truncated: false });
    };
    tool("1", "Glob", { pattern: "src/**/*.ts" }, "src/a.ts\nsrc/b.ts");
    tool("2", "Read", { file_path: "/projet/src/a.ts" }, "export const a = 1;");
    ev({ kind: "tool.requested", toolUseId: "3", tool: "Bash", input: { command: "pnpm test" } });
    ev({
      kind: "agent.text",
      text: "# Résultat\nVoici le code :\n```ts\nexport const a = 1;\n```\n1. premier\n2. second\n<img src=x onerror=alert(1)>",
    });
    s.setControls(
      buildControls({
        prefs: { ...DEFAULT_PREFS, effort: "xhigh" },
        models: [
          {
            value: "modele-a",
            displayName: "Modèle A",
            supportedEffortLevels: ["low", "medium", "high", "xhigh"],
          },
          { value: "modele-b", displayName: "Modèle B" },
        ],
        status: "ready",
        defaultModel: undefined,
        busy: false,
      }),
    );
    s.setBusy(true);
    const view = {
      ...s.view(),
      approvals: [
        {
          toolUseId: "3",
          tool: "Bash",
          label: "Commande",
          summary: "pnpm test",
          detail: "pnpm test",
          reason: "Cette commande demande votre accord.",
          canRemember: true,
        },
      ],
    };
    const data = JSON.stringify(view).replace(/</g, "\\u003c");
    const html = chatHtml({
      nonce: "preview",
      cspSource: "'self'",
      scriptUri: "../media/chat.js",
      styleUri: "../media/chat.css",
    })
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, "")
      .replace('<link rel="stylesheet" href="../media/chat.css">', THEME)
      .replace(
        '<script nonce="preview" src="../media/chat.js"></script>',
        `<script>window.acquireVsCodeApi=()=>({postMessage:(m)=>{if(m.type==="ready")setTimeout(()=>window.postMessage({type:"view",view:${data}},"*"),0);}});</script>\n<script src="../media/chat.js"></script>`,
      );
    expect(html).toContain("acquireVsCodeApi");
    expect(html).toContain("--vscode-foreground");
    mkdirSync(here("../preview"), { recursive: true });
    writeFileSync(here("../preview/chat-preview.html"), html);
  });
});
