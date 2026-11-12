// Cartes d'approbation. Règles : un clic = un `approve` ; aucun `approve` sans clic (jamais à
// l'arrivée d'une liste, à la reconnexion, sur une minuterie ou une touche) ; « Toujours » absent si
// la demande n'est pas mémorisable ; le focus n'est jamais déplacé vers une carte. Toute donnée reçue
// est posée en `textContent`.

export const UNCONFIRMED_AFTER_MS = 10000;

/** Choix proposés pour une demande : « Toujours » seulement si le cœur la dit mémorisable. */
export function choicesFor(item) {
  return item.canRemember === true ? ["once", "deny", "always"] : ["once", "deny"];
}

export const cardKey = (item) => `${item.frame}/${item.toolUseId}`;

const LABELS = {
  once: "Autoriser une fois",
  deny: "Refuser",
  always: "Toujours autoriser",
};

/** Forme exacte d'un élément de la liste `approvals`, ou `null`. */
export function parseApprovalItem(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const { frame, toolUseId, tool, summary, canRemember, confirming } = raw;
  if (typeof frame !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(frame)) return null;
  if (typeof toolUseId !== "string" || toolUseId === "" || toolUseId.length > 200) return null;
  if (typeof tool !== "string" || typeof summary !== "string") return null;
  return {
    frame,
    toolUseId,
    tool: tool.slice(0, 200),
    summary: summary.slice(0, 4000),
    canRemember: canRemember === true,
    confirming: confirming === true,
  };
}

export function parseApprovalList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw.slice(0, 200)) {
    const item = parseApprovalItem(entry);
    if (item === null || seen.has(cardKey(item))) continue;
    seen.add(cardKey(item));
    out.push(item);
  }
  return out;
}

/**
 * État des demandes et de leurs réponses. `click` est la seule porte vers `send` : il est appelé par un
 * gestionnaire de clic, jamais par la réception d'une liste.
 *
 * @param {object} options
 * @param {(frame: string, toolUseId: string, choice: string) => boolean} options.send
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @param {() => void} [options.onChange]
 */
export function createApprovalTracker({
  send,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  onChange = () => {},
}) {
  let items = [];
  /** clé → { status: "sent" | "unconfirmed" | "offline", timer } */
  const statuses = new Map();

  const drop = (key) => {
    const entry = statuses.get(key);
    if (entry?.timer != null) clearTimer(entry.timer);
    statuses.delete(key);
  };

  return {
    items: () => items,
    status: (key) => statuses.get(key)?.status,
    /** Remplace la liste ; renvoie les demandes apparues. L'accusé est la disparition de la demande. */
    update(next) {
      const before = new Set(items.map(cardKey));
      const now = new Set(next.map(cardKey));
      for (const key of [...statuses.keys()]) if (!now.has(key)) drop(key);
      items = next;
      const added = next.filter((i) => !before.has(cardKey(i)));
      onChange();
      return added;
    },
    /** Hors ligne : les réponses en cours restent « envoyées » côté serveur ou perdues ; rien n'est rejoué. */
    connectionLost() {
      for (const key of [...statuses.keys()]) drop(key);
      onChange();
    },
    /**
     * Réponse de l'humain à une demande. Renvoie "sent" | "offline" | "ignored".
     * Refus silencieux (« ignored ») : demande absente, déjà répondue, confirmation en cours, choix interdit.
     */
    click(key, choice) {
      const item = items.find((i) => cardKey(i) === key);
      if (!item || item.confirming) return "ignored";
      if (!choicesFor(item).includes(choice)) return "ignored";
      const current = statuses.get(key)?.status;
      if (current === "sent") return "ignored";
      drop(key);
      if (!send(item.frame, item.toolUseId, choice)) {
        statuses.set(key, { status: "offline", timer: null });
        onChange();
        return "offline";
      }
      const timer = setTimer(() => {
        const entry = statuses.get(key);
        if (entry?.status === "sent") {
          statuses.set(key, { status: "unconfirmed", timer: null });
          onChange();
        }
      }, UNCONFIRMED_AFTER_MS);
      statuses.set(key, { status: "sent", timer });
      onChange();
      return "sent";
    },
  };
}

const NOTES = {
  sent: "Réponse envoyée, en attente de l'accusé du serveur…",
  unconfirmed:
    "Non confirmé : le serveur n'a pas accusé réception. Vous pouvez répondre à nouveau.",
  offline: "Hors ligne : la réponse n'a pas été envoyée. Rien n'est mis en file.",
  confirming: "Confirmation en cours : répondez à la question affichée.",
};

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Construit une carte (squelette) ; `updateCard` pose le contenu et l'état. */
function buildCard(doc, key, onChoice) {
  const card = el(doc, "article", "appr-card");
  card.dataset.key = key;
  const head = el(doc, "header", "appr-head");
  head.append(el(doc, "span", "appr-tool"), el(doc, "a", "appr-mission"));
  const summary = el(doc, "pre", "appr-summary");
  const note = el(doc, "p", "appr-note");
  note.setAttribute("role", "status");
  const actions = el(doc, "div", "appr-actions");
  for (const choice of ["once", "deny", "always"]) {
    const button = el(doc, "button", `appr-btn appr-${choice}`, LABELS[choice]);
    button.type = "button";
    button.dataset.choice = choice;
    button.addEventListener("click", () => onChoice(key, choice));
    actions.append(button);
  }
  card.append(head, summary, note, actions);
  return card;
}

function updateCard(card, item, status, online) {
  card.querySelector(".appr-tool").textContent = item.tool;
  const link = card.querySelector(".appr-mission");
  link.textContent = `mission ${item.frame}`;
  link.href = `#w=mission:${item.frame}`;
  card.querySelector(".appr-summary").textContent = item.summary;
  const blocked = item.confirming || status === "sent";
  const noteText = item.confirming ? NOTES.confirming : status ? NOTES[status] : "";
  const note = card.querySelector(".appr-note");
  note.textContent = noteText;
  note.hidden = noteText === "";
  card.classList.toggle("is-sent", status === "sent");
  card.classList.toggle("is-warn", status === "unconfirmed" || status === "offline");
  const allowed = choicesFor(item);
  for (const button of card.querySelectorAll(".appr-btn")) {
    const choice = button.dataset.choice;
    button.hidden = !allowed.includes(choice);
    button.disabled = blocked || !online;
  }
}

/**
 * Liste de cartes à clés stables : une carte existante est mise à jour sur place (pas de
 * reconstruction qui avalerait un clic), et aucune opération ne touche au focus.
 */
export function createCardList(doc, container, { onChoice }) {
  const cards = new Map();
  return {
    render(items, { status, online }) {
      const keep = new Set();
      let previous = null;
      for (const item of items) {
        const key = cardKey(item);
        keep.add(key);
        let card = cards.get(key);
        if (!card) {
          card = buildCard(doc, key, onChoice);
          cards.set(key, card);
        }
        updateCard(card, item, status(key), online);
        const expected = previous ? previous.nextSibling : container.firstChild;
        if (card !== expected) container.insertBefore(card, expected);
        previous = card;
      }
      for (const [key, card] of [...cards]) {
        if (!keep.has(key)) {
          card.remove();
          cards.delete(key);
        }
      }
    },
  };
}
