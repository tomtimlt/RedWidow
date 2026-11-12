// Écran Journal : le serveur ne fournit pas encore la liste des runs ni le journal d'audit. L'écran ouvre
// donc le Monitor d'un run à partir de son identifiant, retient les derniers runs ouverts depuis cette page
// et affiche le fil des événements reçus pendant la session (bascules de clés, erreurs, Bypass, arrêt).
// Aucune API n'est inventée.
import {
  badge,
  el,
  emptyState,
  field,
  formatTime,
  safeText,
  screenRoot,
  statusLine,
  textInput,
} from "./common.js";

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_RECENT = 10;
export const MAX_ENTRIES = 100;

/** Identifiant de run saisi → identifiant valide ou `null`. */
export function cleanRunId(raw) {
  const id = typeof raw === "string" ? raw.trim() : "";
  return RUN_ID.test(id) ? id : null;
}

/** Ajoute un run aux récents (le plus récent en tête, sans doublon, borné). */
export function pushRecent(list, id) {
  return [id, ...list.filter((r) => r !== id)].slice(0, MAX_RECENT);
}

/**
 * @param {Document} doc
 * @param {{ onOpenMonitor(id: string): void }} deps
 */
export function createJournalScreen(doc, { onOpenMonitor }) {
  const root = screenRoot(doc, "journal", "Journal");
  let recent = [];
  /** Entrées de la session : { at, text, tone }, la plus récente en premier. */
  let entries = [];

  const runSection = el(doc, "section", "scr-section");
  runSection.append(el(doc, "h2", "scr-h2", "Ouvrir un run"));
  runSection.append(
    emptyState(
      doc,
      "La liste des runs n'est pas encore fournie par le serveur.",
      "Saisissez l'identifiant d'un run pour ouvrir son Monitor : il affiche le flux des événements et l'audit du run, quand ils sont disponibles.",
    ),
  );
  const input = textInput(doc, { placeholder: "identifiant du run", maxLength: 64 });
  const status = statusLine(doc);
  const open = el(doc, "button", "scr-btn scr-btn-primary", "Ouvrir le Monitor");
  open.type = "button";
  const submit = (raw) => {
    const id = cleanRunId(raw);
    if (id === null) {
      status.set(
        "Identifiant refusé : lettres, chiffres, « _ » et « - », 64 caractères au plus.",
        "err",
      );
      return;
    }
    status.set("", "mute");
    recent = pushRecent(recent, id);
    renderRecent();
    onOpenMonitor(id);
  };
  open.addEventListener("click", () => submit(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit(input.value);
  });
  const form = el(doc, "div", "scr-form");
  form.append(field(doc, "Identifiant du run", input), open);
  const recentBox = el(doc, "div", "scr-recent");
  runSection.append(form, status.node, recentBox);

  const feedSection = el(doc, "section", "scr-section");
  feedSection.append(el(doc, "h2", "scr-h2", "Événements de cette session"));
  const feedEmpty = emptyState(
    doc,
    "Aucun événement depuis l'ouverture de cette page.",
    "Les bascules de clés, les erreurs de conteneur, le Bypass et l'arrêt d'urgence s'affichent ici dès qu'ils se produisent.",
  );
  const feed = el(doc, "ol", "scr-feed");
  feed.setAttribute("aria-live", "polite");
  feedSection.append(feedEmpty, feed);
  root.append(runSection, feedSection);

  function renderRecent() {
    recentBox.textContent = "";
    if (recent.length === 0) return;
    recentBox.append(el(doc, "span", "scr-label", "Récents"));
    for (const id of recent) {
      const b = el(doc, "button", "scr-btn scr-chip", id);
      b.type = "button";
      b.addEventListener("click", () => submit(id));
      recentBox.append(b);
    }
  }

  function renderFeed() {
    feed.textContent = "";
    feedEmpty.hidden = entries.length > 0;
    for (const e of entries) {
      const li = el(doc, "li", `scr-feed-item tone-${e.tone}`);
      li.append(
        el(doc, "time", "scr-feed-time", formatTime(e.at)),
        badge(doc, e.tag, e.tone),
        el(doc, "span", "scr-feed-text", e.text),
      );
      feed.append(li);
    }
  }
  renderFeed();

  return {
    root,
    /** Ajoute un événement (texte court, déjà sans secret). `tag` : catégorie affichée en pastille. */
    push(tag, text, tone = "mute", at = Date.now()) {
      entries = [{ at, tag: safeText(tag, 20), text: safeText(text, 300), tone }, ...entries].slice(
        0,
        MAX_ENTRIES,
      );
      renderFeed();
    },
    entries: () => entries.slice(),
    setOnline() {},
  };
}
