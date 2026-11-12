// Écran Trouvailles : faits relevés par les agents dans le graphe d'un projet (hôtes, identifiants, sites,
// étapes, butin), filtre par projet, détail avec preuves, suppression confirmée et export du rapport.
// Le modèle n'a pas de gravité : aucune n'est affichée ni inventée. Le rapport est construit par le serveur
// (`GET /api/report`) : le navigateur ne génère aucun Markdown, il ne fait que proposer le lien. Les
// preuves arrivent en texte brut et s'affichent en `textContent`.
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
  statusLine,
  syncOnline,
  table,
} from "./common.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KIND_LABELS = {
  host: "hôte",
  credential: "identifiant",
  site: "site",
  step: "étape",
  loot: "butin",
};
const STATE_LABELS = { confirmed: "confirmée", hypothesis: "hypothèse", failed: "échec" };
const STATE_TONES = { confirmed: "ok", hypothesis: "warn", failed: "err" };
export const MAX_EVIDENCE_TEXT = 20000;

/** Lien de téléchargement du rapport d'un projet (construit par le serveur) ; `null` si l'identifiant est refusé. */
export function reportUrl(project, locale = "fr") {
  if (typeof project !== "string" || !UUID.test(project)) return null;
  return `/api/report?project=${encodeURIComponent(project)}&locale=${locale === "en" ? "en" : "fr"}`;
}

/** Identifiant de projet raccourci pour l'affichage. */
export const shortProject = (id) => (typeof id === "string" ? id.slice(0, 8) : "");

function parseItem(it) {
  if (!isRecord(it) || typeof it.id !== "string" || it.id === "" || !UUID.test(it.project ?? ""))
    return null;
  const evidence = Array.isArray(it.evidence)
    ? it.evidence
        .filter((e) => isRecord(e) && typeof e.id === "string")
        .slice(0, 100)
        .map((e) => ({ id: e.id, label: safeText(e.label, 200) }))
    : [];
  return {
    id: it.id,
    project: it.project,
    kind: Object.hasOwn(KIND_LABELS, it.kind) ? it.kind : "step",
    label: safeText(it.label, 300),
    state: Object.hasOwn(STATE_LABELS, it.state) ? it.state : "hypothesis",
    tactic: typeof it.tactic === "string" ? safeText(it.tactic, 80) : null,
    technique: typeof it.technique === "string" ? safeText(it.technique, 80) : null,
    from: Array.isArray(it.from) ? it.from.filter((v) => typeof v === "string").slice(0, 50) : [],
    evidence,
  };
}

/** Message `findings` → { project, items }. */
export function parseFindings(msg) {
  const project = typeof msg?.project === "string" && UUID.test(msg.project) ? msg.project : null;
  const items = Array.isArray(msg?.items) ? msg.items.map(parseItem).filter((i) => i !== null) : [];
  return { project, items };
}

/** Message `finding` → détail (preuves en texte brut), ou `null`. */
export function parseFinding(msg) {
  const f = isRecord(msg) ? msg.finding : null;
  const base = parseItem(f);
  if (base === null) return null;
  const details = Array.isArray(f.evidenceDetails) ? f.evidenceDetails : [];
  return {
    ...base,
    pathFrom: Array.isArray(f.pathFrom)
      ? f.pathFrom.filter((v) => typeof v === "string").slice(0, 50)
      : [],
    evidenceDetails: details
      .filter((e) => isRecord(e) && typeof e.id === "string")
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        label: safeText(e.label, 200),
        capturedAt: e.capturedAt ?? null,
        source: isRecord(e.source)
          ? { kind: safeText(e.source.kind, 40), reference: safeText(e.source.reference, 300) }
          : { kind: "", reference: "" },
        text: typeof e.text === "string" ? e.text.slice(0, MAX_EVIDENCE_TEXT) : "",
        truncated: e.truncated === true,
      })),
  };
}

/** Fusionne une réponse `findings` : un projet précis remplace ses propres lignes, `null` remplace tout. */
export function mergeFindings(current, { project, items }) {
  if (project === null) return items;
  return [...current.filter((i) => i.project !== project), ...items];
}

/** Projets distincts présents dans la liste. */
export const projectsOf = (items) => [...new Set(items.map((i) => i.project))];

const COLUMNS = [
  { key: "label", label: "Trouvaille", className: "col-main" },
  { key: "kind", label: "Type" },
  { key: "state", label: "État" },
  { key: "attack", label: "Tactique / technique" },
  { key: "evidence", label: "Preuves" },
  { key: "project", label: "Projet", className: "col-mono" },
];

/**
 * @param {Document} doc
 * @param {{ send(msg: object): boolean }} deps
 */
export function createFindingsScreen(doc, { send }) {
  const root = screenRoot(doc, "findings", "Trouvailles");
  let items = [];
  let loaded = false;
  let online = false;
  let project = "";
  let selected = null;
  let detail = null;

  const bar = el(doc, "div", "scr-toolbar");
  const select = el(doc, "select", "scr-input");
  select.addEventListener("change", () => {
    project = select.value;
    selected = null;
    detail = null;
    send({ type: "findingsList", ...(project === "" ? {} : { project }) });
    renderAll();
  });
  const exportLink = el(doc, "a", "scr-btn scr-btn-primary", "Exporter le rapport");
  exportLink.setAttribute("download", "");
  const exportNote = el(doc, "span", "scr-hint", "");
  const refresh = actionButton(doc, "Actualiser", "", () =>
    send({ type: "findingsList", ...(project === "" ? {} : { project }) }),
  );
  bar.append(field(doc, "Projet", select), exportLink, exportNote, refresh);
  const status = statusLine(doc);
  const body = el(doc, "div", "scr-body");
  const detailBox = el(doc, "section", "scr-detail");
  detailBox.hidden = true;
  detailBox.setAttribute("aria-live", "polite");
  root.append(bar, status.node, body, detailBox);

  function renderBar() {
    const projects = projectsOf(items);
    if (project !== "" && !projects.includes(project)) projects.push(project);
    select.textContent = "";
    const all = el(doc, "option", "", "Tous les projets");
    all.value = "";
    select.append(all);
    for (const p of projects) {
      const o = el(doc, "option", "", `Projet ${shortProject(p)}`);
      o.value = p;
      select.append(o);
    }
    select.value = project;
    const url = project === "" ? null : reportUrl(project);
    if (url === null) {
      exportLink.removeAttribute("href");
      exportLink.setAttribute("aria-disabled", "true");
      exportLink.classList.add("is-disabled");
      exportNote.textContent = "Choisissez un projet pour exporter son rapport (Markdown).";
    } else {
      exportLink.setAttribute("href", url);
      exportLink.removeAttribute("aria-disabled");
      exportLink.classList.remove("is-disabled");
      exportNote.textContent = "Rapport en Markdown, construit par le serveur.";
    }
  }

  function renderList() {
    body.textContent = "";
    if (!loaded) {
      body.append(emptyState(doc, "Chargement…", "Lecture des trouvailles auprès du serveur."));
      return;
    }
    const shown = items.filter((i) => project === "" || i.project === project);
    if (shown.length === 0) {
      body.append(
        emptyState(
          doc,
          "Aucune trouvaille.",
          "Les agents enregistrent ici ce qu'ils découvrent pendant une mission (hôtes, identifiants, sites, étapes, butin). Lancez une mission ou choisissez un autre projet.",
        ),
      );
      return;
    }
    const t = table(doc, COLUMNS, "Trouvailles");
    for (const f of shown) {
      const attack = [f.tactic, f.technique].filter(Boolean).join(" / ") || "—";
      const tr = row(doc, COLUMNS, [
        f.label,
        badge(doc, KIND_LABELS[f.kind], "steel"),
        badge(doc, STATE_LABELS[f.state], STATE_TONES[f.state]),
        attack,
        String(f.evidence.length),
        shortProject(f.project),
      ]);
      tr.classList.add("is-clickable");
      if (selected && selected.id === f.id && selected.project === f.project)
        tr.classList.add("is-selected");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `Détail de ${f.label}`);
      const open = () => {
        selected = { id: f.id, project: f.project };
        detail = null;
        send({ type: "findingGet", project: f.project, id: f.id });
        renderAll();
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
      t.tbody.append(tr);
    }
    body.append(t.wrap);
  }

  function renderDetail() {
    detailBox.textContent = "";
    detailBox.hidden = selected === null;
    if (selected === null) return;
    if (detail === null) {
      detailBox.append(el(doc, "p", "scr-note", "Chargement du détail…"));
      return;
    }
    const head = el(doc, "div", "scr-detail-head");
    head.append(
      el(doc, "h2", "scr-h2", detail.label),
      badge(doc, KIND_LABELS[detail.kind], "steel"),
      badge(doc, STATE_LABELS[detail.state], STATE_TONES[detail.state]),
    );
    detailBox.append(head);
    const meta = el(doc, "dl", "scr-meta");
    const add = (k, v) => meta.append(el(doc, "dt", "", k), el(doc, "dd", "", v));
    add("Projet", shortProject(detail.project));
    add("Tactique", detail.tactic ?? "—");
    add("Technique", detail.technique ?? "—");
    add("Déduite de", detail.from.length === 0 ? "—" : `${detail.from.length} élément(s)`);
    detailBox.append(meta);

    detailBox.append(el(doc, "h3", "scr-h3", `Preuves (${detail.evidenceDetails.length})`));
    if (detail.evidenceDetails.length === 0) {
      detailBox.append(el(doc, "p", "scr-note", "Aucune preuve attachée à cette trouvaille."));
    }
    for (const ev of detail.evidenceDetails) {
      const box = el(doc, "article", "scr-evidence");
      const h = el(doc, "header", "scr-evidence-head");
      h.append(
        el(doc, "strong", "", ev.label || ev.id),
        el(doc, "span", "scr-hint", formatDate(ev.capturedAt)),
      );
      const src = [ev.source.kind, ev.source.reference].filter(Boolean).join(" : ");
      if (src) h.append(el(doc, "span", "scr-hint", `source ${src}`));
      if (ev.truncated) h.append(badge(doc, "tronquée", "warn"));
      box.append(h, el(doc, "pre", "scr-pre", ev.text));
      detailBox.append(box);
    }

    const acts = el(doc, "div", "scr-toolbar");
    const url = reportUrl(detail.project);
    if (url !== null) {
      const link = el(doc, "a", "scr-btn", "Exporter le rapport du projet");
      link.setAttribute("href", url);
      link.setAttribute("download", "");
      acts.append(link);
    }
    acts.append(
      confirmButton(doc, {
        label: "Supprimer la trouvaille",
        question: "Supprimer définitivement cette trouvaille ?",
        confirmLabel: "Supprimer",
        onConfirm: () => {
          if (!selected) return;
          if (
            !send({
              type: "findingDelete",
              project: selected.project,
              id: selected.id,
              confirmed: true,
            })
          )
            status.set("Hors ligne : la suppression n'a pas été transmise.", "err");
        },
      }),
    );
    const close = el(doc, "button", "scr-btn", "Fermer le détail");
    close.type = "button";
    close.addEventListener("click", () => {
      selected = null;
      detail = null;
      renderAll();
    });
    acts.append(close);
    detailBox.append(acts);
    syncOnline(root, online);
  }

  function renderAll() {
    renderBar();
    renderList();
    renderDetail();
    syncOnline(root, online);
  }
  renderAll();

  return {
    root,
    onMessage(msg) {
      if (msg.type === "findings") {
        const parsed = parseFindings(msg);
        items = mergeFindings(items, parsed);
        loaded = true;
        if (
          selected &&
          !items.some((i) => i.id === selected.id && i.project === selected.project)
        ) {
          selected = null;
          detail = null;
        }
        status.set("", "mute");
        renderAll();
      } else if (msg.type === "finding") {
        const parsed = parseFinding(msg);
        if (
          parsed === null ||
          !selected ||
          parsed.id !== selected.id ||
          parsed.project !== selected.project
        )
          return;
        detail = parsed;
        renderDetail();
      } else if (
        msg.type === "configError" &&
        ["findingsList", "findingGet", "findingDelete"].includes(msg.op)
      ) {
        status.set("Le serveur n'a pas pu lire ou modifier les trouvailles.", "err");
        loaded = true;
        renderAll();
      }
    },
    refresh: () => send({ type: "findingsList" }),
    setOnline(value) {
      online = value;
      syncOnline(root, online);
    },
  };
}
