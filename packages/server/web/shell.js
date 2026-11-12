// Coquille de RedWidow Serveur : canal WebSocket, barre fixe, file d'approbations, feuille d'approbation
// du téléphone, arrêt d'urgence, bureau à fenêtres (déplaçables, dock, mode pile au téléphone). Aucune
// donnée reçue n'est insérée en HTML : tout passe par `textContent`.
import { createApprovalTracker, createCardList, parseApprovalList } from "./lib/approval-card.js";
import { createChannel } from "./lib/channel.js";
import { chatErrorText, createAfterReady, parseMissionContext } from "./lib/chat-bridge.js";
import { createDialogHost, startDownload } from "./lib/dialog.js";
import { createFrameHost, parseDeepLink } from "./lib/frames.js";
import {
  activityMap,
  formatSize,
  parseAppearance,
  parseMissions,
  parseProjects,
  parseRuns,
} from "./lib/lists.js";
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
import { createFilesHost } from "./screens/files.js";
import { createFindingsScreen } from "./screens/findings.js";
import { createJournalScreen } from "./screens/journal.js";
import { createProvidersScreen } from "./screens/providers.js";
import { createSettingsScreen } from "./screens/settings.js";
import { createTerminalHost } from "./screens/terminal.js";
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
import {
  CHORD_TEXT,
  iframeSpec,
  MENU_GROUPS,
  nativeSpec,
  newMissionId,
  newTerminalId,
  openWindowExtras,
  specFromOpenWindow,
  specFromRoute,
  terminalSpec,
} from "./wm/types.js";

const SHELL = "shell";
/** Écrans natifs du menu « Ouvrir » (palette) : ceux du groupe Écrans, puis « Nouveau terminal ». */
const MENU_SCREENS = MENU_GROUPS.flatMap((g) => g.entries)
  .filter((e) => e.action.startsWith("native:") || e.action === "terminal")
  .map((e) => ({ name: e.action === "terminal" ? "terminal" : e.action.slice(7), title: e.title }));
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
  /** Listes du serveur (palette, dock) : missions, projets, runs. */
  missions: [],
  projects: [],
  runs: [],
  /** Contexte de mission par cadre (`missionContext`), affiché en pastille dans la fenêtre Mission. */
  missionContexts: new Map(),
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

const afterReady = createAfterReady();
const frames = createFrameHost({
  container: $("desktop"),
  doc: document,
  origin: location.origin,
  send: (view, frame, msg) => {
    // Le chat sans fournisseur demande `addProvider` (ou `openSystem`) : la coquille ouvre l'écran natif
    // Fournisseurs ; le serveur ne reçoit rien. Liste fermée, aucune réponse d'approbation.
    if (view === "chat" && (msg.type === "addProvider" || msg.type === "openSystem")) {
      desktop.open(nativeSpec("providers"));
      return true;
    }
    // Chat : `chat-extras.js` (chargé après la page) annonce `extrasReady` quand il écoute ; la coquille
    // pose alors le brouillon de mission. Message propre à la coquille, jamais transmis au serveur.
    if (view === "chat" && msg.type === "extrasReady") {
      for (const action of afterReady.take(view, frame)) action.run();
      return true;
    }
    const sent = channel.send(view, frame, msg);
    // Viewer : le suivi d'un appel d'outil (`watch`) part après le `ready` de la page, dans cet ordre.
    if (sent && view !== "chat" && msg.type === "ready") {
      for (const action of afterReady.take(view, frame)) action.run();
    }
    return sent;
  },
  onFocus: (entry) => desktop.focus(entry.key),
  // Raccourcis relayés par les ponts des pages : même table que le clavier de la coquille.
  onKey: (key) => handleShortcut(key, "frame"),
  onError: (entry) => desktop.setError(entry.key, true),
  onLoad: (entry) => applyAppearanceToFrame(entry),
});
window.addEventListener("message", (event) => frames.handleMessage(event));

// L'écran Approbations vit dans la page ; la référence est gardée : fermer sa fenêtre le retire du DOM.
const approvalsEl = $("screen-approvals");

// ───────────────────────────── Dialogues du serveur (HostUi) ─────────────────────────────

/** Une réponse n'existe que par un geste humain dans le dialogue ; hors ligne, `send` renvoie false. */
const dialogs = createDialogHost({
  doc: document,
  send: (id, value) => channel.send(SHELL, SHELL, { type: "dialogResult", id, value }),
  inert: [$("topbar"), $("desktop"), $("dock"), $("sheet"), $("palette"), $("toasts")],
});

/** Apparence reçue du serveur (`settings`) : langue et palette de la coquille et de ses pages. */
const appearance = { locale: null, palette: null };
function applyAppearance(root) {
  if (appearance.locale !== null) root.lang = appearance.locale;
  if (appearance.palette !== null) root.dataset.palette = appearance.palette;
}
function applyAppearanceToFrame(entry) {
  try {
    const root = entry.iframe.contentDocument?.documentElement;
    if (root) applyAppearance(root);
  } catch {
    // Page non accessible : elle garde son apparence.
  }
}

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

/** Terminaux humains (ADR 0053) : une fenêtre par session, rendu xterm, journalisés côté serveur. */
const terminals = createTerminalHost({
  doc: document,
  send: (view, frame, msg) => channel.send(view, frame, msg),
  sendShell: (msg) => channel.send(SHELL, SHELL, msg),
  onTitle: (key, title) => desktop.setTitle(key, title),
  onChange: () => render(),
});

/** Fichiers du projet actif : explorateur, onglets, éditeur CodeMirror (instance unique). */
const files = createFilesHost({
  doc: document,
  win: window,
  send: sendShell,
  onDirty: (count) =>
    desktop.setTitle(
      "native:files",
      count > 0 ? `Fichiers (${count} modifié${count > 1 ? "s" : ""})` : "Fichiers",
    ),
  onOpenStudio: () => openFixed("studio"),
});

const journal = createJournalScreen(document, {
  send: sendShell,
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
    terminal: { mount: (body, spec) => terminals.mount(body, spec) },
    files: { mount: (body, spec) => files.mount(body, spec) },
    ...nativeMounts,
  },
  onChange: () => render(),
  onLayout: () => scheduleSave(),
  emptyActions: [
    { id: "newMission", title: "Nouvelle mission", run: () => newMission() },
    { id: "cockpit", title: "Cockpit", run: () => openFixed("cockpit") },
    { id: "providers", title: "Fournisseurs", run: () => desktop.open(nativeSpec("providers")) },
  ],
});

const openApprovals = () => desktop.open(nativeSpec("approvals"));

/** Lien profond (`#w=…`) → ouvre ou focalise la fenêtre. Le hash n'est pas une navigation. */
function openRoute(hash) {
  const spec = specFromRoute(parseDeepLink(hash));
  if (spec !== null) openSpec(spec);
}
/** Ouvre ou focalise une fenêtre ; Fichiers est ensuite placée sur le chemin demandé (`#w=fichiers:<chemin>`). */
function openSpec(spec) {
  desktop.open(spec);
  if (spec.kind === "native" && spec.name === "files" && typeof spec.path === "string") {
    files.navigate(spec.path);
  }
}
window.addEventListener("hashchange", () => openRoute(location.hash));
// Un lien `#w=…` déjà actif ne déclenche pas `hashchange` : le clic ouvre la fenêtre directement.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#w="]') : null;
  if (link === null) return;
  event.preventDefault();
  openRoute(link.getAttribute("href"));
});

/** Nouvelle conversation : identifiant généré, fenêtre Mission ouverte et focalisée. */
function newMission() {
  const spec = iframeSpec("mission", newMissionId());
  if (spec !== null) desktop.open(spec);
}
/**
 * Fenêtre demandée par le serveur (`openWindow`). `extras` : brouillon de mission (posé dans le champ de
 * saisie, jamais envoyé d'office) et suivi d'un appel d'outil, joués quand la page a annoncé `ready` ; si la
 * page est déjà chargée, tout de suite.
 */
function openFromServer(spec, extras) {
  const actions = [];
  if (extras.draft !== undefined) {
    const text = extras.draft;
    actions.push({
      run: () =>
        frames.deliver({ view: spec.view, frame: spec.frame, msg: { type: "draft", text } }),
    });
  }
  if (extras.toolUseId !== undefined) {
    const toolUseId = extras.toolUseId;
    actions.push({
      durable: true,
      run: () => channel.send(spec.view, spec.frame, { type: "watch", toolUseId }),
    });
  }
  if (spec.kind === "iframe") {
    const entry = frames.get(spec.view, spec.frame);
    const live = entry !== null && !entry.unloaded && !entry.failed && entry.timer === null;
    if (live) for (const action of actions) action.run();
    afterReady.set(
      spec.view,
      spec.frame,
      live ? actions.filter((a) => a.durable === true) : actions,
    );
  }
  openSpec(spec);
}

/** Pastille « Contexte » des fenêtres Mission ouvertes (relancé à chaque rendu : la fenêtre peut venir après). */
function syncMissionContexts() {
  for (const [frame, text] of state.missionContexts) desktop.setContext(`chat:${frame}`, text);
}

/** Vue à identifiant fixe (`main`) : cockpit, sessions, studio. */
function openFixed(kind) {
  const spec = iframeSpec(kind, "main");
  if (spec !== null) desktop.open(spec);
}
/**
 * Kill chain ou rapport : de la mission au premier plan (ou, à défaut, la plus récente fenêtre de mission) ;
 * sans mission ouverte, la palette demande l'identifiant.
 */
function openForMission(kind) {
  const snap = desktop
    .snapshot()
    .filter((w) => w.type === "mission" && typeof w.frame === "string");
  const active = desktop.activeKey();
  const pick = snap.find((w) => w.key === active) ?? snap.at(-1);
  if (pick) {
    const spec = iframeSpec(kind, pick.frame);
    if (spec !== null) desktop.open(spec);
    return;
  }
  palette.openPrompt({
    placeholder: `Identifiant de la mission (${kind === "graph" ? "kill chain" : "rapport"})`,
    help: "Lettres, chiffres, « - » et « _ » (64 au plus). Entrée pour ouvrir.",
    submit(text) {
      const spec = iframeSpec(kind, text.trim());
      if (spec === null) return "Identifiant refusé.";
      desktop.open(spec);
      return undefined;
    },
  });
}
/** Entrée du menu « Ouvrir » du dock → ouverture. */
function openEntry(action) {
  if (action === "newMission") newMission();
  else if (action === "terminal") {
    const spec = newTerminal();
    if (spec) desktop.open(spec);
  } else if (action.startsWith("fixed:")) openFixed(action.slice(6));
  else if (action.startsWith("forMission:")) openForMission(action.slice(11));
  else if (action.startsWith("native:")) {
    const spec = nativeSpec(action.slice(7));
    if (spec) desktop.open(spec);
  }
}

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
  groups: MENU_GROUPS.map((g) => ({
    title: g.title,
    entries: g.entries.map((e) => ({ ...e, hint: CHORD_TEXT[e.action] })),
  })),
  onActivate: (key) => desktop.focus(key),
  onMinimize: (key) => desktop.minimize(key),
  onOpenEntry: openEntry,
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

/** Un terminal actif, ou Fichiers avec des onglets modifiés, n'est jamais fermé par un espace : il est minimisé. */
const isProtected = (key) => terminals.isActive(key) || files.isProtected(key);

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
  // Premier lancement (ni disposition courante ni espace enregistré) : une mission s'ouvre à côté des
  // approbations, sauf si un lien profond demande autre chose.
  if (
    parsed.current === null &&
    parsed.saved.length === 0 &&
    parseDeepLink(location.hash) === null
  ) {
    newMission();
  }
  openRoute(location.hash);
  saver.enable(true);
  renderSpaces();
}

// ───────────────────────────── Raccourcis et palette ─────────────────────────────

const newTerminal = () => terminalSpec(newTerminalId());
const specFor = (kind, id) =>
  kind === "native" ? (id === "terminal" ? newTerminal() : nativeSpec(id)) : iframeSpec(kind, id);

const MISSION_STATES = { running: "en cours", waiting: "en attente", stopped: "arrêt en cours" };
const MAX_PALETTE_RUNS = 30;
/** Identités connues du serveur pour la palette : missions, projets, runs (ouvre un Monitor). */
function serverKnown(approvalFrames) {
  const known = [];
  const seen = new Set();
  for (const m of state.missions) {
    seen.add(m.id);
    known.push({
      kind: "mission",
      id: m.id,
      title: `Mission : ${m.title}`,
      detail: [MISSION_STATES[m.state], m.project ? `projet ${m.project}` : ""]
        .filter(Boolean)
        .join(", "),
    });
  }
  for (const id of approvalFrames) if (!seen.has(id)) known.push({ kind: "mission", id });
  for (const p of state.projects) {
    known.push({ kind: "program", id: p.id, title: `Programme : ${p.name}`, detail: "projet" });
  }
  for (const r of state.runs.slice(0, MAX_PALETTE_RUNS)) {
    known.push({
      kind: "monitor",
      id: r.id,
      title: `Monitor ${r.id.slice(0, 8)}`,
      detail: `run ${r.kind === "terminal" ? "terminal" : "mission"}, ${formatSize(r.size)}`,
    });
  }
  return known;
}

/** Demande les listes du serveur (palette, dock) ; les réponses mettent l'état à jour. */
function refreshLists() {
  sendShell({ type: "missionsList" });
  sendShell({ type: "projectsList" });
  sendShell({ type: "runsList" });
}
const FIXED_VIEWS = [
  {
    kind: "cockpit",
    id: "main",
    title: "Cockpit",
    keywords: "ouvrir tableau de bord",
    shortcutText: CHORD_TEXT["fixed:cockpit"],
  },
  { kind: "sessions", id: "main", title: "Sessions", keywords: "ouvrir historique" },
  {
    kind: "studio",
    id: "main",
    title: "Projets et réglages",
    keywords: "ouvrir studio projet programme fournisseurs",
    shortcutText: CHORD_TEXT["fixed:studio"],
  },
];

const palette = createPalette({
  doc: document,
  onOpen: refreshLists,
  refs: {
    root: $("palette"),
    input: $("palette-input"),
    list: $("palette-list"),
  },
  getItems: () => {
    const approvalFrames = [...new Set(tracker.items().map((item) => item.frame))];
    return buildCommands({
      windows: desktop.snapshot(),
      activeKey: desktop.activeKey(),
      spaces: state.spaces,
      spaceName: state.spaceName,
      phone: onPhone(),
      known: serverKnown(approvalFrames),
      screens: MENU_SCREENS,
      fixed: FIXED_VIEWS,
      spec: specFor,
      actions: {
        open: (spec) => spec && desktop.open(spec),
        newMission,
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
  // Dialogue ouvert : le bureau derrière lui est inerte, aucun raccourci n'agit.
  if (dialogs.isOpen()) return false;
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
        const spec = newTerminal();
        if (spec) desktop.open(spec);
      },
      approvals: () => openApprovals(),
      newMission,
      cockpit: () => openFixed("cockpit"),
      studio: () => openFixed("studio"),
      files: () => desktop.open(nativeSpec("files")),
    },
    source,
  );
}
// `Alt+J` + lettre : jamais armé palette ouverte ni dans un terminal (les Alt+lettre y appartiennent au shell).
attachShortcuts(
  document,
  (id) => handleShortcut(id, "shell"),
  () => !palette.isOpen() && !terminalFocused() && !dialogs.isOpen(),
);

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
  syncMissionContexts();
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
    activity: activityMap(state.missions),
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
  if (env.view === "term") {
    terminals.onTerm(env);
    return;
  }
  if (env.view !== "shell") {
    // Erreur du chat ou d'un viewer (export, liaison de conteneur, rapport…) : un toast français, non bloquant.
    if ((env.view === "chat" || env.view === "viewer") && env.msg?.type === "error") {
      toast(chatErrorText(env.msg.code), "err");
      return;
    }
    frames.deliver(env);
    return;
  }
  const msg = env.msg;
  // Les écrans natifs ignorent ce qui ne les concerne pas.
  for (const screen of Object.values(screens)) screen.onMessage?.(msg);
  terminals.onMessage(msg);
  files.onMessage(msg);
  switch (msg.type) {
    case "missions":
      state.missions = parseMissions(msg);
      palette.refresh();
      render();
      break;
    case "missionState": {
      // Diffusion d'un changement d'état : pastille du dock (en cours, en attente).
      const known = state.missions.find((m) => m.id === msg.id);
      const next = ["idle", "running", "waiting", "stopped"].includes(msg.state) ? msg.state : null;
      if (known && next !== null) {
        known.state = next;
        render();
      } else if (!known) sendShell({ type: "missionsList" });
      break;
    }
    case "projects":
      state.projects = parseProjects(msg);
      palette.refresh();
      break;
    case "runs":
      state.runs = parseRuns(msg);
      palette.refresh();
      break;
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
    case "dialog":
      dialogs.show(msg);
      break;
    case "dialogClosed":
      dialogs.close(msg.id);
      break;
    case "download":
      startDownload(document, msg);
      break;
    case "openWindow": {
      const spec = specFromOpenWindow(msg);
      if (spec !== null) openFromServer(spec, openWindowExtras(msg));
      break;
    }
    case "missionContext": {
      const ctx = parseMissionContext(msg);
      if (ctx !== null) {
        state.missionContexts.set(ctx.frame, ctx.text);
        syncMissionContexts();
      }
      break;
    }
    case "settings": {
      // Langue et palette : coquille et pages ouvertes. L'invite du terminal est lue par le serveur à la
      // création d'une session : rien à faire ici.
      const next = parseAppearance(msg);
      if (next.locale !== null) appearance.locale = next.locale;
      if (next.palette !== null) appearance.palette = next.palette;
      applyAppearance(document.documentElement);
      for (const entry of frames.entries()) applyAppearanceToFrame(entry);
      break;
    }
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
      terminals.setHalt(halt.active);
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
    // Le serveur renvoie les questions en attente à la reconnexion : elles redemandent (rien n'est répondu).
    dialogs.clear();
    snapshotPending = true;
    state.haltRequested = false;
    state.halt = null;
    terminals.setHalt(false);
    state.bypass = null;
    screens.settings.setBypass(null);
  }
  terminals.setOnline(conn === "open");
  files.setOnline(conn === "open");
  for (const screen of Object.values(screens)) screen.setOnline?.(conn === "open");
  render();
});
channel.onOpen(() => {
  channel.send(SHELL, SHELL, { type: "ready" });
  channel.send(SHELL, SHELL, { type: "layouts" });
  for (const screen of Object.values(screens)) screen.refresh?.();
  sendShell({ type: "missionsList" });
  // Les terminaux actifs se réabonnent (`ready`) ; sans `opened` à temps, « session perdue, rouvrir ».
  terminals.onOpen();
  files.onOpen();
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
