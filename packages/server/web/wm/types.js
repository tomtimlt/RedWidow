// Types de fenêtres du bureau (pur). Une fenêtre est soit une `iframe` de même origine (identité
// `(vue, cadre)`, la même clé que celle de l'hôte de cadres), soit un écran natif de la coquille
// (identité `native:<nom>`). Rouvrir une identité déjà ouverte la focalise au lieu d'en créer une seconde.

/** Écrans natifs ouvrables depuis le dock (instance unique chacun ; filtre et programme se choisissent dans l'écran). */
export const NATIVE_SCREENS = [
  { name: "approvals", title: "Approbations" },
  { name: "containers", title: "Conteneurs" },
  { name: "providers", title: "Fournisseurs" },
  { name: "accounts", title: "Comptes de test" },
  { name: "findings", title: "Trouvailles" },
  { name: "journal", title: "Journal" },
  { name: "settings", title: "Réglages" },
];

/** Entrée « Nouveau terminal » des menus (dock, palette) : instances illimitées, une session chacune. */
export const TERMINAL_ENTRY = { name: "terminal", title: "Nouveau terminal" };

/**
 * Menu « Ouvrir » du dock, en trois groupes : Mission (conversation, kill chain, rapport), Outils
 * (cockpit, sessions, studio, terminal), Écrans (écrans natifs). `action` : `newMission`, `fixed:<type>`
 * (vue à identifiant fixe `main`), `forMission:<type>` (vue d'une mission, choisie par la coquille),
 * `terminal` ou `native:<nom>`.
 */
export const MENU_GROUPS = [
  {
    title: "Mission",
    entries: [
      { action: "newMission", title: "Nouvelle mission" },
      { action: "forMission:graph", title: "Kill chain" },
      { action: "forMission:report", title: "Rapport" },
    ],
  },
  {
    title: "Outils",
    entries: [
      { action: "fixed:cockpit", title: "Cockpit" },
      { action: "fixed:sessions", title: "Sessions" },
      { action: "fixed:studio", title: "Projets et réglages" },
      { action: "terminal", title: TERMINAL_ENTRY.title },
    ],
  },
  {
    title: "Écrans",
    entries: NATIVE_SCREENS.map((s) => ({ action: `native:${s.name}`, title: s.title })),
  },
];

/** Libellés lisibles des raccourcis `Alt+J <lettre>` (palette, menu). */
export const CHORD_TEXT = {
  newMission: "Alt J N",
  "fixed:cockpit": "Alt J K",
  "fixed:studio": "Alt J S",
  terminal: "Alt J T",
};

/** Vues à identifiant fixe `main` : le titre de la fenêtre est le libellé seul. */
const FIXED_KINDS = ["cockpit", "sessions", "studio"];

/** Nouvel identifiant de mission : `m-` et 6 caractères base36 aléatoires (conforme au motif des cadres). */
export function newMissionId(random = randomBase36) {
  let out = "m-";
  for (let i = 0; i < 6; i += 1) out += random();
  return out;
}

function randomBase36() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(1));
  return (bytes[0] % 36).toString(36);
}

const IFRAME_KINDS = {
  mission: { view: "chat", label: "Mission" },
  monitor: { view: "viewer", mode: "watch", label: "Monitor" },
  graph: { view: "killchain", label: "Kill chain" },
  report: { view: "viewer", mode: "report", label: "Rapport" },
  program: { view: "program", label: "Programme" },
  engagement: { view: "engagement", label: "Engagement" },
  // Vues à identifiant fixe `main` (menu « Ouvrir », palette, liens profonds).
  cockpit: { view: "cockpit", label: "Cockpit" },
  sessions: { view: "sessions", label: "Sessions" },
  studio: { view: "studio", label: "Projets et réglages" },
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Spécification d'une fenêtre à iframe, ou `null` si le type ou l'identifiant sont refusés. */
export function iframeSpec(kind, id) {
  const def = Object.hasOwn(IFRAME_KINDS, kind) ? IFRAME_KINDS[kind] : undefined;
  if (!def || typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  return {
    key: `${def.view}:${id}`,
    kind: "iframe",
    type: kind,
    title: FIXED_KINDS.includes(kind) ? def.label : `${def.label} ${id}`,
    view: def.view,
    frame: id,
    mode: def.mode ?? null,
  };
}

/** Vues demandables par le serveur (`openWindow`) → type de fenêtre. La kill chain s'ouvre sur un graphe. */
const OPEN_WINDOW_KINDS = {
  cockpit: "cockpit",
  program: "program",
  engagement: "engagement",
  killchain: "graph",
};

/**
 * Message `openWindow {view, frame}` du serveur → spécification de fenêtre, ou `null` (vue hors liste,
 * identifiant invalide). Le cockpit est une vue à identifiant fixe : sa fenêtre est toujours `main`, pour
 * ne jamais en ouvrir une seconde à côté de celle du dock.
 */
export function specFromOpenWindow(msg) {
  if (msg === null || typeof msg !== "object" || typeof msg.view !== "string") return null;
  if (!Object.hasOwn(OPEN_WINDOW_KINDS, msg.view)) return null;
  const kind = OPEN_WINDOW_KINDS[msg.view];
  return iframeSpec(kind, kind === "cockpit" ? "main" : msg.frame);
}

/** Spécification d'une fenêtre native, ou `null` si l'écran est inconnu. */
export function nativeSpec(name) {
  const screen = NATIVE_SCREENS.find((s) => s.name === name);
  if (!screen) return null;
  return {
    key: `native:${name}`,
    kind: "native",
    type: "native",
    title: screen.title,
    name,
  };
}

/** Fenêtre de terminal (type `terminal`, natif) : `sid` est l'identifiant de session choisi par le client. */
export function terminalSpec(sid) {
  if (typeof sid !== "string" || !ID_PATTERN.test(sid)) return null;
  return {
    key: `term:${sid}`,
    kind: "native",
    type: "terminal",
    name: "terminal",
    frame: sid,
    title: "Terminal",
  };
}

/** Nouvel identifiant de session : `t-` et un UUID, conforme au motif des cadres (38 caractères). */
export function newTerminalId(random = () => globalThis.crypto.randomUUID()) {
  return `t-${random()}`.slice(0, 64);
}

/** Destination d'un lien profond (`parseDeepLink`) → spécification de fenêtre, ou `null`. */
export function specFromRoute(route) {
  if (route === null || typeof route !== "object") return null;
  if (route.kind === "approvals") return nativeSpec("approvals");
  if (route.kind === "native") return nativeSpec(route.name);
  return iframeSpec(route.kind, route.id);
}

/** Libellé court d'un onglet (dock, mode pile). */
export function shortTitle(title, max = 22) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}
