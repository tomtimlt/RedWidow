// Banc de captures des webviews de l'extension (manuel, hors `pnpm check`) : comparer l'interface avant/après un lot.
// Usage : node packages/vscode/scripts/ui-snapshots.mjs [DOSSIER] [--label ETIQUETTE] [--only motif]
//   DOSSIER : sortie des PNG et de index.html (défaut : ../work/ui-snapshots/<étiquette>, relatif à la racine du dépôt).
//   ETIQUETTE : nom du jeu de captures (défaut : nom du dossier). Pages 1280x800 et 420x800 (barre latérale), thèmes sombre et clair.
// Le HTML vient de html.ts (compilé à la volée avec esbuild), le CSS/JS de media/ ; l'hôte VS Code est simulé (faux
// acquireVsCodeApi, variables de thème, messages de données d'exemple). Chromium via Playwright (déjà installé, non ajouté au dépôt).
// Échoue (code 1) si une page lève une erreur JS, journalise une erreur console ou produit un PNG vide.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);
const root = resolve(here("../../.."));
const media = here("../media");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv.splice(i, 2)[1];
};
const onlyPattern = flag("--only");
let label = flag("--label");
const dirArg = argv.find((a) => !a.startsWith("--"));
const outDir = resolve(dirArg ?? join(root, "..", "work", "ui-snapshots", label ?? "courant"));
label ??= basename(outDir);

// --- Compilation de html.ts et des fabriques d'état (hors sortie du dépôt) ---------------------------------------
const esbuild = require(require.resolve("esbuild", { paths: [here("..")] }));
const tmp = mkdtempSync(join(tmpdir(), "warband-ui-"));
const bundle = join(tmp, "logic.mjs");
const src = (p) => JSON.stringify(here(`../src/logic/${p}`));
await esbuild.build({
  stdin: {
    contents: `export * from ${src("html.ts")};
export { createChatState, monitorChatView } from ${src("chat.ts")};
export { buildControls, DEFAULT_PREFS } from ${src("controls.ts")};
export { missionReportPreview } from ${src("mission-report.ts")};
export { EXEGOL_EXEC_TOOL } from "@warband/core";`,
    resolveDir: here(".."),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  external: ["vscode"],
  // Les dépendances CommonJS du cœur (undici) exigent `require` dans un bundle ESM.
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
  logLevel: "error",
});
const L = await import(pathToFileURL(bundle).href);

// --- Thèmes VS Code (valeurs proches de Dark Modern et Light Modern) --------------------------------------------
const COMMON = `--vscode-font-family:"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,"Courier New",monospace`;
const THEMES = {
  dark: {
    cls: "vscode-dark",
    css: `:root{${COMMON};--vscode-foreground:#ccc;--vscode-input-background:#313131;--vscode-input-border:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-editorWidget-background:#202020;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-panel-border:#2b2b2b;--vscode-focusBorder:#0078d4;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#ccc;--vscode-button-secondaryHoverBackground:#3c3c3c;--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-textCodeBlock-background:#2b2b2b;--vscode-testing-iconPassed:#73c991;--vscode-errorForeground:#f85149;--vscode-textLink-foreground:#4daafc;--vscode-inputValidation-errorBorder:#be1100;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;--vscode-toolbar-hoverBackground:#5a5d5e50;--vscode-terminal-ansiMagenta:#bc3fbc;--vscode-terminal-ansiCyan:#11a8cd;--vscode-widget-shadow:#0000005c;--vscode-editorWarning-foreground:#cca700}body{background:#181818}`,
  },
  light: {
    cls: "vscode-light",
    css: `:root{${COMMON};--vscode-foreground:#3b3b3b;--vscode-input-background:#fff;--vscode-input-border:#cecece;--vscode-input-foreground:#3b3b3b;--vscode-editorWidget-background:#f8f8f8;--vscode-editor-background:#fff;--vscode-sideBar-background:#f8f8f8;--vscode-panel-border:#e5e5e5;--vscode-focusBorder:#005fb8;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e6e6e6;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#d6d6d6;--vscode-badge-background:#ccc;--vscode-badge-foreground:#3b3b3b;--vscode-textCodeBlock-background:#f0f0f0;--vscode-testing-iconPassed:#388a34;--vscode-errorForeground:#c72e0f;--vscode-textLink-foreground:#005fb8;--vscode-inputValidation-errorBorder:#be1100;--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000;--vscode-toolbar-hoverBackground:#b8b8b850;--vscode-terminal-ansiMagenta:#bc05bc;--vscode-terminal-ansiCyan:#0598bc;--vscode-widget-shadow:#00000029;--vscode-editorWarning-foreground:#bf8803}body{background:#f8f8f8}`,
  },
};
const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "420", width: 420, height: 800 },
];

// --- Données d'exemple ------------------------------------------------------------------------------------------
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ev = (s) => (e) => s.event(e);

const MODELS = [
  {
    value: "defaut",
    displayName: "Modèle par défaut",
    description: "Équilibré pour la plupart des tâches",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  { value: "rapide", displayName: "Modèle rapide", description: "Réponses vives, coût réduit" },
];

function chatState({ conversation = true, approval = false } = {}) {
  const s = L.createChatState();
  const e = ev(s);
  s.setSandbox("node:22-slim");
  if (conversation) {
    s.user("Scanne 10.10.11.42 et résume les services exposés");
    e({
      kind: "agent.text",
      text: "Je relis mes notes sur la cible, puis je lance un scan de versions.",
    });
    e({
      kind: "tool.requested",
      toolUseId: "v1",
      tool: "Read",
      input: { file_path: "/home/user/engagements/box-42/notes.md" },
    });
    e({
      kind: "tool.result",
      toolUseId: "v1",
      isError: false,
      output: "# Box 42\nPérimètre : 10.10.11.42 uniquement\nHors périmètre : déni de service",
      truncated: false,
    });
    e({
      kind: "tool.requested",
      toolUseId: "v2",
      tool: "Bash",
      input: { command: "nmap -sV --top-ports 100 10.10.11.42" },
    });
    e({
      kind: "tool.result",
      toolUseId: "v2",
      isError: false,
      output:
        "22/tcp  open  ssh    OpenSSH 8.9p1\n80/tcp  open  http   nginx 1.18.0\n443/tcp open  https  nginx 1.18.0",
      truncated: false,
    });
    e({
      kind: "agent.text",
      text: "Trois services sont exposés sur **10.10.11.42** :\n\n- `22/tcp` : OpenSSH 8.9p1\n- `80/tcp` : nginx 1.18.0\n- `443/tcp` : nginx 1.18.0 (TLS)\n\n| Port | Service |\n| --- | --- |\n| 22 | ssh |\n| 80 | http |\n\n```bash\nnmap -sC -sV -p 22,80,443 10.10.11.42\n```",
    });
    if (approval)
      e({
        kind: "tool.requested",
        toolUseId: "v3",
        tool: "Bash",
        input: { command: "nmap -sC -sV -p 22,80,443 10.10.11.42" },
      });
  }
  s.setControls(
    L.buildControls({
      prefs: { ...L.DEFAULT_PREFS, model: "defaut", effort: "high" },
      ultracode: { maxTurns: 100, maxBudgetUsd: 10 },
      models: MODELS,
      status: "ready",
      defaultModel: undefined,
      busy: approval,
    }),
  );
  s.setHistory([
    {
      id: PROJECT_ID,
      title: "Scanne 10.10.11.42",
      updatedAt: "2026-10-15T09:30:00.000Z",
      tools: 3,
      provider: "Claude",
      model: "defaut",
      current: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Corrige le test d'authentification",
      updatedAt: "2026-10-14T16:05:00.000Z",
      tools: 12,
      provider: "Claude",
      model: "rapide",
      current: false,
    },
  ]);
  s.setBusy(approval);
  return s;
}
const APPROVAL = {
  toolUseId: "v3",
  tool: "Bash",
  label: "Commande",
  summary: "nmap -sC -sV -p 22,80,443 10.10.11.42",
  detail: "nmap -sC -sV -p 22,80,443 10.10.11.42",
  reason: "Les commandes shell demandent votre accord (politique par défaut).",
  canRemember: true,
};
const chatView = (opts) => ({
  ...chatState(opts).view(),
  approvals: opts?.approval ? [APPROVAL] : [],
});
const CONTAINERS = {
  type: "containers",
  items: [
    { name: "htb1", state: "running" },
    { name: "lab", state: "stopped" },
  ],
};

function execState() {
  const s = L.createChatState();
  const e = ev(s);
  e({
    id: "req",
    kind: "tool.requested",
    toolUseId: "scan",
    tool: L.EXEGOL_EXEC_TOOL,
    input: { container: "htb1", argv: ["nmap", "-sV", "10.10.10.1"] },
  });
  e({
    id: "proc",
    parentId: "req",
    kind: "process.started",
    argv: ["docker", "exec", "exegol-htb1", "nmap"],
    pid: 1,
  });
  e({
    id: "o1",
    parentId: "proc",
    kind: "process.output",
    stream: "stdout",
    line: "Starting Nmap 7.94",
  });
  e({
    id: "o2",
    parentId: "proc",
    kind: "process.output",
    stream: "stdout",
    line: "80/tcp open  http",
  });
  return s;
}

const DOCKER = {
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
const COCKPIT = {
  type: "view",
  ...DOCKER,
  linked: "running",
  linkedBanner: {
    state: "running",
    name: "exegol-htb1",
    short: "htb1",
    image: "ghcr.io/nwodtuhs/exegol:full",
    workspace: "/home/user/projets/htb/box-1/engagement",
  },
};

const quote = (verified) => ({
  quote: "Seuls les actifs listés sous « In scope » sont autorisés aux tests.",
  url: "https://programme.example/policy",
  retrievedAt: "2026-10-12T08:00:00.000Z",
  verified,
});
const PROGRAM = {
  type: "view",
  view: {
    state: "approved",
    digest: "sha256:9f2c41ab7d0e5c3388b1f6a2d4e97c10aa55f3b2e6d8c70914ab3e5f60c2d7e1",
    approvedAt: "2026-10-12T09:14:00.000Z",
    inScope: { values: ["*.lab.example", "10.10.11.0/24"], citation: quote(true) },
    outOfScope: { values: ["pay.lab.example"], citation: quote(false) },
    userAgentSuffix: { value: "warband-audit/1.0", citation: quote(true) },
    pace: { value: { maxRequestsPerSecond: 5 }, citation: quote(true) },
    haltedHosts: ["api.lab.example"],
    canValidate: false,
    canSuspend: true,
  },
};

/** Fiche absente : le seul état qui montre les deux boutons de démarrage. */
const PROGRAM_EMPTY = {
  type: "view",
  view: {
    state: "none",
    inScope: null,
    outOfScope: null,
    userAgentSuffix: null,
    pace: null,
    haltedHosts: [],
    canValidate: false,
    canSuspend: false,
  },
};

const FINDINGS = [
  {
    id: "network",
    kind: "host",
    state: "confirmed",
    label: "Réseau du laboratoire",
    tactic: "TA0043",
    technique: "T1595",
  },
  {
    id: "portal",
    kind: "site",
    state: "confirmed",
    label: "Portail du laboratoire",
    from: ["network"],
    tactic: "TA0043",
    technique: "T1595.002",
  },
  {
    id: "directory",
    kind: "site",
    state: "hypothesis",
    label: "Annuaire de test",
    from: ["network"],
    tactic: "TA0007",
  },
  {
    id: "access",
    kind: "step",
    state: "confirmed",
    label: "Accès initial confirmé",
    from: ["portal"],
    tactic: "TA0001",
  },
  {
    id: "credential",
    kind: "credential",
    state: "confirmed",
    label: "Identifiant de démonstration",
    from: ["access"],
    tactic: "TA0006",
  },
  {
    id: "attempt",
    kind: "step",
    state: "failed",
    label: "Tentative de test refusée",
    from: ["directory"],
    tactic: "TA0006",
  },
  {
    id: "session",
    kind: "step",
    state: "hypothesis",
    label: "Session du compte de test",
    from: ["credential", "directory"],
    tactic: "TA0008",
  },
  {
    id: "proof",
    kind: "loot",
    state: "confirmed",
    label: "Preuve conservée",
    from: ["session"],
    tactic: "TA0009",
  },
];

const COVERAGE_CELLS = [
  ["/login", "username", "injection", "confirmed", "Réponse différentielle observée"],
  ["/login", "password", "bruteforce", "blocked", "Verrouillage après 5 essais"],
  ["/api/users", "id", "idor", "confirmed", ""],
  ["/api/users", "Authorization", "authz", "negative", "Jeton refusé"],
  ["/search", "q", "xss", "untested", ""],
  ["/upload", "file", "upload", "prerequisite", "Compte privilégié requis"],
].map(([surface, parameter, testClass, state, note]) => ({
  surface,
  parameter,
  testClass,
  state,
  note,
}));
const AUDIT = {
  enabled: true,
  health: { incomplete: false },
  viewLimited: false,
  bytes: 183500,
  coverage: {
    total: COVERAGE_CELLS.length,
    coveredPercent: 83,
    counts: { untested: 1, negative: 1, blocked: 1, prerequisite: 1, confirmed: 2 },
    cells: COVERAGE_CELLS,
  },
  tests: [
    {
      id: "t-001",
      objective: "Vérifier l'injection sur le champ identifiant",
      target: "https://portal.lab.example/login",
      testContext: "Compte anonyme",
      method: "Requêtes manuelles via le proxy",
      observed: "Réponses différentes selon la charge ; aucune extraction de données.",
      execution: "executed",
      conclusion: "unreviewed",
      author: "agent",
      reviewed: false,
      startedAt: "2026-10-15T09:00:00.000Z",
      ts: "2026-10-15T09:12:00.000Z",
      evidenceIds: ["ev-1", "ev-2"],
    },
    {
      id: "t-002",
      objective: "Contrôle d'accès sur /api/users",
      target: "https://portal.lab.example/api/users/2",
      testContext: "Compte standard",
      method: "Modification de l'identifiant dans l'URL",
      observed: "Accès au profil d'un autre utilisateur.",
      execution: "executed",
      conclusion: "finding",
      author: "operator",
      reviewed: true,
      startedAt: "2026-10-15T09:20:00.000Z",
      ts: "2026-10-15T09:31:00.000Z",
      evidenceIds: ["ev-3"],
    },
  ],
};

const studio = (page, extra = {}) => ({
  type: "view",
  page,
  projectId: PROJECT_ID,
  projectChoices: {
    activeId: PROJECT_ID,
    projects: [
      { id: PROJECT_ID, name: "Laboratoire", workspace: "/home/user/missions/laboratoire" },
    ],
  },
  projectSummary: {
    projectId: PROJECT_ID,
    projectName: "Laboratoire",
    text: "État de la session : vérification terminée. Prochaine étape : examiner les résultats.",
  },
  findings: FINDINGS.slice(0, 3),
  ...DOCKER,
  linkedBanner: { name: "exegol-htb1", workspace: "/home/user/projets/htb" },
  sources: [{ name: "owasp-top10", droits: "CC-BY" }],
  ...extra,
});
const CAPS = {
  providerCatalog: [
    { id: "claude", label: "Claude" },
    { id: "opencode-demo", label: "Fournisseur démo", runtimeId: "demo", connected: true },
    { id: "opencode-autre", label: "Autre fournisseur", runtimeId: "autre", connected: false },
  ],
  capabilities: { providers: ["claude"], skills: [], integrations: [], webSearch: false },
  providerAuth: { claude: true, openai: false },
  mcpCatalog: [{ id: "dns", label: "DNS local" }],
  mcpConfigured: [],
  limits: { maxTurns: 40, ultracodeMaxTurns: null, ultracodeMaxBudgetUsd: 25 },
};

// --- Pages -------------------------------------------------------------------------------------------------------
// make : fabrique HTML ; script : fichier media ; messages : envoyés après le chargement ; body : classes ajoutées.
const opts = (script, style, extra = {}) => ({
  scriptUri: `/media/${script}`,
  styleUri: `/media/css/${style}.css`,
  ...extra,
});
const chatPage = (name, messages, extra = {}) => ({
  name,
  html: (o) =>
    L.chatHtml({
      ...o,
      i18nUri: "/media/i18n.js",
      scriptUri: "/media/chat.js",
      uiUri: "/media/ui.js",
      styleUri: "/media/css/chat.css",
    }),
  messages,
  ...extra,
});
// tall : pages de texte à défilement interne ; la fenêtre est allongée (plafond 3200 px de plus) pour tout capturer.
const simple = (name, make, script, messages, extra = {}) => ({
  name,
  html: (o) =>
    make({
      ...o,
      ...opts(script, make === L.killchainHtml ? "killchain" : script.replace(/\.js$/, "")),
    }),
  messages,
  ...extra,
});
const PAGES = [
  chatPage("chat-conversation", [{ type: "view", view: chatView({ approval: true }) }, CONTAINERS]),
  chatPage("chat-accueil", [{ type: "view", view: chatView({ conversation: false }) }, CONTAINERS]),
  chatPage("chat-reglages-popover", [{ type: "view", view: chatView() }, CONTAINERS], {
    click: "cfg-btn",
  }),
  chatPage("monitor", [
    { type: "role", role: "monitor" },
    { type: "title", text: "Laboratoire" },
    { type: "view", view: L.monitorChatView(execState().view()) },
  ]),
  chatPage("sortie", [
    { type: "role", role: "watch", toolUseId: "scan" },
    { type: "view", view: L.monitorChatView(execState().view(), "scan") },
  ]),
  chatPage("rapport", [
    { type: "role", role: "report" },
    {
      type: "view",
      view: {
        items: [L.missionReportPreview({ id: PROJECT_ID, name: "Laboratoire" }, FINDINGS, "fr")],
        approvals: [],
        busy: false,
        sandbox: null,
        sandboxNetwork: null,
        controls: null,
        history: [],
        readonly: null,
        noProvider: false,
      },
    },
  ]),
  simple("cockpit", L.cockpitHtml, "cockpit.js", [COCKPIT], { tall: true }),
  simple("programme", L.programHtml, "program.js", [PROGRAM], { tall: true }),
  simple("programme-vide", L.programHtml, "program.js", [PROGRAM_EMPTY], { tall: true }),
  simple("killchain-plein-ecran", L.killchainHtml, "studio.js", [
    studio("killchain", { findings: FINDINGS }),
  ]),
  ...[
    ["project", {}],
    ["containers", {}],
    ["killchain", { findings: FINDINGS }],
    ["audit", { audit: AUDIT }],
    ["integrations", CAPS],
    ["providers", CAPS],
    ["atlas", {}],
    ["system", CAPS],
    ["appearance", {}],
  ].map(([page, extra]) =>
    simple(`reglages-${page}`, L.studioHtml, "studio.js", [studio(page, extra)], {
      tall: page !== "killchain",
    }),
  ),
].filter((p) => !onlyPattern || p.name.includes(onlyPattern));

// --- Serveur local : HTML en mémoire + media/ (les masques `icon.svg` exigent HTTP, pas file://) -----------------
const MIME = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const pageHtml = new Map();
const themeCss = new Map();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const mem = pageHtml.get(url.pathname);
  if (mem !== undefined) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(mem);
    return;
  }
  const css = themeCss.get(url.pathname);
  if (css !== undefined) {
    res.writeHead(200, { "content-type": "text/css" }).end(css);
    return;
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/media\//, "");
  const file = resolve(media, rel);
  if (
    !url.pathname.startsWith("/media/") ||
    !file.startsWith(media) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res
    .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
    .end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

// Faux hôte : avant tout script de la page.
const shim = (cls) =>
  `window.__sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>{window.__sent.push(m);},getState:()=>undefined,setState:()=>{}});document.body.classList.add("${cls}");`;

let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error(
    "Playwright introuvable (require('playwright')) : installez-le globalement, il n'est pas une dépendance du dépôt.",
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const browser = await playwright.chromium.launch();
const shots = [];
const failures = [];
try {
  for (const page of PAGES) {
    for (const [themeName, theme] of Object.entries(THEMES)) {
      const html = page
        .html({ nonce: "snap", cspSource: origin })
        .replace(
          '<link rel="stylesheet" href="/media/css/base.css">',
          `<link rel="stylesheet" href="/theme-${themeName}.css">\n<link rel="stylesheet" href="/media/css/base.css">`,
        )
        .replace(/(<body[^>]*>)/, `$1<script nonce="snap">${shim(theme.cls)}</script>`);
      const path = `/${page.name}-${themeName}.html`;
      pageHtml.set(path, html);
      themeCss.set(`/theme-${themeName}.css`, theme.css);
      for (const size of SIZES) {
        const ctx = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
          colorScheme: themeName,
        });
        const tab = await ctx.newPage();
        const errors = [];
        tab.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        tab.on("console", (m) => {
          if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
        });
        tab.on("requestfailed", (r) => errors.push(`requête échouée: ${r.url()}`));
        await tab.goto(origin + path, { waitUntil: "load" });
        await tab.evaluate(() => document.fonts.ready);
        for (const m of page.messages) await tab.evaluate((msg) => window.postMessage(msg, "*"), m);
        await tab.waitForTimeout(150);
        if (page.click) {
          await tab.evaluate((id) => document.getElementById(id)?.click(), page.click);
          await tab.waitForTimeout(150);
        }
        if (page.tall) {
          const extra = await tab.evaluate(() => {
            let more = document.documentElement.scrollHeight - innerHeight;
            for (const n of document.querySelectorAll("*"))
              if (
                n.scrollHeight > n.clientHeight + 1 &&
                getComputedStyle(n).overflowY !== "visible"
              )
                more = Math.max(more, n.scrollHeight - n.clientHeight);
            return more;
          });
          if (extra > 0) {
            await tab.setViewportSize({
              width: size.width,
              height: size.height + Math.min(extra, 3200),
            });
            await tab.waitForTimeout(150);
          }
        }
        const file = `${page.name}-${themeName}-${size.name}.png`;
        await tab.screenshot({ path: join(outDir, file), fullPage: true, animations: "disabled" });
        const bytes = statSync(join(outDir, file)).size;
        const blank = await tab.evaluate(() => (document.body.innerText ?? "").trim().length === 0);
        if (bytes < 2000) errors.push(`PNG trop petit (${bytes} octets)`);
        if (blank) errors.push("page sans texte visible");
        if (errors.length) failures.push({ file, errors });
        shots.push({ file, page: page.name, theme: themeName, size: size.name, bytes });
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}

// --- index.html : grille des captures ------------------------------------------------------------------------------
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cards = shots
  .map(
    (s) =>
      `<figure><figcaption>${esc(s.page)} · ${s.theme} · ${s.size}</figcaption><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(s.file)}"></a></figure>`,
  )
  .join("\n");
writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Captures ${esc(label)}</title>
<style>body{font:14px system-ui;margin:16px;background:#222;color:#eee}h1{font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}figure{margin:0;background:#333;padding:8px;border-radius:6px}figcaption{font-size:12px;margin-bottom:6px}img{width:100%;height:auto;display:block}</style>
<h1>Captures « ${esc(label)} » (${shots.length})</h1><div class="grid">\n${cards}\n</div></html>\n`,
);

console.log(`${shots.length} captures dans ${outDir}`);
if (failures.length) {
  for (const f of failures) console.error(`ECHEC ${f.file}\n  ${f.errors.join("\n  ")}`);
  process.exit(1);
}
