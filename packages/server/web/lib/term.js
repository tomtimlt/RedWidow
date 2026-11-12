// Protocole du terminal humain (vue `term`, ADR 0053) : bornes, découpage de la saisie, libellés des
// codes d'erreur et machine d'état d'une session. Pur, sans DOM ni xterm : le rendu est dans
// `screens/terminal.js`. Aucune donnée reçue n'est insérée en HTML.

/** Taille maximale d'un message `input` (octets UTF-8) : miroir du serveur (`MAX_INPUT_BYTES`). */
export const MAX_INPUT_BYTES = 64 * 1024;
/** Au-delà, un collage est refusé plutôt que découpé en une rafale de messages. */
export const MAX_PASTE_BYTES = 1024 * 1024;
/** Bornes de taille du terminal : miroir du serveur (`MAX_COLS`, `MAX_ROWS`). */
export const MAX_COLS = 500;
export const MAX_ROWS = 200;
/** Délai sans `opened` après un réabonnement avant de déclarer la session perdue. */
export const RESUME_TIMEOUT_MS = 4000;

/** Libellés français des codes d'erreur de la vue `term`. */
const REASONS = {
  "docker.unavailable": "Docker est indisponible sur le serveur.",
  "terminal.invalidContainer": "Ce terminal est déjà relié à un autre conteneur.",
  "terminal.notManaged": "Ce conteneur n'est pas géré par RedWidow.",
  "terminal.notRunning": "Ce conteneur est arrêté : démarrez-le depuis Conteneurs.",
  "terminal.limit": "Trop de terminaux ouverts : fermez-en un.",
  "terminal.inputTooLarge": "Saisie trop volumineuse : elle n'a pas été envoyée.",
  "terminal.failed": "Le terminal n'a pas pu s'ouvrir.",
};

export const termReason = (code) =>
  typeof code === "string" && Object.hasOwn(REASONS, code)
    ? REASONS[code]
    : "Le terminal a rencontré une erreur.";

/** Octets UTF-8 d'un point de code (une moitié de paire orpheline compte 3, comme `Buffer.byteLength`). */
const bytesOf = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Taille UTF-8 d'une chaîne. */
export function utf8Size(text) {
  let n = 0;
  for (const ch of text) n += bytesOf(ch.codePointAt(0) ?? 0);
  return n;
}

/**
 * Découpe une saisie en morceaux de `max` octets UTF-8 au plus, sans couper un caractère.
 * Renvoie `{ chunks }`, ou `{ refused: true }` si la saisie dépasse `MAX_PASTE_BYTES`.
 */
export function chunkInput(data, max = MAX_INPUT_BYTES) {
  if (typeof data !== "string" || data === "") return { chunks: [] };
  const chunks = [];
  let current = "";
  let size = 0;
  let total = 0;
  for (const ch of data) {
    const n = bytesOf(ch.codePointAt(0) ?? 0);
    total += n;
    if (total > MAX_PASTE_BYTES) return { refused: true, chunks: [] };
    if (size + n > max) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  if (current !== "") chunks.push(current);
  return { chunks };
}

/** Taille mesurée → `{ cols, rows }` entiers dans les bornes du serveur, ou `null` si illisible. */
export function clampSize(cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  return {
    cols: Math.min(MAX_COLS, Math.max(1, Math.floor(cols))),
    rows: Math.min(MAX_ROWS, Math.max(1, Math.floor(rows))),
  };
}

/** Message de la vue `term` → événement normalisé, ou `null`. */
export function parseTermEvent(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return null;
  switch (msg.type) {
    case "opened":
      return typeof msg.container === "string"
        ? { type: "opened", container: msg.container }
        : null;
    case "output":
      return typeof msg.data === "string" ? { type: "output", data: msg.data } : null;
    case "exit":
      return { type: "exit", code: Number.isInteger(msg.code) ? msg.code : null };
    case "error":
      return { type: "error", code: typeof msg.code === "string" ? msg.code : "terminal.failed" };
    default:
      return null;
  }
}

/** Conteneurs ouvrables : seuls ceux qui tournent. */
export const openable = (items) => items.filter((c) => c.state === "running");

/**
 * Machine d'état d'une session. États : `idle` (choix du conteneur), `connecting`, `live`, `resuming`
 * (réabonnement après une coupure), `ended` (shell terminé), `failed` (ouverture refusée), `lost`
 * (session perdue : rouvrir).
 * @param {object} options
 * @param {(msg: object) => boolean} options.send envoie un message `term` ; `false` si hors ligne
 * @param {(data: string) => void} [options.onOutput]
 * @param {() => void} [options.onReplay] la sortie conservée va être rejouée : vider l'écran
 * @param {(state: string, info: object) => void} [options.onState]
 * @param {(text: string) => void} [options.onNotice] message non bloquant
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 */
export function createTermSession({
  send,
  onOutput = () => {},
  onReplay = () => {},
  onState = () => {},
  onNotice = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
}) {
  let state = "idle";
  let info = { container: "", code: null, reason: "" };
  let size = null;
  let timer = null;
  let replaying = false;

  const set = (next, patch = {}) => {
    state = next;
    info = { ...info, ...patch };
    onState(state, info);
  };
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const active = () => state === "connecting" || state === "live" || state === "resuming";

  return {
    state: () => state,
    info: () => info,
    active,
    /** Ouvre la session dans un conteneur. */
    open(container, cols, rows) {
      const dims = clampSize(cols, rows);
      if (dims === null || typeof container !== "string" || container === "") return false;
      if (!send({ type: "open", container, cols: dims.cols, rows: dims.rows })) {
        set("failed", { reason: "offline" });
        return false;
      }
      size = dims;
      set("connecting", { container, reason: "", code: null });
      return true;
    },
    /** Saisie de l'utilisateur : découpée à 64 Kio, refusée au-delà de 1 Mio. */
    input(data) {
      if (state !== "live") return false;
      const { chunks, refused } = chunkInput(data);
      if (refused) {
        onNotice("Collage trop volumineux (plus de 1 Mio) : il n'a pas été envoyé.");
        return false;
      }
      for (const chunk of chunks) {
        if (!send({ type: "input", data: chunk })) return false;
      }
      return true;
    },
    /** Nouvelle taille : un message `resize` seulement si elle a changé. */
    resize(cols, rows) {
      const dims = clampSize(cols, rows);
      if (dims === null || !active()) return false;
      if (size !== null && size.cols === dims.cols && size.rows === dims.rows) return false;
      size = dims;
      return send({ type: "resize", cols: dims.cols, rows: dims.rows });
    },
    /** Fermeture voulue de la session (la fenêtre se ferme ensuite). */
    close() {
      stopTimer();
      if (active()) send({ type: "close" });
      set("idle", { container: "" });
    },
    /** Retour au choix du conteneur (« Rouvrir »). */
    reset() {
      stopTimer();
      set("idle", { container: "", code: null, reason: "" });
    },
    /** Connexion rétablie : réabonnement ; sans `opened` à temps, la session est perdue. */
    reconnect() {
      if (!active()) return;
      stopTimer();
      if (!send({ type: "ready" })) return;
      set("resuming");
      timer = setTimer(() => {
        timer = null;
        if (state === "resuming") set("lost", { reason: "timeout" });
      }, RESUME_TIMEOUT_MS);
    },
    /** Message du serveur (déjà normalisé par `parseTermEvent`). */
    handle(ev) {
      switch (ev.type) {
        case "opened":
          stopTimer();
          replaying = state === "resuming";
          if (replaying) onReplay();
          set("live", { container: ev.container });
          break;
        case "output":
          if (state === "live" || state === "resuming") onOutput(ev.data);
          break;
        case "exit":
          stopTimer();
          set("ended", { code: ev.code });
          break;
        case "error":
          stopTimer();
          if (state === "live" && ev.code === "terminal.inputTooLarge") {
            onNotice(termReason(ev.code));
          } else if (state === "connecting") set("failed", { reason: ev.code });
          else if (active()) set("lost", { reason: ev.code });
          break;
        default:
          break;
      }
    },
  };
}
