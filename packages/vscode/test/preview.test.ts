import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ModelOption } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";
import { buildControls, DEFAULT_PREFS } from "../src/logic/controls.js";
import { chatHtml, cockpitHtml, studioHtml } from "../src/logic/html.js";

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
      "select",
      "option",
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

const STATES = [
  "empty",
  "idle",
  "running",
  "approval",
  "model",
  "config",
  "history",
  "mention",
  "noprovider",
  "vitrine",
  "vitrine-config",
  "vitrine-accueil",
  "vitrine-accueil-config",
  "vitrine-paysage",
] as const;
type PreviewState = (typeof STATES)[number];
/** Clic simulé après réception de la vue (ouvre le popover correspondant). */
const CLICK: Partial<Record<PreviewState, string>> = {
  model: "model-chip",
  config: "cfg-btn",
  history: "history-btn",
  mention: "mention-btn",
  "vitrine-config": "cfg-btn",
  "vitrine-accueil-config": "cfg-btn",
};

/** Vitrine (README) : modèles d'exemple génériques, sans identifiant réel. */
const VITRINE_MODELS: ModelOption[] = [
  {
    value: "defaut",
    displayName: "Modèle par défaut",
    description: "Équilibré pour la plupart des tâches",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  { value: "rapide", displayName: "Modèle rapide", description: "Réponses vives, coût réduit" },
  {
    value: "avance",
    displayName: "Modèle avancé",
    description: "Raisonnement approfondi",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
];

/** Conversation d'exemple de la vitrine : pentest réaliste, deux outils terminés, une approbation en attente. */
function fillVitrine(s: ReturnType<typeof createChatState>, court = false) {
  const ev = (e: unknown) => s.event(e as never);
  s.user("Scanne 10.10.11.42 et résume les services exposés");
  // Version courte (paysage, 800 px de haut) : sans la phrase d'introduction, pour que la consigne reste visible.
  if (!court)
    ev({
      kind: "agent.text",
      text: "Je commence par relire mes notes sur la cible, puis je lance un scan de versions.",
    });
  ev({
    kind: "tool.requested",
    toolUseId: "v1",
    tool: "Read",
    input: { file_path: "/home/user/engagements/box-42/notes.md" },
  });
  ev({
    kind: "tool.result",
    toolUseId: "v1",
    isError: false,
    output: "# Box 42\nPérimètre : 10.10.11.42 uniquement\nHors périmètre : déni de service",
    truncated: false,
  });
  ev({
    kind: "tool.requested",
    toolUseId: "v2",
    tool: "Bash",
    input: { command: "nmap -sV --top-ports 100 10.10.11.42" },
  });
  ev({
    kind: "tool.result",
    toolUseId: "v2",
    isError: false,
    output:
      "22/tcp  open  ssh    OpenSSH 8.9p1\n80/tcp  open  http   nginx 1.18.0\n443/tcp open  https  nginx 1.18.0",
    truncated: false,
  });
  ev({
    kind: "agent.text",
    text: "Trois services sont exposés sur **10.10.11.42** :\n\n- `22/tcp` : OpenSSH 8.9p1\n- `80/tcp` : nginx 1.18.0\n- `443/tcp` : nginx 1.18.0 (TLS)\n\nJe lance un scan de scripts par défaut sur ces ports :\n\n```bash\nnmap -sC -sV -p 22,80,443 10.10.11.42\n```",
  });
  ev({
    kind: "tool.requested",
    toolUseId: "v3",
    tool: "Bash",
    input: { command: "nmap -sC -sV -p 22,80,443 10.10.11.42" },
  });
}

function buildView(state: PreviewState) {
  const s = createChatState();
  const accueil = state === "vitrine-accueil" || state === "vitrine-accueil-config";
  const vitrine =
    state === "vitrine" || state === "vitrine-config" || state === "vitrine-paysage" || accueil;
  const busy = state === "running" || state === "approval" || (vitrine && !accueil);
  if (!vitrine) s.setSandbox("node:22-slim");
  // Aucun jeton : chat grisé avec invite (écran d'accueil, comme au premier lancement).
  if (state === "noprovider") s.setNoProvider(true);
  if (accueil) {
    // Écran d'accueil vide de la vitrine : aucune conversation.
  } else if (vitrine) fillVitrine(s, state === "vitrine-paysage");
  else if (state !== "empty" && state !== "noprovider") {
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
        input: { command: "pnpm test --filter @warband/vscode" },
      });
    }
  }
  s.setControls(
    buildControls({
      prefs: { ...DEFAULT_PREFS, model: vitrine ? "defaut" : "modele-a", effort: "high" },
      ultracode: { maxTurns: 100, maxBudgetUsd: 10 },
      models: vitrine
        ? VITRINE_MODELS
        : [
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
      vitrine && !accueil
        ? [
            {
              toolUseId: "v3",
              tool: "Bash",
              label: "Commande",
              summary: "nmap -sC -sV -p 22,80,443 10.10.11.42",
              detail: "nmap -sC -sV -p 22,80,443 10.10.11.42",
              reason: "Les commandes shell demandent votre accord (politique par défaut).",
              canRemember: true,
            },
          ]
        : state === "approval"
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
 * Contrôle de débordement, commun à toutes les pages : les animations finies sont menées à leur terme avant la mesure
 * (le tiroir d'historique ouvert part de -100 % et serait signalé à tort) ; sont ignorés les éléments cachés (`hidden`),
 * à clip sr-only, les blocs `pre` et les conteneurs à défilement volontaire (graphe de la chaîne d'attaque).
 */
const MEASURE = `for(const a of document.getAnimations()){try{a.finish();}catch(e){}}const w=document.documentElement.clientWidth;let bad="";
if(document.documentElement.scrollWidth>w)bad="page:"+document.documentElement.scrollWidth;
for(const n of document.body.querySelectorAll("*")){if(n.closest(".sr-only")||n.closest("pre")||n.closest("[hidden]")||n.closest(".kc-viewport")||n.closest(".studio-kc-scroll"))continue;const r=n.getBoundingClientRect();if(r.width>0&&(r.right>w+1||r.left<-1)){bad=n.tagName+"#"+n.id+"."+n.className+" "+Math.round(r.left)+".."+Math.round(r.right);break;}}`;

/**
 * Script de la page de prévisualisation : simule l'hôte VS Code. `trigger` est le type du message que la vue envoie à
 * l'hôte au démarrage (`ready` pour le chat, `refresh` pour le cockpit et les réglages) ; la réponse `messages` part alors.
 * La page est chargée dans une iframe de la largeur voulue ; elle poste au parent les violations CSP et le débordement.
 */
const shim = (
  cls: string,
  trigger: string,
  messages: unknown[],
  click: string | undefined,
  lift?: string,
) => {
  const posts = messages
    .map((m) => `window.postMessage(${JSON.stringify(m).replace(/</g, "\\u003c")},"*");`)
    .join("");
  return `
const csp=[];document.addEventListener("securitypolicyviolation",(e)=>{csp.push(e.violatedDirective+" "+e.blockedURI);});
document.body.classList.add("${cls}");
window.acquireVsCodeApi=()=>({postMessage:(m)=>{if(m.type==="${trigger}")setTimeout(()=>{${posts}},0);}});
window.addEventListener("load",()=>setTimeout(()=>{${click ? `document.getElementById("${click}").click();` : ""}${lift ? `setTimeout(()=>document.getElementById("${lift}").style.setProperty("max-height","none"),100);` : ""}
setTimeout(()=>{${MEASURE}
parent.postMessage({ready:true,csp:csp.join(";"),overflow:bad},"*");},300);},50));`;
};

const CHAT_CONTAINERS = {
  type: "containers",
  items: [
    { name: "htb1", state: "running" },
    { name: "lab", state: "stopped" },
  ],
};

/** Données de l'hôte pour le cockpit et les réglages (conteneurs Exegol, constats, sources). */
const DOCKER_VIEW = {
  docker: "present",
  daemon: "reachable",
  exegol: "present",
  containers: [
    {
      name: "exegol-htb1",
      short: "htb1",
      state: "running",
      image: "exegol:full",
      family: "exegol",
      linked: true,
      canLink: false,
      workspace: "/p",
    },
    {
      name: "exegol-lab",
      short: "lab",
      state: "stopped",
      image: "exegol:light",
      family: "exegol",
      linked: false,
      canLink: true,
    },
    {
      name: "exegol-web",
      short: "web",
      state: "running",
      image: "exegol:web",
      family: "exegol",
      linked: false,
      canLink: false,
      linkTitle: "Déjà utilisé",
      workspace: "/q",
    },
  ],
};
const COCKPIT_VIEW = {
  type: "view",
  ...DOCKER_VIEW,
  linked: "running",
  linkedBanner: {
    state: "running",
    name: "exegol-htb1",
    short: "htb1",
    image: "ghcr.io/nwodtuhs/exegol:full",
    workspace: "/home/user/projets/htb/box-1/engagement",
  },
};
const STUDIO_PAGES_PREVIEW = ["project", "containers", "atlas", "killchain"] as const;
const studioView = (page: string) => ({
  type: "view",
  page,
  projectChoices: {
    activeId: "11111111-1111-4111-8111-111111111111",
    projects: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Laboratoire",
        workspace: "C:\\Missions\\Laboratoire",
      },
    ],
  },
  projectSummary: {
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "Laboratoire",
    text: "État de la session : vérification de l'environnement terminée. Prochaine étape : examiner les résultats avec l'utilisateur.",
  },
  findings: [
    {
      id: "a",
      kind: "host",
      state: "confirmed",
      label: "10.10.11.5",
      tactic: "TA0043",
      technique: "T1595",
    },
    {
      id: "b",
      kind: "credential",
      state: "hypothesis",
      label: "admin",
      from: ["a"],
      tactic: "TA0006",
      technique: "T1110",
    },
    { id: "c", kind: "loot", state: "failed", label: "flag.txt", from: ["b"] },
  ],
  ...DOCKER_VIEW,
  linkedBanner: { name: "exegol-htb1", workspace: "/home/user/projets/htb" },
  sources: [{ name: "owasp-top10", droits: "CC-BY" }],
});

/** Génère des pages statiques ouvrables dans un navigateur (ignorées par git), avec la VRAIE CSP. */
describe("pages de prévisualisation", () => {
  it("sont générées avec le vrai HTML, CSS et JS de la webview (CSP incluse)", () => {
    const dir = here("../preview");
    mkdirSync(dir, { recursive: true });
    for (const [name, t] of Object.entries(THEMES))
      writeFileSync(`${dir}/theme-${name}.css`, t.css);
    const cspSource = "file:";
    for (const state of STATES) {
      const view = buildView(state);
      for (const [theme, t] of Object.entries(THEMES)) {
        const html = chatHtml({
          nonce: "preview",
          cspSource,
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
            `<script nonce="preview">${shim(t.cls, "ready", [{ type: "view", view }, CHAT_CONTAINERS], CLICK[state], state === "vitrine-accueil-config" ? "cfg-pop" : undefined)}</script>\n<script nonce="preview" src="../media/ui.js"></script>`,
          );
        expect(html).toContain("Content-Security-Policy");
        expect(html).toContain(`vscode-${theme === "hc" ? "high-contrast" : theme}`);
        writeFileSync(`${dir}/${state}-${theme}.html`, html);
      }
    }
    // Cockpit et réglages : mêmes pages que celles de l'extension (CSP réelle), script d'hôte simulé en plus.
    const pages: { name: string; script: string; make: typeof cockpitHtml; view: unknown }[] = [
      { name: "cockpit", script: "cockpit.js", make: cockpitHtml, view: COCKPIT_VIEW },
      ...STUDIO_PAGES_PREVIEW.map((p) => ({
        name: `studio-${p}`,
        script: "studio.js",
        make: studioHtml,
        view: studioView(p),
      })),
    ];
    for (const p of pages) {
      for (const [theme, t] of Object.entries(THEMES)) {
        const base = p.make({
          nonce: "preview",
          cspSource,
          scriptUri: `../media/${p.script}`,
          styleUri: "../media/chat.css",
        });
        const html = base
          .replace(
            '<link rel="stylesheet" href="../media/chat.css">',
            `<link rel="stylesheet" href="theme-${theme}.css">\n<link rel="stylesheet" href="../media/chat.css">`,
          )
          .replace(
            `<script nonce="preview" src="../media/${p.script}"></script>`,
            `<script nonce="preview">${shim(t.cls, "refresh", [p.view], undefined)}</script>\n<script nonce="preview" src="../media/${p.script}"></script>`,
          );
        expect(html).toContain("Content-Security-Policy");
        expect(html).toContain(`../media/${p.script}`);
        expect(html).toContain("window.acquireVsCodeApi");
        writeFileSync(`${dir}/${p.name}-${theme}.html`, html);
      }
    }
  });
});
