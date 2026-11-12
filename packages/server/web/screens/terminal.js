// Fenêtre Terminal (xterm.js) vers un conteneur Kali ou Exegol géré par RedWidow (ADR 0053). Une instance
// par fenêtre, une session par instance (identifiant choisi par le client, vue `term`). La session est
// journalisée intégralement côté serveur : la fenêtre le rappelle en permanence. xterm écrit les données
// reçues comme du texte de terminal, jamais en HTML ; tout le reste passe par `textContent`.
import { createTermSession, openable, parseTermEvent, termReason } from "../lib/term.js";
import { actionButton, badge, el, emptyState } from "./common.js";
import { parseContainers } from "./containers.js";

const BANNER =
  "Session journalisée intégralement : tout ce qui est saisi et affiché est enregistré, y compris un mot de passe tapé à la main.";
const HALT_TEXT = "Arrêt d'urgence actif : les agents sont arrêtés, ce terminal reste ouvert.";
const FONT = '"Warband JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';
/** Couleurs de la charte (fond acier très sombre, curseur rouge). */
const THEME = {
  background: "#0d1116",
  foreground: "#e7ebef",
  cursor: "#cc1c40",
  cursorAccent: "#0d1116",
  selectionBackground: "rgba(204, 28, 64, 0.38)",
  black: "#1b232c",
  red: "#ff728b",
  green: "#5fd68a",
  yellow: "#e5bd69",
  blue: "#6ea0ff",
  magenta: "#c872d8",
  cyan: "#35c4d8",
  white: "#e7ebef",
  brightBlack: "#495f73",
  brightRed: "#ff8a8a",
  brightGreen: "#7fe3a3",
  brightYellow: "#f0cf8a",
  brightBlue: "#8db6ff",
  brightMagenta: "#d98ce6",
  brightCyan: "#5fd6e6",
  brightWhite: "#ffffff",
};

/** Chargement paresseux d'xterm (copies de `web/vendor/`, CSP : script du même domaine seulement). */
const defaultLoad = async () => {
  const [xterm, fit] = await Promise.all([
    import("../vendor/xterm.js"),
    import("../vendor/xterm-addon-fit.js"),
  ]);
  return { Terminal: xterm.Terminal, FitAddon: fit.FitAddon };
};

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {(view: string, frame: string, msg: object) => boolean} deps.send émission sur le canal
 * @param {(msg: object) => boolean} deps.sendShell message de la vue `shell`
 * @param {() => Promise<{ Terminal: any, FitAddon: any }>} [deps.loadXterm]
 * @param {(key: string, title: string) => void} [deps.onTitle]
 * @param {() => void} [deps.onChange] l'état actif d'une session a changé
 */
export function createTerminalHost({
  doc,
  send,
  sendShell,
  loadXterm = defaultLoad,
  onTitle = () => {},
  onChange = () => {},
}) {
  /** Instances par identifiant de session. */
  const instances = new Map();
  let containers = [];
  let online = false;
  let halt = false;

  function mount(body, spec) {
    const sid = spec.frame;
    const root = el(doc, "section", "term");
    root.dataset.sid = sid;
    const banner = el(doc, "p", "term-banner", BANNER);
    const haltBar = el(doc, "p", "term-halt", HALT_TEXT);
    haltBar.setAttribute("role", "status");
    haltBar.hidden = !halt;
    const note = el(doc, "p", "term-note");
    note.setAttribute("role", "status");
    note.hidden = true;
    const pick = el(doc, "div", "term-pick");
    const view = el(doc, "div", "term-view");
    view.hidden = true;
    const over = el(doc, "div", "term-over");
    over.hidden = true;
    const confirm = el(doc, "div", "term-confirm");
    confirm.hidden = true;
    confirm.setAttribute("role", "alertdialog");
    root.append(banner, haltBar, note, pick, view, over, confirm);
    body.append(root);

    let term = null;
    let fit = null;
    let observer = null;
    let frame = null;
    let opening = false;
    let disposed = false;
    let pendingProceed = null;
    let preselectFocused = false;

    const session = createTermSession({
      send: (msg) => send("term", sid, msg),
      onOutput: (data) => term?.write(data),
      onReplay: () => term?.reset(),
      onNotice: (text) => showNote(text),
      onState: (state, info) => {
        root.dataset.state = state;
        renderOverlay(state, info);
        pick.hidden = state !== "idle";
        view.hidden = !(
          state === "connecting" ||
          state === "live" ||
          state === "resuming" ||
          state === "ended" ||
          state === "lost"
        );
        if (state === "live") {
          onTitle(spec.key, info.container);
          term?.focus();
        }
        if (state === "idle") onTitle(spec.key, "Terminal");
        onChange();
      },
    });

    function showNote(text) {
      note.textContent = text;
      note.hidden = text === "";
    }

    function renderOverlay(state, info) {
      over.textContent = "";
      over.hidden = !(state === "ended" || state === "failed" || state === "lost");
      if (over.hidden) return;
      let text;
      if (state === "ended") {
        text = `Session terminée${info.code === null ? "" : ` (code ${info.code})`}.`;
      } else if (state === "failed") {
        text =
          info.reason === "offline"
            ? "Hors ligne : le terminal n'a pas été ouvert."
            : termReason(info.reason);
      } else {
        text = "Session perdue, rouvrir.";
        if (info.reason && info.reason !== "timeout") text += ` ${termReason(info.reason)}`;
      }
      const again = el(
        doc,
        "button",
        "scr-btn scr-btn-primary",
        state === "ended" || state === "lost" ? "Rouvrir" : "Choisir un conteneur",
      );
      again.type = "button";
      again.addEventListener("click", () => {
        term?.reset();
        session.reset();
        renderPick();
      });
      over.append(el(doc, "p", "term-over-text", text), again);
    }

    function renderPick() {
      pick.textContent = "";
      pick.append(el(doc, "h2", "scr-h2", "Ouvrir un terminal"));
      const list = openable(containers);
      if (list.length === 0) {
        pick.append(
          emptyState(
            doc,
            "Aucun conteneur en cours d'exécution.",
            "Démarrez un Kali ou un Exegol depuis l'écran Conteneurs, puis actualisez.",
          ),
        );
      }
      const ul = el(doc, "ul", "term-list");
      for (const c of list) {
        const li = el(doc, "li", "term-item");
        const b = el(doc, "button", "scr-btn term-choice");
        b.type = "button";
        b.dataset.container = c.name;
        if (c.name === spec.container) {
          // Conteneur demandé par le serveur : présélectionné et focalisé, jamais ouvert d'office.
          b.classList.add("is-preselected");
          b.setAttribute("aria-current", "true");
          // Focus à la première apparition ; aux rendus suivants (liste actualisée), seulement si le focus
          // était dans le choix (le rendu l'a fait tomber sur le document) : jamais volé à une saisie.
          const first = !preselectFocused;
          preselectFocused = true;
          setTimeout(() => {
            const active = doc.activeElement;
            if (b.isConnected && (first || !active || active === doc.body)) b.focus();
          }, 0);
        }
        b.append(
          el(doc, "span", "term-choice-name", c.name),
          badge(doc, c.kind, c.kind === "autre" ? "mute" : "steel"),
        );
        if (c.image) b.append(el(doc, "span", "term-choice-image", c.image));
        b.disabled = !online;
        b.addEventListener("click", () => start(c.name));
        li.append(b);
        ul.append(li);
      }
      const refresh = actionButton(doc, "Actualiser", "", () =>
        sendShell({ type: "containersList" }),
      );
      refresh.disabled = !online;
      pick.append(ul, refresh);
    }

    function measure() {
      if (term === null || fit === null || view.clientWidth === 0 || view.clientHeight === 0)
        return;
      try {
        fit.fit();
      } catch {
        return;
      }
      session.resize(term.cols, term.rows);
    }

    function schedule() {
      if (frame !== null || disposed) return;
      frame = setTimeout(() => {
        frame = null;
        measure();
      }, 30);
    }

    async function ensureTerm() {
      if (term !== null) return true;
      try {
        const { Terminal, FitAddon } = await loadXterm();
        if (disposed) return false;
        term = new Terminal({
          fontFamily: FONT,
          fontSize: 13,
          cursorBlink: true,
          scrollback: 5000,
          theme: THEME,
          allowProposedApi: false,
          convertEol: false,
        });
        fit = new FitAddon();
        term.loadAddon(fit);
        view.hidden = false;
        term.open(view);
        term.onData((data) => session.input(data));
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => schedule());
          observer.observe(view);
        }
        return true;
      } catch {
        return false;
      }
    }

    async function start(container) {
      if (opening || session.active()) return;
      opening = true;
      pick.hidden = true;
      view.hidden = false;
      const ready = await ensureTerm();
      opening = false;
      if (!ready || disposed) {
        view.hidden = true;
        pick.hidden = false;
        showNote("Le terminal n'a pas pu se charger.");
        return;
      }
      showNote("");
      term.reset();
      try {
        fit.fit();
      } catch {
        // Fenêtre sans taille (masquée) : l'observateur ajustera à l'affichage.
      }
      session.open(container, term.cols || 80, term.rows || 24);
    }

    const instance = {
      sid,
      key: spec.key,
      session,
      event(msg) {
        const ev = parseTermEvent(msg);
        if (ev !== null) session.handle(ev);
      },
      setContainers(next) {
        containers = next;
        if (session.state() === "idle") renderPick();
      },
      setOnline(value) {
        showNote(
          value || !session.active()
            ? ""
            : "Connexion perdue : la saisie reprend dès la reconnexion.",
        );
        if (session.state() === "idle") renderPick();
      },
      setHalt(active) {
        haltBar.hidden = !active;
      },
      reconnect: () => session.reconnect(),
    };
    instances.set(sid, instance);
    renderPick();
    root.dataset.state = "idle";
    if (online) sendShell({ type: "containersList" });

    return {
      /** Fermer une session active demande une confirmation ; `proceed` ferme ensuite la fenêtre. */
      guardClose(proceed) {
        if (!session.active()) return false;
        pendingProceed = proceed;
        confirm.textContent = "";
        const q = el(
          doc,
          "span",
          "term-confirm-q",
          "Fermer ce terminal arrête la session en cours. Confirmer la fermeture ?",
        );
        const yes = el(doc, "button", "scr-btn scr-btn-danger", "Fermer la session");
        yes.type = "button";
        const no = el(doc, "button", "scr-btn", "Annuler");
        no.type = "button";
        yes.addEventListener("click", () => {
          confirm.hidden = true;
          session.close();
          const go = pendingProceed;
          pendingProceed = null;
          go?.();
        });
        no.addEventListener("click", () => {
          confirm.hidden = true;
          pendingProceed = null;
          term?.focus();
        });
        confirm.append(q, yes, no);
        confirm.hidden = false;
        yes.focus();
        return true;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        if (session.active()) session.close();
        observer?.disconnect();
        if (frame !== null) clearTimeout(frame);
        term?.dispose();
        instances.delete(sid);
        onChange();
      },
    };
  }

  return {
    mount,
    /** Message de la vue `term` pour la session `env.frame`. */
    onTerm(env) {
      instances.get(env.frame)?.event(env.msg);
    },
    /** Messages de la vue `shell` utiles aux terminaux (liste des conteneurs). */
    onMessage(msg) {
      if (msg?.type !== "containers") return;
      containers = parseContainers(msg);
      for (const i of instances.values()) i.setContainers(containers);
    },
    /** Connexion (ré)établie : les sessions actives se réabonnent. */
    onOpen() {
      online = true;
      for (const i of instances.values()) {
        i.reconnect();
        i.setOnline(true);
      }
      if (instances.size > 0) sendShell({ type: "containersList" });
    },
    setOnline(value) {
      online = value;
      for (const i of instances.values()) i.setOnline(value);
    },
    /** État d'arrêt d'urgence : bandeau dans chaque terminal (les sessions ne sont pas coupées). */
    setHalt(active) {
      halt = active === true;
      for (const i of instances.values()) i.setHalt(halt);
    },
    /** Session active (protégée contre une fermeture par un espace de travail). */
    isActive: (key) => [...instances.values()].some((i) => i.key === key && i.session.active()),
    count: () => instances.size,
  };
}
