// Écran Journal : liste des runs du serveur (missions et terminaux : type, taille, date) avec ouverture
// d'un Monitor, fil d'audit du serveur (`auditTail`) et fil des événements reçus pendant la session
// (bascules de clés, erreurs, Bypass, arrêt). Un run peut aussi s'ouvrir par son identifiant.
import { formatSize, parseAudit, parseRuns } from "../lib/lists.js";
import {
  actionButton,
  badge,
  el,
  emptyState,
  field,
  formatDate,
  formatTime,
  row,
  safeText,
  screenRoot,
  statusLine,
  syncOnline,
  table,
  textInput,
} from "./common.js";

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_RECENT = 10;
export const MAX_ENTRIES = 100;
/** Entrées d'audit demandées au serveur (il en plafonne le nombre). */
export const AUDIT_LIMIT = 50;

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
export function createJournalScreen(doc, { onOpenMonitor, send = () => false }) {
  const root = screenRoot(doc, "journal", "Journal");
  let recent = [];
  /** Entrées de la session : { at, text, tone }, la plus récente en premier. */
  let entries = [];
  let runs = [];
  let audit = [];
  let online = false;

  const runSection = el(doc, "section", "scr-section");
  const runHead = el(doc, "div", "scr-toolbar");
  runHead.append(el(doc, "h2", "scr-h2", "Runs"));
  const refreshBtn = actionButton(doc, "Actualiser", "", () => refresh());
  runHead.append(refreshBtn);
  runSection.append(runHead);
  const runsEmpty = emptyState(
    doc,
    "Aucun run enregistré.",
    "Les journaux des missions et des terminaux apparaissent ici dès qu'un run existe ; le Monitor s'ouvre d'un clic.",
  );
  const RUN_COLUMNS = [
    { key: "kind", label: "Type" },
    { key: "id", label: "Identifiant", className: "col-mono" },
    { key: "project", label: "Projet", className: "col-mono" },
    { key: "date", label: "Date" },
    { key: "size", label: "Taille" },
    { key: "act", label: "Action", className: "col-act" },
  ];
  const runsTable = table(doc, RUN_COLUMNS, "Runs enregistrés");
  runsTable.wrap.hidden = true;
  runSection.append(runsEmpty, runsTable.wrap);
  runSection.append(el(doc, "h3", "scr-h3", "Ouvrir par identifiant"));
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

  const auditSection = el(doc, "section", "scr-section");
  auditSection.append(el(doc, "h2", "scr-h2", "Journal d'audit du serveur"));
  const auditEmpty = emptyState(
    doc,
    "Aucune entrée d'audit.",
    "Les gestes sensibles (réponses d'approbation, Bypass, révélations, terminaux) sont consignés ici, sans valeur secrète.",
  );
  const auditList = el(doc, "ol", "scr-feed");
  auditSection.append(auditEmpty, auditList);

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
  root.append(runSection, auditSection, feedSection);

  function renderRuns() {
    runsTable.tbody.textContent = "";
    runsEmpty.hidden = runs.length > 0;
    runsTable.wrap.hidden = runs.length === 0;
    for (const r of runs) {
      const open = actionButton(doc, "Ouvrir le Monitor", "", () => onOpenMonitor(r.id));
      open.dataset.run = r.id;
      const tr = row(
        doc,
        RUN_COLUMNS,
        [
          badge(
            doc,
            r.kind === "terminal" ? "terminal" : "mission",
            r.kind === "terminal" ? "crimson" : "steel",
          ),
          r.id,
          r.project ?? "—",
          formatDate(r.startedAt),
          formatSize(r.size),
          open,
        ],
        "scr-run",
      );
      runsTable.tbody.append(tr);
    }
    syncOnline(root, online);
  }

  function renderAudit() {
    auditList.textContent = "";
    auditEmpty.hidden = audit.length > 0;
    for (const a of audit) {
      const li = el(doc, "li", "scr-feed-item tone-mute");
      li.append(
        el(doc, "time", "scr-feed-time", formatDate(a.at)),
        badge(doc, a.kind, "mute"),
        el(doc, "span", "scr-feed-text", a.detail),
      );
      auditList.append(li);
    }
  }

  function refresh() {
    send({ type: "runsList" });
    send({ type: "auditTail", limit: AUDIT_LIMIT });
  }

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
    /** Messages `runs` et `audit` du serveur. */
    onMessage(msg) {
      if (msg?.type === "runs") {
        runs = parseRuns(msg);
        renderRuns();
      } else if (msg?.type === "audit") {
        audit = parseAudit(msg);
        renderAudit();
      }
    },
    refresh,
    setOnline(value) {
      online = value;
      syncOnline(root, online);
    },
  };
}
