#!/usr/bin/env node
import { randomUUID } from "node:crypto";
// Tests de bout en bout de l'interface web (Playwright), hors `pnpm check` : `pnpm test:web`.
//
// Le serveur HTTP est le vrai (`packages/server/dist`, authentification, pages de vue, CSP) ; le moteur
// est remplacé par un pont factice qui rejoue des approbations et enregistre ce que le navigateur envoie.
// Aucune donnée réelle, aucun agent. Prérequis : `pnpm build`. Sans `playwright`, le script se saute.
//
// Couvre (1440x900 et 375x812) : connexion, file vide, trois demandes, « Toujours » absent si non
// mémorisable, un clic = un `approve`, aucun `approve` sans clic (chargement, reconnexion), focus jamais
// déplacé sur une carte, arrêt d'urgence sans confirmation, badge Bypass, hors ligne puis reconnexion,
// feuille d'approbation du téléphone, page de vue en iframe (pont, `ready`), zéro violation CSP ;
// lot 5 : deux terminaux xterm côte à côte (écho, resize, fermeture confirmée, reconnexion, bandeau
// d'arrêt), palette alimentée par le serveur (mission, run), Journal (runs, audit), pastille du dock.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = join(root, "packages/server/test/web-shots");

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("web-e2e : playwright est absent, tests ignorés.");
  process.exit(0);
}
const dist = join(root, "packages/server/dist");
if (!existsSync(join(dist, "http.js"))) {
  console.error("web-e2e : packages/server/dist introuvable, lancez d'abord `pnpm build`.");
  process.exit(1);
}
const { createServer } = await import(pathToFileURL(join(dist, "http.js")).href);
const { hashPassword } = await import(pathToFileURL(join(dist, "auth/password.js")).href);
const { validateLayout } = await import(pathToFileURL(join(dist, "bridge/layout.js")).href);
const { HostUi } = await import(pathToFileURL(join(dist, "bridge/hostui.js")).href);
const { UploadStore } = await import(pathToFileURL(join(dist, "uploads.js")).href);
const { DownloadStore } = await import(pathToFileURL(join(dist, "downloads.js")).href);

const PASSWORD = "mot-de-passe-de-test-e2e";
const dataDir = mkdtempSync(join(tmpdir(), "rw-e2e-"));
mkdirSync(shots, { recursive: true });

const freePort = () =>
  new Promise((ok, ko) => {
    const s = createNetServer();
    s.once("error", ko);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

// ───────────────────────────── Pont factice ─────────────────────────────

const sockets = new Set();
/** Un « sink » par socket de la coquille : les vrais HostUi, UploadStore et DownloadStore du serveur s'y branchent. */
const shellSinks = new Set();
let hostUi;
let downloads;
/** Messages reçus du navigateur : { view, frame, msg }. */
const received = [];
let approvals = [];
/** Dispositions enregistrées côté « serveur » (validées par le vrai schéma). */
/** Disposition courante « Approbations seule » : le bureau d'un utilisateur qui a déjà un espace (pas un premier lancement). */
const approvalsOnly = () => ({
  current: {
    windows: [
      { id: "approvals", view: "shell", mode: "approvals", x: 0.04, y: 0.04, w: 0.46, h: 0.7 },
    ],
    spaces: [{ id: "main", name: "Bureau" }],
  },
  saved: [],
});
let layouts = approvalsOnly();
let layoutRejected = 0;
/** Si faux, un `approve` n'est pas acquitté (la demande reste dans la liste). */
let acknowledge = true;

// Données factices des écrans natifs (lot 4). Aucun secret réel : la « clé » et le « mot de passe » sont
// des marqueurs que les tests cherchent dans la page.
const SECRET_PW = "pw-factice-S3cr3t-42";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_ONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const KEY_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const XSS = '<img src=x onerror="window.__xss=1"> sortie nmap : 22/tcp open ssh';
let containers = [];
let tokens = [];
let pools = {};
let accountItems = [];
let findingItems = [];
let settingsValues = {};
let missionItems = [];
let runItems = [];
let projectItems = [];
let auditItems = [];
/** Sessions de terminal du pont factice : frame → { container, buffer }. */
const termSessions = new Map();
let bypassState = { active: false, until: null };
function resetScreens() {
  containers = [
    {
      id: "c1",
      name: "kali-recon",
      image: "redwidow-kali:local",
      state: "running",
      kind: "kali",
      project: "acme",
    },
    { id: "c2", name: "kali-web", image: "redwidow-kali:local", state: "stopped", kind: "kali" },
    {
      id: "c3",
      name: "exegol-htb",
      image: "ghcr.io/example/exegol:free",
      state: "stopped",
      kind: "exegol",
    },
  ];
  tokens = [
    { provider: "claude", present: true, kind: "subscription" },
    { provider: "openai", present: false, kind: null },
  ];
  pools = {
    claude: {
      provider: "claude",
      active: KEY_TWO,
      keys: [
        { id: KEY_ONE, label: "Principale", state: "exhausted", retryAt: Date.now() + 3600000 },
        { id: KEY_TWO, label: "Secours équipe", state: "ok", retryAt: null },
      ],
    },
    openai: { provider: "openai", active: null, keys: [] },
    opencode: { provider: "opencode", active: null, keys: [] },
  };
  accountItems = [
    {
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      programme: "Acme",
      label: "USER_A",
      login: "alice@example.test",
      createdBy: "human",
      createdAt: "2026-03-02T09:15:00Z",
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      programme: "Acme",
      label: "ADMIN_TEST",
      login: "admin-qa",
      createdBy: "agent",
      createdAt: "2026-03-04T14:40:00Z",
    },
  ];
  findingItems = [
    {
      id: "f1",
      project: PROJECT,
      kind: "host",
      label: "10.0.0.5 (web-01)",
      state: "confirmed",
      tactic: "TA0043",
      technique: "T1595",
      from: [],
      evidence: [{ id: "e1", label: "scan nmap" }],
    },
    {
      id: "f2",
      project: PROJECT,
      kind: "credential",
      label: "compte de service exposé",
      state: "hypothesis",
      tactic: "TA0006",
      technique: "T1552",
      from: ["f1"],
      evidence: [],
    },
    {
      id: "f3",
      project: PROJECT,
      kind: "site",
      label: "portail /admin",
      state: "failed",
      tactic: null,
      technique: null,
      from: [],
      evidence: [],
    },
  ];
  settingsValues = { profile: "mentor", "burp.enabled": false, "chat.webSearch": true };
  bypassState = { active: false, until: null };
  missionItems = [
    {
      id: "m1",
      title: "Reconnaissance Acme",
      project: PROJECT,
      updatedAt: "2026-03-04T10:00:00Z",
      runIds: ["r-m1"],
      live: true,
      state: "running",
    },
    {
      id: "m2",
      title: "Revue du portail",
      project: null,
      updatedAt: "2026-03-03T10:00:00Z",
      runIds: [],
      live: false,
      state: "idle",
    },
  ];
  runItems = [
    {
      id: "r-m1",
      kind: "mission",
      project: PROJECT,
      startedAt: "2026-03-04T10:00:00Z",
      size: 20480,
    },
    { id: "r-t1", kind: "terminal", project: null, startedAt: "2026-03-04T11:30:00Z", size: 3072 },
  ];
  projectItems = [{ id: PROJECT, name: "Acme" }];
  auditItems = [
    { at: "2026-03-04T11:30:00Z", kind: "terminal.open", frame: "t-1", container: "kali-recon" },
    { at: "2026-03-04T11:00:00Z", kind: "approval.answer", choice: "once" },
  ];
  termSessions.clear();
}
resetScreens();
const shellMsg = (ws, msg) => send(ws, "shell", "shell", msg);
const shellAll = (msg) => broadcast("shell", "shell", msg);
const findingDetail = (f) => ({
  ...f,
  pathFrom: f.from,
  evidenceDetails: f.evidence.map((e) => ({
    id: e.id,
    label: e.label,
    capturedAt: "2026-03-04T10:00:00Z",
    source: { kind: "tool", reference: "nmap -sV" },
    text: XSS,
    truncated: true,
  })),
});

function onScreens(ws, msg) {
  switch (msg.type) {
    case "ready":
      return shellMsg(ws, { type: "bypass", ...bypassState });
    case "containersList":
      return shellMsg(ws, { type: "containers", items: containers });
    case "missionsList":
      return shellMsg(ws, { type: "missions", items: missionItems });
    case "projectsList":
      return shellMsg(ws, { type: "projects", items: projectItems });
    case "runsList":
      return shellMsg(ws, { type: "runs", items: runItems });
    case "auditTail":
      return shellMsg(ws, { type: "audit", items: auditItems });
    case "containerStart":
    case "containerStop": {
      const c = containers.find((x) => x.id === msg.id);
      if (c) c.state = msg.type === "containerStart" ? "running" : "stopped";
      return shellAll({ type: "containers", items: containers });
    }
    case "containerCreate":
      if (containers.some((c) => c.name === msg.name))
        return shellMsg(ws, {
          type: "containerError",
          op: "containerCreate",
          code: "container.exists",
        });
      containers.push({
        id: `n${containers.length}`,
        name: msg.name,
        image: "redwidow-kali:local",
        state: "running",
        kind: "kali",
      });
      return shellAll({ type: "containers", items: containers });
    case "tokens":
      return shellMsg(ws, { type: "tokens", items: tokens });
    case "tokenSet": {
      const t = tokens.find((x) => x.provider === msg.provider);
      if (t) Object.assign(t, { present: true, kind: msg.kind });
      return shellAll({ type: "tokens", items: tokens });
    }
    case "tokenDelete": {
      const t = tokens.find((x) => x.provider === msg.provider);
      if (t) Object.assign(t, { present: false, kind: null });
      return shellAll({ type: "tokens", items: tokens });
    }
    case "poolList":
      for (const p of Object.values(pools)) shellMsg(ws, { type: "pool", ...p });
      return undefined;
    case "poolAdd": {
      const p = pools[msg.provider];
      const id = randomUUID();
      p.keys.push({ id, label: msg.label, state: "ok", retryAt: null });
      if (p.active === null) p.active = id;
      return shellAll({ type: "pool", ...p });
    }
    case "poolReorder": {
      const p = pools[msg.provider];
      p.keys = msg.order.map((id) => p.keys.find((k) => k.id === id));
      return shellAll({ type: "pool", ...p });
    }
    case "poolActivate":
      pools[msg.provider].active = msg.id;
      return shellAll({ type: "pool", ...pools[msg.provider] });
    case "poolRemove": {
      const p = pools[msg.provider];
      p.keys = p.keys.filter((k) => k.id !== msg.id);
      if (p.active === msg.id) p.active = p.keys[0]?.id ?? null;
      return shellAll({ type: "pool", ...p });
    }
    case "accounts":
      return shellMsg(ws, { type: "accounts", items: accountItems });
    case "accountAdd":
      accountItems.push({
        id: randomUUID(),
        programme: msg.programme,
        label: msg.label,
        login: msg.login,
        createdBy: "human",
        createdAt: new Date().toISOString(),
      });
      return shellAll({ type: "accounts", items: accountItems });
    case "accountReveal":
      // Au seul demandeur, comme le vrai serveur.
      return shellMsg(ws, { type: "accountSecret", id: msg.id, value: SECRET_PW });
    case "accountRemove":
      accountItems = accountItems.filter((a) => a.id !== msg.id);
      return shellAll({ type: "accounts", items: accountItems });
    case "findingsList":
      return shellMsg(ws, { type: "findings", project: msg.project ?? null, items: findingItems });
    case "findingGet": {
      const f = findingItems.find((x) => x.id === msg.id);
      return f ? shellMsg(ws, { type: "finding", finding: findingDetail(f) }) : undefined;
    }
    case "findingDelete":
      if (msg.confirmed !== true) return shellMsg(ws, { type: "configError", op: "findingDelete" });
      findingItems = findingItems.filter((x) => x.id !== msg.id);
      return shellAll({ type: "findings", project: msg.project, items: findingItems });
    case "settingsGet":
      return shellMsg(ws, { type: "settings", values: settingsValues });
    case "settingsSet":
      for (const [k, v] of Object.entries(msg.patch)) {
        if (v === null) delete settingsValues[k];
        else settingsValues[k] = v;
      }
      return shellAll({ type: "settings", values: settingsValues });
    case "setBypass":
      bypassState = msg.active
        ? {
            active: true,
            until: msg.durationMinutes === null ? null : Date.now() + msg.durationMinutes * 60000,
          }
        : { active: false, until: null };
      return shellAll({ type: "bypass", ...bypassState });
    default:
      return undefined;
  }
}

const send = (ws, view, frame, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ v: 1, view, frame, msg }));
};
const broadcast = (view, frame, msg) => {
  for (const ws of sockets) send(ws, view, frame, msg);
};
const pushApprovals = () => broadcast("shell", "shell", { type: "approvals", items: approvals });

const PROMPT = "\x1b[32mroot@kali\x1b[0m:~# ";
/** Terminal factice : `open` ouvre, `input` est écho, `resize` et `close` sont journalisés par `received`. */
function onTerm(ws, env) {
  const msg = env.msg;
  const frame = env.frame;
  const out = (m) => send(ws, "term", frame, m);
  const session = termSessions.get(frame);
  switch (msg.type) {
    case "open": {
      const c = containers.find((x) => x.name === msg.container);
      if (!c) return out({ type: "error", code: "terminal.notManaged" });
      if (c.state !== "running") return out({ type: "error", code: "terminal.notRunning" });
      // Une ligne en couleur 24 bits : xterm l'écrit par un attribut `style`, ici via le CSSOM.
      const hello = `\x1b[38;2;204;28;64mrouge24\x1b[0m\r\n${PROMPT}`;
      termSessions.set(frame, { container: c.name, buffer: hello });
      out({ type: "opened", container: c.name });
      return out({ type: "output", data: hello });
    }
    case "ready":
      if (!session) return undefined;
      out({ type: "opened", container: session.container });
      return out({ type: "output", data: session.buffer });
    case "input": {
      if (!session) return undefined;
      const echo = msg.data.replace(/\r/g, `\r\n${PROMPT}`);
      session.buffer += echo;
      return out({ type: "output", data: echo });
    }
    case "close":
      termSessions.delete(frame);
      return out({ type: "exit", code: 0 });
    default:
      return undefined;
  }
}

function onConnection(ws) {
  sockets.add(ws);
  const sink = { send: (view, frame, msg) => send(ws, view, frame, msg) };
  shellSinks.add(sink);
  ws.on("close", () => {
    sockets.delete(ws);
    shellSinks.delete(sink);
    hostUi?.detach(sink);
  });
  ws.on("message", (data) => {
    let env;
    try {
      env = JSON.parse(data.toString());
    } catch {
      return;
    }
    received.push(env);
    if (env.view === "term") return onTerm(ws, env);
    if (env.view !== "shell") return;
    if (env.msg.type === "ready") {
      send(ws, "shell", "shell", { type: "approvals", items: approvals });
      // Dialogues en attente : renvoyés à la (re)connexion, comme le fait le pont du serveur.
      hostUi?.attach(sink);
    }
    if (env.msg.type === "dialogResult") {
      hostUi?.answer(env.msg.id, env.msg.value, sink);
    }
    onScreens(ws, env.msg);
    if (env.msg.type === "approve" && acknowledge) {
      approvals = approvals.filter(
        (a) => !(a.frame === env.frame && a.toolUseId === env.msg.toolUseId),
      );
      pushApprovals();
    }
    if (env.msg.type === "layouts") send(ws, "shell", "shell", { type: "layouts", ...layouts });
    if (env.msg.type === "layoutSave") {
      const layout = validateLayout(env.msg.layout);
      if (layout === null) layoutRejected += 1;
      else if (env.msg.name === null) layouts.current = layout;
      else {
        const entry = { name: env.msg.name, layout };
        const i = layouts.saved.findIndex((e) => e.name === env.msg.name);
        if (i >= 0) layouts.saved[i] = entry;
        else layouts.saved.push(entry);
      }
      if (layout !== null) broadcast("shell", "shell", { type: "layouts", ...layouts });
    }
    if (env.msg.type === "layoutDelete") {
      layouts.saved = layouts.saved.filter((e) => e.name !== env.msg.name);
      broadcast("shell", "shell", { type: "layouts", ...layouts });
    }
    if (env.msg.type === "halt") {
      broadcast("shell", "shell", { type: "halt", active: true, since: Date.now() });
    }
    if (env.msg.type === "resume") {
      broadcast("shell", "shell", { type: "halt", active: false, since: null });
    }
  });
}

const approvalsOf = () => received.filter((e) => e.view === "shell" && e.msg.type === "approve");

const item = (n, over = {}) => ({
  frame: "m1",
  toolUseId: `t${n}`,
  tool: "Bash",
  summary: `nmap -sV 10.0.0.${n}`,
  canRemember: true,
  confirming: false,
  ...over,
});
const three = () => [
  item(1),
  item(2, { tool: "Write", summary: "écrire /workspace/notes.md", canRemember: false }),
  item(3, { frame: "m2" }),
];

// ───────────────────────────── Outils de test ─────────────────────────────

const failures = [];
let checks = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) {
    failures.push(message);
    console.error(`  ECHEC : ${message}`);
  }
};

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(fn, message, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch {
      value = false;
    }
    if (value) return true;
    if (Date.now() > end) {
      check(false, `délai dépassé : ${message}`);
      return false;
    }
    await sleep(50);
  }
}

// ───────────────────────────── Scénario ─────────────────────────────

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const uploads = new UploadStore({ dir: join(dataDir, "uploads"), sweepMs: 0 });
downloads = new DownloadStore({ shell: () => shellSinks, sweepMs: 0 });
hostUi = new HostUi({ shell: () => shellSinks, uploads });
const server = createServer(
  {
    host: "127.0.0.1",
    port,
    dataDir,
    webDir: join(root, "packages/server/web"),
    publicOrigin: origin,
    trustProxy: false,
  },
  {
    passwordHash: await hashPassword(PASSWORD),
    onConnection,
    files: { ui: hostUi, uploads, downloads },
  },
);
await new Promise((ok) => server.listen(port, "127.0.0.1", ok));

const browser = await chromium.launch();

async function scenario(name, viewport) {
  console.log(`\n== ${name} (${viewport.width}x${viewport.height})`);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const violations = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning") {
      if (/Content Security Policy|Refused to/i.test(t)) violations.push(t);
    }
  });
  page.on("pageerror", (e) => violations.push(`pageerror : ${e.message}`));
  let dialogs = 0;
  page.on("dialog", async (d) => {
    dialogs += 1;
    await d.dismiss();
  });
  const shot = (label) => page.screenshot({ path: join(shots, `${name}-${label}.png`) });
  const text = (selector) => page.locator(selector).innerText();
  const visible = (selector) => page.locator(selector).isVisible();

  received.length = 0;
  approvals = [];
  acknowledge = true;
  layouts = approvalsOnly();

  // Sans session : redirection vers la connexion, puis connexion.
  await page.goto(`${origin}/#w=approbations`);
  check(new URL(page.url()).pathname === "/login", "sans session, redirection vers /login");
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/`);
  await until(async () => (await text("#tb-conn")) === "Connecté", "connexion WebSocket établie");

  // File vide.
  check((await text("#tb-count")) === "0", "compteur à 0 (file vide)");
  check((await page.title()) === "RedWidow", "titre sans compteur");
  check(await visible("#appr-empty"), "état vide affiché");
  check((await page.locator(".appr-card").count()) === 0, "aucune carte en file vide");
  check(await page.locator("#tb-halt").isEnabled(), "arrêt d'urgence actif (état serveur inconnu)");
  check((await text("#tb-halt")) === "Arrêt d'urgence", "libellé de l'arrêt d'urgence");
  check(!(await visible("#tb-bypass")), "pas de badge Bypass tant que l'état est inconnu");
  await shot("1-file-vide");

  // Trois demandes.
  approvals = three();
  pushApprovals();
  await until(async () => (await page.locator(".appr-card").count()) === 3, "trois cartes");
  check((await text("#tb-count")) === "3", "compteur à 3");
  check((await page.title()) === "(3) RedWidow", "titre « (3) RedWidow »");
  check(
    await page.locator("#tb-count").evaluate((e) => e.classList.contains("has-pending")),
    "compteur rouge tant que des demandes attendent",
  );
  check(
    (await text("#tb-preview")).startsWith("Bash — nmap"),
    "aperçu de la plus ancienne demande",
  );
  check(
    await page.locator(".appr-card:nth-child(2) .appr-always").isHidden(),
    "« Toujours » absent quand la demande n'est pas mémorisable",
  );
  check(
    await page.locator(".appr-card:nth-child(1) .appr-always").isVisible(),
    "« Toujours » présent quand la demande est mémorisable",
  );
  const sizes = await page
    .locator(".appr-card:nth-child(1) .appr-btn:visible")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(sizes.length === 3 && sizes.every((h) => h >= 44), "trois boutons d'au moins 44 px");
  const focusInCard = await page.evaluate(() => !!document.activeElement?.closest(".appr-card"));
  check(!focusInCard, "le focus n'est pas déplacé vers une carte");
  check(approvalsOf().length === 0, "aucun approve à l'arrivée des demandes");
  await shot("2-trois-demandes");

  // Rechargement : toujours aucun approve.
  await page.reload();
  await until(
    async () => (await page.locator(".appr-card").count()) === 3,
    "cartes après rechargement",
  );
  check(approvalsOf().length === 0, "aucun approve au rechargement");

  // Un clic = un approve.
  await page.locator(".appr-card:nth-child(1) .appr-once").click();
  await until(() => approvalsOf().length === 1, "un approve reçu");
  await sleep(300);
  check(approvalsOf().length === 1, "un clic envoie un seul approve");
  const a = approvalsOf()[0];
  check(
    a?.frame === "m1" &&
      a.msg.toolUseId === "t1" &&
      a.msg.choice === "once" &&
      Object.keys(a.msg).length === 3,
    "approve conforme (frame, toolUseId, choice)",
  );
  await until(async () => (await text("#tb-count")) === "2", "accusé : la demande disparaît");

  // Bypass.
  broadcast("shell", "shell", { type: "bypass", active: true, until: null });
  await until(() => visible("#tb-bypass"), "badge Bypass");
  check((await text("#tb-bypass")) === "Bypass illimité", "badge « Bypass illimité »");
  await shot("3-bypass");

  // Arrêt d'urgence : un clic, aucune confirmation.
  await page.click("#tb-halt");
  await until(() => received.some((e) => e.view === "shell" && e.msg.type === "halt"), "halt reçu");
  check(dialogs === 0, "aucune boîte de confirmation sur l'arrêt d'urgence");
  check(received.filter((e) => e.msg?.type === "halt").length === 1, "un clic envoie un seul halt");
  await until(
    async () => (await text("#tb-halt")) === "Reprendre",
    "bouton « Reprendre » après l'arrêt",
  );
  check(
    (await text("#tb-halt-note")).startsWith("Arrêt d'urgence actif"),
    "état de l'arrêt affiché",
  );
  await shot("4-arret");
  await page.click("#tb-halt");
  await until(() => received.some((e) => e.msg?.type === "resume"), "resume reçu");
  await until(
    async () => (await text("#tb-halt")) === "Arrêt d'urgence",
    "retour à « Arrêt d'urgence »",
  );

  // Hors ligne puis reconnexion : actions désactivées, rien rejoué.
  const before = approvalsOf().length;
  for (const ws of [...sockets]) ws.terminate();
  await until(
    async () => (await text("#tb-conn")).startsWith("Hors ligne"),
    "indicateur hors ligne",
  );
  check(
    await page.locator(".appr-btn:visible").evaluateAll((els) => els.every((e) => e.disabled)),
    "boutons d'approbation désactivés hors ligne",
  );
  await shot("5-hors-ligne");
  await until(async () => (await text("#tb-conn")) === "Connecté", "reconnexion", 10000);
  await until(
    async () => (await page.locator(".appr-card").count()) === 2,
    "liste réannoncée après reconnexion",
  );
  check(approvalsOf().length === before, "aucun approve rejoué à la reconnexion");

  // Plusieurs missions : lien vers la mission.
  check(
    (await page.locator(".appr-card:nth-child(2) .appr-mission").getAttribute("href")) ===
      "#w=mission:m2",
    "lien de la carte vers sa mission",
  );

  // Page de vue en iframe (mission) : pont, `ready`, CSP.
  await page.goto(`${origin}/#w=mission:m1`);
  await until(
    () =>
      page
        .locator("iframe.view-frame")
        .count()
        .then((n) => n === 1),
    "iframe de la mission",
  );
  const findChat = () => page.frames().find((f) => f.url().includes("/view/chat"));
  await until(() => !!findChat(), "la page /view/chat est chargée dans l'iframe");
  const frame = findChat();
  if (frame) {
    await until(
      () => frame.evaluate(() => typeof acquireVsCodeApi === "function"),
      "pont présent dans l'iframe",
    );
    await until(
      () => received.some((e) => e.view === "chat" && e.frame === "m1" && e.msg.type === "ready"),
      "message ready du chat relayé au serveur",
    );
    // Un message du serveur arrive jusqu'à la page.
    await frame.evaluate(() => {
      window.__reçus = [];
      window.addEventListener("message", (e) => window.__reçus.push(e.data));
    });
    broadcast("chat", "m1", { type: "ping-test" });
    await until(
      () => frame.evaluate(() => window.__reçus.some((m) => m.type === "ping-test")),
      "message du serveur reçu par la page",
    );
  }
  const barUncovered = await page.evaluate(() => {
    const bar = document.getElementById("topbar").getBoundingClientRect();
    const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
    return !!hit?.closest("#topbar");
  });
  check(barUncovered, "la barre fixe n'est pas couverte par la vue");
  await shot("6-mission");

  // Feuille d'approbation (téléphone) au-dessus de la fenêtre active.
  const phone = viewport.width < 720;
  const sheetVisible = await visible("#sheet");
  check(
    sheetVisible === phone,
    phone ? "feuille d'approbation visible au téléphone" : "pas de feuille sur grand écran",
  );
  if (phone) {
    check(
      (await page.locator("#sheet .appr-card").count()) === 1,
      "la feuille montre la plus ancienne demande",
    );
    check((await text("#sheet-open")).startsWith("Ouvrir la file"), "bouton « Ouvrir la file »");
    await shot("7-feuille");
    await page.click("#sheet-open");
    await until(
      async () => !(await visible("#sheet")),
      "feuille refermée par l'ouverture de la file",
    );
    check(await visible("#screen-approvals"), "la file d'approbation est ouverte");
  }

  // Non acquittement : « non confirmé » après 10 s (délai réel), puis nouvelle réponse possible.
  acknowledge = false;
  await page.goto(`${origin}/#w=approbations`);
  await until(
    async () => (await page.locator(".appr-card").count()) === 2,
    "cartes avant le test d'accusé",
  );
  const n0 = approvalsOf().length;
  await page.locator(".appr-card:nth-child(1) .appr-deny").click();
  await until(() => approvalsOf().length === n0 + 1, "refus envoyé");
  check(
    await page
      .locator(".appr-card:nth-child(1) .appr-btn:visible")
      .evaluateAll((els) => els.every((e) => e.disabled)),
    "boutons désactivés en attente de l'accusé",
  );
  await until(
    async () => (await text(".appr-card:nth-child(1) .appr-note")).startsWith("Non confirmé"),
    "mention « non confirmé » après 10 s",
    14000,
  );
  check(
    await page.locator(".appr-card:nth-child(1) .appr-once").isEnabled(),
    "réponse possible à nouveau après « non confirmé »",
  );
  check(approvalsOf().length === n0 + 1, "aucun approve envoyé par la minuterie");

  check(
    violations.length === 0,
    `zéro violation CSP en console (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

// ───────────────────────────── Bureau à fenêtres ─────────────────────────────

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

async function openSession(
  name,
  viewport,
  { keepLayouts = false, init = null, firstLaunch = false } = {},
) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const violations = [];
  page.on("console", (m) => {
    if (
      (m.type() === "error" || m.type() === "warning") &&
      /Content Security Policy|Refused to/i.test(m.text())
    ) {
      violations.push(m.text());
    }
  });
  page.on("pageerror", (e) => violations.push(`pageerror : ${e.message}`));
  received.length = 0;
  approvals = [];
  acknowledge = true;
  if (!keepLayouts) layouts = firstLaunch ? { current: null, saved: [] } : approvalsOnly();
  layoutRejected = 0;
  await page.goto(`${origin}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/`);
  await until(
    async () => (await page.locator("#tb-conn").innerText()) === "Connecté",
    "connexion WebSocket (bureau)",
  );
  const win = (key) => page.locator(`.wm-win[data-key="${key}"]`);
  const openHash = (hash) =>
    page.evaluate((h) => {
      location.hash = h;
    }, hash);
  const shot = (label) => page.screenshot({ path: join(shots, `${name}-${label}.png`) });
  return { context, page, violations, win, openHash, shot };
}

/** Rects des fenêtres visibles, et état du dock. */
const visibleKeys = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".wm-win")].filter((w) => !w.hidden).map((w) => w.dataset.key),
  );

async function desktopScenario(name, viewport) {
  console.log(`\n== ${name} : bureau à fenêtres (${viewport.width}x${viewport.height})`);
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport);
  const bar = async () => await page.locator("#topbar").boundingBox();
  const desk = async () => await page.locator("#desktop").boundingBox();

  check(
    (await page.locator(".wm-win").count()) === 1,
    "à l'ouverture : la fenêtre Approbations seule",
  );
  check(await win("native:approvals").isVisible(), "fenêtre Approbations visible");
  check(
    (await page.locator("#screen-approvals").count()) === 1,
    "écran Approbations hébergé par la fenêtre",
  );
  check((await page.locator("#dock-items .dock-item").count()) === 1, "une entrée de dock");

  // Quatre fenêtres : mission, monitor, approbations, natif.
  await openHash("#w=mission:m1");
  await until(() => win("chat:m1").isVisible(), "fenêtre mission");
  await openHash("#w=monitor:r1");
  await until(() => win("viewer:r1").isVisible(), "fenêtre monitor");
  await openHash("#w=conteneurs");
  await until(() => win("native:containers").isVisible(), "fenêtre native (Conteneurs)");
  check(
    (await win("native:containers").innerText()).includes("Conteneur"),
    "écran natif Conteneurs hébergé par sa fenêtre",
  );
  check((await page.locator("#dock-items .dock-item").count()) === 4, "quatre entrées de dock");
  await until(
    async () => !!page.frames().find((f) => f.url().includes("/view/viewer")),
    "page viewer chargée",
  );
  check(
    page.frames().some((f) => f.url().includes("/view/viewer") && f.url().includes("mode=watch")),
    "le monitor charge le viewer en mode watch",
  );
  // Rouvrir une identité existante la focalise au lieu d'en créer une seconde.
  await openHash("#w=mission:m1");
  await sleep(150);
  check(
    (await page.locator(".wm-win").count()) === 4,
    "pas de seconde instance de la même mission",
  );
  check((await page.locator("iframe.view-frame").count()) === 2, "deux iframes pour deux vues");
  await shot("1-cascade");

  // Glisser quatre fenêtres aux coins (pointeur réel) : quarts exacts.
  const d = await desk();
  const corner = {
    br: { x: d.x + d.width - 6, y: d.y + d.height - 40 },
    tr: { x: d.x + d.width - 6, y: d.y + 40 },
    bl: { x: d.x + 6, y: d.y + d.height - 40 },
    tl: { x: d.x + 6, y: d.y + 40 },
  };
  const quarter = {
    br: { x: d.x + Math.round(d.width / 2), y: d.y + Math.round(d.height / 2) },
    tr: { x: d.x + Math.round(d.width / 2), y: d.y },
    bl: { x: d.x, y: d.y + Math.round(d.height / 2) },
    tl: { x: d.x, y: d.y },
  };
  const half = { w: Math.round(d.width / 2), h: Math.round(d.height / 2) };
  const plan = [
    ["chat:m1", "br"],
    ["native:containers", "tr"],
    ["viewer:r1", "bl"],
    ["native:approvals", "tl"],
  ];
  for (const [key, where] of plan) {
    const title = await win(key).locator(".wm-title").boundingBox();
    await page.mouse.move(title.x + 20, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(title.x + 200, title.y + 160, { steps: 6 });
    if (key === "chat:m1") {
      // Pendant le glisser : voile au-dessus des iframes, barre fixe libre.
      const iframeBox = await win("viewer:r1").locator("iframe").boundingBox();
      const overIframe = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.className ?? "",
        { x: iframeBox.x + iframeBox.width / 2, y: iframeBox.y + iframeBox.height / 2 },
      );
      check(overIframe.includes("wm-veil"), "pendant un glisser, le voile couvre les iframes");
    }
    await page.mouse.move(corner[where].x, corner[where].y, { steps: 10 });
    check(
      await page.locator(".wm-preview").isVisible(),
      `aperçu de tuile (${where}) pendant le glisser`,
    );
    if (where === "tl") await shot("2-glisser");
    await page.mouse.up();
    check(await page.locator(".wm-veil").isHidden(), "voile retiré au relâchement");
    check(await page.locator(".wm-preview").isHidden(), "aperçu retiré au relâchement");
    await sleep(220);
    const box = await win(key).boundingBox();
    const q = quarter[where];
    check(
      near(box.x, q.x) && near(box.y, q.y) && near(box.width, half.w) && near(box.height, half.h),
      `${key} : quart ${where} exact (${JSON.stringify(box)})`,
    );
  }
  await sleep(300);
  await shot("3-quatre-quarts");
  const barBox = await bar();
  const topHit = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("#topbar"),
    {
      x: barBox.x + barBox.width / 2,
      y: barBox.y + barBox.height / 2,
    },
  );
  check(topHit, "la barre fixe n'est pas couverte (quatre fenêtres)");

  // Minimiser, restaurer par le dock ; clic sur la focalisée : minimise.
  const item = (key) => page.locator(`#dock-items .dock-item[data-key="${key}"]`);
  await win("viewer:r1").locator(".wm-min").click();
  check(await win("viewer:r1").isHidden(), "minimiser masque la fenêtre");
  check(
    await item("viewer:r1").evaluate((e) => e.classList.contains("is-min")),
    "le dock signale la minimisée",
  );
  check(!(await visibleKeys(page)).includes("viewer:r1"), "fenêtre minimisée non visible");
  await item("viewer:r1").click();
  check(await win("viewer:r1").isVisible(), "clic dock : restaure");
  check(
    await item("viewer:r1").evaluate((e) => e.classList.contains("is-focus")),
    "la restaurée est focalisée",
  );
  await item("viewer:r1").click();
  check(await win("viewer:r1").isHidden(), "clic dock sur la focalisée : minimise");
  await item("viewer:r1").click();
  // La page du monitor est restée vivante (budget non atteint) : pas rechargée.
  check(
    (await win("viewer:r1").locator("iframe").getAttribute("src")).includes("/view/viewer"),
    "iframe minimisée gardée vivante",
  );

  // Maximiser (double-clic sur le titre), restaurer.
  const before = await win("native:containers").boundingBox();
  await win("native:containers")
    .locator(".wm-title")
    .dblclick({ position: { x: 60, y: 15 } });
  await sleep(220);
  const dd = await desk();
  const full = await win("native:containers").boundingBox();
  check(near(full.width, dd.width) && near(full.height, dd.height), "double-clic : maximisée");
  await win("native:containers")
    .locator(".wm-title")
    .dblclick({ position: { x: 60, y: 15 } });
  await sleep(220);
  const back = await win("native:containers").boundingBox();
  check(
    near(back.width, before.width) && near(back.height, before.height),
    "double-clic : restaurée",
  );

  // Redimensionner par la poignée sud-est, taille minimale respectée, jamais au-delà du bureau.
  const grip = await win("native:containers").locator(".wm-grip-se").boundingBox();
  await page.mouse.move(grip.x + 6, grip.y + 6);
  await page.mouse.down();
  await page.mouse.move(grip.x - 2000, grip.y - 2000, { steps: 6 });
  await page.mouse.up();
  const small = await win("native:containers").boundingBox();
  check(
    near(small.width, 320) && near(small.height, 200),
    `taille minimale 320x200 (${small.width}x${small.height})`,
  );
  await page
    .locator(".wm-win[data-key='native:containers'] .wm-grip-se")
    .boundingBox()
    .then(async (g) => {
      await page.mouse.move(g.x + 6, g.y + 6);
      await page.mouse.down();
      await page.mouse.move(g.x + 3000, g.y + 3000, { steps: 6 });
      await page.mouse.up();
    });
  const wide = await win("native:containers").boundingBox();
  check(
    wide.x + wide.width <= dd.x + dd.width + 1.5 && wide.y + wide.height <= dd.y + dd.height + 1.5,
    "redimensionnement borné au bureau",
  );

  // Une fenêtre tirée hors du bureau garde sa barre de titre atteignable et ne couvre pas la barre fixe.
  const t = await win("native:containers").locator(".wm-title").boundingBox();
  await page.mouse.move(t.x + 20, t.y + 15);
  await page.mouse.down();
  await page.mouse.move(t.x + 20, -500, { steps: 8 });
  await page.mouse.up();
  await sleep(250);
  const lifted = await win("native:containers").boundingBox();
  const bar2 = await bar();
  check(lifted.y >= bar2.y + bar2.height - 1, "une fenêtre ne passe pas sur la barre fixe");
  check(
    near(lifted.width, dd.width) && near(lifted.height, dd.height),
    "glisser contre le haut : plein bureau",
  );
  // Saisir la maximisée la restaure sous le pointeur ; un double-clic seul, non.
  const tm = await win("native:containers").locator(".wm-title").boundingBox();
  await page.mouse.move(tm.x + 300, tm.y + 15);
  await page.mouse.down();
  await page.mouse.move(tm.x + 340, tm.y + 120, { steps: 5 });
  await page.mouse.up();
  const freed = await win("native:containers").boundingBox();
  check(
    freed.width < dd.width - 100 && freed.y > bar2.y + bar2.height,
    "saisie d'une maximisée : restaurée",
  );

  // Fermer.
  await win("native:containers").locator(".wm-close").click();
  check(
    (await page.locator(".wm-win[data-key='native:containers']").count()) === 0,
    "fermer retire la fenêtre",
  );
  check((await page.locator("#dock-items .dock-item").count()) === 3, "le dock suit la fermeture");

  // Clic dans une fenêtre : premier plan.
  await win("chat:m1")
    .locator(".wm-title")
    .click({ position: { x: 100, y: 15 } });
  check(
    await win("chat:m1").evaluate((e) => e.classList.contains("is-focused")),
    "clic dans la fenêtre : premier plan",
  );
  // Focus depuis l'iframe (pont) : un clic dans la page de la mission la passe devant.
  await win("native:approvals")
    .locator(".wm-title")
    .click({ position: { x: 100, y: 15 } });
  const chat = page.frames().find((f) => f.url().includes("/view/chat"));
  if (chat) {
    await chat
      .locator("body")
      .click({ position: { x: 10, y: 10 }, force: true })
      .catch(() => {});
    await until(
      () => win("chat:m1").evaluate((e) => e.classList.contains("is-focused")),
      "clic dans l'iframe : la fenêtre passe devant (pont)",
    );
  }

  // Menu « Ouvrir ».
  await page.click("#dock-open");
  check(await page.locator("#dock-menu").isVisible(), "menu Ouvrir affiché");
  await page.locator('#dock-menu .dock-menu-item[data-action="native:settings"]').click();
  check(await win("native:settings").isVisible(), "menu Ouvrir : ouvre l'écran Réglages");
  check(await page.locator("#dock-menu").isHidden(), "menu refermé après le choix");

  // Barre fixe et approbations restent prioritaires : une demande arrive, la fenêtre Approbations est
  // minimisée, le compteur de la barre et la pastille du dock l'annoncent.
  await win("native:approvals").locator(".wm-min").click();
  approvals = [item1()];
  pushApprovals();
  await until(
    async () => (await page.locator("#tb-count").innerText()) === "1",
    "compteur de la barre",
  );
  check(
    (await page
      .locator('#dock-items .dock-item[data-key="native:approvals"] .dock-badge')
      .innerText()) === "1",
    "pastille d'approbation sur l'entrée du dock",
  );
  check(
    (await page.locator('#dock-items .dock-item[data-key="chat:m1"] .dock-badge').innerText()) ===
      "1",
    "pastille sur la mission concernée",
  );
  check(approvalsOf().length === 0, "aucun approve sans clic");
  await page.locator("#tb-count").click();
  check(
    await win("native:approvals").isVisible(),
    "clic sur le compteur : fenêtre Approbations devant",
  );
  approvals = [];
  pushApprovals();

  check(
    violations.length === 0,
    `zéro violation CSP (bureau) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

const item1 = () => ({
  frame: "m1",
  toolUseId: "w1",
  tool: "Bash",
  summary: "nmap -sV 10.0.0.9",
  canRemember: true,
  confirming: false,
});

/** Budget d'iframes : 8 au bureau, 3 au téléphone ; jamais une fenêtre visible. */
async function budgetScenario(name, viewport, budget) {
  console.log(`\n== ${name} : veille des iframes (budget ${budget})`);
  const { context, page, violations, win, openHash } = await openSession(name, viewport);
  const phone = viewport.width < 720;
  const ids = Array.from({ length: budget + 2 }, (_, i) => `b${i + 1}`);
  for (const id of ids) {
    await openHash(`#w=mission:${id}`);
    await until(
      () =>
        page
          .locator(`.wm-win[data-key="chat:${id}"]`)
          .count()
          .then((n) => n === 1),
      `fenêtre ${id}`,
    );
  }
  await sleep(400);
  const live = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("iframe.view-frame")].filter(
          (f) => !f.src.startsWith("about:blank"),
        ).length,
    );
  const asleep = (id) => win(`chat:${id}`).locator("iframe").getAttribute("src");
  if (phone) {
    // Pile : une seule fenêtre visible ; les autres vivent dans le budget.
    check((await visibleKeys(page)).length === 1, "mode pile : une seule fenêtre visible");
    check(
      (await live()) <= budget,
      `mode pile : au plus ${budget} iframes vivantes (${await live()})`,
    );
    check((await asleep(ids[0])) === "about:blank", "mode pile : la plus ancienne est déchargée");
    check(
      !(await asleep(ids.at(-1))).startsWith("about:blank"),
      "mode pile : la visible n'est jamais déchargée",
    );
  } else {
    check(
      (await visibleKeys(page)).length === ids.length + 1,
      "toutes les fenêtres visibles au bureau",
    );
    check((await live()) === ids.length, "aucune iframe visible déchargée, même au-delà du budget");
    // Minimiser toutes sauf la dernière : on revient au budget, la plus ancienne minimisée part d'abord.
    for (const id of ids.slice(0, -1)) {
      await win(`chat:${id}`)
        .locator(".wm-min")
        .evaluate((e) => e.click());
    }
    await sleep(300);
    check((await live()) === budget, `au bureau : ${budget} iframes vivantes (${await live()})`);
    check((await asleep(ids[0])) === "about:blank", "la minimisée la moins récente est déchargée");
    check((await asleep(ids[1])) === "about:blank", "la suivante aussi");
    check(!(await asleep(ids[2])).startsWith("about:blank"), "les plus récentes restent vivantes");
    check(
      await page
        .locator(`#dock-items .dock-item[data-key="chat:${ids[0]}"]`)
        .evaluate((e) => e.classList.contains("is-sleep")),
      "le dock signale la fenêtre en veille",
    );
  }
  // Restauration d'une déchargée : la page se recharge et renvoie `ready`.
  const readies = () =>
    received.filter((e) => e.view === "chat" && e.frame === ids[0] && e.msg.type === "ready")
      .length;
  const n0 = readies();
  await page.locator(`#dock-items .dock-item[data-key="chat:${ids[0]}"]`).click();
  await until(
    async () => (await asleep(ids[0])).includes(`/view/chat?frame=${ids[0]}`),
    "la déchargée est rechargée à la restauration",
  );
  await until(() => readies() > n0, "la page restaurée renvoie ready");
  check(await win(`chat:${ids[0]}`).isVisible(), "la restaurée est visible");
  check(
    violations.length === 0,
    `zéro violation CSP (veille) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

async function phoneScenario(name, viewport) {
  console.log(`\n== ${name} : mode pile (${viewport.width}x${viewport.height})`);
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport);
  check(await page.evaluate(() => document.body.classList.contains("is-phone")), "mode pile actif");
  await openHash("#w=mission:m1");
  await until(() => win("chat:m1").isVisible(), "mission en plein écran");
  await openHash("#w=monitor:r1");
  await until(() => win("viewer:r1").isVisible(), "monitor en plein écran");
  await openHash("#w=conteneurs");
  await until(() => win("native:containers").isVisible(), "natif en plein écran");
  const keys = await visibleKeys(page);
  check(keys.length === 1 && keys[0] === "native:containers", "une seule fenêtre à la fois");
  const d = await page.locator("#desktop").boundingBox();
  const w = await win("native:containers").boundingBox();
  check(near(w.width, d.width) && near(w.height, d.height), "la fenêtre remplit le bureau");
  check((await page.locator("#dock-items .dock-item").count()) === 4, "quatre onglets");
  const dock = await page.locator("#dock").boundingBox();
  check(dock.y + dock.height >= viewport.height - 1, "onglets en bas de l'écran");
  const tabH = await page.locator("#dock-items .dock-item").first().boundingBox();
  check(tabH.height >= 44, "onglets d'au moins 44 px");
  check(
    await win("native:containers").locator(".wm-min").isHidden(),
    "pas de minimisation au téléphone",
  );
  check(
    await win("native:containers").locator(".wm-grip-se").isHidden(),
    "pas de redimensionnement au téléphone",
  );
  // Pas de déplacement.
  const t = await win("native:containers").locator(".wm-title").boundingBox();
  await page.mouse.move(t.x + 20, t.y + 15);
  await page.mouse.down();
  await page.mouse.move(t.x + 120, t.y + 200, { steps: 5 });
  await page.mouse.up();
  const still = await win("native:containers").boundingBox();
  check(near(still.x, w.x) && near(still.y, w.y), "le glisser ne déplace rien au téléphone");
  // Onglet : bascule.
  await page.locator('#dock-items .dock-item[data-key="chat:m1"]').click();
  await until(() => win("chat:m1").isVisible(), "onglet : la mission passe devant");
  check((await visibleKeys(page)).length === 1, "toujours une seule fenêtre visible après bascule");
  await shot("8-pile");
  // Feuille d'approbation au-dessus de la fenêtre active ; la barre fixe reste libre.
  approvals = [item1()];
  pushApprovals();
  await until(() => page.locator("#sheet").isVisible(), "feuille d'approbation");
  const sheet = await page.locator("#sheet").boundingBox();
  const bar = await page.locator("#topbar").boundingBox();
  check(sheet.y >= bar.y + bar.height - 1, "la feuille ne couvre pas la barre fixe");
  await shot("9-pile-feuille");
  await page.click("#sheet-open");
  await until(
    () => win("native:approvals").isVisible(),
    "« Ouvrir la file » : fenêtre Approbations devant",
  );
  check(await page.locator("#sheet").isHidden(), "feuille refermée");
  approvals = [];
  pushApprovals();
  check(
    violations.length === 0,
    `zéro violation CSP (pile) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

/** Espaces de travail, raccourcis et palette (bureau 1440x900, puis téléphone). */
async function spacesScenario(name, viewport) {
  console.log(`\n== ${name} : espaces, raccourcis, palette (${viewport.width}x${viewport.height})`);
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport);
  const keys = () => visibleKeys(page);
  const palette = page.locator("#palette");
  const typeInPalette = async (text) => {
    await page.keyboard.type(text);
    await sleep(60);
  };
  const layoutSaves = (n) =>
    received.filter((e) => e.view === "shell" && e.msg.type === "layoutSave" && e.msg.name === n);
  const sentType = (t) => received.some((e) => e.view === "shell" && e.msg.type === t);
  const forbidden = () =>
    received.filter(
      (e) => e.view === "shell" && ["approve", "setBypass", "accountReveal"].includes(e.msg.type),
    );

  await until(async () => (await keys()).includes("native:approvals"), "approbations ouvertes");
  await openHash("#w=mission:m1");
  await until(() => win("chat:m1").isVisible(), "mission m1");
  await openHash("#w=monitor:r1");
  await until(() => win("viewer:r1").isVisible(), "monitor r1");

  // Palette : Ctrl+K l'ouvre, la saisie filtre, Échap la ferme.
  await page.keyboard.press("Control+k");
  await until(() => palette.isVisible(), "palette ouverte par Ctrl+K");
  check(
    await page.locator("#palette-input").evaluate((n) => n === document.activeElement),
    "focus dans la palette",
  );
  await typeInPalette("mis");
  const first = await page.locator(".pal-item.is-active .pal-title").innerText();
  check(/mission/i.test(first), `meilleure correspondance de « mis » : ${first}`);
  await shot("1-palette");
  const anim = await page
    .locator(".palette-box")
    .evaluate((n) => getComputedStyle(n).animationDuration);
  check(Number.parseFloat(anim) <= 0.15, `animation de la palette ≤ 150 ms (${anim})`);
  await page.keyboard.press("Escape");
  await until(async () => !(await palette.isVisible()), "palette fermée par Échap");

  // Raccourcis : moitié droite, puis moitié gauche pour l'autre fenêtre.
  await win("chat:m1").locator(".wm-title").click();
  await page.keyboard.press("Control+Alt+ArrowRight");
  await sleep(250);
  const d = await page.locator("#desktop").boundingBox();
  const m1 = await win("chat:m1").boundingBox();
  check(Math.abs(m1.x - (d.x + Math.round(d.width / 2))) <= 1, "Ctrl+Alt+→ : moitié droite");
  await win("viewer:r1").locator(".wm-title").click();
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await sleep(250);
  const r1 = await win("viewer:r1").boundingBox();
  check(
    Math.abs(r1.x - d.x) <= 1 && Math.abs(r1.width - Math.round(d.width / 2)) <= 1,
    "Ctrl+Alt+← : moitié gauche",
  );

  // Enregistrer l'espace « Recon » par la palette.
  await page.keyboard.press("Control+k");
  await typeInPalette("enregistrer sous");
  await page.keyboard.press("Enter");
  await typeInPalette("Recon");
  await page.keyboard.press("Enter");
  await until(() => layoutSaves("Recon").length === 1, "layoutSave « Recon » envoyé");
  const recon = layoutSaves("Recon")[0].msg.layout;
  check(
    recon.windows.some((w) => w.id === "m1" && w.view === "chat" && w.w === 0.5 && w.x === 0.5),
    "« Recon » contient m1 à droite",
  );
  check(
    recon.windows.some((w) => w.id === "r1" && w.view === "viewer"),
    "« Recon » contient r1",
  );
  await until(
    async () => (await page.locator("#dock-space .dock-space-name").innerText()) === "Recon",
    "le dock affiche l'espace Recon",
  );

  // Une autre disposition, puis retour à Recon par Ctrl+Alt+1.
  await openHash("#w=conteneurs");
  await until(() => win("native:containers").isVisible(), "conteneurs ouverts");
  await win("chat:m1").locator(".wm-title").dblclick();
  await sleep(250);
  await page.keyboard.press("Control+Alt+1");
  await until(
    async () => !(await keys()).includes("native:containers"),
    "Ctrl+Alt+1 : conteneurs fermés",
  );
  await sleep(250);
  const back = await win("chat:m1").boundingBox();
  check(
    Math.abs(back.width - Math.round(d.width / 2)) <= 1,
    "Ctrl+Alt+1 : géométrie de Recon rétablie",
  );

  // La disposition courante est enregistrée environ 1 s après le dernier changement.
  const before = layoutSaves(null).length;
  await until(
    () => layoutSaves(null).length > before,
    "enregistrement de la disposition courante",
    4000,
  );
  await sleep(1300);
  check(layoutRejected === 0, "le schéma serveur accepte toutes les dispositions envoyées");
  const lastCurrent = layoutSaves(null).at(-1).msg.layout;
  check(lastCurrent.spaces[0].name === "Recon", "la disposition courante porte le nom Recon");

  // Rechargement : « Recon » est restaurée depuis le serveur.
  // Le lien profond (#w=conteneurs) rouvrirait Conteneurs : on le retire avant de recharger.
  await page.evaluate(() => history.replaceState(null, "", "/"));
  await page.reload();
  await until(
    async () => (await page.locator("#tb-conn").innerText()) === "Connecté",
    "reconnexion",
  );
  await until(async () => (await keys()).includes("chat:m1"), "après rechargement : m1 restaurée");
  const after = await keys();
  check(
    after.includes("viewer:r1") && !after.includes("native:containers"),
    "après rechargement : espace Recon restauré",
  );
  await sleep(300);
  const restored = await win("chat:m1").boundingBox();
  check(
    Math.abs(restored.x - (d.x + Math.round(d.width / 2))) <= 1,
    "après rechargement : géométrie restaurée",
  );
  check(
    (await page.locator("#dock-space .dock-space-name").innerText()) === "Recon",
    "après rechargement : le dock affiche Recon",
  );
  await shot("2-recon-restauree");

  // Sélecteur d'espaces du dock.
  await page.locator("#dock-space").click();
  check(await page.locator("#dock-space-menu").isVisible(), "menu des espaces ouvert");
  check(
    (await page.locator(".dock-space-item").count()) === 1,
    "un espace enregistré dans le menu",
  );
  await page.keyboard.press("Escape");

  // Arrêt d'urgence par la palette (le même message que le bouton).
  await page.keyboard.press("Control+Shift+k");
  await typeInPalette("arret d'urgence");
  await page.keyboard.press("Enter");
  await until(() => sentType("halt"), "halt envoyé par la palette");

  // Suppression avec confirmation.
  await page.keyboard.press("Control+k");
  await typeInPalette("supprimer recon");
  await page.keyboard.press("Enter");
  await sleep(80);
  check(!sentType("layoutDelete"), "suppression : rien n'est envoyé avant la confirmation");
  await page.keyboard.press("Enter");
  await until(() => sentType("layoutDelete"), "layoutDelete envoyé");
  await until(async () => (await page.locator(".dock-space-item").count()) === 0, "espace retiré");

  check(forbidden().length === 0, "aucun approve / setBypass / accountReveal émis");
  check(violations.length === 0, `zéro violation CSP (${violations.slice(0, 3).join(" | ")})`);
  await context.close();

  // Téléphone : la disposition enregistrée n'est pas appliquée ni modifiée.
  console.log(`\n== ${name} : téléphone`);
  layouts.current = lastCurrent;
  const saved = JSON.stringify(layouts.current);
  const phone = await openSession(
    `${name}-phone`,
    { width: 375, height: 812 },
    { keepLayouts: true },
  );
  await sleep(400);
  check(
    JSON.stringify(await visibleKeys(phone.page)) === JSON.stringify(["native:approvals"]),
    "téléphone : disposition enregistrée non appliquée",
  );
  await phone.openHash("#w=mission:m7");
  await sleep(1600);
  check(
    !received.some((e) => e.view === "shell" && e.msg.type === "layoutSave"),
    "téléphone : aucune disposition enregistrée",
  );
  check(JSON.stringify(layouts.current) === saved, "téléphone : disposition serveur inchangée");
  await phone.context.close();
}

// ───────────────────────────── Écrans natifs (lot 4) ─────────────────────────────

const sentOf = (type) => received.filter((e) => e.view === "shell" && e.msg.type === type);

/** Conteneurs, Fournisseurs, Comptes de test, Trouvailles, Journal, Réglages (bureau 1440x900). */
async function screensScenario(name, viewport) {
  console.log(`\n== ${name} : écrans natifs (${viewport.width}x${viewport.height})`);
  resetScreens();
  // Permission de notification : on compte les demandes (rien ne doit partir avant un clic).
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport, {
    init: () => {
      window.__permissionAsked = 0;
      if (typeof Notification !== "undefined") {
        Object.defineProperty(Notification, "permission", { get: () => "default" });
        Notification.requestPermission = async () => {
          window.__permissionAsked += 1;
          return "default";
        };
      }
    },
  });
  let dialogs = 0;
  page.on("dialog", async (d) => {
    dialogs += 1;
    await d.dismiss();
  });
  const openScreen = async (hash, key) => {
    await openHash(hash);
    await until(() => win(key).isVisible(), `fenêtre ${key}`);
    await win(key)
      .locator(".wm-title")
      .dblclick({ position: { x: 60, y: 15 } });
    await sleep(220);
  };
  const closeScreen = async (key) => {
    await win(key).locator(".wm-close").click();
  };
  const inWin = (key, selector, options) => win(key).locator(selector, options);
  const textOf = (key, selector, options) => inWin(key, selector, options).innerText();

  // ── Conteneurs ──
  await openScreen("#w=conteneurs", "native:containers");
  await until(
    async () => (await inWin("native:containers", "tbody tr").count()) === 3,
    "trois conteneurs listés",
  );
  check(
    (await textOf("native:containers", "tbody tr:nth-child(1)")).includes("en cours"),
    "badge d'état « en cours »",
  );
  check(
    (await textOf("native:containers", "tbody tr:nth-child(2)")).includes("arrêté"),
    "badge d'état « arrêté »",
  );
  check(sentOf("containerStart").length === 0, "aucun démarrage sans clic");
  await shot("conteneurs");
  await inWin("native:containers", "tbody tr:nth-child(2) button").click();
  await until(() => sentOf("containerStart").length === 1, "containerStart envoyé");
  check(sentOf("containerStart")[0].msg.id === "c2", "containerStart vise le bon conteneur");
  await until(
    async () => (await textOf("native:containers", "tbody tr:nth-child(2)")).includes("en cours"),
    "état mis à jour par la diffusion",
  );
  await inWin("native:containers", "input").fill("-mauvais nom");
  await inWin("native:containers", "button", { hasText: "Créer un Kali" }).click();
  check(sentOf("containerCreate").length === 0, "nom invalide : rien n'est envoyé");
  await inWin("native:containers", "input").fill("kali-recon");
  await inWin("native:containers", "button", { hasText: "Créer un Kali" }).click();
  await until(
    async () => (await textOf("native:containers", ".scr-status")).includes("porte déjà ce nom"),
    "refus affiché avec son libellé (container.exists)",
  );
  await closeScreen("native:containers");

  // ── Fournisseurs ──
  await openScreen("#w=fournisseurs", "native:providers");
  await until(
    async () => (await inWin("native:providers", ".scr-key").count()) === 2,
    "deux clés dans la réserve Claude",
  );
  check(
    (await textOf("native:providers", ".scr-key.is-active")).includes("Secours équipe"),
    "clé active signalée",
  );
  const secretInputs = await page
    .locator("#desktop input[type=password]")
    .evaluateAll((els) => els.map((e) => [e.autocomplete, e.type]));
  check(
    secretInputs.length >= 3 && secretInputs.every(([a, t]) => a === "off" && t === "password"),
    "champs de clé : type=password, autocomplete=off",
  );
  const KEY_VALUE = "sk-ant-factice-12345";
  const claudePool = inWin("native:providers", '.scr-pool[data-provider="claude"]');
  await claudePool.locator('input[type="text"]').fill("Dépannage");
  await claudePool.locator("input[type=password]").fill(KEY_VALUE);
  await claudePool.locator("button", { hasText: "Ajouter à la réserve" }).click();
  await until(() => sentOf("poolAdd").length === 1, "poolAdd envoyé");
  check(
    sentOf("poolAdd")[0].msg.value === KEY_VALUE,
    "poolAdd transporte la clé (vers le serveur seulement)",
  );
  check(
    (await claudePool.locator("input[type=password]").inputValue()) === "",
    "champ de clé vidé après l'envoi",
  );
  await until(
    async () => (await inWin("native:providers", ".scr-key").count()) === 3,
    "clé ajoutée dans la liste",
  );
  check(
    !(await page.content()).includes(KEY_VALUE),
    "la valeur de la clé n'est nulle part dans le DOM",
  );
  check(
    await page.evaluate(
      (v) => !JSON.stringify([{ ...localStorage }, { ...sessionStorage }]).includes(v),
      KEY_VALUE,
    ),
    "la clé n'est ni en localStorage ni en sessionStorage",
  );
  // Réordonner et activer : un clic = un message.
  await claudePool.locator(".scr-key").nth(1).locator("button", { hasText: "Monter" }).click();
  await until(() => sentOf("poolReorder").length === 1, "poolReorder envoyé");
  check(
    sentOf("poolReorder")[0].msg.order[0] === KEY_TWO,
    "nouvel ordre : la clé montée passe en tête",
  );
  const spare = claudePool.locator(".scr-key", { hasText: "Dépannage" });
  await spare.locator("button", { hasText: "Activer" }).click();
  await until(() => sentOf("poolActivate").length === 1, "poolActivate envoyé");
  // Retrait confirmé.
  await spare.locator(".scr-confirm > .scr-btn-danger").click();
  check(sentOf("poolRemove").length === 0, "retrait : rien n'est envoyé avant la confirmation");
  await spare.locator(".scr-confirm-box .scr-btn-primary").click();
  await until(() => sentOf("poolRemove").length === 1, "poolRemove envoyé après confirmation");
  // Bascule automatique : fil et notification non bloquante.
  shellAll({
    type: "poolEvent",
    provider: "claude",
    from: "Principale",
    to: "Secours équipe",
    reason: "quota",
    phase: "switched",
  });
  shellAll({
    type: "poolEvent",
    provider: "claude",
    from: "Principale",
    to: "Secours équipe",
    reason: "quota",
    phase: "confirmed",
  });
  shellAll({ type: "poolExhausted", provider: "openai", nextRetryAt: Date.now() + 7200000 });
  await until(
    async () => (await inWin("native:providers", ".scr-feed-item").count()) === 2,
    "fil des bascules : deux événements",
  );
  check(
    (await inWin("native:providers", ".scr-feed-item").first().innerText()).includes("confirmée"),
    "le plus récent en premier",
  );
  await until(
    async () => (await page.locator("#toasts .toast").count()) >= 2,
    "notifications non bloquantes",
  );
  check(
    (await page.locator("#toasts .toast").last().innerText()).includes("épuisée"),
    "notification d'épuisement de la réserve",
  );
  check(
    await page.evaluate(() => !document.activeElement?.closest("#toasts")),
    "une notification ne prend pas le focus",
  );
  await shot("fournisseurs");
  await closeScreen("native:providers");

  // ── Comptes de test ──
  await openScreen("#w=comptes", "native:accounts");
  await until(
    async () => (await inWin("native:accounts", "tbody tr").count()) === 2,
    "deux comptes listés",
  );
  check(
    (await inWin("native:accounts", "tbody tr:nth-child(2) .scr-badge").first().innerText()) ===
      "agent",
    "badge « agent » pour un compte créé par l'agent",
  );
  check(
    (await textOf("native:accounts", "tbody tr:nth-child(1)")).includes("alice@example.test"),
    "identifiant de connexion en clair",
  );
  check(!(await page.content()).includes(SECRET_PW), "mot de passe absent du DOM avant révélation");
  check(sentOf("accountReveal").length === 0, "aucune révélation sans clic");
  await inWin("native:accounts", "tbody tr:nth-child(1)")
    .locator("button", { hasText: "Révéler" })
    .click();
  await until(() => sentOf("accountReveal").length === 1, "accountReveal envoyé");
  await until(
    async () => (await page.content()).includes(SECRET_PW),
    "mot de passe affiché après révélation",
  );
  const revealedAt = Date.now();
  await shot("comptes");
  check(
    await page.evaluate(
      (v) => !JSON.stringify([{ ...localStorage }, { ...sessionStorage }]).includes(v),
      SECRET_PW,
    ),
    "le mot de passe n'est pas en stockage du navigateur",
  );
  // Ajout : champ vidé, mot de passe jamais dans la page.
  const addForm = inWin("native:accounts", ".scr-section .scr-form");
  await addForm.locator('input[type="text"]').nth(0).fill("Acme");
  await addForm.locator('input[type="text"]').nth(1).fill("USER_B");
  await addForm.locator('input[type="text"]').nth(2).fill("bob@example.test");
  await addForm.locator("input[type=password]").fill("nouveau-pw-factice");
  await addForm.locator("button", { hasText: "Ajouter" }).click();
  await until(() => sentOf("accountAdd").length === 1, "accountAdd envoyé");
  check(
    (await addForm.locator("input[type=password]").inputValue()) === "",
    "mot de passe vidé du formulaire après l'envoi",
  );
  await until(
    async () => (await inWin("native:accounts", "tbody tr").count()) === 3,
    "compte ajouté dans la liste",
  );
  check(
    !(await page.content()).includes("nouveau-pw-factice"),
    "le mot de passe saisi n'est pas dans le DOM",
  );
  // Retrait confirmé.
  const row3 = inWin("native:accounts", "tbody tr", { hasText: "USER_B" });
  await row3.locator(".scr-confirm > .scr-btn-danger").click();
  check(sentOf("accountRemove").length === 0, "retrait de compte : rien avant la confirmation");
  await row3.locator(".scr-confirm-box .scr-btn-primary").click();
  await until(
    () => sentOf("accountRemove").length === 1,
    "accountRemove envoyé après confirmation",
  );
  // 30 s : la valeur est effacée du DOM.
  const wait = 30500 - (Date.now() - revealedAt);
  if (wait > 0) await sleep(wait);
  check(
    !(await page.content()).includes(SECRET_PW),
    "mot de passe effacé du DOM après 30 secondes",
  );
  await closeScreen("native:accounts");

  // ── Trouvailles ──
  await openScreen("#w=trouvailles", "native:findings");
  await until(
    async () => (await inWin("native:findings", "tbody tr").count()) === 3,
    "trois trouvailles",
  );
  check(
    !(await textOf("native:findings", "table")).toLowerCase().includes("gravité"),
    "aucune gravité inventée",
  );
  check(await inWin("native:findings", "select").isVisible(), "filtre par projet");
  await inWin("native:findings", "tbody tr:nth-child(1)").click();
  await until(() => sentOf("findingGet").length === 1, "findingGet envoyé");
  await until(
    async () => (await inWin("native:findings", ".scr-pre").count()) === 1,
    "preuve affichée",
  );
  check(
    (await textOf("native:findings", ".scr-pre")).includes("<img src=x"),
    "preuve en texte brut (balises visibles, non interprétées)",
  );
  check(
    (await inWin("native:findings", ".scr-pre img").count()) === 0,
    "aucun élément HTML créé depuis une preuve",
  );
  check(!(await page.evaluate(() => window.__xss)), "aucun script exécuté depuis une preuve");
  check(
    (await textOf("native:findings", ".scr-evidence")).includes("tronquée"),
    "preuve marquée tronquée",
  );
  await shot("trouvailles");
  check(
    (await inWin("native:findings", ".scr-detail a[download]").getAttribute("href")) ===
      `/api/report?project=${PROJECT}&locale=fr`,
    "lien d'export du rapport (route serveur)",
  );
  await inWin("native:findings", ".scr-detail button", {
    hasText: "Supprimer la trouvaille",
  }).click();
  check(sentOf("findingDelete").length === 0, "suppression : rien avant la confirmation");
  await inWin("native:findings", ".scr-detail .scr-confirm-box .scr-btn-primary").click();
  await until(() => sentOf("findingDelete").length === 1, "findingDelete envoyé");
  check(sentOf("findingDelete")[0].msg.confirmed === true, "findingDelete porte confirmed: true");
  await until(
    async () => (await inWin("native:findings", "tbody tr").count()) === 2,
    "la trouvaille supprimée disparaît",
  );
  await inWin("native:findings", "select").selectOption(PROJECT);
  await until(
    () => sentOf("findingsList").some((e) => e.msg.project === PROJECT),
    "filtre : findingsList avec le projet",
  );
  check(
    await inWin("native:findings", ".scr-toolbar a[download]").isVisible(),
    "export proposé pour le projet choisi",
  );
  await closeScreen("native:findings");

  // ── Journal ──
  await openScreen("#w=journal", "native:journal");
  await until(
    async () => (await inWin("native:journal", ".scr-run").count()) === 2,
    "Journal : deux runs listés par le serveur",
  );
  check(
    (await inWin("native:journal", ".scr-feed-item").count()) >= 2,
    "événements de la session (bascules de clés)",
  );
  await shot("journal");
  await inWin("native:journal", "input").fill("run bad");
  await inWin("native:journal", ".scr-form button", { hasText: "Ouvrir le Monitor" }).click();
  check(
    (await page.locator(".wm-win[data-key^='viewer:']").count()) === 0,
    "identifiant refusé : aucune fenêtre",
  );
  await inWin("native:journal", "input").fill("r42");
  await inWin("native:journal", ".scr-form button", { hasText: "Ouvrir le Monitor" }).click();
  await until(
    async () => (await page.locator('.wm-win[data-key="viewer:r42"]').count()) === 1,
    "Monitor du run ouvert",
  );
  await shot("journal-monitor");
  await closeScreen("viewer:r42");
  await closeScreen("native:journal");

  // ── Réglages ──
  await openScreen("#w=reglages", "native:settings");
  check(sentOf("setBypass").length === 0, "aucun Bypass sans action explicite");
  check(
    (await inWin("native:settings", "select").first().inputValue()) === "",
    "durée par défaut : illimité",
  );
  check(
    (await inWin("native:settings", "select").first().locator("option").allInnerTexts()).join(
      "|",
    ) === "Illimité|1 heure|8 heures|24 heures|48 heures",
    "durées proposées",
  );
  check(
    (await inWin("native:settings", ".scr-state").first().innerText()).includes("désactivé"),
    "Bypass désactivé affiché",
  );
  await inWin("native:settings", "button", { hasText: "Activer le Bypass…" }).click();
  check(sentOf("setBypass").length === 0, "la demande de confirmation n'active rien");
  check(
    (await textOf("native:settings", ".scr-warning")).includes("responsable"),
    "la confirmation rappelle que l'utilisateur devient responsable",
  );
  await shot("reglages");
  await inWin("native:settings", ".scr-warning button", { hasText: "Activer le Bypass" }).click();
  await until(() => sentOf("setBypass").length === 1, "setBypass envoyé après confirmation");
  check(
    sentOf("setBypass")[0].msg.durationMinutes === null &&
      sentOf("setBypass")[0].msg.active === true,
    "Bypass illimité par défaut",
  );
  await until(
    async () => (await page.locator("#tb-bypass").innerText()) === "Bypass illimité",
    "badge de la barre : Bypass illimité",
  );
  await until(
    () => inWin("native:settings", "button", { hasText: "Désactiver le Bypass" }).isVisible(),
    "bouton de désactivation",
  );
  await inWin("native:settings", "button", { hasText: "Désactiver le Bypass" }).click();
  await until(() => sentOf("setBypass").length === 2, "désactivation en un clic");
  check(sentOf("setBypass")[1].msg.active === false, "setBypass active:false");
  // Notifications : permission demandée seulement sur clic.
  check(
    (await page.evaluate(() => window.__permissionAsked)) === 0,
    "aucune permission de notification demandée avant le clic",
  );
  await inWin("native:settings", "button", { hasText: "Autoriser les notifications" }).click();
  await until(
    async () => (await page.evaluate(() => window.__permissionAsked)) === 1,
    "permission demandée au clic",
  );
  // Moteur.
  await inWin("native:settings", ".scr-form", { hasText: "Profil" })
    .locator("select")
    .selectOption("htb");
  await inWin("native:settings", "button", { hasText: "Enregistrer" }).click();
  await until(() => sentOf("settingsSet").length === 1, "settingsSet envoyé");
  check(
    JSON.stringify(sentOf("settingsSet")[0].msg.patch) === JSON.stringify({ profile: "htb" }),
    "patch : seulement ce qui change",
  );
  check(sentOf("approve").length === 0, "aucune approbation envoyée par ces écrans");
  check(dialogs === 0, "aucune boîte de dialogue native");
  check(
    violations.length === 0,
    `zéro violation CSP (écrans) (${violations.slice(0, 3).join(" | ")})`,
  );
  // Déconnexion (en dernier : la session est révoquée).
  await inWin("native:settings", "button", { hasText: "Se déconnecter" }).click();
  await until(
    () => new URL(page.url()).pathname === "/login",
    "déconnexion : retour à la connexion",
  );
  await context.close();
}

/** Réglages au téléphone : Bypass activable à 375 px, rien de débordant. */
async function settingsPhoneScenario(name, viewport) {
  console.log(`\n== ${name} : Réglages au téléphone (${viewport.width}x${viewport.height})`);
  resetScreens();
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport);
  await openHash("#w=reglages");
  await until(() => win("native:settings").isVisible(), "Réglages en plein écran");
  const settings = win("native:settings");
  const ask = settings.locator("button", { hasText: "Activer le Bypass…" });
  await until(() => ask.isEnabled(), "bouton Bypass actif");
  check((await ask.boundingBox()).height >= 44, "bouton Bypass d'au moins 44 px");
  await ask.click();
  await shot("reglages-bypass");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check(!overflow, "aucun défilement horizontal de la page");
  check(sentOf("setBypass").length === 0, "téléphone : la demande de confirmation n'active rien");
  await settings.locator(".scr-warning button", { hasText: "Activer le Bypass" }).click();
  await until(() => sentOf("setBypass").length === 1, "setBypass envoyé depuis le téléphone");
  await until(
    async () => (await page.locator("#tb-bypass").innerText()) === "Bypass illimité",
    "badge Bypass illimité",
  );
  check(
    violations.length === 0,
    `zéro violation CSP (réglages téléphone) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

// ───────────────────────────── Terminal, palette et Journal (lot 5) ─────────────────────────────

const termsReceived = (type) => received.filter((e) => e.view === "term" && e.msg.type === type);

async function terminalScenario(name, viewport) {
  console.log(
    `\n== ${name} : terminaux xterm, palette, Journal (${viewport.width}x${viewport.height})`,
  );
  resetScreens();
  const { context, page, violations, win, shot } = await openSession(name, viewport);
  const terms = page.locator('.wm-win[data-type="terminal"]');
  const live = page.locator('.wm-win[data-type="terminal"] .term[data-state="live"]');
  /** Met une fenêtre au premier plan par le dock (les fenêtres se recouvrent en cascade). */
  const raise = async (key) => {
    if (await win(key).evaluate((n) => n.classList.contains("is-focused"))) return;
    await page.locator(`.dock-item[data-key="${key}"]`).click();
    await until(
      () => win(key).evaluate((n) => n.classList.contains("is-focused")),
      `fenêtre ${key} au premier plan`,
    );
  };

  // Ctrl+Alt+T ouvre un terminal ; chacun a sa session. Le choix ne propose que les conteneurs qui tournent.
  await page.keyboard.press("Control+Alt+KeyT");
  await until(async () => (await terms.count()) === 1, "premier terminal ouvert (Ctrl+Alt+T)");
  const pickButtons = terms.nth(0).locator(".term-choice");
  await until(async () => (await pickButtons.count()) === 1, "un seul conteneur ouvrable proposé");
  check(
    (await pickButtons.first().getAttribute("data-container")) === "kali-recon",
    "seul le conteneur en cours d'exécution est proposé",
  );
  check(
    (await terms.nth(0).locator(".term-banner").innerText()).includes("journalisée intégralement"),
    "bandeau « session journalisée intégralement »",
  );
  await pickButtons.first().click();
  await until(async () => (await live.count()) === 1, "première session en direct");
  const open1 = termsReceived("open")[0];
  check(
    open1?.msg.container === "kali-recon" &&
      Number.isInteger(open1.msg.cols) &&
      open1.msg.cols > 10 &&
      open1.msg.rows > 3 &&
      /^[A-Za-z0-9_-]{1,64}$/.test(open1.frame),
    "open : conteneur, taille mesurée, identifiant de session conforme",
  );
  check(
    (await terms.nth(0).locator(".wm-name").innerText()) === "kali-recon",
    "titre de la fenêtre = conteneur",
  );

  await page.keyboard.press("Control+Alt+KeyT");
  await until(async () => (await terms.count()) === 2, "second terminal (plusieurs instances)");
  await terms.nth(1).locator(".term-choice").first().click();
  await until(async () => (await live.count()) === 2, "seconde session en direct");
  const frames = [...new Set(termsReceived("open").map((e) => e.frame))];
  check(frames.length === 2, "deux sessions distinctes");

  // Moitiés : le premier à gauche, le second à droite.
  const key0 = await terms.nth(0).getAttribute("data-key");
  const key1 = await terms.nth(1).getAttribute("data-key");
  await raise(key0);
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await raise(key1);
  await page.keyboard.press("Control+Alt+ArrowRight");
  await sleep(500);
  const r0 = await win(key0).boundingBox();
  const r1 = await win(key1).boundingBox();
  check(
    near(r0.x + r0.width, r1.x, 3) && near(r0.height, r1.height, 3) && r0.width > 500,
    "deux terminaux côte à côte en moitiés",
  );
  await until(
    async () => termsReceived("resize").length >= 2,
    "resize émis au redimensionnement des fenêtres",
  );
  const lastResize = termsReceived("resize").at(-1);
  check(
    lastResize.msg.cols > 10 &&
      lastResize.msg.cols < open1.msg.cols + 200 &&
      lastResize.msg.rows > 3,
    "resize : colonnes et lignes mesurées",
  );

  // Écho : saisie au clavier dans le premier terminal.
  await terms.nth(0).locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("whoami");
  await page.keyboard.press("Enter");
  const rows0 = terms.nth(0).locator(".xterm-rows");
  await until(
    async () => (await rows0.innerText()).includes("whoami"),
    "écho de la saisie dans xterm",
  );
  const typed = termsReceived("input")
    .filter((e) => e.frame === open1.frame)
    .map((e) => e.msg.data)
    .join("");
  check(typed === "whoami\r", "input : octets saisis envoyés à la bonne session");
  const second = termsReceived("input").filter((e) => e.frame !== open1.frame);
  check(second.length === 0, "rien n'est envoyé à l'autre session");
  // Rendu réel : texte lisible et couleur du thème appliquée par la feuille constructible.
  const green = await terms
    .nth(0)
    .locator(".xterm-rows .xterm-fg-2")
    .first()
    .evaluate((n) => getComputedStyle(n).color);
  check(green === "rgb(95, 214, 138)", `couleur du thème appliquée sans <style> (${green})`);
  const truecolor = await terms
    .nth(0)
    .locator(".xterm-rows span", { hasText: "rouge24" })
    .first()
    .evaluate((n) => getComputedStyle(n).color);
  check(
    truecolor === "rgb(204, 28, 64)",
    `couleur 24 bits appliquée sans attribut style (${truecolor})`,
  );
  const styleTags = await page.evaluate(() => document.querySelectorAll("style").length);
  check(styleTags === 0, "aucun élément <style> dans la page");
  check(
    (await terms.nth(0).locator(".xterm-screen").boundingBox()).height > 100,
    "xterm rendu avec une taille réelle",
  );
  // Ctrl+K reste au shell quand le terminal a le focus ; Ctrl+Maj+K ouvre la palette.
  await page.keyboard.press("Control+KeyK");
  await sleep(150);
  check(await page.locator("#palette").isHidden(), "Ctrl+K laissé au terminal (palette fermée)");
  await shot("1-deux-terminaux");

  // Palette : mission, run et programme venus du serveur.
  await page.keyboard.press("Control+Shift+KeyK");
  await until(() => page.locator("#palette").isVisible(), "palette ouverte (Ctrl+Maj+K)");
  await page.fill("#palette-input", "Reconnaissance");
  await until(
    async () =>
      (await page.locator(".pal-item", { hasText: "Mission : Reconnaissance Acme" }).count()) === 1,
    "palette : la mission du serveur est listée",
  );
  check(
    (await page.locator(".pal-item .pal-detail", { hasText: "en cours" }).count()) === 1,
    "palette : état de la mission affiché",
  );
  await page.fill("#palette-input", "monitor");
  await until(
    async () => (await page.locator(".pal-item", { hasText: "Monitor r-t1" }).count()) === 1,
    "palette : le run est listé",
  );
  await page.fill("#palette-input", "Acme");
  await until(
    async () => (await page.locator(".pal-item", { hasText: "Programme : Acme" }).count()) === 1,
    "palette : le projet est listé",
  );
  await page.fill("#palette-input", "Reconnaissance");
  await page.keyboard.press("Enter");
  await until(
    async () => (await page.locator('.wm-win[data-key="chat:m1"]').count()) === 1,
    "palette : la mission s'ouvre",
  );
  await page.keyboard.press("Control+Shift+KeyK");
  await page.fill("#palette-input", "quart bas droit");
  await page.keyboard.press("Enter");
  await sleep(300);
  check(
    (await page
      .locator('.dock-item[data-key="chat:m1"] .dock-act[data-state="running"]')
      .count()) === 1,
    "dock : pastille « en cours » pour la mission",
  );
  broadcast("shell", "shell", { type: "missionState", id: "m1", state: "waiting" });
  await until(
    async () =>
      (await page
        .locator('.dock-item[data-key="chat:m1"] .dock-act[data-state="waiting"]')
        .count()) === 1,
    "dock : pastille « en attente » après missionState",
  );
  broadcast("shell", "shell", { type: "missionState", id: "m1", state: "idle" });
  await until(
    async () =>
      (await page.locator('.dock-item[data-key="chat:m1"] .dock-act:visible').count()) === 0,
    "dock : pastille retirée au repos",
  );
  broadcast("shell", "shell", { type: "missionState", id: "m1", state: "running" });
  await page.keyboard.press("Control+Shift+KeyK");
  await page.fill("#palette-input", "Monitor r-t1");
  await page.keyboard.press("Enter");
  await until(
    async () => (await page.locator('.wm-win[data-key="viewer:r-t1"]').count()) === 1,
    "palette : le run ouvre un Monitor",
  );
  await page.locator('.wm-win[data-key="viewer:r-t1"] .wm-close').click();

  // Arrêt d'urgence : bandeau dans chaque terminal, sessions conservées.
  broadcast("shell", "shell", { type: "halt", active: true, since: Date.now() });
  await until(
    async () =>
      (await page.locator('.wm-win[data-type="terminal"] .term-halt:visible').count()) === 2,
    "bandeau d'arrêt d'urgence dans chaque terminal",
  );
  check((await live.count()) === 2, "l'arrêt d'urgence ne coupe pas les terminaux");
  check(termsReceived("close").length === 0, "aucun close envoyé par l'arrêt d'urgence");
  await shot("2-terminaux-mission-arret");
  await win("chat:m1").locator(".wm-close").click();
  broadcast("shell", "shell", { type: "halt", active: false, since: null });
  await until(
    async () => (await page.locator(".term-halt:visible").count()) === 0,
    "bandeau retiré à la reprise",
  );

  // Fermeture : confirmation tant que la session est active, `close` seulement une fois confirmée.
  await raise(key0);
  await win(key0).locator(".wm-close").click();
  await until(() => win(key0).locator(".term-confirm").isVisible(), "confirmation de fermeture");
  check(termsReceived("close").length === 0, "aucun close avant confirmation");
  await win(key0).locator(".term-confirm button", { hasText: "Annuler" }).click();
  check((await win(key0).count()) === 1, "fermeture annulée : la fenêtre reste");
  await raise(key0);
  await win(key0).locator(".wm-close").click();
  await win(key0).locator(".term-confirm button", { hasText: "Fermer la session" }).click();
  await until(async () => (await win(key0).count()) === 0, "fenêtre fermée après confirmation");
  check(termsReceived("close").length === 1, "close envoyé une fois confirmé");
  check(termsReceived("close")[0].frame === open1.frame, "close vise la bonne session");

  // Reconnexion : la session survivante est réabonnée (`ready`), l'écran est rejoué.
  const readyBefore = termsReceived("ready").length;
  for (const ws of sockets) ws.terminate();
  await until(
    async () => termsReceived("ready").length > readyBefore,
    "ready renvoyé après coupure",
    12000,
  );
  await until(async () => (await live.count()) === 1, "session réabonnée en direct", 12000);
  check(
    (await win(key1).locator(".xterm-rows").innerText()).includes("root@kali"),
    "écran rejoué après la reconnexion",
  );
  // Session non conservée par le serveur : « session perdue, rouvrir ».
  termSessions.clear();
  for (const ws of sockets) ws.terminate();
  await until(
    async () => (await win(key1).locator(".term-over-text").count()) === 1,
    "session perdue détectée",
    16000,
  );
  check(
    (await win(key1).locator(".term-over-text").innerText()).includes("Session perdue, rouvrir"),
    "message « session perdue, rouvrir »",
  );
  await raise(key1);
  await win(key1).locator(".term-over button", { hasText: "Rouvrir" }).click();
  await until(
    () => win(key1).locator(".term-pick").isVisible(),
    "Rouvrir ramène au choix du conteneur",
  );
  await win(key1).locator(".term-choice").first().click();
  await until(async () => (await live.count()) === 1, "session rouverte");

  // Journal : runs (mission et terminal), taille, date, ouverture d'un Monitor ; fil d'audit.
  await page.evaluate(() => {
    location.hash = "#w=journal";
  });
  await until(() => win("native:journal").isVisible(), "Journal ouvert");
  await until(
    async () => (await win("native:journal").locator(".scr-run").count()) === 2,
    "Journal : deux runs",
  );
  const runsText = await win("native:journal").locator(".scr-run").allInnerTexts();
  check(
    runsText.some((t) => t.includes("terminal") && t.includes("3.0 Kio")) &&
      runsText.some((t) => t.includes("mission") && t.includes("20.0 Kio")),
    "Journal : type et taille des runs",
  );
  await until(
    async () =>
      (await win("native:journal")
        .locator(".scr-feed-item", { hasText: "terminal.open" })
        .count()) >= 1,
    "Journal : fil d'audit",
  );
  await raise("native:journal");
  await page.keyboard.press("Control+Alt+ArrowUp");
  await sleep(300);
  await shot("3-journal");
  await win("native:journal").locator('button[data-run="r-t1"]').click();
  await until(
    async () => (await page.locator('.wm-win[data-key="viewer:r-t1"]').count()) === 1,
    "Journal : ouvre le Monitor du run",
  );

  check(
    violations.length === 0,
    `zéro violation CSP (terminaux) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

async function terminalPhoneScenario(name, viewport) {
  console.log(`\n== ${name} : terminal en pile (${viewport.width}x${viewport.height})`);
  resetScreens();
  const { context, page, violations, win, shot } = await openSession(name, viewport);
  await page.locator("#dock-open").click();
  await page.locator("#dock-menu .dock-menu-item", { hasText: "Nouveau terminal" }).click();
  const terms = page.locator('.wm-win[data-type="terminal"]');
  await until(async () => (await terms.count()) === 1, "terminal ouvert depuis le dock");
  await terms.first().locator(".term-choice").first().click();
  await until(
    async () => (await page.locator(".term[data-state=live]").count()) === 1,
    "session en direct (téléphone)",
  );
  const box = await terms.first().boundingBox();
  check(box.width >= viewport.width - 2, "le terminal occupe toute la largeur (pile)");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check(!overflow, "aucun défilement horizontal de la page");
  const open = termsReceived("open")[0];
  check(
    open?.msg.cols >= 20 && open.msg.cols < 80,
    `colonnes adaptées à 375 px (${open?.msg.cols})`,
  );
  await shot("terminal-pile");
  check(
    violations.length === 0,
    `zéro violation CSP (terminal téléphone) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

/** Coquille : premier lancement, bureau vide, menu Ouvrir groupé, palette, liens profonds, accords Alt+J. */
async function shellScenario(name, viewport) {
  console.log(
    `\n== ${name} : coquille, discuter avec l'agent (${viewport.width}x${viewport.height})`,
  );
  const phone = viewport.width < 600;
  const { context, page, violations, win, openHash, shot } = await openSession(name, viewport, {
    firstLaunch: true,
  });
  const chatKeys = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.wm-win[data-type="mission"]')].map((w) => w.dataset.key),
    );
  const focused = (key) => win(key).evaluate((e) => e.classList.contains("is-focused"));
  const forbidden = () =>
    received.filter(
      (e) => e.view === "shell" && ["approve", "setBypass", "accountReveal"].includes(e.msg.type),
    );

  // Premier lancement : Mission et Approbations ouvertes, la mission au premier plan.
  await until(
    async () => (await chatKeys()).length === 1,
    "premier lancement : une mission ouverte",
  );
  const first = (await chatKeys())[0];
  check(/^chat:m-[0-9a-z]{6}$/.test(first), `identifiant généré m-<6 base36> (${first})`);
  check((await win("native:approvals").count()) === 1, "premier lancement : Approbations aussi");
  check(await focused(first), "la mission est au premier plan");
  check(
    (await page.locator(`.wm-win[data-key="${first}"] iframe`).getAttribute("src")) ===
      `/view/chat?frame=${first.slice(5)}`,
    "la fenêtre Mission héberge l'iframe chat du cadre généré",
  );

  // Pas de fournisseur : l'iframe demande `addProvider`, la coquille ouvre Fournisseurs.
  const chatFrame = page.frames().find((f) => f.url().includes("/view/chat"));
  await chatFrame.evaluate(() =>
    window.parent.postMessage({ rw: 1, msg: { type: "addProvider" } }, location.origin),
  );
  await until(
    () => win("native:providers").isVisible(),
    "addProvider : la fenêtre Fournisseurs s'ouvre",
  );
  await sleep(150);
  check(
    !received.some((e) => e.msg?.type === "addProvider"),
    "addProvider n'est pas transmis au serveur",
  );

  // Bureau vide (bureau seulement) : trois boutons directs.
  if (!phone) {
    await page.evaluate(() => {
      for (const b of document.querySelectorAll(".wm-win .wm-close")) b.click();
    });
    await until(
      async () => (await page.locator(".wm-win").count()) === 0,
      "toutes fenêtres fermées",
    );
    check(await page.locator(".wm-empty").isVisible(), "bureau vide : message affiché");
    const empties = await page.locator(".wm-empty-btn").allInnerTexts();
    check(
      empties.join("|") === "Nouvelle mission|Cockpit|Fournisseurs",
      `bureau vide : boutons (${empties.join(", ")})`,
    );
    await shot("1-bureau-vide");
    await page.locator('.wm-empty-btn[data-action="providers"]').click();
    await until(() => win("native:providers").isVisible(), "bouton Fournisseurs");
    await page.locator(".wm-win .wm-close").click();
    await page.locator('.wm-empty-btn[data-action="cockpit"]').click();
    await until(() => win("cockpit:main").isVisible(), "bouton Cockpit");
    await page.locator(".wm-win .wm-close").click();
    await page.locator('.wm-empty-btn[data-action="newMission"]').click();
    await until(async () => (await chatKeys()).length === 1, "bouton Nouvelle mission");
  }
  const initial = (await chatKeys())[0];

  // Menu Ouvrir : trois groupes lisibles.
  await page.click("#dock-open");
  check(await page.locator("#dock-menu").isVisible(), "menu Ouvrir affiché");
  const titles = await page.locator("#dock-menu .dock-menu-title").allTextContents();
  check(
    titles.join("|").toLowerCase() === "mission|outils|écrans",
    `groupes du menu : ${titles.join(", ")}`,
  );
  const labels = await page.locator("#dock-menu .dock-menu-item").allInnerTexts();
  for (const want of [
    "Nouvelle mission",
    "Kill chain",
    "Rapport",
    "Cockpit",
    "Sessions",
    "Projets et réglages",
    "Nouveau terminal",
    "Approbations",
    "Fournisseurs",
    "Réglages",
  ]) {
    check(
      labels.some((l) => l.startsWith(want)),
      `menu Ouvrir : « ${want} »`,
    );
  }
  const box = await page.locator("#dock-menu").boundingBox();
  check(
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.height > 100,
    "le menu tient dans la fenêtre",
  );
  if (phone) {
    const heights = await page
      .locator("#dock-menu .dock-menu-item")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check(
      heights.every((h) => h >= 44),
      "mode pile : entrées du menu d'au moins 44 px",
    );
    const dockBox = await page.locator("#dock").boundingBox();
    check(box.y + box.height <= dockBox.y + 1, "mode pile : le menu est au-dessus du dock");
    const topbar = await page.locator("#topbar").boundingBox();
    check(box.y >= topbar.y + topbar.height - 1, "mode pile : le menu ne couvre pas la barre fixe");
  }
  await shot("2-menu-ouvrir");
  await page.locator('#dock-menu .dock-menu-item[data-action="newMission"]').click();
  await until(
    async () => (await chatKeys()).length === 2,
    "Nouvelle mission (menu) : une seconde mission",
  );
  const second = (await chatKeys()).find((k) => k !== initial);
  check(await focused(second), "la nouvelle mission est focalisée");
  check(await page.locator("#dock-menu").isHidden(), "menu refermé après le choix");
  await shot("3-nouvelle-mission");

  // Outils et vues de la mission au premier plan.
  const id2 = second.slice(5);
  for (const [action, key] of [
    ["fixed:cockpit", "cockpit:main"],
    ["fixed:sessions", "sessions:main"],
    ["fixed:studio", "studio:main"],
    ["forMission:graph", `killchain:${id2}`],
    ["forMission:report", `viewer:${id2}`],
  ]) {
    // Les vues d'une mission visent la mission au premier plan : on la ramène devant.
    if (action.startsWith("forMission")) await openHash(`#w=mission:${id2}`);
    await page.click("#dock-open");
    await page.locator(`#dock-menu .dock-menu-item[data-action="${action}"]`).click();
    await until(() => win(key).isVisible(), `menu Ouvrir : ${key}`);
  }

  // Liens profonds.
  await openHash("#w=killchain:m9");
  await until(() => win("killchain:m9").isVisible(), "lien #w=killchain:m9");
  for (const [hash, key] of [
    ["#w=cockpit", "cockpit:main"],
    ["#w=studio", "studio:main"],
    ["#w=sessions", "sessions:main"],
  ]) {
    await openHash("#w=conteneurs");
    await openHash(hash);
    await until(() => focused(key), `lien ${hash} : fenêtre focalisée`);
  }

  // Palette : Nouvelle mission, puis Kill chain d'une mission ouverte.
  await page.keyboard.press("Control+Shift+k");
  await page.keyboard.type("nouvelle mission");
  await sleep(80);
  check(
    /Nouvelle mission/.test(await page.locator(".pal-item.is-active .pal-title").innerText()),
    "palette : « Nouvelle mission » en tête",
  );
  await page.keyboard.press("Enter");
  await until(async () => (await chatKeys()).length === 3, "palette : une troisième mission");
  await page.keyboard.press("Control+Shift+k");
  await page.keyboard.type(`kill chain : ${initial.slice(5)}`);
  await sleep(80);
  await page.keyboard.press("Enter");
  await until(
    () => win(`killchain:${initial.slice(5)}`).isVisible(),
    "palette : kill chain d'une mission ouverte",
  );

  // Accords Alt+J depuis la coquille.
  const count = async () => (await chatKeys()).length;
  await page.locator("#topbar").click({ position: { x: 300, y: 5 }, force: true });
  const before = await count();
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("n");
  await until(async () => (await count()) === before + 1, "Alt+J N : nouvelle mission");
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("k");
  await until(() => focused("cockpit:main"), "Alt+J K : cockpit");
  await openHash("#w=conteneurs");
  await until(() => focused("native:containers"), "Conteneurs au premier plan");
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("s");
  await until(() => focused("studio:main"), "Alt+J S : studio");
  // Alt+J puis une autre lettre : rien ne s'ouvre.
  const windowsBefore = await page.locator(".wm-win").count();
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("x");
  check((await page.locator(".wm-win").count()) === windowsBefore, "Alt+J X : rien ne s'ouvre");
  // Dans une iframe, le pont relaie l'accord.
  await openHash(`#w=mission:${id2}`);
  await until(() => focused(`chat:${id2}`), "mission au premier plan");
  const innerHandle = await win(`chat:${id2}`).locator("iframe").elementHandle();
  const inner = await innerHandle.contentFrame();
  await inner.locator("body").click({ position: { x: 10, y: 10 } });
  const before2 = await count();
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("n");
  await until(async () => (await count()) === before2 + 1, "Alt+J N depuis une iframe (pont)");
  const terms = () => page.locator('.wm-win[data-type="terminal"]').count();
  await page.keyboard.press("Alt+j");
  await page.keyboard.press("t");
  await until(async () => (await terms()) === 1, "Alt+J T : terminal");
  check(forbidden().length === 0, "aucun approve, Bypass ni révélation par raccourci ou palette");

  // Missions mémorisées dans l'espace de travail : restaurées au rechargement.
  if (!phone) {
    await until(
      () => layouts.current?.windows.filter((w) => w.view === "chat").length >= 4,
      "disposition courante enregistrée avec les missions",
      5000,
    );
    const saved = layouts.current.windows.filter((w) => w.view === "chat").map((w) => w.id);
    await page.reload();
    await until(async () => {
      const keys = await chatKeys();
      return saved.every((id) => keys.includes(`chat:${id}`));
    }, "après rechargement : les missions sont restaurées");
  }
  check(
    violations.length === 0,
    `zéro violation CSP (coquille) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

/** Dialogues du serveur (HostUi), `openWindow`, `download`, `settings` : vrai HostUi, aucun clic = aucune réponse. */
async function dialogScenario(name, viewport) {
  console.log(`\n== ${name} : dialogues du serveur (${viewport.width}x${viewport.height})`);
  const phone = viewport.width < 600;
  const { context, page, violations, win, shot } = await openSession(name, viewport);
  const results = () =>
    received.filter((e) => e.view === "shell" && e.msg.type === "dialogResult").map((e) => e.msg);
  const dlg = page.locator(".dlg-box");
  const open = (message) => until(() => dlg.isVisible(), message);
  const closed = (message) => until(async () => (await dlg.count()) === 0, message);
  /** Suit la résolution côté serveur : { done, value }. */
  const track = (promise) => {
    const r = { done: false, value: undefined };
    promise.then((value) => {
      r.done = true;
      r.value = value;
    });
    return r;
  };
  const activeClass = () => page.evaluate(() => document.activeElement?.className ?? "");
  const activeText = () => page.evaluate(() => document.activeElement?.textContent ?? "");

  // ── Choix simple : filtre, flèches, Entrée.
  const pick = track(
    hostUi.pick({
      title: "Choisir un projet",
      items: [
        { id: "a", label: "Alpha", detail: "premier projet" },
        { id: "b", label: "Beta" },
        { id: "g", label: "Gamma" },
      ],
    }),
  );
  await open("pick : dialogue affiché");
  check((await dlg.getAttribute("role")) === "dialog", "pick : rôle dialog");
  check((await dlg.getAttribute("aria-modal")) === "true", "pick : aria-modal");
  check(
    (await dlg.getAttribute("aria-labelledby")) !== null &&
      (await page.locator(".dlg-title").innerText()) === "Choisir un projet",
    "pick : titre relié au dialogue",
  );
  await sleep(300);
  check(results().length === 0, "pick : aucun dialogResult sans action humaine");
  check((await activeClass()).includes("dlg-filter"), "pick : focus sur le filtre");
  check(
    (await page.locator("#desktop").evaluate((e) => e.inert)) === true,
    "pick : le bureau derrière est inerte",
  );
  if (phone) {
    const box = await dlg.boundingBox();
    check(
      box.width >= viewport.width - 1 && box.height >= viewport.height - 1,
      "téléphone : feuille plein écran",
    );
    for (const b of await page.locator(".dlg-actions .dlg-btn").all()) {
      check((await b.boundingBox()).height >= 44, "téléphone : boutons d'au moins 44 px");
    }
  }
  await shot("1-pick");
  await page.keyboard.type("bet");
  check((await page.locator(".dlg-opt:visible").count()) === 1, "pick : le filtre réduit la liste");
  await page.keyboard.press("ArrowDown");
  check((await activeText()).includes("Beta"), "pick : flèche bas vers le premier résultat");
  await page.keyboard.press("Enter");
  await until(() => pick.done, "pick : réponse reçue par le serveur");
  check(pick.value === "b", `pick : valeur « b » (${pick.value})`);
  check(results().length === 1 && results()[0].value === "b", "pick : un seul dialogResult");
  await closed("pick : dialogue fermé après la réponse");

  // ── Choix multiple : cases, compteur.
  const multi = track(
    hostUi.pick({
      title: "Plusieurs",
      multi: true,
      items: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "g", label: "Gamma" },
      ],
    }),
  );
  await open("multi : dialogue affiché");
  const valider = page.locator(".dlg-actions .dlg-btn", { hasText: "Valider" });
  check(await valider.isDisabled(), "multi : Valider inactif sans sélection");
  await page.locator(".dlg-opt input").nth(0).check();
  await page.locator(".dlg-opt input").nth(2).check();
  check((await valider.innerText()) === "Valider (2)", "multi : compteur de sélection");
  await valider.click();
  await until(() => multi.done, "multi : réponse reçue");
  check(JSON.stringify(multi.value) === '["a","g"]', "multi : valeurs dans l'ordre de la liste");

  // ── Saisie secrète : champ masqué, vidé à l'envoi.
  const secret = track(hostUi.input({ title: "Clé d'API", label: "Clé d'API", secret: true }));
  await open("input : dialogue affiché");
  const field = page.locator(".dlg-box input.dlg-input");
  check((await field.getAttribute("type")) === "password", "input secret : type password");
  check(
    (await field.getAttribute("autocomplete")) !== "on",
    "input secret : autocomplete désactivé",
  );
  check(
    await page.locator(".dlg-box .dlg-btn.is-primary").isDisabled(),
    "input secret : vide = Valider inactif",
  );
  await field.fill("sk-secret-e2e-42");
  await field.press("Enter");
  await until(() => secret.done, "input : réponse reçue");
  check(secret.value === "sk-secret-e2e-42", "input secret : valeur transmise une fois");
  await closed("input : dialogue fermé");
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll("input")].every((i) => !i.value.includes("sk-secret")),
    ),
    "input secret : la valeur ne reste dans aucun champ",
  );
  check(!(await page.content()).includes("sk-secret-e2e-42"), "input secret : absente du DOM");

  // ── Confirmation dangereuse : focus sur Annuler, Entrée n'y confirme jamais.
  const danger1 = track(
    hostUi.confirm({
      title: "Supprimer le projet",
      text: "Cette suppression est définitive.\nLes preuves seront perdues.",
      danger: true,
    }),
  );
  await open("confirm danger : dialogue affiché");
  check((await activeText()) === "Annuler", "confirm danger : focus initial sur Annuler");
  check(
    /^rgb\((2\d\d|1[89]\d), \d{1,2}, \d{1,2}[,)]/.test(
      await page.locator(".dlg-btn.is-danger").evaluate((b) => getComputedStyle(b).backgroundColor),
    ),
    "confirm danger : bouton rouge",
  );
  await shot("2-confirm-danger");
  await page.keyboard.press("Enter");
  await until(() => danger1.done, "confirm danger : Entrée sur Annuler répond");
  check(danger1.value === false, "confirm danger : Entrée ne confirme pas");
  check(results().at(-1).value === null, "confirm danger : Entrée sur Annuler = null");
  const danger2 = track(hostUi.confirm({ title: "Supprimer", text: "Sûr ?", danger: true }));
  await open("confirm danger (2) : dialogue affiché");
  await page.locator(".dlg-btn.is-danger").click();
  await until(() => danger2.done, "confirm danger : clic sur Confirmer");
  check(danger2.value === true, "confirm danger : le clic confirme");
  check(results().at(-1).value === true, "confirm danger : dialogResult true");

  // ── Échap, clic extérieur, file d'attente avec compteur.
  const q1 = track(hostUi.confirm({ title: "Première", text: "un" }));
  const q2 = track(hostUi.input({ title: "Seconde", label: "Valeur" }));
  await open("file : premier dialogue");
  check(
    (await page.locator(".dlg-title").innerText()) === "Première",
    "file : le premier est visible",
  );
  check(
    (await page.locator(".dlg-count").innerText()).startsWith("1 autre"),
    "file : compteur « 1 autre en attente »",
  );
  await page.keyboard.press("Escape");
  await until(() => q1.done, "file : Échap répond au premier");
  check(q1.value === false && results().at(-1).value === null, "Échap = annulation (null)");
  await until(
    async () => (await page.locator(".dlg-title").innerText()) === "Seconde",
    "file : le second apparaît",
  );
  check((await page.locator(".dlg-count").innerText()) === "", "file : plus de compteur");
  // Bureau : clic sur le fond. Téléphone : la feuille couvre tout, le bouton Annuler annule.
  if (phone) await page.locator(".dlg-btn", { hasText: "Annuler" }).click();
  else await page.mouse.click(5, 5);
  await until(() => q2.done, "clic extérieur : réponse reçue");
  check(q2.value === null && results().at(-1).value === null, "clic extérieur = annulation (null)");
  await closed("file vidée");

  // ── Focus piégé : Tab ne sort jamais du dialogue.
  const trap = track(
    hostUi.pick({
      title: "Piège",
      multi: true,
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    }),
  );
  await open("piège : dialogue affiché");
  let inside = true;
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press("Tab");
    inside = inside && (await page.evaluate(() => !!document.activeElement?.closest(".dlg-box")));
  }
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Shift+Tab");
    inside = inside && (await page.evaluate(() => !!document.activeElement?.closest(".dlg-box")));
  }
  check(inside, "focus piégé dans le dialogue (Tab et Maj+Tab)");
  await page.keyboard.press("Escape");
  await until(() => trap.done, "piège : fermé par Échap");

  // ── Fichier : contrôle local, 413 affiché, puis envoi réussi (glisser-déposer).
  const uploadCalls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/upload")) uploadCalls.push(r);
  });
  const file = track(
    hostUi.file({ title: "Importer une fiche", accept: [".txt", ".json"], maxBytes: 1000 }),
  );
  await open("file : dialogue affiché");
  check(
    (await page.locator(".dlg-hint").first().innerText()).includes(".txt"),
    "file : extensions annoncées",
  );
  const chooser = page.locator(".dlg-box input[type=file]");
  await chooser.setInputFiles({
    name: "gros.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(2000, 97),
  });
  await until(
    async () => (await page.locator(".dlg-error").innerText()).includes("trop volumineux"),
    "file : contrôle local de taille",
  );
  await chooser.setInputFiles({
    name: "virus.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(10, 97),
  });
  await until(
    async () => (await page.locator(".dlg-error").innerText()).includes("Extensions acceptées"),
    "file : contrôle local d'extension",
  );
  check(uploadCalls.length === 0, "file : rien n'est envoyé quand le contrôle local refuse");
  // Le serveur répond 413 une fois (message clair dans le dialogue).
  let refuseOnce = true;
  await page.route("**/api/upload*", (route) => {
    if (!refuseOnce) return route.continue();
    refuseOnce = false;
    return route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({ error: "hostui.uploadTooLarge" }),
    });
  });
  await chooser.setInputFiles({
    name: "fiche.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(500, 97),
  });
  await until(
    async () => (await page.locator(".dlg-error").innerText()).includes("Taille maximale"),
    "file : 413 affiché",
  );
  check((await dlg.count()) === 1, "file : le dialogue reste ouvert après un 413");
  check(!file.done, "file : aucun dialogResult après un refus du serveur");
  await shot("3-file-413");
  // Glisser-déposer d'un fichier valide : envoi réel au serveur, puis dialogResult avec l'identifiant.
  await page.locator(".dlg-drop").evaluate((zone) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{"ok":true}'], "fiche.json", { type: "application/json" }));
    zone.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    zone.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  });
  await until(() => file.done, "file : envoi réussi puis réponse");
  check(
    typeof file.value === "string" && file.value.startsWith("up_"),
    `file : identifiant d'envoi (${file.value})`,
  );
  const last = uploadCalls.at(-1);
  check(
    last.headers()["content-type"] === "application/octet-stream",
    "file : Content-Type octet-stream",
  );
  check(last.headers()["x-filename"] === "fiche.json", "file : nom dans X-Filename");
  await closed("file : dialogue fermé");
  await page.unroute("**/api/upload*");

  // ── Lien externe : domaine en évidence, ouverture sans opener, schéma refusé.
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (...args) => {
      window.__opened.push(args);
      return null;
    };
  });
  const ext = track(
    hostUi.external({ url: "https://exemple.fr/doc?a=1", label: "Documentation de l'outil" }),
  );
  await open("external : dialogue affiché");
  check(
    (await page.locator(".dlg-url-host").innerText()) === "exemple.fr",
    "external : domaine mis en évidence",
  );
  check(
    (await page.locator(".dlg-url").innerText()) === "https://exemple.fr/doc?a=1",
    "external : URL en clair",
  );
  check(
    (await page.evaluate(() => window.__opened.length)) === 0,
    "external : rien ouvert avant le clic",
  );
  await page.locator(".dlg-btn", { hasText: "Ouvrir" }).click();
  await until(() => ext.done, "external : réponse reçue");
  check(ext.value === true, "external : true après ouverture");
  const opened = await page.evaluate(() => window.__opened);
  check(
    opened.length === 1 &&
      opened[0][0] === "https://exemple.fr/doc?a=1" &&
      opened[0][1] === "_blank" &&
      opened[0][2] === "noopener,noreferrer",
    "external : window.open(url, _blank, noopener,noreferrer)",
  );
  // Un schéma non http(s) (envoi forgé hors serveur) n'est ni affiché ni ouvrable.
  let sinkOf = [...shellSinks][0];
  sinkOf.send("shell", "shell", {
    type: "dialog",
    id: "forge-1",
    kind: "external",
    url: "javascript:alert(1)",
    label: "piège",
  });
  await open("external refusé : dialogue affiché");
  check(
    !(await dlg.innerText()).includes("javascript"),
    "external refusé : l'adresse n'est pas affichée",
  );
  check(
    (await page.locator(".dlg-btn", { hasText: "Ouvrir" }).count()) === 0,
    "external refusé : pas de bouton Ouvrir",
  );
  sinkOf.send("shell", "shell", { type: "dialogClosed", id: "forge-1" });
  await closed("dialogClosed ferme le dialogue forgé");
  check(
    results().every((r) => r.id !== "forge-1"),
    "dialogClosed : aucune réponse envoyée",
  );

  // ── Reconnexion avec un dialogue en attente : il redemande, rien n'est répondu.
  const resent = track(
    hostUi.confirm({ title: "Toujours là", text: "Réponse attendue d'un humain." }),
  );
  await open("reconnexion : dialogue affiché");
  const before = results().length;
  for (const ws of [...sockets]) ws.terminate();
  await until(
    async () => (await page.locator("#tb-conn").innerText()).startsWith("Hors ligne"),
    "reconnexion : hors ligne",
    12000,
  );
  await until(
    async () => (await page.locator("#tb-conn").innerText()) === "Connecté",
    "reconnexion : reconnecté",
    15000,
  );
  await open("reconnexion : le dialogue en attente est réaffiché");
  check(
    (await page.locator(".dlg-title").innerText()) === "Toujours là",
    "reconnexion : même question",
  );
  await sleep(300);
  check(results().length === before && !resent.done, "reconnexion : aucune réponse sans clic");
  await page.locator(".dlg-btn", { hasText: "Annuler" }).click();
  await until(() => resent.done, "reconnexion : réponse après le clic");

  // ── openWindow : la kill chain de la mission s'ouvre.
  sinkOf = [...shellSinks][0];
  sinkOf.send("shell", "shell", { type: "openWindow", view: "killchain", frame: "m-abc123" });
  await until(
    () => win("killchain:m-abc123").isVisible(),
    "openWindow killchain : fenêtre ouverte",
  );
  check(
    (await page.locator('.wm-win[data-key="killchain:m-abc123"] iframe').getAttribute("src")) ===
      "/view/killchain?frame=m-abc123",
    "openWindow killchain : iframe /view/killchain du bon cadre",
  );
  sinkOf.send("shell", "shell", { type: "openWindow", view: "studio", frame: "main" });
  await sleep(200);
  check((await win("studio:main").count()) === 0, "openWindow : une vue hors liste est ignorée");

  // ── download : le navigateur télécharge, une seule fois.
  const downloadEvent = page.waitForEvent("download");
  const id = await downloads.offer({
    filename: "kill chain.json",
    mime: "application/json",
    body: Buffer.from('{"nodes":[]}'),
  });
  const dl = await downloadEvent;
  check(
    dl.suggestedFilename() === "kill chain.json",
    `download : nom proposé (${dl.suggestedFilename()})`,
  );
  const path = await dl.path();
  const { readFileSync: readFile } = await import("node:fs");
  check(readFile(path, "utf8") === '{"nodes":[]}', "download : contenu reçu");
  check(typeof id === "string" && downloads.take(id) === undefined, "download : usage unique");

  // ── settings : langue et palette appliquées.
  sinkOf.send("shell", "shell", {
    type: "settings",
    values: { locale: "en", palette: "braise", terminalPrompt: "compact" },
  });
  await until(
    () => page.evaluate(() => document.documentElement.lang === "en"),
    "settings : langue appliquée",
  );
  check(
    (await page.evaluate(() => document.documentElement.dataset.palette)) === "braise",
    "settings : palette appliquée",
  );
  sinkOf.send("shell", "shell", {
    type: "settings",
    values: { locale: "fr", palette: "<script>", model: "x" },
  });
  await until(
    () => page.evaluate(() => document.documentElement.lang === "fr"),
    "settings : retour au français",
  );
  check(
    (await page.evaluate(() => document.documentElement.dataset.palette)) === "braise",
    "settings : palette invalide ignorée",
  );

  check(
    results().every(
      (r) =>
        r.value === null ||
        typeof r.value === "string" ||
        typeof r.value === "boolean" ||
        Array.isArray(r.value),
    ),
    "toutes les réponses ont une forme valide",
  );
  check(
    violations.length === 0,
    `zéro violation CSP (dialogues) (${violations.slice(0, 3).join(" | ")})`,
  );
  await context.close();
}

try {
  // WEB_E2E_ONLY=<nom> : ne joue que ce scénario (mise au point).
  const only = (name) => !process.env.WEB_E2E_ONLY || process.env.WEB_E2E_ONLY === name;
  if (only("desktop")) await scenario("desktop", { width: 1440, height: 900 });
  if (only("mobile")) await scenario("mobile", { width: 375, height: 812 });
  if (only("wm-desktop")) await desktopScenario("wm-desktop", { width: 1440, height: 900 });
  if (only("wm-budget-desktop")) {
    await budgetScenario("wm-budget-desktop", { width: 1440, height: 900 }, 8);
  }
  if (only("wm-spaces")) await spacesScenario("wm-spaces", { width: 1440, height: 900 });
  if (only("wm-mobile")) await phoneScenario("wm-mobile", { width: 375, height: 812 });
  if (only("screens")) await screensScenario("screens", { width: 1440, height: 900 });
  if (only("screens-mobile"))
    await settingsPhoneScenario("screens-mobile", { width: 375, height: 812 });
  if (only("terminal")) await terminalScenario("terminal", { width: 1440, height: 900 });
  if (only("terminal-mobile"))
    await terminalPhoneScenario("terminal-mobile", { width: 375, height: 812 });
  if (only("shell")) await shellScenario("shell", { width: 1440, height: 900 });
  if (only("shell-mobile")) await shellScenario("shell-mobile", { width: 375, height: 812 });
  if (only("dialogs")) await dialogScenario("dialogs", { width: 1440, height: 900 });
  if (only("dialogs-mobile")) await dialogScenario("dialogs-mobile", { width: 375, height: 812 });
  if (only("wm-budget-mobile")) {
    await budgetScenario("wm-budget-mobile", { width: 375, height: 812 }, 3);
  }
} catch (error) {
  failures.push(`exception : ${error?.stack ?? error}`);
  console.error(error);
} finally {
  await browser.close();
  hostUi?.dispose();
  downloads?.dispose();
  await uploads.dispose();
  for (const ws of sockets) ws.terminate();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(
  `\nweb-e2e : ${checks - failures.length}/${checks} vérifications réussies, captures dans ${shots}`,
);
if (failures.length > 0) {
  console.error(`${failures.length} échec(s).`);
  process.exit(1);
}
