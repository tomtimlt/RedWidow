// Coquille de RedWidow Serveur (lot 1) : canal WebSocket, barre fixe, file d'approbations, feuille
// d'approbation du téléphone, arrêt d'urgence, hébergement des pages de vue. Aucune donnée reçue n'est
// insérée en HTML : tout passe par `textContent`.
import { createApprovalTracker, createCardList, parseApprovalList } from "./lib/approval-card.js";
import { createChannel } from "./lib/channel.js";
import { createFrameHost, parseDeepLink } from "./lib/frames.js";
import {
  createTopbar,
  oldestPreview,
  parseBypass,
  parseHalt,
  titleFor,
  truncate,
} from "./lib/topbar.js";
import { createApprovalsScreen, createConfirmZone } from "./screens/approvals.js";

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
  route: parseDeepLink(location.hash) ?? { kind: "approvals" },
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
    // Arrêt d'urgence : un clic, aucune confirmation. Actif même si l'état serveur est inconnu.
    onHalt() {
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
          state.haltNote =
            "Arrêt envoyé, sans confirmation du serveur. Vérifiez l'état des agents.";
          render();
        }
      }, HALT_ECHO_MS);
      render();
    },
    onResume() {
      if (!channel.send(SHELL, SHELL, { type: "resume" })) {
        state.haltNote = "Hors ligne : la reprise n'a pas été transmise.";
        render();
      }
    },
    onOpenApprovals: () => goTo("#w=approbations"),
  },
);

function goTo(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

// ───────────────────────────── Cadres de vue ─────────────────────────────

const frames = createFrameHost({
  container: $("frames"),
  doc: document,
  origin: location.origin,
  send: (view, frame, msg) => channel.send(view, frame, msg),
  onKey(key) {
    // Lot 1 : un seul raccourci est servi. Aucun raccourci ne répond à une approbation.
    if (key === "Ctrl+Alt+A") goTo("#w=approbations");
  },
  onError: () => {
    $("frame-error").hidden = false;
  },
});
window.addEventListener("message", (event) => frames.handleMessage(event));
$("frame-reload").addEventListener("click", () => {
  $("frame-error").hidden = true;
  for (const entry of frames.entries()) frames.reload(entry);
});

function applyRoute() {
  state.route = parseDeepLink(location.hash) ?? { kind: "approvals" };
  const mission = state.route.kind === "mission" ? state.route.id : null;
  if (mission !== null) frames.open("chat", mission);
  for (const entry of frames.entries())
    entry.iframe.hidden = !(entry.view === "chat" && entry.frame === mission);
  $("screen-approvals").hidden = mission !== null;
  $("screen-frame").hidden = mission === null;
  $("frame-error").hidden = true;
  render();
}
window.addEventListener("hashchange", applyRoute);

// ───────────────────────────── Rendu ─────────────────────────────

const phoneQuery = window.matchMedia("(max-width: 719px), (pointer: coarse) and (hover: none)");

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
  const phone = phoneQuery.matches;
  document.body.classList.toggle("is-phone", phone);
  const showSheet = phone && items.length > 0 && state.route.kind !== "approvals";
  $("sheet").hidden = !showSheet;
  sheetList.render(showSheet ? items.slice(0, 1) : [], ctx);
  $("sheet-open").textContent =
    items.length > 1 ? `Ouvrir la file (${items.length})` : "Ouvrir la file";
}
phoneQuery.addEventListener("change", render);
$("sheet-open").addEventListener("click", () => goTo("#w=approbations"));

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
      goTo("#w=approbations");
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
      state.bypass = bypass;
      render();
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
  }
  render();
});
channel.onOpen(() => {
  channel.send(SHELL, SHELL, { type: "ready" });
  // Reconnexion : les pages vivantes sont rechargées (elles renvoient `ready` et reprennent l'état).
  if (everOpen) frames.reloadAll();
  everOpen = true;
});

// Le temps restant du Bypass se rafraîchit sans message du serveur.
setInterval(render, 30000);

applyRoute();
channel.start();
