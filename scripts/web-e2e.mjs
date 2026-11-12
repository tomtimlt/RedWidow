#!/usr/bin/env node
// Tests de bout en bout de l'interface web (Playwright), hors `pnpm check` : `pnpm test:web`.
//
// Le serveur HTTP est le vrai (`packages/server/dist`, authentification, pages de vue, CSP) ; le moteur
// est remplacé par un pont factice qui rejoue des approbations et enregistre ce que le navigateur envoie.
// Aucune donnée réelle, aucun agent. Prérequis : `pnpm build`. Sans `playwright`, le script se saute.
//
// Couvre (1440x900 et 375x812) : connexion, file vide, trois demandes, « Toujours » absent si non
// mémorisable, un clic = un `approve`, aucun `approve` sans clic (chargement, reconnexion), focus jamais
// déplacé sur une carte, arrêt d'urgence sans confirmation, badge Bypass, hors ligne puis reconnexion,
// feuille d'approbation du téléphone, page de vue en iframe (pont, `ready`), zéro violation CSP.
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
/** Messages reçus du navigateur : { view, frame, msg }. */
const received = [];
let approvals = [];
/** Dispositions enregistrées côté « serveur » (validées par le vrai schéma). */
let layouts = { current: null, saved: [] };
let layoutRejected = 0;
/** Si faux, un `approve` n'est pas acquitté (la demande reste dans la liste). */
let acknowledge = true;

const send = (ws, view, frame, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ v: 1, view, frame, msg }));
};
const broadcast = (view, frame, msg) => {
  for (const ws of sockets) send(ws, view, frame, msg);
};
const pushApprovals = () => broadcast("shell", "shell", { type: "approvals", items: approvals });

function onConnection(ws) {
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("message", (data) => {
    let env;
    try {
      env = JSON.parse(data.toString());
    } catch {
      return;
    }
    received.push(env);
    if (env.view !== "shell") return;
    if (env.msg.type === "ready")
      send(ws, "shell", "shell", { type: "approvals", items: approvals });
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
const server = createServer(
  {
    host: "127.0.0.1",
    port,
    dataDir,
    webDir: join(root, "packages/server/web"),
    publicOrigin: origin,
    trustProxy: false,
  },
  { passwordHash: await hashPassword(PASSWORD), onConnection },
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

async function openSession(name, viewport, { keepLayouts = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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
  if (!keepLayouts) layouts = { current: null, saved: [] };
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
  await until(() => win("native:containers").isVisible(), "fenêtre native (écran d'attente)");
  check(
    (await win("native:containers").innerText()).includes("prochaine version"),
    "écran natif d'attente",
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
  await page.locator("#dock-menu .dock-menu-item", { hasText: "Réglages" }).click();
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
  if (only("wm-budget-mobile")) {
    await budgetScenario("wm-budget-mobile", { width: 375, height: 812 }, 3);
  }
} catch (error) {
  failures.push(`exception : ${error?.stack ?? error}`);
  console.error(error);
} finally {
  await browser.close();
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
