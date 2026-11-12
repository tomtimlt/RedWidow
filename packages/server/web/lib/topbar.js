// Barre fixe (hors bureau) : marque, compteur d'approbations, aperçu de la plus ancienne, connexion,
// badge Bypass et Arrêt d'urgence. Les fonctions de libellé sont pures ; `createTopbar` ne fait que
// poser du texte (`textContent`) et des états sur des éléments existants.

export const PREVIEW_MAX = 90;
export const BRAND = "RedWidow";

export function truncate(text, max) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Titre de l'onglet : « (N) RedWidow » quand des demandes attendent. */
export const titleFor = (count) => (count > 0 ? `(${count}) ${BRAND}` : BRAND);

/** Aperçu de la plus ancienne demande : outil et résumé tronqué. */
export function oldestPreview(items) {
  const first = items[0];
  return first ? `${truncate(first.tool, 40)} — ${truncate(first.summary, PREVIEW_MAX)}` : "";
}

export function countLabel(count) {
  if (count === 0) return "Aucune demande";
  return count === 1 ? "1 demande" : `${count} demandes`;
}

/** Date en millisecondes depuis un nombre ou une chaîne ISO ; `null` si illisible. */
export function parseInstant(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Durée restante lisible : « 47 min », « 1 h 12 min », « 2 j 3 h ». */
export function formatRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

/**
 * Libellé du badge Bypass, ou `null` s'il ne doit pas s'afficher. État inconnu (message jamais reçu) :
 * pas de badge.
 */
export function bypassLabel(bypass, now) {
  if (bypass?.active !== true) return null;
  if (bypass.until === null || bypass.until === undefined) return "Bypass illimité";
  const until = parseInstant(bypass.until);
  if (until === null) return "Bypass actif";
  return until <= now ? "Bypass expiré" : `Bypass ${formatRemaining(until - now)}`;
}

/** Message `bypass` du serveur → état, ou `null` si la forme est invalide. */
export function parseBypass(msg) {
  if (typeof msg.active !== "boolean") return null;
  if (msg.until === null || msg.until === undefined) return { active: msg.active, until: null };
  const until = parseInstant(msg.until);
  return until === null ? null : { active: msg.active, until };
}

/** Message `halt` du serveur → état, ou `null` si la forme est invalide. */
export function parseHalt(msg) {
  if (typeof msg.active !== "boolean") return null;
  const since = parseInstant(msg.since);
  return { active: msg.active, since };
}

const time = (ms) =>
  new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Libellé et description du bouton d'arrêt selon l'état connu (inconnu : arrêt proposé quand même). */
export function haltButton(halt, requested) {
  if (halt?.active === true) {
    return {
      text: "Reprendre",
      title: "Lever l'arrêt d'urgence : les agents peuvent de nouveau agir",
      state: "active",
    };
  }
  return {
    text: requested ? "Arrêt demandé…" : "Arrêt d'urgence",
    title: "Arrêter tous les agents immédiatement (sans confirmation)",
    state: requested ? "requested" : "idle",
  };
}

export function haltStatus(halt) {
  if (halt?.active !== true) return "";
  return halt.since === null
    ? "Arrêt d'urgence actif"
    : `Arrêt d'urgence actif depuis ${time(halt.since)}`;
}

export function connectionLabel(state) {
  if (state === "open") return "Connecté";
  if (state === "connecting") return "Connexion…";
  return "Hors ligne, reconnexion";
}

/**
 * @param {object} refs éléments de la barre
 * @param {object} handlers { onHalt, onResume, onOpenApprovals }
 */
export function createTopbar(refs, { onHalt, onResume, onOpenApprovals }) {
  let model = null;
  refs.count.addEventListener("click", () => onOpenApprovals());
  refs.preview.addEventListener("click", () => onOpenApprovals());
  refs.halt.addEventListener("click", () => {
    if (model?.halt?.active === true) onResume();
    else onHalt();
  });

  return {
    render(next) {
      model = next;
      refs.count.textContent = String(next.count);
      refs.count.setAttribute("aria-label", `${countLabel(next.count)} en attente`);
      refs.count.classList.toggle("has-pending", next.count > 0);
      refs.preview.textContent = next.count > 0 ? next.preview : "";
      refs.preview.hidden = next.count === 0;
      refs.conn.textContent = connectionLabel(next.conn);
      refs.conn.dataset.state = next.conn;
      const bypass = bypassLabel(next.bypass, next.now);
      refs.bypass.textContent = bypass ?? "";
      refs.bypass.hidden = bypass === null;
      const halt = haltButton(next.halt, next.haltRequested);
      refs.halt.textContent = halt.text;
      refs.halt.title = halt.title;
      refs.halt.dataset.state = halt.state;
      const note = next.haltNote || haltStatus(next.halt);
      refs.haltNote.textContent = note;
      refs.haltNote.hidden = note === "";
    },
    /** Un clignotement du compteur (nouvelle demande) ; ensuite il reste en rouge tant que `count > 0`. */
    flashCount() {
      refs.count.classList.remove("flash");
      // Relecture de la mise en page pour relancer l'animation CSS.
      void refs.count.offsetWidth;
      refs.count.classList.add("flash");
    },
  };
}
