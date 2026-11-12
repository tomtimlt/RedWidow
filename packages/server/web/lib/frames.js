// Cadres de vue : une `iframe` de même origine par (vue, cadre). La coquille relie chaque page au canal
// par le pont (`bridge.js`). Seuls comptent les messages dont l'origine est la nôtre ET dont la source est
// la fenêtre de la `iframe` enregistrée ; tout le reste est ignoré. Aucun message n'est mis en file.

import { cleanRelPath } from "./files.js";

export const VIEW_NAMES = [
  "chat",
  "cockpit",
  "sessions",
  "program",
  "engagement",
  "studio",
  "killchain",
  "viewer",
];

/** Raccourcis que le pont a le droit de relayer (même liste que `bridge.js`). */
export const RELAYED_KEYS = [
  "Ctrl+K",
  "Ctrl+Shift+K",
  "Ctrl+Alt+ArrowLeft",
  "Ctrl+Alt+ArrowRight",
  "Ctrl+Alt+ArrowUp",
  "Ctrl+Alt+ArrowDown",
  "Ctrl+Alt+1",
  "Ctrl+Alt+2",
  "Ctrl+Alt+3",
  "Ctrl+Alt+4",
  "Ctrl+Alt+5",
  "Ctrl+Alt+6",
  "Ctrl+Alt+7",
  "Ctrl+Alt+8",
  "Ctrl+Alt+9",
  "Ctrl+Alt+`",
  "Ctrl+Alt+T",
  "Ctrl+Alt+A",
  "Alt+J N",
  "Alt+J K",
  "Alt+J S",
  "Alt+J T",
  "Alt+J F",
];

export const LOAD_TIMEOUT_MS = 15000;
const FRAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const frameKey = (view, frame) => `${view}:${frame}`;

/** Mots du lien profond → type de fenêtre à instance (`#w=<mot>:<identifiant>`). */
const DEEP_KINDS = {
  mission: "mission",
  monitor: "monitor",
  graphe: "graph",
  killchain: "graph",
  rapport: "report",
  programme: "program",
  engagement: "engagement",
};
/** Vues à identifiant fixe `main` (`#w=<mot>`). */
const DEEP_FIXED = { cockpit: "cockpit", sessions: "sessions", studio: "studio" };
/** Écrans natifs uniques (`#w=<mot>`). */
const DEEP_NATIVES = {
  conteneurs: "containers",
  fournisseurs: "providers",
  comptes: "accounts",
  trouvailles: "findings",
  journal: "journal",
  reglages: "settings",
  fichiers: "files",
};

/**
 * Lien profond (`#w=approbations`, `#w=mission:<id>`, `#w=monitor:<id>`, `#w=conteneurs`, `#w=fichiers:<chemin>`…) → destination,
 * ou `null`. Le hash ne sert qu'à l'ouverture : il n'est pas une navigation.
 */
export function parseDeepLink(hash) {
  const text = hash ?? "";
  if (text === "#w=approbations") return { kind: "approvals" };
  const withId = /^#w=([a-z]+):([A-Za-z0-9_-]{1,64})$/.exec(text);
  if (withId && Object.hasOwn(DEEP_KINDS, withId[1])) {
    return { kind: DEEP_KINDS[withId[1]], id: withId[2] };
  }
  // `#w=fichiers:<chemin relatif au projet>` (encodé en pourcent) : ouvre Fichiers sur ce chemin.
  const files = /^#w=fichiers:(.{1,3000})$/.exec(text);
  if (files) {
    let decoded = null;
    try {
      decoded = decodeURIComponent(files[1]);
    } catch {
      return null;
    }
    const path = cleanRelPath(decoded);
    return path === null ? null : { kind: "native", name: "files", path };
  }
  const plain = /^#w=([a-z]+)$/.exec(text);
  if (plain && Object.hasOwn(DEEP_NATIVES, plain[1])) {
    return { kind: "native", name: DEEP_NATIVES[plain[1]] };
  }
  if (plain && Object.hasOwn(DEEP_FIXED, plain[1])) {
    return { kind: DEEP_FIXED[plain[1]], id: "main" };
  }
  return null;
}

/** URL de la page d'une vue pour un cadre. */
export function viewUrl(view, frame, mode) {
  const query = new URLSearchParams({ frame });
  if (view === "viewer" && mode) query.set("mode", mode);
  return `/view/${view}?${query.toString()}`;
}

/**
 * Message du pont → intention, ou `null` (ignoré). Formes exactes : { rw: 1, msg }, { rw: 1, focus: true },
 * { rw: 1, key } avec `key` dans `RELAYED_KEYS`.
 */
export function parseBridgeMessage(data) {
  if (data === null || typeof data !== "object" || data.rw !== 1) return null;
  const keys = Object.keys(data);
  if (keys.length !== 2) return null;
  if (keys.includes("msg")) {
    const msg = data.msg;
    return msg !== null && typeof msg === "object" && !Array.isArray(msg) ? { msg } : null;
  }
  if (keys.includes("focus")) return data.focus === true ? { focus: true } : null;
  if (keys.includes("key")) {
    return typeof data.key === "string" && RELAYED_KEYS.includes(data.key)
      ? { key: data.key }
      : null;
  }
  return null;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.container où poser les `iframe`
 * @param {Document} options.doc
 * @param {string} options.origin origine de la coquille (`location.origin`)
 * @param {(view: string, frame: string, msg: object) => boolean} options.send envoi vers le canal
 * @param {(entry: object) => void} [options.onFocus]
 * @param {(key: string, entry: object) => void} [options.onKey]
 * @param {(entry: object) => void} [options.onError] chargement trop long : cadre d'erreur à afficher
 * @param {(entry: object) => void} [options.onLoad] page chargée (palette et langue à appliquer)
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 */
export function createFrameHost({
  container,
  doc,
  origin,
  send,
  onFocus = () => {},
  onKey = () => {},
  onError = () => {},
  onLoad = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
}) {
  const entries = new Map();

  const load = (entry) => {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.failed = false;
    entry.unloaded = false;
    entry.timer = setTimer(() => {
      entry.timer = null;
      entry.failed = true;
      onError(entry);
    }, LOAD_TIMEOUT_MS);
    entry.iframe.src = viewUrl(entry.view, entry.frame, entry.mode);
  };

  return {
    /**
     * Ouvre le cadre, ou renvoie l'existant (une seule instance par identité). `null` si le nom est refusé.
     * `parent` : élément où poser l'`iframe` (par défaut le conteneur de l'hôte) ; un `iframe` déplacé dans
     * le DOM se rechargerait, d'où le choix du parent dès la création.
     */
    open(view, frame, mode, parent) {
      if (!VIEW_NAMES.includes(view) || !FRAME_PATTERN.test(frame)) return null;
      const key = frameKey(view, frame);
      const existing = entries.get(key);
      if (existing) return existing;
      const iframe = doc.createElement("iframe");
      iframe.className = "view-frame";
      iframe.title = `${view} ${frame}`;
      iframe.referrerPolicy = "no-referrer";
      const entry = {
        key,
        view,
        frame,
        mode: mode ?? null,
        iframe,
        timer: null,
        failed: false,
        unloaded: false,
      };
      iframe.addEventListener("load", () => {
        if (entry.timer !== null) clearTimer(entry.timer);
        entry.timer = null;
        entry.failed = false;
        if (!entry.unloaded) onLoad(entry);
      });
      entries.set(key, entry);
      (parent ?? container).append(iframe);
      load(entry);
      return entry;
    },
    get: (view, frame) => entries.get(frameKey(view, frame)) ?? null,
    entries: () => [...entries.values()],
    close(view, frame) {
      const entry = entries.get(frameKey(view, frame));
      if (!entry) return;
      if (entry.timer !== null) clearTimer(entry.timer);
      entry.iframe.remove();
      entries.delete(entry.key);
    },
    /** Recharge une page (bouton « Recharger » du cadre d'erreur, ou après une reconnexion). */
    reload(entry) {
      load(entry);
    },
    /** Reconnexion : recharge les pages vivantes ; une page déchargée le reste jusqu'à sa restauration. */
    reloadAll() {
      for (const entry of entries.values()) if (!entry.unloaded) load(entry);
    },
    /**
     * Décharge une page (veille d'une fenêtre minimisée) : mémoire rendue, état perdu. `reload` la
     * ramène ; la page renvoie alors `ready`. Le gestionnaire de fenêtres ne l'appelle jamais sur une
     * fenêtre visible.
     */
    unload(entry) {
      if (entry.unloaded) return;
      if (entry.timer !== null) clearTimer(entry.timer);
      entry.timer = null;
      entry.failed = false;
      entry.unloaded = true;
      entry.iframe.src = "about:blank";
    },
    /** Message du canal vers la page concernée ; ignoré si aucun cadre ne correspond. */
    deliver(env) {
      const entry = entries.get(frameKey(env.view, env.frame));
      if (!entry || entry.unloaded) return false;
      const target = entry.iframe.contentWindow;
      if (!target) return false;
      target.postMessage({ rw: 1, msg: env.msg }, origin);
      return true;
    },
    /** À brancher sur l'événement `message` de la fenêtre de la coquille. */
    handleMessage(event) {
      if (event.origin !== origin) return;
      for (const entry of entries.values()) {
        if (event.source !== entry.iframe.contentWindow) continue;
        const parsed = parseBridgeMessage(event.data);
        if (parsed === null) return;
        if ("msg" in parsed) send(entry.view, entry.frame, parsed.msg);
        else if ("focus" in parsed) onFocus(entry);
        else onKey(parsed.key, entry);
        return;
      }
    },
  };
}
