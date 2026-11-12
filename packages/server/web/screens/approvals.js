// Écran Approbations : file complète des demandes en attente (toutes missions), et questions de
// confirmation posées par le serveur (« Toujours autoriser », suppression). Aucune réponse n'est donnée
// sans clic ; aucun focus n'est déplacé.
import { createCardList } from "../lib/approval-card.js";

export const EMPTY_TEXT =
  "Aucune demande en attente. Les demandes des agents apparaîtront ici ; rien n'est approuvé sans votre clic.";

/**
 * @param {Document} doc
 * @param {object} refs { empty, list }
 * @param {object} options { onChoice(key, choice) }
 */
export function createApprovalsScreen(doc, refs, { onChoice }) {
  refs.empty.textContent = EMPTY_TEXT;
  const list = createCardList(doc, refs.list, { onChoice });
  return {
    render(items, ctx) {
      refs.empty.hidden = items.length > 0;
      refs.list.hidden = items.length === 0;
      list.render(items, ctx);
    },
  };
}

const KIND_TITLES = {
  always: "Confirmer « Toujours autoriser »",
  delete: "Confirmer la suppression",
};

/** Message `confirm` du serveur → question, ou `null` si la forme est invalide. */
export function parseConfirm(msg) {
  if (typeof msg.id !== "string" || msg.id === "" || msg.id.length > 200) return null;
  if (msg.kind !== "always" && msg.kind !== "delete") return null;
  if (typeof msg.text !== "string") return null;
  return { id: msg.id, kind: msg.kind, text: msg.text.slice(0, 2000) };
}

/**
 * Zone des questions de confirmation. Une question reste affichée jusqu'à `confirmClosed` du serveur ;
 * un clic envoie `confirmResult` une seule fois.
 *
 * @param {Document} doc
 * @param {HTMLElement} root
 * @param {object} options { answer(id, accepted): boolean }
 */
export function createConfirmZone(doc, root, { answer }) {
  const open = new Map();
  const sync = () => {
    root.hidden = open.size === 0;
  };
  sync();

  const make = (q) => {
    const box = doc.createElement("div");
    box.className = "confirm-box";
    box.setAttribute("role", "group");
    const title = doc.createElement("p");
    title.className = "confirm-title";
    title.textContent = KIND_TITLES[q.kind];
    const body = doc.createElement("p");
    body.className = "confirm-text";
    body.textContent = q.text;
    const actions = doc.createElement("div");
    actions.className = "appr-actions";
    const buttons = [];
    for (const [accepted, label, cls] of [
      [true, "Confirmer", "appr-once"],
      [false, "Annuler", "appr-deny"],
    ]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `appr-btn ${cls}`;
      button.textContent = label;
      button.addEventListener("click", () => {
        if (button.disabled) return;
        if (!answer(q.id, accepted)) return;
        for (const b of buttons) b.disabled = true;
      });
      buttons.push(button);
      actions.append(button);
    }
    box.append(title, body, actions);
    return { box, buttons };
  };

  return {
    show(msg) {
      const q = parseConfirm(msg);
      if (q === null || open.has(q.id)) return;
      const built = make(q);
      open.set(q.id, built);
      root.append(built.box);
      sync();
    },
    close(id) {
      const entry = open.get(id);
      if (!entry) return;
      entry.box.remove();
      open.delete(id);
      sync();
    },
    /** Connexion perdue : les questions n'ont plus d'interlocuteur, le serveur les ré-annonce à la reconnexion. */
    clear() {
      for (const entry of open.values()) entry.box.remove();
      open.clear();
      sync();
    },
    size: () => open.size,
  };
}
