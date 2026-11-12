// Pont des pages de vue : fournit `acquireVsCodeApi` (utilisé par les scripts de l'extension) et relie la
// page à la coquille par `postMessage` de même origine. Script classique, chargé avant tout script de la
// page. Aucun accès réseau, aucun `eval`.
//
// Page → coquille : { rw: 1, msg } (message de la page), { rw: 1, focus: true } (pointerdown),
//                   { rw: 1, key } (seulement les raccourcis de la liste ci-dessous).
// Coquille → page : { rw: 1, msg }. Tout autre message, ou venant d'une autre origine ou d'une autre
// fenêtre que le parent, est ignoré.
(() => {
  /** Raccourcis relayés à la coquille ; rien d'autre ne sort de la page (les iframes ne propagent pas le clavier). */
  const RELAYED_KEYS = [
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

  /**
   * Identifiant d'un raccourci relayable, ou `null`. Les touches mortes, AltGr (qui produit des
   * caractères à saisir, par exemple `{` sur un clavier français) et Méta ne sont jamais relayés.
   */
  function shortcutOf(e) {
    if (!e.ctrlKey || e.metaKey) return null;
    if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return null;
    let id = null;
    if (!e.altKey) {
      if (typeof e.key === "string" && e.key.toLowerCase() === "k") {
        id = e.shiftKey ? "Ctrl+Shift+K" : "Ctrl+K";
      }
    } else if (!e.shiftKey) {
      const code = typeof e.code === "string" ? e.code : "";
      if (/^Arrow(Left|Right|Up|Down)$/.test(code)) id = `Ctrl+Alt+${code}`;
      else if (/^Digit[1-9]$/.test(code)) id = `Ctrl+Alt+${code.slice(5)}`;
      else if (code === "Backquote") id = "Ctrl+Alt+`";
      else if (code === "KeyT") id = "Ctrl+Alt+T";
      else if (code === "KeyA") id = "Ctrl+Alt+A";
    }
    return id !== null && RELAYED_KEYS.includes(id) ? id : null;
  }

  /**
   * Accord `Alt+J` puis N, K, S, T ou F (même logique que `createChord`, lib/shortcuts.js). Rend
   * `{ id, consume }` : `consume` retient la frappe, `id` est le raccourci complet. Ctrl, Méta et AltGr
   * ne participent jamais ; une autre touche désarme.
   */
  const CHORD_CODES = {
    KeyN: "Alt+J N",
    KeyK: "Alt+J K",
    KeyS: "Alt+J S",
    KeyT: "Alt+J T",
    KeyF: "Alt+J F",
  };
  const CHORD_MS = 1500;
  let chordAt = Number.NEGATIVE_INFINITY;
  function chordOf(e) {
    const none = { id: null, consume: false };
    if (e.ctrlKey || e.metaKey) {
      chordAt = Number.NEGATIVE_INFINITY;
      return none;
    }
    if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return none;
    const code = typeof e.code === "string" ? e.code : "";
    if (/^(Alt|Control|Shift|Meta)(Left|Right)$/.test(code)) return none;
    const armed = Date.now() - chordAt <= CHORD_MS;
    chordAt = Number.NEGATIVE_INFINITY;
    if (armed && !e.shiftKey && Object.hasOwn(CHORD_CODES, code)) {
      return { id: CHORD_CODES[code], consume: true };
    }
    if (e.altKey && !e.shiftKey && code === "KeyJ") {
      chordAt = Date.now();
      return { id: null, consume: true };
    }
    return none;
  }

  const params = new URLSearchParams(location.search);
  const rawFrame = params.get("frame") ?? "";
  const frame = /^[A-Za-z0-9_-]{1,64}$/.test(rawFrame) ? rawFrame : "";
  const origin = location.origin;
  const host = window.parent;
  const embedded = host !== window;

  const post = (payload) => {
    if (embedded) host.postMessage({ rw: 1, ...payload }, origin);
  };

  // État de la page : `sessionStorage` (par cadre, pour survivre à un rechargement), sinon mémoire.
  const storeKey = `rw:state:${frame}`;
  let memory;
  // Page `viewer` : le serveur attend le mode (`monitor`, `watch`, `report`) dans le `ready` de la page, qui
  // ne l'envoie pas d'elle-même ; il est lu ici dans l'URL du cadre (`?mode=`). Sans lui, le serveur sert
  // des données Monitor, y compris pour un Rapport.
  const VIEWER_MODES = ["monitor", "watch", "report"];
  const urlMode = params.get("mode");
  const viewerMode =
    location.pathname === "/view/viewer" && VIEWER_MODES.includes(urlMode) ? urlMode : null;
  const withMode = (msg) =>
    viewerMode !== null &&
    msg !== null &&
    typeof msg === "object" &&
    msg.type === "ready" &&
    msg.mode === undefined
      ? { ...msg, mode: viewerMode }
      : msg;

  const api = {
    postMessage(msg) {
      post({ msg: withMode(msg) });
    },
    getState() {
      try {
        const raw = sessionStorage.getItem(storeKey);
        if (raw !== null) return JSON.parse(raw);
      } catch {
        // Stockage indisponible ou valeur illisible : on retombe sur la mémoire.
      }
      return memory;
    },
    setState(state) {
      memory = state;
      try {
        sessionStorage.setItem(storeKey, JSON.stringify(state));
      } catch {
        // Stockage plein ou bloqué : l'état reste en mémoire.
      }
      return state;
    },
  };
  Object.defineProperty(window, "acquireVsCodeApi", { value: () => api, configurable: false });

  // Messages de la coquille : capturés avant les écouteurs de la page, puis rejoués comme un message
  // `{ data: msg }` (la forme attendue par les scripts de l'extension).
  window.addEventListener(
    "message",
    (event) => {
      if (event.origin !== origin || event.source !== host || host === window) return;
      const data = event.data;
      if (data === null || typeof data !== "object" || data.rw !== 1) return;
      event.stopImmediatePropagation();
      const keys = Object.keys(data);
      if (keys.length !== 2 || !keys.includes("msg")) return;
      const msg = data.msg;
      if (msg === null || typeof msg !== "object") return;
      window.dispatchEvent(new MessageEvent("message", { data: msg }));
    },
    true,
  );

  document.addEventListener("pointerdown", () => post({ focus: true }), true);
  document.addEventListener(
    "keydown",
    (event) => {
      if (embedded) {
        const step = chordOf(event);
        if (step.consume) {
          event.preventDefault();
          if (step.id !== null && RELAYED_KEYS.includes(step.id)) post({ key: step.id });
          return;
        }
      }
      const key = shortcutOf(event);
      if (key === null || !embedded) return;
      event.preventDefault();
      post({ key });
    },
    true,
  );

  // Exposé pour les tests (aucun effet de bord).
  Object.defineProperty(window, "__rwBridge", {
    value: Object.freeze({ shortcutOf, RELAYED_KEYS }),
  });
})();
