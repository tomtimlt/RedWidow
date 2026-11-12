// Écran Comptes de test : identifiants de test par programme. L'identifiant de connexion s'affiche en
// clair (choix de l'utilisateur) ; le mot de passe n'est jamais dans la liste. « Révéler » le demande au
// serveur, l'affiche 30 s puis l'efface du DOM : la valeur ne vit que dans un nœud de texte, jamais dans
// une variable de l'écran, un stockage ou la console.
import {
  actionButton,
  badge,
  confirmButton,
  el,
  emptyState,
  field,
  formatDate,
  isRecord,
  row,
  safeText,
  screenRoot,
  secretInput,
  statusLine,
  syncOnline,
  table,
  textInput,
} from "./common.js";

export const REVEAL_MS = 30000;
/** Libellé de compte accepté par le serveur (miroir de `ACCOUNT_LABEL`). */
export const ACCOUNT_LABEL = /^[A-Z][A-Z0-9_]{0,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Attente de la réponse à une révélation demandée. */
export const PENDING_MS = 10000;

/** Message `accounts` → comptes lisibles ; accepte `createdAt` (serveur) et `date`. Aucun secret ici. */
export function parseAccounts(msg) {
  if (!isRecord(msg) || !Array.isArray(msg.items)) return [];
  const out = [];
  for (const it of msg.items.slice(0, 500)) {
    if (!isRecord(it) || typeof it.id !== "string" || !UUID.test(it.id)) continue;
    out.push({
      id: it.id,
      programme: safeText(it.programme, 80),
      label: safeText(it.label, 16),
      login: safeText(it.login, 512),
      createdBy: it.createdBy === "agent" ? "agent" : "human",
      date: it.createdAt ?? it.date ?? null,
    });
  }
  return out;
}

/** Programmes distincts, dans l'ordre alphabétique. */
export const programmesOf = (items) => [...new Set(items.map((a) => a.programme))].sort();

/** Contrôle du formulaire d'ajout : message d'erreur ou `null`. */
export function checkAccount({ programme, label, login, secret }) {
  const p = programme.trim();
  if (p === "" || p.length > 80) return "Programme : 1 à 80 caractères.";
  if (!ACCOUNT_LABEL.test(label.trim()))
    return "Libellé : majuscules, chiffres et « _ », 16 caractères au plus, première lettre obligatoire (ex. USER_A).";
  if (login.trim() === "" || login.length > 512)
    return "Identifiant de connexion : 1 à 512 caractères.";
  if (secret === "") return "Saisissez le mot de passe.";
  return null;
}

/**
 * Révélations en cours. Chaque révélation tient un compte à rebours de `ms` ; à l'échéance (ou sur
 * `clearAll`) le nœud de texte est vidé et plus rien ne subsiste. Les minuteries sont injectables.
 */
export function createRevealer({
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  ms = REVEAL_MS,
  onChange = () => {},
} = {}) {
  /** id → { node, timer, endsAt } ; `node` porte seul la valeur. */
  const shown = new Map();
  const pending = new Map();
  const hide = (id) => {
    const entry = shown.get(id);
    if (!entry) return;
    clearTimer(entry.timer);
    entry.node.textContent = "";
    shown.delete(id);
    onChange();
  };
  return {
    /** Une révélation vient d'être demandée pour `id` : la prochaine réponse pour cet id sera acceptée. */
    expect(id) {
      const old = pending.get(id);
      if (old !== undefined) clearTimer(old);
      pending.set(
        id,
        setTimer(() => pending.delete(id), PENDING_MS),
      );
    },
    isPending: (id) => pending.has(id),
    /** Réponse du serveur : la valeur est posée dans `node` (textContent) sans être gardée ailleurs. */
    reveal(id, node, value, now = Date.now()) {
      const timer = pending.get(id);
      if (timer === undefined) return false;
      clearTimer(timer);
      pending.delete(id);
      hide(id);
      node.textContent = value;
      shown.set(id, { node, endsAt: now + ms, timer: setTimer(() => hide(id), ms) });
      onChange();
      return true;
    },
    hide,
    clearAll() {
      for (const id of [...shown.keys()]) hide(id);
      for (const t of pending.values()) clearTimer(t);
      pending.clear();
    },
    node: (id) => shown.get(id)?.node ?? null,
    remainingMs: (id, now = Date.now()) => {
      const e = shown.get(id);
      return e ? Math.max(0, e.endsAt - now) : 0;
    },
    isShown: (id) => shown.has(id),
    size: () => shown.size,
  };
}

const COLUMNS = [
  { key: "label", label: "Libellé", className: "col-mono" },
  { key: "login", label: "Identifiant", className: "col-mono" },
  { key: "by", label: "Auteur" },
  { key: "date", label: "Créé le" },
  { key: "secret", label: "Mot de passe", className: "col-secret" },
  { key: "act", label: "Action", className: "col-act" },
];

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean, setTimer?: Function, clearTimer?: Function, now?: () => number }} deps
 */
export function createAccountsScreen(doc, { send, setTimer, clearTimer, now = () => Date.now() }) {
  const root = screenRoot(doc, "accounts", "Comptes de test");
  let items = [];
  let loaded = false;
  let online = false;
  let filter = "";
  /** id → nœud `<code>` persistant (seul porteur d'une valeur révélée) et son compte à rebours. */
  const cells = new Map();
  const counters = new Map();
  let ticker = null;

  const tick = () => {
    for (const [id, c] of counters) {
      c.textContent = revealer.isShown(id)
        ? `efface dans ${Math.ceil(revealer.remainingMs(id, now()) / 1000)} s`
        : "";
    }
    if (revealer.size() === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
  const revealer = createRevealer({
    setTimer,
    clearTimer,
    onChange: () => {
      if (revealer.size() > 0 && ticker === null) ticker = setInterval(tick, 1000);
      tick();
      renderRows();
    },
  });

  // ── Barre : filtre par programme ──
  const bar = el(doc, "div", "scr-toolbar");
  const select = el(doc, "select", "scr-input");
  select.addEventListener("change", () => {
    filter = select.value;
    renderRows();
  });
  bar.append(field(doc, "Programme", select));
  const note = el(
    doc,
    "p",
    "scr-note",
    "Les mots de passe sont chiffrés côté serveur. « Révéler » les affiche 30 secondes puis les efface.",
  );

  const body = el(doc, "div", "scr-body");

  // ── Formulaire d'ajout ──
  const addSection = el(doc, "section", "scr-section");
  addSection.append(el(doc, "h2", "scr-h2", "Ajouter un compte"));
  const fProgramme = textInput(doc, { placeholder: "nom du programme", maxLength: 80 });
  const list = el(doc, "datalist");
  list.id = "accounts-programmes";
  fProgramme.setAttribute("list", list.id);
  const fLabel = textInput(doc, { placeholder: "USER_A", maxLength: 16 });
  const fLogin = textInput(doc, { placeholder: "alice@example.test", maxLength: 512 });
  const fSecret = secretInput(doc, "Mot de passe");
  const status = statusLine(doc);
  const add = actionButton(doc, "Ajouter", "scr-btn-primary", () => {
    const input = {
      programme: fProgramme.value,
      label: fLabel.value,
      login: fLogin.value,
      secret: fSecret.value,
    };
    const problem = checkAccount(input);
    if (problem !== null) {
      status.set(problem, "err");
      return;
    }
    const ok = send({
      type: "accountAdd",
      programme: input.programme.trim(),
      label: input.label.trim(),
      login: input.login.trim(),
      secret: input.secret,
    });
    // Vidé tout de suite : le mot de passe ne reste pas dans la page.
    fSecret.value = "";
    if (ok) {
      fLabel.value = "";
      fLogin.value = "";
      status.set("Compte transmis.", "ok");
    } else status.set("Hors ligne : le compte n'a pas été transmis.", "err");
  });
  const form = el(doc, "div", "scr-form");
  form.append(
    field(doc, "Programme", fProgramme),
    field(doc, "Libellé", fLabel),
    field(doc, "Identifiant", fLogin),
    field(doc, "Mot de passe", fSecret),
    add,
  );
  addSection.append(form, status.node, list);

  root.append(bar, note, body, addSection);

  function renderFilter() {
    const programmes = programmesOf(items);
    if (filter !== "" && !programmes.includes(filter)) filter = "";
    select.textContent = "";
    const all = el(doc, "option", "", "Tous les programmes");
    all.value = "";
    select.append(all);
    for (const p of programmes) {
      const o = el(doc, "option", "", p);
      o.value = p;
      select.append(o);
    }
    select.value = filter;
    list.textContent = "";
    for (const p of programmes) {
      const o = el(doc, "option");
      o.value = p;
      list.append(o);
    }
  }

  function secretCell(a) {
    const wrap = el(doc, "span", "scr-secret-cell");
    if (revealer.isShown(a.id)) {
      const node = revealer.node(a.id);
      const counter = el(doc, "span", "scr-hint");
      counters.set(a.id, counter);
      counter.textContent = `efface dans ${Math.ceil(revealer.remainingMs(a.id, now()) / 1000)} s`;
      wrap.append(node, counter);
    } else wrap.append(el(doc, "span", "scr-mask", "••••••••"));
    return wrap;
  }

  function renderRows() {
    body.textContent = "";
    counters.clear();
    if (!loaded) {
      body.append(emptyState(doc, "Chargement…", "Lecture des comptes auprès du serveur."));
      return;
    }
    const shownItems = items.filter((a) => filter === "" || a.programme === filter);
    if (shownItems.length === 0) {
      body.append(
        emptyState(
          doc,
          items.length === 0 ? "Aucun compte de test." : "Aucun compte pour ce programme.",
          "Ajoutez un compte avec le formulaire ci-dessous : les agents s'en servent pour tester les accès. Les comptes qu'un agent crée apparaîtront ici avec le badge « agent ».",
        ),
      );
      syncOnline(root, online);
      return;
    }
    const t = table(doc, COLUMNS, "Comptes de test");
    for (const a of shownItems) {
      const reveal = actionButton(doc, revealer.isShown(a.id) ? "Masquer" : "Révéler", "", () => {
        if (revealer.isShown(a.id)) {
          revealer.hide(a.id);
          return;
        }
        if (!cells.has(a.id)) cells.set(a.id, el(doc, "code", "scr-secret-value"));
        revealer.expect(a.id);
        if (!send({ type: "accountReveal", id: a.id }))
          status.set("Hors ligne : demande non transmise.", "err");
      });
      reveal.setAttribute(
        "aria-label",
        `${revealer.isShown(a.id) ? "Masquer" : "Révéler"} le mot de passe ${a.label}`,
      );
      const remove = confirmButton(doc, {
        label: "Retirer",
        question: `Retirer le compte ${a.label} ?`,
        confirmLabel: "Retirer",
        onConfirm: () => {
          revealer.hide(a.id);
          if (!send({ type: "accountRemove", id: a.id }))
            status.set("Hors ligne : retrait non transmis.", "err");
        },
      });
      const acts = el(doc, "span", "scr-acts");
      acts.append(reveal, remove);
      const tr = row(
        doc,
        COLUMNS,
        [
          a.label,
          a.login,
          badge(
            doc,
            a.createdBy === "agent" ? "agent" : "humain",
            a.createdBy === "agent" ? "crimson" : "steel",
          ),
          formatDate(a.date),
          secretCell(a),
          acts,
        ],
        a.createdBy === "agent" ? "is-agent" : "",
      );
      if (filter === "") tr.dataset.programme = a.programme;
      t.tbody.append(tr);
    }
    body.append(t.wrap);
    syncOnline(root, online);
  }

  renderFilter();
  renderRows();

  return {
    root,
    onMessage(msg) {
      if (msg.type === "accounts") {
        items = parseAccounts(msg);
        loaded = true;
        // Un compte retiré ne garde aucune valeur affichée.
        for (const id of [...cells.keys()]) {
          if (!items.some((a) => a.id === id)) {
            revealer.hide(id);
            cells.delete(id);
          }
        }
        renderFilter();
        renderRows();
      } else if (msg.type === "accountSecret") {
        if (typeof msg.id !== "string" || typeof msg.value !== "string") return;
        const node = cells.get(msg.id);
        // Réponse non demandée par cet écran : ignorée, jamais affichée.
        if (!node || !revealer.isPending(msg.id)) return;
        revealer.reveal(msg.id, node, msg.value, now());
      } else if (
        msg.type === "configError" &&
        ["accountAdd", "accountReveal", "accountRemove"].includes(msg.op)
      ) {
        status.set(
          msg.op === "accountAdd"
            ? "Ajout refusé : plafond atteint, libellé déjà pris pour ce programme ou valeur invalide."
            : "Le serveur a refusé l'opération.",
          "err",
        );
      }
    },
    refresh: () => send({ type: "accounts" }),
    /** Connexion perdue ou page quittée : plus aucune valeur ne reste affichée. */
    clearSecrets: () => revealer.clearAll(),
    setOnline(value) {
      online = value;
      if (!online) revealer.clearAll();
      syncOnline(root, online);
    },
    revealer,
  };
}
