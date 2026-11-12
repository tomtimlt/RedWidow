// Messages du serveur propres au chat et aux fenêtres qu'il ouvre (pur, testable). Aucun accès au DOM.

const FRAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Borne d'affichage du contexte de mission (le serveur le masque et le borne déjà : ceinture et bretelles). */
export const MAX_CONTEXT_CHARS = 4000;
const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,60}$/;

/** Textes français des codes d'erreur du chat connus ; tout autre code reçoit un texte générique. */
const CHAT_ERRORS = {
  "view.failed": "L'opération a échoué. Réessayez.",
  "project.absent": "Aucun projet actif : l'export est impossible.",
  "container.failed": "L'opération sur le conteneur a échoué.",
  "exegol.containerDenied": "Ce conteneur n'est pas autorisé pour le projet actif.",
};

/** Texte d'un toast pour `error {code}` du chat (français, non bloquant). */
export function chatErrorText(code) {
  if (typeof code === "string" && Object.hasOwn(CHAT_ERRORS, code)) return CHAT_ERRORS[code];
  return typeof code === "string" && CODE_PATTERN.test(code)
    ? `Action refusée ou impossible (${code}).`
    : "Action refusée ou impossible.";
}

/** `missionContext {frame, runId, text}` → `{ frame, text }`, ou `null` (forme invalide ou texte vide). */
export function parseMissionContext(msg) {
  if (msg === null || typeof msg !== "object") return null;
  if (typeof msg.frame !== "string" || !FRAME_PATTERN.test(msg.frame)) return null;
  if (typeof msg.text !== "string") return null;
  const text = msg.text.trim();
  if (text === "") return null;
  return {
    frame: msg.frame,
    text: text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…` : text,
  };
}

const MAX_WAITING = 32;

/**
 * Actions à jouer quand la page d'un cadre annonce `ready` (brouillon du chat, `watch` d'un viewer). Une
 * action ponctuelle est jouée une seule fois (un rechargement ne réécrit pas le champ de saisie) ; une
 * action durable est rejouée à chaque `ready` du cadre (le suivi d'un viewer survit au rechargement).
 */
export function createAfterReady() {
  const waiting = new Map();
  const key = (view, frame) => `${view}:${frame}`;
  return {
    /** Remplace les actions du cadre (un nouvel `openWindow` annule les précédentes). */
    set(view, frame, actions) {
      const k = key(view, frame);
      waiting.delete(k);
      if (actions.length === 0) return;
      waiting.set(k, actions);
      while (waiting.size > MAX_WAITING) waiting.delete(waiting.keys().next().value);
    },
    /** Actions à jouer pour ce `ready` ; les ponctuelles sont retirées. */
    take(view, frame) {
      const k = key(view, frame);
      const actions = waiting.get(k);
      if (!actions) return [];
      const rest = actions.filter((a) => a.durable === true);
      if (rest.length === 0) waiting.delete(k);
      else waiting.set(k, rest);
      return actions;
    },
    size: () => waiting.size,
  };
}
