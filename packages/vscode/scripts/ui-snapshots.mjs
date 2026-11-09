// Banc de captures des webviews de l'extension (manuel, hors `pnpm check`) : comparer l'interface avant/après un lot.
// Usage : node packages/vscode/scripts/ui-snapshots.mjs [DOSSIER] [--label ETIQUETTE] [--only motif]
//   DOSSIER : sortie des PNG et de index.html (défaut : ../work/ui-snapshots/<étiquette>, relatif à la racine du dépôt).
//   ETIQUETTE : nom du jeu de captures (défaut : nom du dossier). Pages 1280x800 et 420x800 (barre latérale), thèmes sombre et clair.
// Le HTML vient de html.ts (compilé à la volée avec esbuild), le CSS/JS de media/ ; l'hôte VS Code est simulé (faux
// acquireVsCodeApi, variables de thème, messages de données d'exemple). Chromium via Playwright (déjà installé, non ajouté au dépôt).
// Deux lancements successifs produisent les mêmes PNG (horloge simulée, rAF neutralisé, transitions coupées, raster déterministe).
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

// Horloge déterministe : les états d'exemple horodatent le début de tour avec Date.now() ; on la fige pendant
// leur construction (rétablie avant Playwright) et la page reçoit une horloge simulée à FIXED + 65 s (T+01:05).
const FIXED = Date.parse("2026-01-01T00:00:00Z");
const realNow = Date.now;
Date.now = () => FIXED;

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

function chatState({ conversation = true, approval = false, context } = {}) {
  const s = L.createChatState();
  const e = ev(s);
  s.setSandbox("node:22-slim");
  if (context) e({ kind: "context.usage", ...context });
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
const MENTION_RESULTS = {
  type: "mentionResults",
  query: "",
  files: [
    { path: "/work/src/auth/login.ts", label: "src/auth/login.ts" },
    { path: "/work/src/auth/session.ts", label: "src/auth/session.ts" },
    { path: "/work/README.md", label: "README.md" },
  ],
  killchain: { available: true },
  sortie: { available: false, why: "empty" },
};
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
  e({
    id: "o3",
    parentId: "proc",
    kind: "process.output",
    stream: "stdout",
    line: "22/tcp closed ssh",
  });
  e({
    id: "o4",
    parentId: "proc",
    kind: "process.output",
    stream: "stdout",
    line: "443/tcp open  https",
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
const tile = (id, name, state, extra = {}) => ({
  id,
  name,
  title: "",
  location: "editor",
  state,
  model: "défaut",
  project: "Laboratoire",
  updatedAt: "2026-11-07T10:00:00.000Z",
  approvals: state === "approval" ? 1 : 0,
  ...extra,
});
const SESSIONS = {
  type: "view",
  tiles: [
    tile("c1", "Chat 2", "approval", {
      title: "Scan du périmètre web",
      approvals: 2,
      updatedAt: "2026-11-07T09:12:00.000Z",
    }),
    tile("sidebar", "Chat", "approval", {
      title: "Rédaction de la fiche programme",
      location: "sidebar",
      updatedAt: "2026-11-07T09:40:00.000Z",
    }),
    tile("c3", "Chat 3", "error", {
      title: "Énumération DNS",
      updatedAt: "2026-11-07T08:50:00.000Z",
    }),
    tile("c4", "Chat 4", "busy", {
      title: "Analyse des en-têtes HTTP",
      updatedAt: "2026-11-07T10:20:00.000Z",
    }),
    tile("c5", "Chat 5", "idle", {
      title: "Relecture du rapport",
      project: "",
      updatedAt: "2026-11-06T16:00:00.000Z",
    }),
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

// Page Engagement (red team) : engagement validé, arrêt d'urgence actif, plan de campagne avec journal et clôture.
const engQuote = (verified = true) => ({
  quote: "Lettre de mission LM-2026-14, article 2 : périmètre et fenêtre de test.",
  url: "https://client.example/lettre-de-mission",
  retrievedAt: "2026-11-02T08:00:00.000Z",
  verified,
});
const ENG_SHEET = {
  authorization: {
    value: { principal: "ACME Industries", reference: "LM-2026-14", signatory: "A. Martin, RSSI" },
    citation: engQuote(),
  },
  window: {
    value: {
      text: "Du 10 au 21 novembre 2026, heures ouvrées",
      notBefore: "2026-11-10T08:00:00.000Z",
      notAfter: "2026-11-21T18:00:00.000Z",
    },
    citation: engQuote(),
  },
  inScope: { value: ["*.acme.example", "10.20.0.0/16"], citation: engQuote() },
  infrastructure: { value: ["c2.redteam.example"], citation: engQuote() },
  outOfScope: { value: ["paie.acme.example", "10.20.99.0/24"], citation: engQuote(false) },
  rulesOfEngagement: {
    value:
      "Pas de déni de service. Systèmes de production critiques intouchables. Aucune exfiltration de données personnelles.",
    citation: engQuote(),
  },
  whiteTeam: {
    value: {
      contact: "soc@acme.example",
      deconfliction: "Appel au SOC avant toute action bruyante",
    },
    citation: engQuote(),
  },
  osintPolicy: {
    value: "Rôles et informations professionnelles publiques seulement ; minimisation.",
    citation: engQuote(),
  },
};
const ENG_DIGEST = "5d1e0c7a93b24f6e8a10c2d7b9e4f3a6180d5c2b7e9f4a63d1c80b5e27a9f4d1";
const ENG_CAMPAIGN_NONE = {
  state: "none",
  threatSummary: null,
  objectives: [],
  steps: [],
  executed: 0,
  total: 0,
  percent: 0,
  canValidate: false,
  canSuspend: false,
};
const ENG_BASE = {
  state: "approved",
  digest: ENG_DIGEST,
  approvedAt: "2026-11-03T09:14:00.000Z",
  sheet: ENG_SHEET,
  halt: { active: false },
  campaign: ENG_CAMPAIGN_NONE,
  journal: { rows: [], total: 0 },
  closure: null,
  canValidate: false,
  canSuspend: true,
};
const ENGAGEMENT = { type: "view", view: ENG_BASE };
const ENGAGEMENT_HALT = {
  type: "view",
  view: { ...ENG_BASE, halt: { active: true, since: "2026-11-12T14:32:00.000Z" } },
};
const ENGAGEMENT_PLAN = {
  type: "view",
  view: {
    ...ENG_BASE,
    campaign: {
      state: "approved",
      digest: "a37c90e1d24b58f6c0913e7d5a8b24f1c6e09d3a7b5f2814e6c0a9d73b1f58e2",
      approvedAt: "2026-11-03T09:20:00.000Z",
      threatSummary: {
        value: "Groupe criminel motivé par l'extorsion, accès initial par hameçonnage ciblé.",
        citation: engQuote(),
      },
      objectives: [
        {
          id: "o1",
          label: "Compromettre le domaine",
          successCriterion: "Compte administrateur du domaine obtenu",
        },
        {
          id: "o2",
          label: "Atteindre la base clients",
          successCriterion: "Lecture d'une ligne de test sur le serveur de base",
        },
      ],
      steps: [
        {
          id: "s1",
          label: "Hameçonnage ciblé",
          tactic: "TA0001",
          technique: "T1566",
          objectiveId: "o1",
          executed: true,
          result: "success",
        },
        {
          id: "s2",
          label: "Exécution de la charge",
          tactic: "TA0002",
          technique: "T1059",
          objectiveId: "o1",
          executed: true,
          result: "partial",
        },
        {
          id: "s3",
          label: "Mouvement latéral SMB",
          tactic: "TA0008",
          technique: "T1021.002",
          objectiveId: "o1",
          executed: false,
          result: "blocked",
        },
        {
          id: "s4",
          label: "Accès à la base clients",
          tactic: "TA0009",
          technique: "T1005",
          objectiveId: "o2",
          executed: false,
        },
      ],
      executed: 2,
      total: 4,
      percent: 50,
      canValidate: false,
      canSuspend: true,
    },
    journal: {
      total: 3,
      rows: [
        {
          ts: "2026-11-10T09:12:44Z",
          stepId: "s1",
          stepLabel: "Hameçonnage ciblé",
          technique: "T1566",
          target: "mail.acme.example",
          result: "success",
        },
        {
          ts: "2026-11-10T11:03:09Z",
          stepId: "s2",
          stepLabel: "Exécution de la charge",
          technique: "T1059",
          target: "ws-0142.acme.example",
          result: "partial",
        },
        {
          ts: "2026-11-11T08:41:27Z",
          stepId: "s3",
          stepLabel: "Mouvement latéral SMB",
          technique: "T1021.002",
          target: "fs01.acme.example",
          result: "blocked",
        },
      ],
    },
    closure: {
      remaining: 2,
      canClose: false,
      items: [
        {
          id: "t1",
          label: "Retirer la balise de ws-0142",
          kind: "artifact",
          done: true,
          doneAt: "2026-11-11T17:02:00Z",
          proof: "Processus arrêté, binaire supprimé",
        },
        { id: "t2", label: "Supprimer le compte de test svc-rt", kind: "account", done: false },
        {
          id: "t3",
          label: "Détruire le serveur de commande et contrôle",
          kind: "infrastructure",
          done: false,
        },
      ],
    },
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
// Pages en lecture seule (Monitor, Sortie, Rapport) : viewer.js, sans le chat.
const viewerPage = (name, kind, messages, extra = {}) => ({
  name,
  html: (o) =>
    L.viewerHtml({
      ...o,
      kind,
      i18nUri: "/media/i18n.js",
      scriptUri: "/media/viewer.js",
      uiUri: "/media/ui.js",
      styleUri: "/media/css/viewer.css",
    }),
  messages,
  ...extra,
});
const credentialWarning = chatState({ conversation: false });
credentialWarning.notice(
  "Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir.",
);
const PAGES = [
  chatPage(
    "chat-profils",
    [
      {
        type: "view",
        view: {
          ...chatView({ conversation: false }),
          capabilities: {
            providers: [{ id: "claude", label: "Fournisseur" }],
            provider: "claude",
            selection: { profile: "out-of-box", integrations: [], burp: false, webSearch: false },
            skills: ["out-of-box", "htb", "bug-bounty", "red-team", "mentor"],
            integrations: [],
            burp: false,
            available: {
              skills: ["out-of-box", "htb", "bug-bounty", "red-team", "mentor"],
              integrations: [],
              burp: false,
            },
          },
        },
      },
      { ...CONTAINERS, linkedCount: 1 },
    ],
    { click: "composer-menu-btn", profileMenu: true },
  ),
  chatPage("chat-identifiant-detecte", [
    { type: "view", view: credentialWarning.view() },
    CONTAINERS,
  ]),
  chatPage(
    "chat-conteneur-manquant",
    [
      { type: "view", view: chatView({ conversation: false }) },
      { type: "containers", items: [], linkedCount: 0 },
      {
        type: "containerLinks",
        items: [
          {
            name: "kali-1",
            message:
              "kali-1 n’est pas lié au projet : une mention @ ne suffit pas, liez-le dans le cockpit.",
          },
        ],
      },
    ],
    { containerState: "missing" },
  ),
  chatPage(
    "chat-conteneur-lie",
    [
      { type: "view", view: chatView({ conversation: false }) },
      { ...CONTAINERS, linkedCount: 1 },
    ],
    { containerState: "linked" },
  ),
  chatPage("chat-conversation", [{ type: "view", view: chatView({ approval: true }) }, CONTAINERS]),
  chatPage("chat-accueil", [{ type: "view", view: chatView({ conversation: false }) }, CONTAINERS]),
  // Jauge de contexte : fenêtre connue, avertissement (> 80 %), fenêtre inconnue, aucune donnée.
  chatPage("chat-jauge-connue", [
    { type: "view", view: chatView({ context: { usedTokens: 42_000, windowTokens: 200_000 } }) },
    CONTAINERS,
  ]),
  chatPage("chat-jauge-alerte", [
    { type: "view", view: chatView({ context: { usedTokens: 170_000, windowTokens: 200_000 } }) },
    CONTAINERS,
  ]),
  chatPage("chat-jauge-fenetre-inconnue", [
    { type: "view", view: chatView({ context: { usedTokens: 42_000 } }) },
    CONTAINERS,
  ]),
  chatPage("chat-jauge-inconnue", [{ type: "view", view: chatView() }, CONTAINERS]),
  // Menu `@` : fichiers de l'espace de travail, @killchain et @sortie (grisée sans sortie).
  chatPage("chat-mention", [{ type: "view", view: chatView() }, CONTAINERS], {
    type: "@",
    after: [MENTION_RESULTS],
  }),
  chatPage("chat-mention-sans-projet", [{ type: "view", view: chatView() }, CONTAINERS], {
    type: "@",
    after: [{ ...MENTION_RESULTS, files: [], killchain: { available: false, why: "no-project" } }],
  }),
  chatPage("chat-reglages-popover", [{ type: "view", view: chatView() }, CONTAINERS], {
    click: "cfg-btn",
  }),
  viewerPage("monitor", "monitor", [
    { type: "title", text: "Laboratoire" },
    { type: "view", view: L.monitorChatView(execState().view()) },
  ]),
  viewerPage("sortie", "watch", [
    { type: "view", view: L.monitorChatView(execState().view(), "scan") },
  ]),
  viewerPage(
    "sortie-filtre",
    "watch",
    [{ type: "view", view: L.monitorChatView(execState().view(), "scan") }],
    { filter: "open" },
  ),
  viewerPage("rapport", "report", [
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
  simple("reglages-accounts-valeurs-courtes", L.studioHtml, "studio.js", [studio("accounts")], {
    accountDraft: { identifier: "admin", secret: "a1" },
  }),
  simple("programme", L.programHtml, "program.js", [PROGRAM], { tall: true }),
  simple("programme-vide", L.programHtml, "program.js", [PROGRAM_EMPTY], { tall: true }),
  simple("engagement", L.engagementHtml, "engagement.js", [ENGAGEMENT], { tall: true }),
  simple("engagement-arret", L.engagementHtml, "engagement.js", [ENGAGEMENT_HALT], { tall: true }),
  simple("engagement-plan", L.engagementHtml, "engagement.js", [ENGAGEMENT_PLAN], { tall: true }),
  simple("sessions", L.sessionsHtml, "sessions.js", [SESSIONS]),
  simple("sessions-attente", L.sessionsHtml, "sessions.js", [SESSIONS], {
    click: "filter-awaiting",
  }),
  simple("killchain-plein-ecran", L.killchainHtml, "studio.js", [
    studio("killchain", { findings: FINDINGS }),
  ]),
  ...[
    ["project", {}],
    ["accounts", { testAccounts: [{ label: "A", host: "example.com", kind: "password" }] }],
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
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
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

Date.now = realNow;

let playwright;
try {
  try {
    playwright = require("playwright");
  } catch {
    playwright = require("playwright-core");
  }
} catch {
  console.error(
    "Playwright introuvable (require('playwright')) : installez-le globalement, il n'est pas une dépendance du dépôt.",
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
// Reproductibilité octet pour octet : rastérisation mono-fil et sans raster partiel (sinon les coins arrondis varient
// d'un niveau d'une exécution à l'autre), pas de GPU ni de lissage LCD, profil couleur sRGB.
const browser = await playwright.chromium.launch({
  ...(process.env.WARBAND_CHROMIUM && { executablePath: process.env.WARBAND_CHROMIUM }),
  args: [
    "--disable-gpu",
    "--disable-lcd-text",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    "--num-raster-threads=1",
    "--disable-partial-raster",
    "--disable-skia-runtime-opts",
  ],
});
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
      themeCss.set(
        "/bench-stable.css",
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}",
      );
      for (const size of SIZES) {
        const ctx = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1,
          colorScheme: themeName,
          reducedMotion: "reduce",
        });
        const tab = await ctx.newPage();
        const errors = [];
        tab.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        tab.on("console", (m) => {
          if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
        });
        tab.on("requestfailed", (r) => errors.push(`requête échouée: ${r.url()}`));
        // Stabilité : horloge simulée figée (T+mm:ss, setInterval), rAF neutralisé, curseur masqué, transitions
        // coupées. Réservé au banc : rien de cela n'existe dans le produit.
        await tab.clock.install({ time: new Date(FIXED) });
        await tab.clock.pauseAt(new Date(FIXED + 65_000));
        await tab.addInitScript(() => {
          window.requestAnimationFrame = () => 0;
        });
        await tab.goto(origin + path, { waitUntil: "load" });
        await tab.addStyleTag({ url: `${origin}/bench-stable.css` });
        await tab.evaluate(() => document.fonts.ready);
        for (const m of page.messages) await tab.evaluate((msg) => window.postMessage(msg, "*"), m);
        await tab.waitForTimeout(150);
        if (page.accountDraft) {
          for (const [name, value] of Object.entries(page.accountDraft))
            await tab.fill(`input[name="${name}"]`, value);
        }
        if (page.type) {
          await tab.evaluate((value) => {
            const field = document.getElementById("input");
            field.focus();
            field.value = value;
            field.setSelectionRange(value.length, value.length);
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }, page.type);
          await tab.waitForTimeout(250);
          for (const m of page.after ?? [])
            await tab.evaluate((msg) => window.postMessage(msg, "*"), m);
          await tab.waitForTimeout(150);
        }
        if (page.filter) {
          await tab.fill("#viewer-filter", page.filter);
          await tab.waitForTimeout(150);
        }
        if (page.click) {
          await tab.evaluate((id) => document.getElementById(id)?.click(), page.click);
          await tab.waitForTimeout(150);
        }
        if (page.containerState) {
          const expected = page.containerState === "missing";
          const visible = await tab.locator("#container-warning").isVisible();
          if (visible !== expected) throw new Error(`Bandeau conteneur incorrect : ${page.name}`);
          if (expected) {
            if (
              !(await tab.locator("#container-links").innerText()).includes(
                "Lier kali-1 à ce projet ?",
              )
            )
              throw new Error("Carte de liaison absente");
            await tab.locator("#link-container").click();
            await tab.locator("#container-links button").first().click();
            await tab.locator("#container-links button").last().click();
            const sent = await tab.evaluate(() => window.__sent.slice(-3));
            if (
              JSON.stringify(sent) !==
              JSON.stringify([
                { type: "openCockpit" },
                { type: "linkMention", name: "kali-1" },
                { type: "ignoreLinkMention", name: "kali-1" },
              ])
            )
              throw new Error("Actions de liaison incorrectes");
          }
        }
        if (page.profileMenu) {
          const text = await tab.locator("#composer-resources").innerText();
          for (const label of [
            "Pentest",
            "Hack The Box / CTF",
            "Bug bounty",
            "Red Team — Expert",
            "Mentor",
          ])
            if (!text.includes(label)) throw new Error(`Profil absent : ${label}`);
          if (text.includes("Out of the box")) throw new Error("Ancien libellé de profil");
        }
        // Captures stables : animations et transitions figées à leur début.
        await tab.evaluate(() => {
          for (const a of document.getAnimations()) {
            a.pause();
            a.currentTime = 0;
          }
        });
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
