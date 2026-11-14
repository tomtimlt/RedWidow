// Briques communes des écrans natifs : création d'éléments, badges, états vides, dates, confirmation en
// ligne (jamais `window.confirm`), libellés des codes de raison. Aucune donnée reçue n'est insérée en HTML :
// tout passe par `textContent`.

export const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Pastille d'état. `tone` : ok, warn, err, steel, crimson, mute. */
export function badge(doc, text, tone = "mute") {
  return el(doc, "span", `scr-badge tone-${tone}`, text);
}

/** État vide : dit ce qu'il se passe et quoi faire. */
export function emptyState(doc, title, text) {
  const box = el(doc, "div", "scr-empty");
  box.append(el(doc, "p", "scr-empty-title", title), el(doc, "p", "scr-empty-text", text));
  return box;
}

const toMs = (value) =>
  typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
const pad = (n) => String(n).padStart(2, "0");

/** Date lisible (fuseau local) depuis un nombre (ms) ou une chaîne ISO ; « — » si illisible. */
export function formatDate(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Heure lisible (HH:MM:SS) ; « — » si illisible. */
export function formatTime(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export { reasonText } from "../lib/reasons.js";

/** Chaîne bornée sans caractère de contrôle (donnée reçue : jamais confiance). */
export function safeText(value, max = 200) {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value.slice(0, max)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
}

export const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Active ou désactive les boutons d'action selon la connexion : `data-act` marque un bouton qui envoie
 * quelque chose ; `data-lock="1"` le garde désactivé tant qu'une réponse est attendue.
 */
export function syncOnline(root, online) {
  for (const b of root.querySelectorAll("[data-act]")) {
    b.disabled = !online || b.dataset.lock === "1";
  }
}

/** Bouton d'action (marqué `data-act`). */
export function actionButton(doc, label, className, onClick) {
  const b = el(doc, "button", `scr-btn ${className ?? ""}`.trim(), label);
  b.type = "button";
  b.dataset.act = "1";
  b.addEventListener("click", () => {
    if (!b.disabled) onClick(b);
  });
  return b;
}

/**
 * Bouton à confirmation en ligne : un premier clic affiche la question avec « Confirmer » et « Annuler »,
 * le second clic exécute. Rien n'est envoyé au premier clic.
 */
export function confirmButton(doc, { label, question, confirmLabel = "Confirmer", onConfirm }) {
  const wrap = el(doc, "span", "scr-confirm");
  const box = el(doc, "span", "scr-confirm-box");
  box.hidden = true;
  box.setAttribute("role", "group");
  const ask = actionButton(doc, label, "scr-btn-danger", () => {
    ask.hidden = true;
    box.hidden = false;
    yes.focus();
  });
  const text = el(doc, "span", "scr-confirm-q", question);
  const yes = actionButton(doc, confirmLabel, "scr-btn-primary", () => {
    box.hidden = true;
    ask.hidden = false;
    onConfirm();
  });
  const no = el(doc, "button", "scr-btn", "Annuler");
  no.type = "button";
  no.addEventListener("click", () => {
    box.hidden = true;
    ask.hidden = false;
    ask.focus();
  });
  box.append(text, yes, no);
  wrap.append(ask, box);
  return wrap;
}

/** Champ de formulaire étiqueté. `input` est un élément déjà configuré. */
export function field(doc, labelText, input, hint) {
  const wrap = el(doc, "label", "scr-field");
  wrap.append(el(doc, "span", "scr-label", labelText), input);
  if (hint) wrap.append(el(doc, "span", "scr-hint", hint));
  return wrap;
}

/** Champ texte. */
export function textInput(doc, { placeholder = "", maxLength = 200 } = {}) {
  const input = el(doc, "input", "scr-input");
  input.type = "text";
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  return input;
}

/** Champ secret : `type=password`, `autocomplete=off`, vidé par l'appelant juste après l'envoi. */
export function secretInput(doc, placeholder = "") {
  const input = el(doc, "input", "scr-input scr-secret");
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.maxLength = 8192;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  return input;
}

/** Ligne d'état de formulaire (succès ou erreur), annoncée aux lecteurs d'écran. */
export function statusLine(doc) {
  const node = el(doc, "p", "scr-status");
  node.setAttribute("role", "status");
  node.hidden = true;
  return {
    node,
    set(text, tone = "mute") {
      node.textContent = text;
      node.className = `scr-status tone-${tone}`;
      node.hidden = text === "";
    },
  };
}

/** Racine d'un écran : section accessible avec titre (visible dans la page, masqué dans une fenêtre). */
export function screenRoot(doc, id, title) {
  const root = el(doc, "section", "screen scr");
  root.id = `screen-${id}`;
  root.setAttribute("aria-labelledby", `${id}-title`);
  const h1 = el(doc, "h1", "", title);
  h1.id = `${id}-title`;
  root.append(h1);
  return root;
}

/** Tableau dense : `columns` = [{ key, label }] ; renvoie { table, tbody }. `data-label` sert au mode carte. */
export function table(doc, columns, caption) {
  const wrap = el(doc, "div", "scr-table-wrap");
  const t = el(doc, "table", "scr-table");
  if (caption) t.append(el(doc, "caption", "scr-sr", caption));
  const head = el(doc, "thead");
  const tr = el(doc, "tr");
  for (const c of columns) {
    const th = el(doc, "th", "", c.label);
    th.scope = "col";
    tr.append(th);
  }
  head.append(tr);
  const tbody = el(doc, "tbody");
  t.append(head, tbody);
  wrap.append(t);
  return { wrap, table: t, tbody };
}

/** Ligne de tableau : `cells` = [Node|string] alignées sur `columns`. */
export function row(doc, columns, cells, className) {
  const tr = el(doc, "tr", className);
  columns.forEach((c, i) => {
    const td = el(doc, "td", c.className);
    td.dataset.label = c.label;
    const cell = cells[i];
    if (cell instanceof Node) td.append(cell);
    else if (cell !== undefined) td.textContent = String(cell);
    tr.append(td);
  });
  return tr;
}
