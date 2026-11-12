// Fenêtre Fichiers : explorateur du projet actif, onglets, éditeur CodeMirror 6 et aperçus (image, Markdown).
// Instance unique ; tout passe par les messages `fs*` de la vue `shell` (lib/files.js les contrôle). Le
// serveur reste l'autorité : il demande lui-même la confirmation d'une suppression ou d'un téléversement
// (aucune confirmation de ces gestes ici), refuse `.git`, `node_modules` et les liens symboliques. Les
// seules confirmations locales (dans la fenêtre, jamais `window.confirm`) concernent ce qui se perd
// côté navigateur : fermer des onglets modifiés, recharger ou écraser un fichier en conflit.
// Aucune donnée reçue n'est insérée en HTML : `textContent`, nœuds DOM et `data:` pour les images.

import {
  ancestorsOf,
  baseName,
  checkName,
  cleanRelPath,
  createTabs,
  crumbsOf,
  imageMime,
  isMarkdown,
  isUnder,
  joinPath,
  languageOf,
  parentOf,
  parseFsMessage,
} from "../lib/files.js";
import { createEditor, loadCodeMirror } from "../lib/files-editor.js";
import { placeMenu } from "../lib/files-menu.js";
import { formatSize } from "../lib/lists.js";
import { renderMarkdown } from "../lib/markdown.js";
import { el, syncOnline } from "./common.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE = 10;
const STATUS_MS = 9000;
/** Mêmes seuils que la requête de conteneur de files.css : sous cette largeur, mode pile. */
const NARROW_PX = 620;

/** Tracés des icônes (grille 16, trait `currentColor`) : aucun emoji, aucune image distante. */
const ICONS = {
  folder:
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
  folderOpen:
    "M2 5.5V4a1 1 0 0 1 1-1h3l1.4 1.5H12a1 1 0 0 1 1 1V6M2.2 6h11.6a.8.8 0 0 1 .8 1l-1 5.2a1 1 0 0 1-1 .8H3.6a1 1 0 0 1-1-.8L1.4 7a.8.8 0 0 1 .8-1z",
  file: "M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM9 2v3h3",
  image: "M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.2h.01",
  chevron: "M6 4l4 4-4 4",
  filePlus:
    "M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM9 2v3h3M8 7.5v4M6 9.5h4",
  folderPlus:
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5zM8 7v4M6 9h4",
  upload: "M8 11V3M5 6l3-3 3 3M3 13h10",
  download: "M8 3v8M5 8l3 3 3-3M3 13h10",
  refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  back: "M10 3L5 8l5 5",
  close: "M4 4l8 8M12 4l-8 8",
  save: "M3 3h8l2 2v8H3zM5 3v3h5V3M5 13V9h6v4",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  pencil: "M3 13l.7-3L10.5 3.2a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7L6 12.3z",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM11 11l3 3",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5",
  shield: "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z",
};

/** Icône SVG décorative (nœuds `createElementNS`, jamais du HTML écrit). */
export function icon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `fx-ico fx-ico-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.file);
  svg.append(path);
  return svg;
}

/** Bouton de la fenêtre : icône, libellé, `data-act` quand il envoie quelque chose au serveur. */
function button(doc, { label, ico, className = "", act = false, title }) {
  const b = el(doc, "button", `fx-btn ${className}`.trim());
  b.type = "button";
  if (ico) b.append(icon(doc, ico));
  if (label) b.append(el(doc, "span", "fx-btn-label", label));
  if (title) {
    b.title = title;
    if (!label) b.setAttribute("aria-label", title);
  }
  if (act) b.dataset.act = "1";
  return b;
}

/** Libellés des opérations d'un `fsError` (le champ `op` est le type du message refusé). */
const OP_LABEL = {
  fsList: "Lecture du dossier",
  fsStat: "Vérification",
  fsRead: "Lecture",
  fsWrite: "Enregistrement",
  fsMkdir: "Création du dossier",
  fsRename: "Renommage",
  fsDelete: "Suppression",
  fsUpload: "Téléversement",
  fsDownload: "Téléchargement",
  fsCaptureEvidence: "Capture de preuve",
};
const CANCEL_TEXT = {
  fsDelete: "Suppression annulée.",
  fsUpload: "Téléversement annulé.",
  fsCaptureEvidence: "Capture de preuve annulée.",
};

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {Window} [deps.win] fenêtre du navigateur (garde `beforeunload`, mesure)
 * @param {(msg: object) => boolean} deps.send message de la vue `shell`
 * @param {() => Promise<object>} [deps.loadEditor] module CodeMirror
 * @param {(count: number) => void} [deps.onDirty] nombre d'onglets modifiés
 * @param {() => void} [deps.onOpenStudio] ouvre « Projets et réglages »
 */
export function createFilesHost({
  doc,
  win = globalThis.window,
  send,
  loadEditor = () => loadCodeMirror(),
  onDirty = () => {},
  onOpenStudio = () => {},
}) {
  let inst = null;
  let online = false;
  let pendingNavigate = null;

  function mount(body, _spec) {
    // ───────────── État ─────────────
    const tabs = createTabs();
    /** Dossier → { entries, truncated, error }. */
    const listings = new Map();
    const expanded = new Set([""]);
    /** Dossiers dont la liste est demandée et pas encore reçue. */
    const loading = new Set();
    let rootError = "";
    let selected = { path: "", kind: "dir" };
    let pane = "tree";
    const previews = new Set();
    const editorRevs = new Map();
    const lastDirty = new Map();
    const pendingStat = new Map();
    /** Fichiers ouverts par un geste : l'éditeur prend le focus quand le contenu arrive. */
    const focusOnLoad = new Set();
    let pendingCreate = null;
    let shownKey = "";
    let showToken = 0;
    let editor = null;
    let editorPromise = null;
    let editorFailed = false;
    let statusTimer = null;
    let disposed = false;
    let overlay = null;
    let menu = null;
    let longPress = null;
    let skipClick = false;

    // ───────────── Structure ─────────────
    const root = el(doc, "section", "fx");
    root.setAttribute("aria-label", "Fichiers du projet");
    root.dataset.pane = pane;

    const policy = el(doc, "div", "fx-policy");
    policy.setAttribute("role", "alert");
    policy.hidden = true;
    const policyText = el(
      doc,
      "p",
      "fx-policy-text",
      "La politique du dépôt a changé : elle doit être réapprouvée dans Projets et réglages.",
    );
    const policyOpen = button(doc, { label: "Ouvrir Projets et réglages" });
    const policyClose = button(doc, { label: "Masquer" });
    policy.append(policyText, policyOpen, policyClose);

    const status = el(doc, "p", "fx-status");
    status.setAttribute("role", "status");
    status.hidden = true;

    const main = el(doc, "div", "fx-main");

    // Colonne gauche : chemin, actions, arborescence.
    const side = el(doc, "div", "fx-side");
    const crumbs = el(doc, "nav", "fx-crumbs");
    crumbs.setAttribute("aria-label", "Chemin");
    const toolbar = el(doc, "div", "fx-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Actions sur les fichiers");
    const bNewFile = button(doc, {
      label: "Fichier",
      ico: "filePlus",
      act: true,
      title: "Nouveau fichier",
    });
    const bNewDir = button(doc, {
      label: "Dossier",
      ico: "folderPlus",
      act: true,
      title: "Nouveau dossier",
    });
    const bUpload = button(doc, {
      label: "Téléverser",
      ico: "upload",
      act: true,
      title: "Téléverser dans le dossier",
    });
    const bRefresh = button(doc, { ico: "refresh", act: true, title: "Actualiser" });
    const bActions = button(doc, { ico: "more", title: "Actions sur la sélection" });
    bActions.setAttribute("aria-haspopup", "menu");
    toolbar.append(bNewFile, bNewDir, bUpload, bRefresh, bActions);
    const tree = el(doc, "ul", "fx-tree");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Arborescence du projet");
    side.append(crumbs, toolbar, tree);

    // Colonne droite : onglets, barre, bandeaux, contenu.
    const paneEl = el(doc, "div", "fx-pane");
    const tabsEl = el(doc, "div", "fx-tabs");
    tabsEl.setAttribute("role", "tablist");
    tabsEl.setAttribute("aria-label", "Fichiers ouverts");
    const bar = el(doc, "div", "fx-bar");
    const conflict = el(doc, "div", "fx-conflict");
    conflict.setAttribute("role", "alert");
    conflict.hidden = true;
    const note = el(doc, "p", "fx-note");
    note.hidden = true;
    const view = el(doc, "div", "fx-view");
    const editorHost = el(doc, "div", "fx-editor");
    editorHost.hidden = true;
    const alt = el(doc, "div", "fx-alt");
    view.append(editorHost, alt);
    paneEl.append(tabsEl, bar, conflict, note, view);

    main.append(side, paneEl);

    const menuHost = el(doc, "div", "fx-menu-host");
    const overHost = el(doc, "div", "fx-over");
    overHost.hidden = true;
    root.append(policy, status, main, menuHost, overHost);
    body.append(root);

    // ───────────── Outils ─────────────
    const isNarrow = () => (root.clientWidth || 9999) < NARROW_PX;

    function setStatus(text, tone = "steel") {
      if (statusTimer !== null) clearTimeout(statusTimer);
      statusTimer = null;
      status.textContent = text;
      status.className = `fx-status tone-${tone}`;
      status.hidden = text === "";
      if (text !== "") {
        statusTimer = setTimeout(() => {
          status.hidden = true;
          statusTimer = null;
        }, STATUS_MS);
      }
    }

    function sendOrWarn(msg) {
      if (send(msg)) return true;
      setStatus("Hors ligne : rien n'a été envoyé au serveur.", "warn");
      return false;
    }

    function setPane(next) {
      pane = next;
      root.dataset.pane = next;
    }

    const currentDir = () => (selected.kind === "dir" ? selected.path : parentOf(selected.path));

    function notifyDirty() {
      onDirty(tabs.dirtyPaths().length);
    }

    // ───────────── Dialogue local (dans la fenêtre) ─────────────

    function closeOverlay(restore = true) {
      if (overlay === null) return;
      const { opener } = overlay;
      overlay = null;
      overHost.textContent = "";
      overHost.hidden = true;
      main.inert = false;
      if (restore && opener?.isConnected) opener.focus();
    }

    /**
     * Question ou saisie locale. `input` : valeur initiale (champ texte) ou `undefined` (confirmation).
     * `validate(value)` rend un message d'erreur ou `null`. `onConfirm(value)` n'est appelé que sur geste.
     */
    function ask({ title, text, input, confirmLabel, danger = false, validate, onConfirm }) {
      closeOverlay(false);
      const opener = doc.activeElement;
      const form = el(doc, "form", "fx-dlg");
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-modal", "true");
      form.noValidate = true;
      const heading = el(doc, "h2", "fx-dlg-title", title);
      heading.id = "fx-dlg-title";
      form.setAttribute("aria-labelledby", heading.id);
      form.append(heading);
      if (text) form.append(el(doc, "p", "fx-dlg-text", text));
      let field = null;
      const err = el(doc, "p", "fx-dlg-err");
      err.setAttribute("role", "alert");
      err.hidden = true;
      if (input !== undefined) {
        field = el(doc, "input", "fx-input");
        field.type = "text";
        field.value = input;
        field.maxLength = 255;
        field.autocomplete = "off";
        field.spellcheck = false;
        field.setAttribute("autocapitalize", "off");
        field.setAttribute("aria-label", title);
        form.append(field);
      }
      form.append(err);
      const actions = el(doc, "div", "fx-dlg-actions");
      const cancel = button(doc, { label: "Annuler" });
      const ok = button(doc, {
        label: confirmLabel,
        className: danger ? "fx-btn-danger" : "fx-btn-primary",
      });
      ok.type = "submit";
      actions.append(cancel, ok);
      form.append(actions);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = field === null ? "" : field.value;
        const problem = validate ? validate(value) : null;
        if (problem) {
          err.textContent = problem;
          err.hidden = false;
          field?.focus();
          return;
        }
        closeOverlay(true);
        onConfirm(value);
      });
      cancel.addEventListener("click", () => closeOverlay(true));
      form.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeOverlay(true);
        }
      });
      overHost.append(form);
      overHost.hidden = false;
      main.inert = true;
      overlay = { opener };
      if (field) {
        field.focus();
        const dot = field.value.lastIndexOf(".");
        field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      } else {
        (danger ? cancel : ok).focus();
      }
    }

    // ───────────── Liste des dossiers ─────────────

    function requestList(path) {
      if (!online) return;
      if (loading.has(path)) return;
      if (send({ type: "fsList", path })) loading.add(path);
    }

    function ensureListed(path) {
      if (!listings.has(path)) requestList(path);
    }

    /** Relit les dossiers déjà connus (racine et dossiers dépliés) après une opération. */
    function relist(...paths) {
      const wanted = new Set(paths.filter((p) => listings.has(p) || expanded.has(p)));
      for (const p of wanted) {
        loading.delete(p);
        requestList(p);
      }
    }
    function relistAll() {
      loading.clear();
      for (const p of new Set(["", ...expanded])) requestList(p);
    }

    function showFolder(path) {
      for (const a of ancestorsOf(path)) expanded.add(a);
      expanded.add(path);
      for (const a of ancestorsOf(path)) ensureListed(a);
      ensureListed(path);
      selected = { path, kind: "dir" };
      setPane("tree");
      renderTree();
      renderCrumbs();
    }

    // ───────────── Arborescence ─────────────

    function rowsOf() {
      const rows = [];
      const walk = (dir, depth) => {
        const listing = listings.get(dir);
        if (listing === undefined) {
          rows.push({ type: "note", depth, text: loading.has(dir) ? "Chargement…" : "", dir });
          return;
        }
        if (listing.error) {
          rows.push({ type: "note", depth, text: listing.error, tone: "err", dir });
          return;
        }
        if (listing.entries.length === 0) {
          rows.push({ type: "note", depth, text: "Dossier vide.", dir });
        }
        for (const e of listing.entries) {
          const path = joinPath(dir, e.name);
          rows.push({ type: "item", depth, path, name: e.name, kind: e.kind, size: e.size });
          if (e.kind === "dir" && expanded.has(path)) walk(path, depth + 1);
        }
        if (listing.truncated) {
          rows.push({
            type: "note",
            depth,
            text: "Dossier tronqué : seules les premières entrées sont affichées.",
            tone: "warn",
            dir,
          });
        }
      };
      walk("", 0);
      return rows;
    }

    function renderTree() {
      const focused = tree.contains(doc.activeElement)
        ? doc.activeElement.closest("[data-path]")?.dataset.path
        : undefined;
      tree.textContent = "";
      if (rootError !== "") {
        const li = el(doc, "li", "fx-empty");
        li.setAttribute("role", "none");
        li.append(
          el(doc, "p", "fx-empty-title", rootError),
          el(
            doc,
            "p",
            "fx-empty-text",
            "Activez un projet dans Projets et réglages, puis actualisez.",
          ),
        );
        tree.append(li);
        return;
      }
      const rows = rowsOf();
      const items = rows.filter((r) => r.type === "item");
      const tabbable = items.some((r) => r.path === selected.path) ? selected.path : items[0]?.path;
      for (const row of rows) {
        const li = el(doc, "li", `fx-row lv-${Math.min(row.depth, 10)}`);
        if (row.type === "note") {
          li.classList.add("fx-row-note");
          if (row.tone) li.classList.add(`tone-${row.tone}`);
          li.setAttribute("role", "none");
          li.textContent = row.text;
          if (row.text !== "") tree.append(li);
          continue;
        }
        li.setAttribute("role", "treeitem");
        li.dataset.path = row.path;
        li.dataset.kind = row.kind;
        li.setAttribute("aria-level", String(row.depth + 1));
        li.tabIndex = row.path === tabbable ? 0 : -1;
        const isSel = selected.path === row.path;
        li.setAttribute("aria-selected", String(isSel));
        if (isSel) li.classList.add("is-selected");
        if (row.kind === "dir") {
          const open = expanded.has(row.path);
          li.setAttribute("aria-expanded", String(open));
          li.append(icon(doc, "chevron"), icon(doc, open ? "folderOpen" : "folder"));
        } else {
          li.append(
            el(doc, "span", "fx-chev-gap"),
            icon(doc, imageMime(row.path) ? "image" : "file"),
          );
        }
        li.append(el(doc, "span", "fx-name", row.name));
        if (row.kind === "file" && tabs.isDirty(row.path)) {
          const dot = el(doc, "span", "fx-dot");
          dot.setAttribute("role", "img");
          dot.setAttribute("aria-label", "modifié");
          dot.title = "Modifié, non enregistré";
          li.append(dot);
        }
        if (row.kind === "file") li.append(el(doc, "span", "fx-size", formatSize(row.size)));
        const more = button(doc, {
          ico: "more",
          className: "fx-more",
          title: `Actions pour ${row.name}`,
        });
        more.tabIndex = -1;
        more.dataset.more = "1";
        li.append(more);
        tree.append(li);
        if (row.path === focused) li.focus();
      }
    }

    function renderCrumbs() {
      crumbs.textContent = "";
      const list = crumbsOf(currentDir());
      list.forEach((c, i) => {
        const b = el(doc, "button", "fx-crumb", c.name === "" ? "Projet" : c.name);
        b.type = "button";
        b.dataset.path = c.path;
        if (i === list.length - 1) b.setAttribute("aria-current", "location");
        b.addEventListener("click", () => showFolder(c.path));
        if (i > 0) crumbs.append(el(doc, "span", "fx-crumb-sep", "/"));
        crumbs.append(b);
      });
    }

    function rowOf(path) {
      for (const li of tree.querySelectorAll("[data-path]"))
        if (li.dataset.path === path) return li;
      return null;
    }

    function selectPath(path, kind, { focus = false } = {}) {
      selected = { path, kind };
      renderTree();
      renderCrumbs();
      if (focus) rowOf(path)?.focus();
      rowOf(path)?.scrollIntoView?.({ block: "nearest" });
    }

    function toggleDir(path) {
      if (expanded.has(path)) {
        expanded.delete(path);
      } else {
        expanded.add(path);
        ensureListed(path);
      }
    }

    function activateRow(li, { fromClick = false } = {}) {
      const path = li.dataset.path;
      const kind = li.dataset.kind;
      if (kind === "dir") {
        selected = { path, kind };
        toggleDir(path);
        renderTree();
        renderCrumbs();
        rowOf(path)?.focus();
      } else {
        selectPath(path, "file", { focus: !fromClick });
        openFile(path);
      }
    }

    function moveFocus(li, delta) {
      const all = [...tree.querySelectorAll("[data-path]")];
      const i = all.indexOf(li);
      const next = all[Math.max(0, Math.min(all.length - 1, i + delta))];
      if (!next) return;
      for (const r of all) r.tabIndex = r === next ? 0 : -1;
      next.focus();
    }

    tree.addEventListener("click", (event) => {
      if (skipClick) {
        skipClick = false;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const li = target?.closest("[data-path]");
      if (!li) return;
      if (target.closest("[data-more]")) {
        openMenuFor(li, rectOf(target.closest("[data-more]")));
        return;
      }
      activateRow(li, { fromClick: true });
    });

    tree.addEventListener("keydown", (event) => {
      const li = event.target instanceof Element ? event.target.closest("[data-path]") : null;
      if (!li || event.target !== li) return;
      const path = li.dataset.path;
      const isDir = li.dataset.kind === "dir";
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(li, 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(li, -1);
          break;
        case "Home":
          event.preventDefault();
          moveFocus(li, -9999);
          break;
        case "End":
          event.preventDefault();
          moveFocus(li, 9999);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (isDir && !expanded.has(path)) {
            selected = { path, kind: "dir" };
            toggleDir(path);
            renderTree();
            renderCrumbs();
            rowOf(path)?.focus();
          } else if (isDir) moveFocus(li, 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (isDir && expanded.has(path)) {
            toggleDir(path);
            renderTree();
            rowOf(path)?.focus();
          } else {
            const parent = parentOf(path);
            if (parent !== "") rowOf(parent)?.focus();
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          activateRow(li);
          break;
        case "F2":
          event.preventDefault();
          renameDialog({ path, kind: isDir ? "dir" : "file" });
          break;
        case "Delete":
          event.preventDefault();
          doDelete({ path, kind: isDir ? "dir" : "file" });
          break;
        case "ContextMenu":
          event.preventDefault();
          openMenuFor(li, rectOf(li));
          break;
        case "F10":
          if (event.shiftKey) {
            event.preventDefault();
            openMenuFor(li, rectOf(li));
          }
          break;
        default:
          break;
      }
    });

    tree.addEventListener("focusin", (event) => {
      const li = event.target instanceof Element ? event.target.closest("[data-path]") : null;
      if (!li || event.target !== li) return;
      for (const r of tree.querySelectorAll("[data-path]")) r.tabIndex = r === li ? 0 : -1;
    });

    // Menu contextuel : clic droit, appui long (tactile), touche Menu / Maj+F10, bouton « ⋯ ».
    tree.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const li = event.target instanceof Element ? event.target.closest("[data-path]") : null;
      const rect =
        event.clientX === 0 && event.clientY === 0 && li
          ? rectOf(li)
          : { left: event.clientX, top: event.clientY, bottom: event.clientY };
      if (li) openMenuFor(li, rect);
      else openMenu({ path: currentDir(), kind: "dir" }, rect, tree);
    });
    tree.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      const li = event.target instanceof Element ? event.target.closest("[data-path]") : null;
      if (!li || event.target.closest?.("[data-more]")) return;
      const start = { x: event.clientX, y: event.clientY };
      cancelLongPress();
      longPress = {
        start,
        timer: setTimeout(() => {
          longPress = null;
          skipClick = true;
          openMenuFor(li, rectOf(li));
        }, LONG_PRESS_MS),
      };
    });
    tree.addEventListener("pointermove", (event) => {
      if (longPress === null) return;
      if (
        Math.abs(event.clientX - longPress.start.x) > LONG_PRESS_MOVE ||
        Math.abs(event.clientY - longPress.start.y) > LONG_PRESS_MOVE
      ) {
        cancelLongPress();
      }
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      tree.addEventListener(type, () => cancelLongPress());
    }
    function cancelLongPress() {
      if (longPress !== null) clearTimeout(longPress.timer);
      longPress = null;
    }

    function rectOf(node) {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    }

    // ───────────── Menu contextuel ─────────────

    function closeMenu(restore = true) {
      if (menu === null) return;
      const { opener } = menu;
      menu = null;
      menuHost.textContent = "";
      doc.removeEventListener("pointerdown", onOutside, true);
      if (restore && opener?.isConnected) opener.focus();
    }
    function onOutside(event) {
      if (menu !== null && !menuHost.contains(event.target)) closeMenu(false);
    }

    function menuItems(target) {
      const { path, kind } = target;
      const dir = kind === "dir" ? path : parentOf(path);
      const items = [];
      if (path !== "") {
        if (kind === "file") items.push({ label: "Ouvrir", run: () => openFile(path) });
        else {
          items.push({
            label: expanded.has(path) ? "Replier" : "Déplier",
            run: () => {
              toggleDir(path);
              renderTree();
            },
          });
        }
      }
      items.push(
        { label: "Nouveau fichier ici", act: true, run: () => newEntryDialog(dir, "file") },
        { label: "Nouveau dossier ici", act: true, run: () => newEntryDialog(dir, "dir") },
        { label: "Téléverser ici", act: true, run: () => sendOrWarn({ type: "fsUpload", dir }) },
      );
      if (path !== "") {
        items.push({ label: "Renommer", act: true, run: () => renameDialog(target) });
        if (kind === "file") {
          items.push(
            {
              label: "Télécharger",
              act: true,
              run: () => sendOrWarn({ type: "fsDownload", path }),
            },
            {
              label: "Capturer comme preuve",
              act: true,
              run: () => sendOrWarn({ type: "fsCaptureEvidence", path }),
            },
          );
        }
        items.push({ label: "Supprimer", act: true, danger: true, run: () => doDelete(target) });
      }
      items.push({ label: "Actualiser", act: true, run: () => relist(dir, path) });
      return items;
    }

    function openMenuFor(li, rect) {
      const path = li.dataset.path;
      const kind = li.dataset.kind;
      selected = { path, kind };
      for (const r of tree.querySelectorAll("[data-path]")) {
        r.classList.toggle("is-selected", r.dataset.path === path);
        r.setAttribute("aria-selected", String(r.dataset.path === path));
      }
      renderCrumbs();
      openMenu({ path, kind }, rect, li);
    }

    function openMenu(target, rect, opener) {
      closeMenu(false);
      const box = el(doc, "div", "fx-menu");
      box.setAttribute("role", "menu");
      box.setAttribute("aria-label", "Actions");
      const buttons = [];
      for (const item of menuItems(target)) {
        const b = el(doc, "button", `fx-menu-item${item.danger ? " is-danger" : ""}`, item.label);
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.tabIndex = -1;
        if (item.act) {
          b.dataset.act = "1";
          b.disabled = !online;
        }
        b.addEventListener("click", () => {
          closeMenu(false);
          item.run();
        });
        buttons.push(b);
        box.append(b);
      }
      box.addEventListener("keydown", (event) => {
        const enabled = buttons.filter((b) => !b.disabled);
        const i = enabled.indexOf(doc.activeElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          enabled[(i + 1) % enabled.length]?.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          enabled[(i - 1 + enabled.length) % enabled.length]?.focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          enabled[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          enabled.at(-1)?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          closeMenu(true);
        }
      });
      menuHost.append(box);
      menu = { opener };
      placeMenu(box, rect, root);
      doc.addEventListener("pointerdown", onOutside, true);
      (buttons.find((b) => !b.disabled) ?? buttons[0])?.focus();
    }

    // ───────────── Opérations ─────────────

    function newEntryDialog(dir, kind) {
      const where = dir === "" ? "la racine du projet" : dir;
      ask({
        title: kind === "file" ? "Nouveau fichier" : "Nouveau dossier",
        text: `Dans ${where}.`,
        input: "",
        confirmLabel: "Créer",
        validate: checkName,
        onConfirm(value) {
          const path = joinPath(dir, value.trim());
          if (kind === "file") {
            pendingCreate = path;
            sendOrWarn({ type: "fsWrite", path, text: "", etag: null });
          } else {
            sendOrWarn({ type: "fsMkdir", path });
          }
        },
      });
    }

    function renameDialog(target) {
      ask({
        title: `Renommer ${target.kind === "dir" ? "le dossier" : "le fichier"}`,
        text: target.path,
        input: baseName(target.path),
        confirmLabel: "Renommer",
        validate: (value) =>
          value.trim() === baseName(target.path) ? "Nom inchangé." : checkName(value),
        onConfirm(value) {
          const to = joinPath(parentOf(target.path), value.trim());
          sendOrWarn({ type: "fsRename", from: target.path, to });
        },
      });
    }

    function doDelete(target) {
      // Le serveur demande la confirmation (dialogue) : aucune question ici.
      sendOrWarn({ type: "fsDelete", path: target.path });
    }

    bNewFile.addEventListener("click", () => newEntryDialog(currentDir(), "file"));
    bNewDir.addEventListener("click", () => newEntryDialog(currentDir(), "dir"));
    bUpload.addEventListener("click", () => sendOrWarn({ type: "fsUpload", dir: currentDir() }));
    bRefresh.addEventListener("click", () => relistAll());
    bActions.addEventListener("click", () =>
      openMenu({ path: selected.path, kind: selected.kind }, rectOf(bActions), bActions),
    );
    policyClose.addEventListener("click", () => {
      policy.hidden = true;
    });
    policyOpen.addEventListener("click", () => onOpenStudio());

    // ───────────── Onglets et fichiers ─────────────

    function openFile(path) {
      const { created } = tabs.open(path);
      if (created) {
        focusOnLoad.add(path);
        sendOrWarn({ type: "fsRead", path, as: imageMime(path) ? "base64" : "text" });
      }
      setPane("editor");
      renderTabs();
      renderBar();
      void showView({ focus: true });
    }

    function reloadFile(path) {
      sendOrWarn({ type: "fsRead", path, as: imageMime(path) ? "base64" : "text" });
    }

    function closeTab(path) {
      const finish = () => {
        tabs.close(path);
        editor?.forget(path);
        editorRevs.delete(path);
        previews.delete(path);
        lastDirty.delete(path);
        focusOnLoad.delete(path);
        if (tabs.list().length === 0) setPane("tree");
        renderAll();
        notifyDirty();
      };
      if (tabs.isDirty(path)) {
        ask({
          title: "Fermer sans enregistrer ?",
          text: `« ${baseName(path)} » contient des modifications non enregistrées. Elles seront perdues.`,
          confirmLabel: "Fermer sans enregistrer",
          danger: true,
          onConfirm: finish,
        });
        return;
      }
      finish();
    }

    function save(path) {
      const t = tabs.get(path);
      if (t === null) return;
      if (t.readOnly) {
        setStatus("Ce fichier est en lecture seule.", "warn");
        return;
      }
      if (t.conflict) {
        setStatus(
          "Le fichier a changé sur le disque : rechargez-le ou écrasez-le (bandeau).",
          "warn",
        );
        return;
      }
      const payload = tabs.beginSave(path);
      if (payload === null) return;
      if (!send({ type: "fsWrite", ...payload })) {
        t.saving = false;
        setStatus("Hors ligne : rien n'a été enregistré.", "warn");
      }
      renderBar();
    }
    const saveActive = () => {
      const p = tabs.activePath();
      if (p !== null) save(p);
    };

    function renderTabs() {
      tabsEl.textContent = "";
      const list = tabs.list();
      tabsEl.hidden = list.length === 0;
      for (const t of list) {
        const active = tabs.activePath() === t.path;
        const wrap = el(doc, "div", `fx-tab${active ? " is-active" : ""}`);
        const b = el(doc, "button", "fx-tab-btn");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(active));
        b.tabIndex = active ? 0 : -1;
        b.title = t.path;
        b.append(el(doc, "span", "fx-tab-name", baseName(t.path)));
        if (tabs.isDirty(t.path)) {
          const dot = el(doc, "span", "fx-dot");
          dot.setAttribute("role", "img");
          dot.setAttribute("aria-label", "modifié");
          b.append(dot);
        }
        b.addEventListener("click", () => {
          tabs.activate(t.path);
          setPane("editor");
          selected = { path: t.path, kind: "file" };
          renderTabs();
          renderBar();
          renderTree();
          renderCrumbs();
          void showView({ focus: true });
        });
        b.addEventListener("keydown", (event) => {
          const all = [...tabsEl.querySelectorAll('[role="tab"]')];
          const i = all.indexOf(b);
          const next =
            event.key === "ArrowRight"
              ? all[(i + 1) % all.length]
              : event.key === "ArrowLeft"
                ? all[(i - 1 + all.length) % all.length]
                : null;
          if (next) {
            event.preventDefault();
            next.focus();
            next.click();
          }
        });
        const x = button(doc, {
          ico: "close",
          className: "fx-tab-x",
          title: `Fermer ${baseName(t.path)}`,
        });
        x.tabIndex = -1;
        x.addEventListener("click", () => closeTab(t.path));
        wrap.append(b, x);
        tabsEl.append(wrap);
      }
    }

    function badgeText(t) {
      if (t.kind === "image") return "image";
      if (t.kind === "binary") return "binaire";
      if (t.kind !== "text") return "";
      if (t.truncated) return "tronqué, lecture seule";
      if (t.readOnly) return "lecture seule";
      if (t.saving) return "enregistrement…";
      if (tabs.isDirty(t.path)) return t.missing ? "supprimé sur le disque, modifié" : "modifié";
      return "";
    }

    function renderBar() {
      bar.textContent = "";
      conflict.textContent = "";
      conflict.hidden = true;
      note.hidden = true;
      const t = tabs.active();
      bar.hidden = t === null;
      if (t === null) return;
      const back = button(doc, { label: "Fichiers", ico: "back", className: "fx-back" });
      back.addEventListener("click", () => setPane("tree"));
      const name = el(doc, "span", "fx-bar-path", t.path);
      name.title = t.path;
      const badge = badgeText(t);
      bar.append(back, name);
      if (badge)
        bar.append(el(doc, "span", `fx-badge${tabs.isDirty(t.path) ? " is-dirty" : ""}`, badge));
      if (t.kind === "text") {
        if (isMarkdown(t.path)) {
          const previewing = previews.has(t.path);
          const toggle = button(doc, {
            label: previewing ? "Éditer" : "Aperçu",
            ico: previewing ? "pencil" : "eye",
            title: previewing ? "Revenir à l'édition" : "Aperçu rendu du Markdown",
          });
          toggle.addEventListener("click", () => {
            if (previews.has(t.path)) previews.delete(t.path);
            else previews.add(t.path);
            renderBar();
            void showView({ focus: previews.has(t.path) === false });
          });
          bar.append(toggle);
        }
        if (!previews.has(t.path)) {
          const find = button(doc, {
            label: "Rechercher",
            ico: "search",
            title: "Rechercher (Ctrl+F)",
          });
          find.addEventListener("click", () => editor?.openSearch());
          bar.append(find);
        }
        if (!t.readOnly) {
          const saveBtn = button(doc, {
            label: "Enregistrer",
            ico: "save",
            className: "fx-btn-primary",
            act: true,
            title: "Enregistrer (Ctrl+S)",
          });
          saveBtn.disabled = !online || t.saving || !tabs.isDirty(t.path) || t.conflict;
          if (saveBtn.disabled) saveBtn.dataset.lock = "1";
          else delete saveBtn.dataset.lock;
          saveBtn.addEventListener("click", () => save(t.path));
          bar.append(saveBtn);
        }
      } else if (t.kind === "image" || t.kind === "binary") {
        const dl = button(doc, { label: "Télécharger", ico: "download", act: true });
        dl.addEventListener("click", () => sendOrWarn({ type: "fsDownload", path: t.path }));
        bar.append(dl);
      }
      if (t.conflict) {
        conflict.hidden = false;
        conflict.append(
          el(
            doc,
            "p",
            "fx-conflict-text",
            "Ce fichier a changé sur le disque depuis son ouverture. Rien n'a été écrasé.",
          ),
        );
        const reload = button(doc, { label: "Recharger", ico: "refresh", act: true });
        reload.addEventListener("click", () => {
          const go = () => reloadFile(t.path);
          if (tabs.isDirty(t.path)) {
            ask({
              title: "Recharger depuis le disque ?",
              text: "Vos modifications non enregistrées seront remplacées par le contenu du disque.",
              confirmLabel: "Recharger",
              danger: true,
              onConfirm: go,
            });
          } else go();
        });
        const over = button(doc, {
          label: "Écraser",
          ico: "save",
          className: "fx-btn-danger",
          act: true,
        });
        over.addEventListener("click", () => {
          ask({
            title: "Écraser la version du disque ?",
            text: "Votre texte remplacera le contenu actuel du fichier sur le disque. Cette action ne peut pas être annulée.",
            confirmLabel: "Écraser",
            danger: true,
            onConfirm() {
              if (!tabs.beginOverwrite(t.path)) return;
              if (!send({ type: "fsStat", path: t.path })) {
                tabs.get(t.path).overwriting = false;
                setStatus("Hors ligne : rien n'a été écrasé.", "warn");
              }
            },
          });
        });
        conflict.append(reload, over);
        syncOnline(conflict, online);
      }
      const message = t.error && t.kind === "text" ? t.error : "";
      if (message) {
        note.textContent = message;
        note.className = "fx-note tone-err";
        note.hidden = false;
      } else if (t.kind === "text" && t.truncated) {
        note.textContent = "Fichier tronqué à 1 Mio : lecture seule, impossible à enregistrer.";
        note.className = "fx-note tone-warn";
        note.hidden = false;
      } else if (t.kind === "text" && t.readOnly) {
        note.textContent = "Lecture seule : ce fichier ne peut pas être enregistré depuis ici.";
        note.className = "fx-note tone-warn";
        note.hidden = false;
      }
      syncOnline(bar, online);
    }

    // ───────────── Contenu : éditeur, aperçus, messages ─────────────

    function ensureEditor() {
      if (editor !== null) return Promise.resolve(editor);
      if (editorFailed) return Promise.resolve(null);
      if (editorPromise === null) {
        editorPromise = loadEditor()
          .then((cm) => {
            if (disposed) return null;
            editor = createEditor(cm, {
              parent: editorHost,
              onChange: (key, text) => {
                tabs.edit(key, text);
                syncDirty(key);
              },
              onSave: saveActive,
            });
            return editor;
          })
          .catch(() => {
            editorFailed = true;
            return null;
          })
          .finally(() => {
            editorPromise = null;
          });
      }
      return editorPromise;
    }

    /** Un onglet vient de devenir (ou de cesser d'être) modifié : pastilles et boutons suivent. */
    function syncDirty(path) {
      const now = tabs.isDirty(path);
      if (lastDirty.get(path) === now) return;
      lastDirty.set(path, now);
      renderTabs();
      renderBar();
      renderTree();
      notifyDirty();
    }

    function message(title, text, ...extra) {
      const box = el(doc, "div", "fx-msg");
      box.append(el(doc, "p", "fx-msg-title", title));
      if (text) box.append(el(doc, "p", "fx-msg-text", text));
      box.append(...extra);
      return box;
    }

    async function showView({ focus = false } = {}) {
      const t = tabs.active();
      const token = ++showToken;
      if (t === null) {
        shownKey = "";
        editorHost.hidden = true;
        alt.hidden = false;
        alt.replaceChildren(
          message(
            "Aucun fichier ouvert.",
            "Choisissez un fichier dans l'arborescence pour l'ouvrir, ou créez-en un.",
          ),
        );
        return;
      }
      const key = `${t.path}#${t.rev}#${t.kind}#${previews.has(t.path) ? "p" : "e"}#${t.error}`;
      if (key === shownKey && !focus) return;
      shownKey = key;
      if (t.kind === "loading") {
        editorHost.hidden = true;
        alt.hidden = false;
        alt.replaceChildren(message("Chargement…"));
        return;
      }
      if (t.kind === "error") {
        editorHost.hidden = true;
        alt.hidden = false;
        const retry = button(doc, { label: "Réessayer", ico: "refresh", act: true });
        retry.addEventListener("click", () => {
          t.kind = "loading";
          t.error = "";
          renderBar();
          void showView();
          reloadFile(t.path);
        });
        alt.replaceChildren(message("Ouverture impossible.", t.error, retry));
        syncOnline(alt, online);
        return;
      }
      if (t.kind === "binary") {
        editorHost.hidden = true;
        alt.hidden = false;
        alt.replaceChildren(
          message(
            "Fichier non texte.",
            "Aucun aperçu pour ce type de fichier. Vous pouvez le télécharger.",
          ),
        );
        return;
      }
      if (t.kind === "image") {
        editorHost.hidden = true;
        alt.hidden = false;
        const box = el(doc, "div", "fx-image");
        const img = el(doc, "img", "fx-img");
        img.alt = baseName(t.path);
        img.decoding = "async";
        if (t.mime !== null && t.base64 !== null) img.src = `data:${t.mime};base64,${t.base64}`;
        box.append(
          img,
          el(doc, "p", "fx-image-cap", `${baseName(t.path)} · ${formatSize(t.size)}`),
        );
        alt.replaceChildren(box);
        return;
      }
      // Texte.
      if (isMarkdown(t.path) && previews.has(t.path)) {
        editorHost.hidden = true;
        alt.hidden = false;
        const wrap = el(doc, "div", "fx-md-wrap");
        wrap.append(renderMarkdown(doc, t.text));
        alt.replaceChildren(wrap);
        return;
      }
      alt.hidden = true;
      alt.replaceChildren();
      editorHost.hidden = false;
      const ed = await ensureEditor();
      if (token !== showToken || disposed) return;
      if (ed === null) {
        editorHost.hidden = true;
        alt.hidden = false;
        const pre = el(doc, "pre", "fx-plain", t.text);
        alt.replaceChildren(
          message("L'éditeur n'a pas pu se charger.", "Le texte s'affiche en lecture seule."),
          pre,
        );
        return;
      }
      const opts = { text: t.text, language: languageOf(t.path), readOnly: t.readOnly };
      if (editorRevs.get(t.path) === t.rev) ed.open(t.path, opts);
      else ed.reset(t.path, opts);
      editorRevs.set(t.path, t.rev);
      ed.view.requestMeasure();
      if (focus && !isNarrow()) ed.focus();
    }

    function renderAll() {
      renderTabs();
      renderBar();
      renderTree();
      renderCrumbs();
      void showView();
    }

    // ───────────── Navigation demandée (lien profond, openWindow) ─────────────

    function navigate(raw) {
      const path = cleanRelPath(raw);
      if (path === null) {
        setStatus("Chemin invalide.", "err");
        return;
      }
      if (path === "") {
        showFolder("");
        return;
      }
      if (!online) {
        pendingNavigate = path;
        return;
      }
      pendingStat.set(path, (info) => {
        if (!info.exists) {
          setStatus(`Introuvable : ${path}`, "warn");
        } else if (info.type === "dir") {
          showFolder(path);
        } else {
          showFolder(parentOf(path));
          selected = { path, kind: "file" };
          openFile(path);
          renderTree();
          renderCrumbs();
        }
      });
      send({ type: "fsStat", path });
    }

    // ───────────── Messages du serveur ─────────────

    function applyRename(from, to) {
      const moved = tabs.rename(from, to);
      for (const [a, b] of moved) {
        editor?.move(a, b);
        if (editorRevs.has(a)) {
          editorRevs.set(b, editorRevs.get(a));
          editorRevs.delete(a);
        }
        if (previews.delete(a)) previews.add(b);
        if (lastDirty.has(a)) {
          lastDirty.set(b, lastDirty.get(a));
          lastDirty.delete(a);
        }
      }
      for (const p of [...expanded]) {
        if (p !== "" && isUnder(p, from)) {
          expanded.delete(p);
          expanded.add(to + p.slice(from.length));
        }
      }
      for (const p of [...listings.keys()]) {
        if (p !== "" && isUnder(p, from)) listings.delete(p);
      }
      if (isUnder(selected.path, from)) {
        selected = { path: to + selected.path.slice(from.length), kind: selected.kind };
      }
      shownKey = "";
    }

    function handle(ev) {
      switch (ev.kind) {
        case "policyChanged":
          policy.hidden = false;
          break;
        case "entries": {
          loading.delete(ev.path);
          listings.set(ev.path, { entries: ev.entries, truncated: ev.truncated, error: "" });
          if (ev.path === "") rootError = "";
          renderTree();
          renderCrumbs();
          break;
        }
        case "info": {
          const t = tabs.get(ev.path);
          if (t?.overwriting) {
            const payload = tabs.overwritePayload(ev);
            if (payload === null) {
              setStatus(
                "Écrasement impossible : l'élément sur le disque n'est plus un fichier.",
                "err",
              );
            } else if (!send({ type: "fsWrite", ...payload })) {
              t.saving = false;
              setStatus("Hors ligne : rien n'a été écrasé.", "warn");
            }
            renderBar();
            break;
          }
          const cb = pendingStat.get(ev.path);
          pendingStat.delete(ev.path);
          cb?.(ev);
          break;
        }
        case "content": {
          const t = tabs.applyContent(ev);
          if (t === null) break;
          lastDirty.set(ev.path, false);
          renderTabs();
          renderBar();
          renderTree();
          notifyDirty();
          const focus = focusOnLoad.delete(ev.path);
          if (tabs.activePath() === ev.path) void showView({ focus });
          break;
        }
        case "written": {
          const t = tabs.applyWritten(ev);
          const created = pendingCreate === ev.path;
          if (created) pendingCreate = null;
          relist(parentOf(ev.path));
          if (created && t === null) {
            for (const a of ancestorsOf(ev.path)) expanded.add(a);
            selected = { path: ev.path, kind: "file" };
            openFile(ev.path);
            setStatus(`Fichier créé : ${ev.path}`, "ok");
            break;
          }
          if (t !== null) {
            lastDirty.set(ev.path, tabs.isDirty(ev.path));
            setStatus(`Enregistré : ${ev.path}`, "ok");
            renderTabs();
            renderBar();
            renderTree();
            notifyDirty();
            if (tabs.activePath() === ev.path) void showView();
          }
          break;
        }
        case "conflict": {
          if (pendingCreate === ev.path) {
            pendingCreate = null;
            setStatus("Un élément porte déjà ce nom : rien n'a été écrasé.", "warn");
            break;
          }
          if (tabs.applyConflict(ev.path) !== null) {
            renderTabs();
            renderBar();
          }
          break;
        }
        case "done":
          handleDone(ev);
          break;
        case "cancelled":
          setStatus(CANCEL_TEXT[ev.op] ?? "Opération annulée.", "steel");
          break;
        case "error":
          handleError(ev);
          break;
        default:
          break;
      }
    }

    function handleDone(ev) {
      switch (ev.op) {
        case "mkdir": {
          for (const a of ancestorsOf(ev.path)) expanded.add(a);
          relist(parentOf(ev.path));
          selected = { path: ev.path, kind: "dir" };
          setStatus(`Dossier créé : ${ev.path}`, "ok");
          break;
        }
        case "rename": {
          if (ev.from === null) break;
          applyRename(ev.from, ev.path);
          relist(parentOf(ev.from), parentOf(ev.path));
          renderAll();
          setStatus(`Renommé : ${ev.path}`, "ok");
          break;
        }
        case "delete": {
          const closed = tabs.removed(ev.path);
          for (const p of closed) {
            editor?.forget(p);
            editorRevs.delete(p);
            previews.delete(p);
            lastDirty.delete(p);
          }
          for (const p of [...expanded]) if (p !== "" && isUnder(p, ev.path)) expanded.delete(p);
          for (const p of [...listings.keys()]) {
            if (p !== "" && isUnder(p, ev.path)) listings.delete(p);
          }
          if (isUnder(selected.path, ev.path)) selected = { path: parentOf(ev.path), kind: "dir" };
          if (tabs.list().length === 0) setPane("tree");
          shownKey = "";
          relist(parentOf(ev.path));
          renderAll();
          notifyDirty();
          setStatus(`Supprimé : ${ev.path}`, "ok");
          break;
        }
        case "upload":
          relist(parentOf(ev.path));
          setStatus(`Fichier téléversé : ${ev.path}`, "ok");
          break;
        case "download":
          setStatus(`Téléchargement lancé : ${baseName(ev.path)}`, "ok");
          break;
        case "evidence":
          setStatus(`Preuve capturée : ${baseName(ev.path)}`, "ok");
          break;
        default:
          break;
      }
    }

    function handleError(ev) {
      const label = OP_LABEL[ev.op] ?? "Opération";
      const where = ev.path ? ` (${ev.path})` : "";
      switch (ev.op) {
        case "fsList": {
          if (ev.path === null) break;
          loading.delete(ev.path);
          if (ev.path === "") {
            rootError = ev.text;
            listings.delete("");
          } else {
            if (ev.code === "notFound") {
              expanded.delete(ev.path);
              listings.delete(ev.path);
              relist(parentOf(ev.path));
            } else {
              listings.set(ev.path, { entries: [], truncated: false, error: ev.text });
            }
          }
          renderTree();
          break;
        }
        case "fsRead": {
          if (ev.path === null) break;
          const t = tabs.get(ev.path);
          if (t === null) break;
          if (ev.code === "notText") tabs.applyBinary(ev.path);
          else tabs.applyError(ev.path, ev.text);
          shownKey = "";
          renderTabs();
          renderBar();
          if (tabs.activePath() === ev.path) void showView();
          break;
        }
        case "fsWrite": {
          if (ev.path !== null) {
            if (pendingCreate === ev.path) pendingCreate = null;
            if (tabs.applyError(ev.path, `${label} refusé : ${ev.text}`) !== null) {
              renderTabs();
              renderBar();
            }
          }
          setStatus(`${label} refusé : ${ev.text}${where}`, "err");
          break;
        }
        case "fsStat": {
          if (ev.path !== null) {
            pendingStat.delete(ev.path);
            const t = tabs.get(ev.path);
            if (t) {
              t.overwriting = false;
              renderBar();
            }
          }
          setStatus(`${label} refusée : ${ev.text}${where}`, "err");
          break;
        }
        default:
          setStatus(`${label} refusé : ${ev.text}${where}`, "err");
      }
    }

    // ───────────── Clavier de la fenêtre et garde de fermeture ─────────────

    root.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (mod && !event.altKey && !event.shiftKey && key === "s") {
        event.preventDefault();
        saveActive();
      } else if (mod && !event.altKey && !event.shiftKey && key === "f") {
        const t = tabs.active();
        if (editor !== null && t?.kind === "text" && !previews.has(t.path) && !editorHost.hidden) {
          event.preventDefault();
          editor.openSearch();
        }
      } else if (event.key === "Escape" && menu !== null) {
        event.preventDefault();
        closeMenu(true);
      }
    });

    const beforeUnload = (event) => {
      if (tabs.dirtyPaths().length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    win?.addEventListener?.("beforeunload", beforeUnload);

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => editor?.view.requestMeasure());
      observer.observe(root);
    }

    const api = {
      handle,
      navigate,
      setOnline(value) {
        syncOnline(root, value);
        if (value) {
          if (pendingNavigate !== null) {
            const p = pendingNavigate;
            pendingNavigate = null;
            navigate(p);
          }
          renderBar();
        }
      },
      reconnect() {
        relistAll();
        if (pendingNavigate !== null) {
          const p = pendingNavigate;
          pendingNavigate = null;
          navigate(p);
        }
      },
      dirtyCount: () => tabs.dirtyPaths().length,
      /** Fermer avec des onglets modifiés demande une confirmation locale ; `proceed` ferme ensuite. */
      guardClose(proceed) {
        const count = tabs.dirtyPaths().length;
        if (count === 0) return false;
        ask({
          title: "Fermer Fichiers ?",
          text: `${count} onglet${count > 1 ? "s" : ""} modifié${count > 1 ? "s" : ""} non enregistré${count > 1 ? "s" : ""} : les modifications seront perdues.`,
          confirmLabel: "Fermer sans enregistrer",
          danger: true,
          onConfirm: proceed,
        });
        return true;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        closeMenu(false);
        cancelLongPress();
        if (statusTimer !== null) clearTimeout(statusTimer);
        win?.removeEventListener?.("beforeunload", beforeUnload);
        observer?.disconnect();
        editor?.destroy();
        if (inst === api) inst = null;
        onDirty(0);
      },
    };

    inst = api;
    renderAll();
    syncOnline(root, online);
    if (online) requestList("");
    if (pendingNavigate !== null && online) {
      const p = pendingNavigate;
      pendingNavigate = null;
      navigate(p);
    }
    return api;
  }

  return {
    mount,
    /** Message de la vue `shell` : tout ce qui n'est pas `fs*` ou `policyChanged` est ignoré. */
    onMessage(msg) {
      const ev = parseFsMessage(msg);
      if (ev !== null) inst?.handle(ev);
    },
    /** Connexion (ré)établie : les listes ouvertes sont relues, un chemin demandé hors ligne est suivi. */
    onOpen() {
      online = true;
      inst?.reconnect();
      inst?.setOnline(true);
    },
    setOnline(value) {
      online = value === true;
      inst?.setOnline(online);
    },
    /** Dossier ou fichier à montrer (lien profond, `openWindow files path`). Sans fenêtre : à l'ouverture. */
    navigate(path) {
      if (inst === null) pendingNavigate = typeof path === "string" ? path : null;
      else inst.navigate(path);
    },
    /** Nombre d'onglets modifiés. */
    dirtyCount: () => inst?.dirtyCount() ?? 0,
    /** Une fenêtre avec des onglets modifiés n'est jamais fermée par un changement d'espace. */
    isProtected: (key) => key === "native:files" && (inst?.dirtyCount() ?? 0) > 0,
  };
}
