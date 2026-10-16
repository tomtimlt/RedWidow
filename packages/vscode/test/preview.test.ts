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
      "input",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ];
    for (const m of js.matchAll(/\bel\(\s*"(\w+)"/g)) expect(allowed).toContain(m[1]);
    expect(js).not.toMatch(/createElement\(\s*["'`](script|a|img|iframe)/);
    expect(js).not.toMatch(/\.on[a-z]+\s*=|setAttribute\(\s*["']on/);
  });
});

const COMMON = `--vscode-font-family:"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,"Courier New",monospace`;
/** Thèmes de prévisualisation : valeurs proches de Dark Modern, Light Modern et Contraste élevé. */
const THEMES: Record<string, { cls: string; css: string }> = {
  dark: {
    cls: "vscode-dark",
    css: `:root{${COMMON};--vscode-foreground:#ccc;--vscode-input-background:#313131;--vscode-input-border:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-editorWidget-background:#202020;--vscode-panel-border:#2b2b2b;--vscode-focusBorder:#0078d4;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#ccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-textCodeBlock-background:#2b2b2b;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f85149;--vscode-textLink-foreground:#4daafc;--vscode-inputValidation-errorBorder:#be1100;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;--vscode-toolbar-hoverBackground:#5a5d5e50;--vscode-terminal-ansiMagenta:#bc3fbc;--vscode-terminal-ansiCyan:#11a8cd;--vscode-widget-shadow:#0000005c;--vscode-editorWarning-foreground:#cca700}body{background:#181818}`,
  },
  light: {
    cls: "vscode-light",
    css: `:root{${COMMON};--vscode-foreground:#3b3b3b;--vscode-input-background:#fff;--vscode-input-border:#cecece;--vscode-input-foreground:#3b3b3b;--vscode-editorWidget-background:#f8f8f8;--vscode-panel-border:#e5e5e5;--vscode-focusBorder:#005fb8;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e6e6e6;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#d6d6d6;--vscode-badge-background:#ccc;--vscode-badge-foreground:#3b3b3b;--vscode-textCodeBlock-background:#f0f0f0;--vscode-testing-iconPassed:#388a34;--vscode-errorForeground:#c72e0f;--vscode-textLink-foreground:#005fb8;--vscode-inputValidation-errorBorder:#be1100;--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000;--vscode-toolbar-hoverBackground:#b8b8b850;--vscode-terminal-ansiMagenta:#bc05bc;--vscode-terminal-ansiCyan:#0598bc;--vscode-widget-shadow:#00000029;--vscode-editorWarning-foreground:#bf8803}body{background:#f8f8f8}`,
  },
  hc: {
    cls: "vscode-high-contrast",
    css: `:root{${COMMON};--vscode-foreground:#fff;--vscode-input-background:#000;--vscode-input-border:#6fc3df;--vscode-input-foreground:#fff;--vscode-editorWidget-background:#0c141f;--vscode-focusBorder:#f38518;--vscode-contrastBorder:#6fc3df;--vscode-contrastActiveBorder:#f38518;--vscode-button-background:#000;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#000;--vscode-button-secondaryForeground:#fff;--vscode-badge-background:#000;--vscode-badge-foreground:#fff;--vscode-textCodeBlock-background:#000;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f48771;--vscode-textLink-foreground:#21a6ff;--vscode-inputValidation-errorBorder:#be1100;--vscode-list-hoverBackground:#ffffff1f;--vscode-list-activeSelectionBackground:#000;--vscode-terminal-ansiMagenta:#d670d6;--vscode-terminal-ansiCyan:#29b8db}body{background:#000}`,
  },
};

const STATES = ["empty", "idle", "running", "approval", "model", "config", "history"] as const;
type PreviewState = (typeof STATES)[number];
/** Clic simulé après réception de la vue (ouvre le popover correspondant). */
const CLICK: Partial<Record<PreviewState, string>> = {
  model: "model-chip",
  config: "cfg-btn",
  history: "history-btn",
};

function buildView(state: PreviewState) {
  const s = createChatState();
  const busy = state === "running" || state === "approval";
  s.setSandbox("node:22-slim");
  if (state !== "empty") {
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
    ev({
      kind: "agent.text",
      text: "# Résultat\nVoici le code :\n```ts\nexport const a = 1;\n```\n1. premier\n2. second\n\n| Fichier | Rôle |\n| --- | --- |\n| a.ts | export |\n| b.ts | test |\n\n<img src=x onerror=alert(1)>",
    });
    if (busy) {
      ev({
        kind: "tool.requested",
        toolUseId: "3",
        tool: "Bash",
        input: { command: "pnpm test --filter @john-studio/vscode" },
      });
    }
  }
  s.setControls(
    buildControls({
      prefs: { ...DEFAULT_PREFS, model: "modele-a", effort: "high" },
      ultracode: { maxTurns: 100, maxBudgetUsd: 10 },
      models: [
        {
          value: "modele-a",
          displayName: "Modèle A avec un nom particulièrement long pour tester la troncature",
          description:
            "Description assez longue pour déborder d'une seule ligne dans la liste des modèles.",
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        },
        { value: "modele-b", displayName: "Modèle B", description: "Rapide" },
        {
          value: "modele-c",
          displayName: "<img src=x onerror=alert(1)>",
          description: "<b>inerte</b>",
        },
      ],
      status: "ready",
      defaultModel: undefined,
      busy,
    }),
  );
  s.setHistory([
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Liste les fichiers du dossier src",
      updatedAt: "2026-10-15T09:30:00.000Z",
      tools: 3,
      provider: "Claude",
      model: "modele-a",
      current: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Corrige le test qui échoue dans le module d'authentification",
      updatedAt: "2026-10-14T16:05:00.000Z",
      tools: 12,
      provider: "Claude",
      model: "modele-b",
      current: false,
    },
  ]);
  s.setBusy(busy);
  return {
    ...s.view(),
    approvals:
      state === "approval"
        ? [
            {
              toolUseId: "3",
              tool: "Bash",
              label: "Commande",
              summary: "pnpm test",
              detail: "pnpm test",
              reason: "Cette commande demande votre accord.",
              canRemember: true,
            },
          ]
        : [],
  };
}

/**
 * Script de la page de prévisualisation : simule l'hôte VS Code. La page est chargée dans une iframe de la
 * largeur voulue (Edge headless impose ~500 px de fenêtre) ; elle poste au parent les violations CSP et le débordement.
 */
const shim = (cls: string, data: string, click: string | undefined) => `
const csp=[];document.addEventListener("securitypolicyviolation",(e)=>{csp.push(e.violatedDirective+" "+e.blockedURI);});
document.body.classList.add("${cls}");
window.acquireVsCodeApi=()=>({postMessage:(m)=>{if(m.type==="ready")setTimeout(()=>window.postMessage({type:"view",view:${data}},"*"),0);}});
window.addEventListener("load",()=>setTimeout(()=>{${click ? `document.getElementById("${click}").click();` : ""}
setTimeout(()=>{const w=document.documentElement.clientWidth;let bad="";
if(document.documentElement.scrollWidth>w)bad="page:"+document.documentElement.scrollWidth;
for(const n of document.body.querySelectorAll("*")){if(n.closest(".sr-only")||n.closest("pre"))continue;const r=n.getBoundingClientRect();if(r.width>0&&(r.right>w+1||r.left<-1)){bad=n.tagName+"#"+n.id+"."+n.className+" "+Math.round(r.left)+".."+Math.round(r.right);break;}}
parent.postMessage({ready:true,csp:csp.join(";"),overflow:bad},"*");},300);},50));`;

/** Génère des pages statiques ouvrables dans un navigateur (ignorées par git), avec la VRAIE CSP. */
describe("pages de prévisualisation", () => {
  it("sont générées avec le vrai HTML, CSS et JS de la webview (CSP incluse)", () => {
    const dir = here("../preview");
    mkdirSync(dir, { recursive: true });
    for (const [name, t] of Object.entries(THEMES))
      writeFileSync(`${dir}/theme-${name}.css`, t.css);
    for (const state of STATES) {
      const data = JSON.stringify(buildView(state)).replace(/</g, "\\u003c");
      for (const [theme, t] of Object.entries(THEMES)) {
        const html = chatHtml({
          nonce: "preview",
          cspSource: "file:",
          scriptUri: "../media/chat.js",
          uiUri: "../media/ui.js",
          styleUri: "../media/chat.css",
        })
          .replace(
            '<link rel="stylesheet" href="../media/chat.css">',
            `<link rel="stylesheet" href="theme-${theme}.css">\n<link rel="stylesheet" href="../media/chat.css">`,
          )
          .replace(
            '<script nonce="preview" src="../media/ui.js"></script>',
            `<script nonce="preview">${shim(t.cls, data, CLICK[state])}</script>\n<script nonce="preview" src="../media/ui.js"></script>`,
          );
        expect(html).toContain("Content-Security-Policy");
        expect(html).toContain(`vscode-${theme === "hc" ? "high-contrast" : theme}`);
        writeFileSync(`${dir}/${state}-${theme}.html`, html);
      }
    }
  });
});
