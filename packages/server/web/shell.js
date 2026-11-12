// Coquille de RedWidow Serveur : canal WebSocket, barre fixe, file d'approbations, feuille d'approbation
// du téléphone, arrêt d'urgence, bureau à fenêtres (déplaçables, dock, mode pile au téléphone). Aucune
// donnée reçue n'est insérée en HTML : tout passe par `textContent`.
import { createApprovalTracker, createCardList, parseApprovalList } from "./lib/approval-card.js";
import { createChannel } from "./lib/channel.js";
import { createFrameHost, parseDeepLink } from "./lib/frames.js";
import { buildCommands, createPalette } from "./lib/palette.js";
import { attachShortcuts, runShortcut } from "./lib/shortcuts.js";
import {
  createTopbar,
  oldestPreview,
  parseBypass,
  parseHalt,
  titleFor,
  truncate,
} from "./lib/topbar.js";
import { createAccountsScreen } from "./screens/accounts.js";
import { createApprovalsScreen, createConfirmZone } from "./screens/approvals.js";
import { createContainersScreen } from "./screens/containers.js";
import { createFindingsScreen } from "./screens/findings.js";
import { createJournalScreen } from "./screens/journal.js";
import { createProvidersScreen } from "./screens/providers.js";
import { createSettingsScreen } from "./screens/settings.js";
import { createDesktop } from "./wm/desktop.js";
import { createDock } from "./wm/dock.js";
import {
  applyPlan,
  cleanName,
  createLayoutSaver,
  DEFAULT_NAME,
  gridFractions,
  MAX_SAVED,
  parseLayouts,
  planApply,
  serialize,
  spaceNameOf,
} from "./wm/layouts.js";
import { createMobile } from "./wm/mobile.js";
import { iframeSpec, NATIVE_SCREENS, nativeSpec, specFromRoute } from "./wm/types.js";

const SHELL = "shell";
/** Au-delà, l'arrêt d'urgence demandé sans écho du serveur redevient « inconnu ». */
const HALT_ECHO_MS = 8000;

const $ = (id) => document.getElementById(id);

const state = {
  conn: "closed",
  halt: null,
  haltRequested: false,
  haltNote: "",
  bypass: null,
  /** Espaces de travail enregistrés ({ name, layout }), nom de l'espace affiché. */
  spaces: [],
  spaceName: DEFAULT_NAME,
  /** Vrai après la première lecture des dispositions : avant, rien n'est enregistré. */
  hydrated: false,
};

// ───────────────────────────── Canal ─────────────────────────────

const channel = createChannel({
  url: () => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  connect: (url) => new WebSocket(url),
  sessionAlive: async () => {
    try {
      const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      return res.status !== 401;
    } catch {
      return true;
    }
  },
  onSessionLost: () => {
    // Session expirée : retour à la connexion, lien profond conservé pour après.
    try {
      sessionStorage.setItem("rw:next", location.hash);
    } catch {
      // Stockage bloqué : on perd seulement le lien profond.
    }
    location.assign("/login");
  },
});

// ───────────────────────────── Approbations ─────────────────────────────

const tracker = createApprovalTracker({
  send: (frame, toolUseId, choice) =>
    channel.send(SHELL, frame, { type: "approve", toolUseId, choice }),
  onChange: () => render(),
});
/** Seul point d'entrée d'une réponse : un gestionnaire de clic. */
const onChoice = (key, choice) => void tracker.click(key, choice);

const approvalsScreen = createApprovalsScreen(
  document,
  { empty: $("appr-empty"), list: $("appr-list") },
  { onChoice },
);
const sheetList = createCardList(document, $("sheet-list"), { onChoice });
const confirmZone = createConfirmZone(document, $("confirm-zone"), {
  answer: (id, accepted) => channel.send(SHELL, SHELL, { type: "confirmResult", id, accepted }),
});

// ───────────────────────────── Barre fixe ─────────────────────────────

let haltTimer = null;
/** Arrêt d'urgence : un clic ou la palette, aucune confirmation. Actif même si l'état serveur est inconnu. */
function requestHalt() {
  if (!channel.send(SHELL, SHELL, { type: "halt" })) {
    state.haltNote = "Hors ligne : l'arrêt n'a pas été transmis. Réessayez dès la reconnexion.";
    render();
    return;
  }
  state.haltNote = "";
  state.haltRequested = true;
  clearTimeout(haltTimer);
  haltTimer = setTimeout(() => {
    if (state.haltRequested) {
      state.haltRequested = false;
      state.haltNote = "Arrêt envoyé, sans confirmation du serveur. Vérifiez l'état des agents.";
      render();
    }
  }, HALT_ECHO_MS);
  render();
}

const topbar = createTopbar(
  {
    count: $("tb-count"),
    preview: $("tb-preview"),
    conn: $("tb-conn"),
    bypass: $("tb-bypass"),
    halt: $("tb-halt"),
    haltNote: $("tb-halt-note"),
  },
  {
    onHalt: requestHalt,
    onResume() {
      if (!channel.send(SHELL, SHELL, { type: "resume" })) {
        state.haltNote = "Hors ligne : la reprise n'a pas été transmise.";
        render();
      }
    },
    onOpenApprovals: () => openApprovals(),
  },
);

// ───────────────────────────── Bureau à fenêtres ─────────────────────────────

/** Mobile et dock sont créés après le bureau ; `render` les ignore tant qu'ils n'existent pas. */
let mobile = null;
let dock = null;

const frames = createFrameHost({
  container: $("desktop"),
  doc: document,
  origin: location.origin,
  send: (view, frame, msg) => channel.send(view, frame, msg),
  onFocus: (entry) => desktop.focus(entry.key),
  // Raccourcis relayés par les ponts des pages : même table que le clavier de la coquille.
  onKey: (key) => handleShortcut(key, "frame"),
  onError: (entry) => desktop.setError(entry.key, true),
});
window.addEventListener("message", (event) => frames.handleMessage(event));

// L'écran Approbations vit dans la page ; la référence est gardée : fermer sa fenêtre le retire du DOM.
const approvalsEl = $("screen-approvals");

// ───────────────────────────── Notifications non bloquantes ─────────────────────────────

const MAX_TOASTS = 4;
const TOAST_MS = 10000;
/** Bandeau d'information qui ne prend ni le focus ni la main : se ferme seul ou d'un clic. */
function toast(text, tone = "steel") {
  const zone = $("toasts");
  const box = document.createElement("div");
  box.className = `toast tone-${tone}`;
  const p = document.createElement("p");
  p.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fermer la notification");
  close.textContent = "×";
  const remove = () => box.remove();
  close.addEventListener("click", remove);
  box.append(p, close);
  zone.append(box);
  while (zone.children.length > MAX_TOASTS) zone.firstElementChild?.remove();
  setTimeout(remove, TOAST_MS);
}

// ───────────────────────────── Écrans natifs ─────────────────────────────

const sendShell = (msg) => channel.send(SHELL, SHELL, msg);
const logout = async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Réseau indisponible : la page de connexion décidera.
  }
  location.assign("/login");
};

const journal = createJournalScreen(document, {
  onOpenMonitor: (id) => {
    const spec = iframeSpec("monitor", id);
    if (spec !== null) desktop.open(spec);
  },
});
const screens = {
  containers: createContainersScreen(document, { send: sendShell }),
  providers: createProvidersScreen(document, {
    send: sendShell,
    onNotify: (text, tone) => toast(text, tone),
    onFeed: (text, tone) => journal.push("clés", text, tone),
  }),
  accounts: createAccountsScreen(document, { send: sendShell }),
  findings: createFindingsScreen(document, { send: sendShell }),
  journal,
  settings: createSettingsScreen(document, {
    send: sendShell,
    notifications: typeof Notification === "undefined" ? null : Notification,
    requestPermission: () =>
      typeof Notification === "undefined" ? Promise.resolve() : Notification.requestPermission(),
    openPalette: () => palette.toggle(),
    logout,
  }),
};
/** Chaque écran natif est monté dans sa fenêtre ; ses données sont redemandées à l'ouverture. */
const nativeMounts = Object.fromEntries(
  Object.entries(screens).map(([name, screen]) => [
    name,
    {
      mount(body) {
        body.append(screen.root);
        screen.refresh?.();
      },
    },
  ]),
);

const desktop = createDesktop({
  doc: document,
  root: $("desktop"),
  frames,
  natives: {
    // L'écran Approbations est préparé dans la page ; la fenêtre l'héberge.
    approvals: { mount: (body) => body.append(approvalsEl) },
    ...nativeMounts,
  },
  onChange: () => render(),
  onLayout: () => scheduleSave(),
});

const openApprovals = () => desktop.open(nativeSpec("approvals"));

/** Lien profond (`#w=…`) → ouvre ou focalise la fenêtre. Le hash n'est pas une navigation. */
function openRoute(hash) {
  const spec = specFromRoute(parseDeepLink(hash));
  if (spec !== null) desktop.open(spec);
}
window.addEventListener("hashchange", () => openRoute(location.hash));
// Un lien `#w=…` déjà actif ne déclenche pas `hashchange` : le clic ouvre la fenêtre directement.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#w="]') : null;
  if (link === null) return;
  event.preventDefault();
  openRoute(link.getAttribute("href"));
});

dock = createDock({
  doc: document,
  refs: {
    root: $("dock"),
    items: $("dock-items"),
    openButton: $("dock-open"),
    menu: $("dock-menu"),
    spaceButton: $("dock-space"),
    spaceMenu: $("dock-space-menu"),
  },
  screens: NATIVE_SCREENS,
  onActivate: (key) => desktop.focus(key),
  onMinimize: (key) => desktop.minimize(key),
  onOpenScreen: (name) => desktop.open(nativeSpec(name)),
  onSpace: (name) => applySpace(name),
  onSpaceSave: () => palette.openPrompt(saveSpacePrompt()),
});
mobile = createMobile({
  win: window,
  doc: document,
  desktop,
  onChange: () => renderSpaces(),
});

// ───────────────────────────── Espaces de travail ─────────────────────────────

const saver = createLayoutSaver({
  send: (layout) => channel.send(SHELL, SHELL, { type: "layoutSave", name: null, layout }),
});
function onPhone() {
  return mobile?.isPhone() ?? false;
}

/** Disposition courante : enregistrée 1 s après le dernier changement, jamais depuis le téléphone. */
function scheduleSave() {
  if (!state.hydrated || onPhone()) return;
  saver.schedule(serialize(desktop.layoutWindows(), state.spaceName));
}

/** Un terminal dont la session est active n'est jamais fermé par un espace : il est minimisé. */
const isProtected = (key) =>
  desktop.layoutWindows().some((w) => w.key === key && w.spec.type === "terminal" && w.spec.active);

function applyLayout(layout) {
  const plan = planApply(
    layout,
    desktop.layoutWindows().map((w) => w.key),
    isProtected,
  );
  applyPlan(desktop, plan);
}

function renderSpaces() {
  dock?.renderSpaces({
    current: state.spaceName,
    spaces: state.spaces.map((s) => s.name),
    disabled: onPhone(),
  });
}

function applySpace(name) {
  if (onPhone()) return;
  const space = state.spaces.find((s) => s.name === name);
  if (!space) return;
  state.spaceName = name;
  applyLayout(space.layout);
  scheduleSave();
  renderSpaces();
}

/** Enregistre l'espace affiché sous `name` (remplace un espace du même nom). Message d'erreur ou `undefined`. */
function saveSpace(name) {
  if (onPhone()) return "Indisponible au téléphone.";
  const clean = cleanName(name);
  if (clean === null) return "Nom refusé : 1 à 40 caractères, sans caractère de contrôle.";
  if (!state.spaces.some((s) => s.name === clean) && state.spaces.length >= MAX_SAVED) {
    return `Trop d'espaces enregistrés (${MAX_SAVED} au plus).`;
  }
  const layout = serialize(desktop.layoutWindows(), clean);
  if (!channel.send(SHELL, SHELL, { type: "layoutSave", name: clean, layout })) {
    return "Hors ligne : l'espace n'a pas été enregistré.";
  }
  state.spaceName = clean;
  scheduleSave();
  renderSpaces();
  return undefined;
}

function deleteSpace(name) {
  channel.send(SHELL, SHELL, { type: "layoutDelete", name });
}

const saveSpacePrompt = () => ({
  placeholder: "Nom de l'espace (40 caractères au plus)",
  help: "Entrée pour enregistrer. Un nom existant est remplacé.",
  submit: saveSpace,
});

/** Tuile les fenêtres visibles en grille. */
function tileAll() {
  if (onPhone()) return;
  const open = desktop.layoutWindows().filter((w) => !w.minimized);
  gridFractions(open.length).forEach((rect, i) => {
    desktop.setGeometry(open[i].key, rect, false);
  });
}

/** Première lecture : restaure la disposition courante (bureau seulement), puis le lien profond. */
function hydrate(parsed) {
  state.hydrated = true;
  saver.setBaseline(parsed.current);
  if (parsed.current !== null) {
    state.spaceName = spaceNameOf(parsed.current);
    if (!onPhone()) applyLayout(parsed.current);
  }
  openRoute(location.hash);
  saver.enable(true);
  renderSpaces();
}

// ───────────────────────────── Raccourcis et palette ─────────────────────────────

const specFor = (kind, id) => (kind === "native" ? nativeSpec(id) : iframeSpec(kind, id));
const FIXED_VIEWS = [
  { kind: "cockpit", id: "main", title: "Ouvrir le cockpit" },
  { kind: "sessions", id: "main", title: "Ouvrir les sessions" },
  { kind: "studio", id: "main", title: "Ouvrir le studio" },
];

const palette = createPalette({
  doc: document,
  refs: {
    root: $("palette"),
    input: $("palette-input"),
    list: $("palette-list"),
  },
  getItems: () => {
    const missions = [...new Set(tracker.items().map((item) => item.frame))];
    return buildCommands({
      windows: desktop.snapshot(),
      activeKey: desktop.activeKey(),
      spaces: state.spaces,
      spaceName: state.spaceName,
      phone: onPhone(),
      known: missions.map((id) => ({ kind: "mission", id })),
      screens: NATIVE_SCREENS,
      fixed: FIXED_VIEWS,
      spec: specFor,
      actions: {
        open: (spec) => spec && desktop.open(spec),
        focus: (key) => desktop.focus(key),
        tile: (key, kind) => desktop.tile(key, kind),
        tileAll,
        applySpace,
        saveSpace,
        saveSpaceAs: saveSpace,
        deleteSpace,
        halt: requestHalt,
      },
    });
  },
});

const terminalFocused = () =>
  document.activeElement?.closest?.('.wm-win[data-type="terminal"]') != null;

/** Raccourcis : ne pilotent que le bureau et la palette (jamais une approbation, le Bypass ou une fermeture). */
function handleShortcut(id, source) {
  // Palette ouverte : seuls ses propres raccourcis agissent, pas le bureau derrière elle.
  if (palette.isOpen() && id !== "Ctrl+K" && id !== "Ctrl+Shift+K") return false;
  const key = desktop.activeKey();
  const snap = desktop.snapshot().find((w) => w.key === key);
  return runShortcut(
    id,
    {
      palette: () => palette.toggle(),
      terminalFocused,
      tile: (kind) => key && desktop.tile(key, kind),
      maximize: () => key && desktop.maximize(key),
      lower: () => {
        if (!key) return;
        if (snap?.maximized) desktop.restore(key);
        else desktop.minimize(key);
      },
      space: (index) => {
        const space = state.spaces[index];
        if (space) applySpace(space.name);
      },
      cycle: () => desktop.cycle(),
      terminal: () => {
        const spec = nativeSpec("terminal");
        if (spec) desktop.open(spec);
      },
      approvals: () => openApprovals(),
    },
    source,
  );
}
attachShortcuts(document, (id) => handleShortcut(id, "shell"));

// ───────────────────────────── Rendu ─────────────────────────────

/** Pastilles du dock : demandes en attente par mission, total sur la fenêtre Approbations. */
function dockBadges(items) {
  const badges = new Map();
  if (items.length > 0) badges.set("native:approvals", items.length);
  for (const item of items) {
    const key = `chat:${item.frame}`;
    badges.set(key, (badges.get(key) ?? 0) + 1);
  }
  return badges;
}

function render() {
  const items = tracker.items();
  const online = state.conn === "open";
  topbar.render({
    count: items.length,
    preview: oldestPreview(items),
    conn: state.conn,
    bypass: state.bypass,
    halt: state.halt,
    haltRequested: state.haltRequested,
    haltNote: state.haltNote,
    now: Date.now(),
  });
  document.title = titleFor(items.length);
  const ctx = { status: (key) => tracker.status(key), online };
  approvalsScreen.render(items, ctx);

  // Feuille d'approbation (téléphone) : au-dessus de la fenêtre active, sans bouton de fermeture ;
  // elle disparaît quand on répond ou qu'on ouvre la file.
  const phone = mobile?.isPhone() ?? false;
  const showSheet = phone && items.length > 0 && desktop.activeKey() !== "native:approvals";
  $("sheet").hidden = !showSheet;
  sheetList.render(showSheet ? items.slice(0, 1) : [], ctx);
  $("sheet-open").textContent =
    items.length > 1 ? `Ouvrir la file (${items.length})` : "Ouvrir la file";

  dock?.render(desktop.snapshot(), {
    badges: dockBadges(items),
    mode: phone ? "stack" : "desktop",
  });
  mobile?.revealActive($("dock-items"));
}
$("sheet-open").addEventListener("click", () => openApprovals());

// ───────────────────────────── Notifications ─────────────────────────────

/**
 * Notification système pour une nouvelle demande, seulement si l'utilisateur l'a déjà autorisée (la
 * permission se demande par un clic dans Réglages, jamais ici). Le clic ouvre la file.
 */
function notifyNew(added) {
  const first = added[0];
  if (!first || typeof Notification === "undefined" || Notification.permission !== "granted")
    return;
  try {
    const n = new Notification("RedWidow : approbation requise", {
      body: `${truncate(first.tool, 40)} — ${truncate(first.summary, 120)}`,
      tag: "rw-approval",
    });
    n.onclick = () => {
      window.focus();
      openApprovals();
      n.close();
    };
  } catch {
    // Notifications indisponibles : la barre et le titre suffisent.
  }
}

// ───────────────────────────── Messages du serveur ─────────────────────────────

/** Première liste reçue après une ouverture : un état, pas une « nouvelle » demande. */
let snapshotPending = true;

channel.onMessage((env) => {
  if (env.view !== "shell") {
    frames.deliver(env);
    return;
  }
  const msg = env.msg;
  // Les écrans natifs ignorent ce qui ne les concerne pas.
  for (const screen of Object.values(screens)) screen.onMessage?.(msg);
  switch (msg.type) {
    case "approvals": {
      const added = tracker.update(parseApprovalList(msg.items));
      if (!snapshotPending && added.length > 0) {
        topbar.flashCount();
        notifyNew(added);
      }
      snapshotPending = false;
      break;
    }
    case "confirm":
      confirmZone.show(msg);
      break;
    case "confirmClosed":
      if (typeof msg.id === "string") confirmZone.close(msg.id);
      break;
    case "halt": {
      const halt = parseHalt(msg);
      if (halt === null) break;
      if ((state.halt?.active ?? null) !== halt.active) {
        journal.push(
          "arrêt",
          halt.active ? "Arrêt d'urgence déclenché." : "Reprise après l'arrêt d'urgence.",
          halt.active ? "err" : "ok",
        );
      }
      state.halt = halt;
      state.haltRequested = false;
      state.haltNote = "";
      clearTimeout(haltTimer);
      render();
      break;
    }
    case "bypass": {
      const bypass = parseBypass(msg);
      if (bypass === null) break;
      if ((state.bypass?.active ?? null) !== bypass.active) {
        journal.push(
          "bypass",
          bypass.active ? "Bypass activé." : "Bypass désactivé.",
          bypass.active ? "crimson" : "ok",
        );
      }
      state.bypass = bypass;
      screens.settings.setBypass(bypass);
      render();
      break;
    }
    case "containerError":
      journal.push("conteneur", `Opération refusée (${truncate(String(msg.code), 60)}).`, "err");
      break;
    case "layouts": {
      const parsed = parseLayouts(msg);
      state.spaces = parsed.saved;
      if (!state.hydrated) hydrate(parsed);
      else renderSpaces();
      break;
    }
    default:
      break;
  }
});

let everOpen = false;
channel.onState((conn) => {
  state.conn = conn;
  if (conn !== "open") {
    // Hors ligne : rien n'est rejoué ; les actions sont désactivées et l'état serveur redevient inconnu.
    tracker.connectionLost();
    confirmZone.clear();
    snapshotPending = true;
    state.haltRequested = false;
    state.halt = null;
    state.bypass = null;
    screens.settings.setBypass(null);
  }
  for (const screen of Object.values(screens)) screen.setOnline?.(conn === "open");
  render();
});
channel.onOpen(() => {
  channel.send(SHELL, SHELL, { type: "ready" });
  channel.send(SHELL, SHELL, { type: "layouts" });
  for (const screen of Object.values(screens)) screen.refresh?.();
  // Reconnexion : la disposition courante est renvoyée si elle a changé hors ligne.
  if (state.hydrated) scheduleSave();
  // Reconnexion : les pages vivantes sont rechargées (elles renvoient `ready` et reprennent l'état).
  if (everOpen) frames.reloadAll();
  everOpen = true;
});

// Le temps restant du Bypass se rafraîchit sans message du serveur.
setInterval(() => {
  render();
  screens.settings.tick();
}, 30000);
// Le badge Bypass de la barre ouvre Réglages (là où il s'active et se coupe).
$("tb-bypass").addEventListener("click", () => desktop.open(nativeSpec("settings")));
$("tb-bypass").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    desktop.open(nativeSpec("settings"));
  }
});

// Au démarrage : la fenêtre Approbations est ouverte ; un lien profond ouvre sa fenêtre par-dessus.
// La disposition courante enregistrée (ou, à défaut, le lien profond) est appliquée à sa première lecture.
openApprovals();
channel.start();
