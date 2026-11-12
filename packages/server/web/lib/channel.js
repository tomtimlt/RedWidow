// Canal WebSocket de la coquille : une socket par onglet, enveloppe { v, view, frame, msg }.
// Aucune mise en file : un message envoyé hors ligne est refusé (`send` renvoie false), et rien n'est
// rejoué à la reconnexion. Reconnexion à délai croissant de 1 s à 30 s.

export const ENVELOPE_VERSION = 1;
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30000;

const FRAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Enveloppe sortante sérialisée (mêmes quatre champs que le serveur exige). */
export function encodeEnvelope(view, frame, msg) {
  return JSON.stringify({ v: ENVELOPE_VERSION, view, frame, msg });
}

/** Décode un message entrant : forme exacte ou `null` (trame ignorée, aucun écho). */
export function decodeEnvelope(data) {
  if (typeof data !== "string") return null;
  let raw;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 4 || !["v", "view", "frame", "msg"].every((k) => keys.includes(k))) {
    return null;
  }
  if (raw.v !== ENVELOPE_VERSION || typeof raw.view !== "string" || raw.view === "") return null;
  if (typeof raw.frame !== "string" || !FRAME_PATTERN.test(raw.frame)) return null;
  if (raw.msg === null || typeof raw.msg !== "object" || Array.isArray(raw.msg)) return null;
  return { view: raw.view, frame: raw.frame, msg: raw.msg };
}

/** Délai avant la n-ième tentative (0, 1, 2…) : 1 s, 2 s, 4 s… plafonné à 30 s. */
export function backoffDelay(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt));
}

/**
 * @param {object} options
 * @param {() => string} options.url URL de la socket (calculée à chaque tentative).
 * @param {(url: string) => any} options.connect fabrique la socket (`new WebSocket(url)`).
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @param {() => Promise<boolean>} [options.sessionAlive] vérifie la session après une coupure.
 * @param {() => void} [options.onSessionLost] session expirée : retour à la connexion.
 */
export function createChannel({
  url,
  connect,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  sessionAlive,
  onSessionLost,
}) {
  /** "connecting" | "open" | "closed" */
  let state = "closed";
  let socket = null;
  let attempt = 0;
  let timer = null;
  let stopped = false;
  const stateListeners = new Set();
  const messageListeners = new Set();
  const openListeners = new Set();

  const setState = (next) => {
    if (state === next) return;
    state = next;
    for (const fn of stateListeners) fn(next);
  };

  const scheduleReconnect = () => {
    if (stopped || timer !== null) return;
    const delay = backoffDelay(attempt);
    attempt += 1;
    timer = setTimer(() => {
      timer = null;
      open();
    }, delay);
  };

  const onClosed = async (ws) => {
    if (socket !== ws) return;
    socket = null;
    setState("closed");
    if (stopped) return;
    if (sessionAlive) {
      let alive = true;
      try {
        alive = await sessionAlive();
      } catch {
        alive = true;
      }
      if (!alive) {
        stopped = true;
        onSessionLost?.();
        return;
      }
    }
    scheduleReconnect();
  };

  function open() {
    if (stopped || socket !== null) return;
    setState("connecting");
    let ws;
    try {
      ws = connect(url());
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      attempt = 0;
      setState("open");
      for (const fn of openListeners) fn();
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      const env = decodeEnvelope(event.data);
      if (env === null) return;
      for (const fn of messageListeners) fn(env);
    };
    ws.onclose = () => void onClosed(ws);
    ws.onerror = () => {
      // `close` suit toujours une erreur de socket : la reconnexion est décidée là.
    };
  }

  return {
    get state() {
      return state;
    },
    start() {
      stopped = false;
      open();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      const ws = socket;
      socket = null;
      setState("closed");
      try {
        ws?.close();
      } catch {
        // Déjà fermée.
      }
    },
    /** Envoie une enveloppe ; `false` (rien n'est conservé) si la socket n'est pas ouverte. */
    send(view, frame, msg) {
      if (state !== "open" || socket === null) return false;
      try {
        socket.send(encodeEnvelope(view, frame, msg));
        return true;
      } catch {
        return false;
      }
    },
    onState(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    onMessage(fn) {
      messageListeners.add(fn);
      return () => messageListeners.delete(fn);
    },
    /** Appelé à chaque ouverture (y compris les reconnexions). */
    onOpen(fn) {
      openListeners.add(fn);
      return () => openListeners.delete(fn);
    },
  };
}
