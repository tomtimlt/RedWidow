// Dialogues du serveur (« HostUi », ADR 0055) : l'équivalent web des fenêtres modales de VS Code.
// Le serveur envoie `dialog {id, kind, …}` ; la coquille affiche la question, et c'est un geste humain
// (clic, Entrée, dépôt d'un fichier) qui produit `dialogResult {id, value}`. Aucune minuterie, aucune
// réponse implicite : fermer par `dialogClosed`, par une coupure ou par un nouveau message ne répond rien.
// Aucune donnée reçue n'est insérée en HTML (`textContent` partout) ; la valeur d'un champ secret n'est
// jamais conservée : le champ est vidé dès l'envoi, l'annulation ou la fermeture.
import { el, isRecord, safeText } from "../screens/common.js";

export const DIALOG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DOWNLOAD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EXTENSION = /^\.[A-Za-z0-9]{1,12}$/;
const MAX_ITEMS = 500;
const MAX_URL = 2048;
const MAX_QUEUE = 32;
/** Sans `maxBytes` valide, le contrôle local retombe sur 5 Mio (la borne du serveur par défaut). */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

// ───────────────────────────── Pur : analyse des messages ─────────────────────────────

/** Texte lisible sur plusieurs lignes (retours à la ligne gardés, autres contrôles retirés). */
function longText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, max)
    .split("\n")
    .map((line) => safeText(line, max))
    .join("\n");
}

/** Message `dialog` → description normalisée, ou `null` (ignoré). */
export function parseDialog(msg) {
  if (!isRecord(msg) || typeof msg.id !== "string" || !DIALOG_ID.test(msg.id)) return null;
  const id = msg.id;
  switch (msg.kind) {
    case "pick": {
      if (!Array.isArray(msg.items)) return null;
      const items = [];
      const seen = new Set();
      for (const it of msg.items.slice(0, MAX_ITEMS)) {
        if (!isRecord(it) || typeof it.id !== "string" || it.id === "" || it.id.length > 256) {
          continue;
        }
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        const label = safeText(it.label, 200).trim();
        items.push({
          id: it.id,
          label: label || it.id.slice(0, 200),
          detail: typeof it.detail === "string" ? safeText(it.detail, 300).trim() : "",
        });
      }
      return {
        id,
        kind: "pick",
        title: safeText(msg.title, 200).trim(),
        items,
        multi: msg.multi === true,
      };
    }
    case "input":
      return {
        id,
        kind: "input",
        title: safeText(msg.title, 200).trim(),
        label: safeText(msg.label, 200).trim(),
        secret: msg.secret === true,
        // Un champ secret n'est jamais prérempli : la valeur reçue est écartée.
        value:
          msg.secret !== true && typeof msg.value === "string" ? safeText(msg.value, 4096) : "",
      };
    case "confirm":
      return {
        id,
        kind: "confirm",
        title: safeText(msg.title, 200).trim(),
        text: longText(msg.text, 4000),
        danger: msg.danger === true,
      };
    case "file": {
      const accept = Array.isArray(msg.accept)
        ? msg.accept
            .filter((e) => typeof e === "string" && EXTENSION.test(e))
            .map((e) => e.toLowerCase())
        : [];
      if (accept.length === 0) return null;
      const max = msg.maxBytes;
      return {
        id,
        kind: "file",
        title: safeText(msg.title, 200).trim(),
        accept: [...new Set(accept)].slice(0, 32),
        maxBytes: Number.isInteger(max) && max >= 1 ? max : DEFAULT_MAX_BYTES,
      };
    }
    case "external":
      return {
        id,
        kind: "external",
        url: typeof msg.url === "string" ? msg.url.slice(0, MAX_URL + 1) : "",
        label: safeText(msg.label, 200).trim(),
      };
    default:
      return null;
  }
}

/** Message `download` → { id, filename } ou `null`. Le nom ne contient jamais de séparateur de chemin. */
export function parseDownload(msg) {
  if (!isRecord(msg) || typeof msg.id !== "string" || !DOWNLOAD_ID.test(msg.id)) return null;
  const name = safeText(msg.filename, 200).replace(/[\\/]/g, "_").trim();
  return { id: msg.id, filename: name === "" || name === "." || name === ".." ? "export" : name };
}

/**
 * URL ouvrable décomposée (schéma, hôte, reste), ou `null` : http(s) seulement, sans identifiants intégrés
 * (de la forme confiance.fr@autre.fr), sans caractère de contrôle ni espace, longueur bornée. Défense en
 * profondeur : le serveur filtre déjà.
 */
export function splitUrl(raw) {
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_URL) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refus volontaire des contrôles
  if (/[\u0000- \u007f-\u009f]/.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  const href = url.href;
  const hostAt = href.indexOf(url.host);
  if (hostAt < 0) return null;
  return {
    href,
    scheme: href.slice(0, hostAt),
    host: url.host,
    rest: href.slice(hostAt + url.host.length),
  };
}

/** Taille lisible (Kio, Mio). */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} Kio`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} Mio`;
}

/** Contrôle local d'un fichier avant l'envoi (le serveur recontrôle tout). */
export function validateFile(file, { accept, maxBytes }) {
  const name = typeof file?.name === "string" ? file.name : "";
  const size = typeof file?.size === "number" ? file.size : Number.NaN;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (!accept.includes(ext)) {
    return {
      ok: false,
      code: "badType",
      message: `Type de fichier refusé. Extensions acceptées : ${accept.join(", ")}.`,
    };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, code: "empty", message: "Le fichier est vide." };
  }
  if (size > maxBytes) {
    return {
      ok: false,
      code: "tooBig",
      message: `Fichier trop volumineux (${formatBytes(size)}). Taille maximale : ${formatBytes(maxBytes)}.`,
    };
  }
  return { ok: true };
}

/** Réponse d'erreur du serveur à un envoi → message clair pour le dialogue. */
export function uploadErrorMessage(status, { accept, maxBytes }) {
  switch (status) {
    case 413:
      return `Fichier trop volumineux. Taille maximale : ${formatBytes(maxBytes)}.`;
    case 415:
      return `Type de fichier refusé. Extensions acceptées : ${accept.join(", ")}.`;
    case 403:
      return "Envoi refusé par le serveur : la question n'est plus en attente ou l'origine est refusée.";
    case 401:
      return "Session expirée : reconnectez-vous puis recommencez.";
    case 0:
      return "Envoi interrompu : le serveur est injoignable.";
    default:
      return `Échec de l'envoi (code ${status}).`;
  }
}

// ───────────────────────────── Pur : file d'attente ─────────────────────────────

/** File de dialogues : le premier est visible, les autres attendent derrière. Un identifiant n'entre qu'une fois. */
export function createDialogQueue() {
  const list = [];
  return {
    /** `true` si ajouté ; `false` si déjà présent ou file pleine. */
    add(dialog) {
      if (list.some((d) => d.id === dialog.id) || list.length >= MAX_QUEUE) return false;
      list.push(dialog);
      return true;
    },
    /** Retire un dialogue ; renvoie `true` s'il existait. */
    remove(id) {
      const i = list.findIndex((d) => d.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },
    clear() {
      list.length = 0;
    },
    current: () => list[0] ?? null,
    size: () => list.length,
    waiting: () => Math.max(0, list.length - 1),
    has: (id) => list.some((d) => d.id === id),
  };
}

// ───────────────────────────── Envoi et téléchargement ─────────────────────────────

/**
 * Envoi d'un fichier par `XMLHttpRequest` (seul moyen d'avoir la progression). Corps = le fichier, nom
 * percent-encodé dans `X-Filename`. `done` ne rejette jamais : { status, body } ; `status` 0 = réseau.
 */
export function xhrUpload(file, dialogId, onProgress, Xhr = globalThis.XMLHttpRequest) {
  const xhr = new Xhr();
  const done = new Promise((resolve) => {
    xhr.open("POST", `/api/upload?dialog=${encodeURIComponent(dialogId)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Corps non JSON : seul le statut compte.
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: null });
    xhr.onabort = () => resolve({ status: -1, body: null });
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}

/** Déclenche un téléchargement par un lien `<a download>` de même origine, retiré aussitôt. */
export function startDownload(doc, msg) {
  const parsed = parseDownload(msg);
  if (parsed === null) return false;
  const a = doc.createElement("a");
  a.href = `/api/download/${encodeURIComponent(parsed.id)}`;
  a.download = parsed.filename;
  a.rel = "noopener";
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  return true;
}

// ───────────────────────────── Interface ─────────────────────────────

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled):not([type="hidden"]):not([hidden]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {(id: string, value: string | string[] | boolean | null) => boolean} options.send
 *   envoie `dialogResult` ; `false` si hors ligne (le dialogue reste, rien n'est conservé).
 * @param {HTMLElement[]} [options.inert] éléments rendus inertes derrière le dialogue.
 * @param {(file: File, id: string, onProgress: (ratio: number) => void) => { done: Promise<object>, abort: () => void }} [options.upload]
 * @param {(url: string) => boolean} [options.openUrl] ouvre l'URL ; `false` si refusé.
 */
export function createDialogHost({
  doc,
  send,
  inert = [],
  upload = (file, id, onProgress) => xhrUpload(file, id, onProgress),
  openUrl = (url) => {
    try {
      globalThis.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  },
}) {
  const queue = createDialogQueue();
  const overlay = el(doc, "div", "dlg-overlay");
  overlay.hidden = true;
  doc.body.append(overlay);
  let shownId = null;
  let opener = null;
  /** Nettoyage du dialogue affiché (vide les champs, interrompt un envoi). */
  let dispose = () => {};
  let serial = 0;

  const focusables = () =>
    [...overlay.querySelectorAll(FOCUSABLE)].filter(
      (n) => !n.hidden && n.getClientRects().length > 0,
    );

  function cancel() {
    const d = queue.current();
    if (d === null) return;
    answer(d, null);
  }

  /** Envoie la réponse (geste humain) ; hors ligne, le dialogue reste ouvert avec un message. */
  function answer(d, value) {
    if (send(d.id, value)) {
      finish(d.id);
      return true;
    }
    const note = overlay.querySelector(".dlg-error");
    if (note) {
      note.textContent =
        "Hors ligne : la réponse n'a pas été transmise. Réessayez à la reconnexion.";
    }
    return false;
  }

  function finish(id) {
    if (!queue.remove(id)) return;
    if (shownId === id) {
      dispose();
      dispose = () => {};
      shownId = null;
    }
    render();
  }

  function restoreFocus() {
    const target = opener;
    opener = null;
    if (target && typeof target.focus === "function" && target.isConnected) target.focus();
  }

  function render() {
    const d = queue.current();
    if (d === null) {
      overlay.hidden = true;
      overlay.replaceChildren();
      for (const n of inert) n.inert = false;
      doc.body.classList.remove("has-dialog");
      restoreFocus();
      return;
    }
    if (shownId === d.id) {
      updateCount();
      return;
    }
    if (overlay.hidden) {
      opener = typeof doc.activeElement?.focus === "function" ? doc.activeElement : null;
      for (const n of inert) n.inert = true;
      doc.body.classList.add("has-dialog");
    }
    dispose();
    dispose = () => {};
    shownId = d.id;
    serial += 1;
    overlay.hidden = false;
    const error = el(doc, "p", "dlg-error");
    error.setAttribute("role", "alert");
    const built = build(d, { answer: (v) => answer(d, v), cancel, serial, error });
    const box = el(doc, "div", `dlg-box dlg-${d.kind}${d.danger ? " is-danger" : ""}`);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const titleId = `dlg-title-${serial}`;
    box.setAttribute("aria-labelledby", titleId);
    const head = el(doc, "header", "dlg-head");
    const title = el(doc, "h2", "dlg-title", built.title);
    title.id = titleId;
    const count = el(doc, "span", "dlg-count");
    count.setAttribute("role", "status");
    head.append(title, count);
    const body = el(doc, "div", "dlg-body");
    body.append(...built.nodes, error);
    const actions = el(doc, "footer", "dlg-actions");
    actions.append(...built.actions);
    box.append(head, body, actions);
    overlay.replaceChildren(box);
    dispose = built.dispose;
    updateCount();
    (built.focus ?? focusables()[0])?.focus();
  }

  function updateCount() {
    const count = overlay.querySelector(".dlg-count");
    if (!count) return;
    const waiting = queue.waiting();
    count.textContent = waiting > 0 ? `${waiting} autre${waiting > 1 ? "s" : ""} en attente` : "";
  }

  // Clic sur le fond : annulation. Un clic qui commence dans la boîte (sélection de texte) ne compte pas.
  let downOnBackdrop = false;
  overlay.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && downOnBackdrop) cancel();
    downOnBackdrop = false;
  });
  // Échap annule ; Tab reste piégé dans la boîte.
  doc.addEventListener(
    "keydown",
    (e) => {
      if (overlay.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (!overlay.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    true,
  );
  // Le focus ne quitte jamais la boîte (clic dans le vide, outil d'accessibilité).
  doc.addEventListener("focusin", (e) => {
    if (overlay.hidden || overlay.contains(e.target)) return;
    focusables()[0]?.focus();
  });

  // ───── Construction des cinq variantes ─────

  function button(text, className, onClick) {
    const b = el(doc, "button", `dlg-btn ${className}`, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function build(d, ctx) {
    switch (d.kind) {
      case "pick":
        return buildPick(d, ctx);
      case "input":
        return buildInput(d, ctx);
      case "confirm":
        return buildConfirm(d, ctx);
      case "file":
        return buildFile(d, ctx);
      default:
        return buildExternal(d, ctx);
    }
  }

  function buildPick(d, { answer: reply, cancel: cancelAll, serial: n }) {
    const picked = new Set();
    const filter = el(doc, "input", "dlg-input dlg-filter");
    filter.type = "search";
    filter.autocomplete = "off";
    filter.spellcheck = false;
    filter.setAttribute("aria-label", "Filtrer la liste");
    filter.placeholder = "Filtrer…";
    const list = el(doc, "div", "dlg-list");
    list.setAttribute("role", d.multi ? "group" : "listbox");
    list.setAttribute("aria-label", d.title || "Choix");
    if (!d.multi) list.setAttribute("aria-orientation", "vertical");
    const empty = el(doc, "p", "dlg-empty", "Aucun résultat.");
    empty.hidden = d.items.length > 0;
    if (d.items.length === 0) empty.textContent = "Aucun élément à choisir.";
    const confirmBtn = d.multi ? button("Valider", "is-primary") : null;
    const refreshConfirm = () => {
      if (!confirmBtn) return;
      confirmBtn.disabled = picked.size === 0;
      confirmBtn.textContent = picked.size > 0 ? `Valider (${picked.size})` : "Valider";
    };
    const rows = [];
    for (const [i, it] of d.items.entries()) {
      let row;
      if (d.multi) {
        row = el(doc, "label", "dlg-opt");
        const box = el(doc, "input", "dlg-check");
        box.type = "checkbox";
        box.id = `dlg-${n}-opt-${i}`;
        box.addEventListener("change", () => {
          if (box.checked) picked.add(it.id);
          else picked.delete(it.id);
          refreshConfirm();
        });
        row.append(box, optText(it));
      } else {
        row = el(doc, "button", "dlg-opt");
        row.type = "button";
        row.addEventListener("click", () => reply(it.id));
        row.setAttribute("role", "option");
        row.append(optText(it));
      }
      list.append(row);
      rows.push({ row, it });
    }
    function visible() {
      return rows.filter((r) => !r.row.hidden);
    }
    filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      for (const r of rows) {
        r.row.hidden = q !== "" && !`${r.it.label} ${r.it.detail}`.toLowerCase().includes(q);
      }
      const none = rows.length > 0 && visible().length === 0;
      empty.hidden = !none;
      if (none) empty.textContent = "Aucun résultat.";
    });
    const optNodes = () => visible().map((r) => (d.multi ? r.row.querySelector("input") : r.row));
    // Flèches : du filtre à la liste et dans la liste ; Entrée dans le filtre choisit l'unique résultat
    // d'un choix simple.
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      const nodes = optNodes();
      const at = nodes.indexOf(doc.activeElement);
      if (e.key === "Enter" && doc.activeElement === filter && !d.multi && nodes.length === 1) {
        e.preventDefault();
        nodes[0].click();
        return;
      }
      if (e.key === "Enter") return;
      e.preventDefault();
      if (e.key === "ArrowDown") (at < 0 ? nodes[0] : nodes[at + 1])?.focus();
      else if (at <= 0) filter.focus();
      else nodes[at - 1]?.focus();
    };
    filter.addEventListener("keydown", onKey);
    list.addEventListener("keydown", onKey);
    const cancelBtn = button("Annuler", "is-secondary", cancelAll);
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        // L'ordre de la liste, pas celui des clics.
        reply(d.items.filter((it) => picked.has(it.id)).map((it) => it.id));
      });
      refreshConfirm();
    }
    return {
      title: d.title || "Choisir",
      nodes: [filter, list, empty],
      actions: confirmBtn ? [cancelBtn, confirmBtn] : [cancelBtn],
      focus: filter,
      dispose: () => picked.clear(),
    };
  }

  function optText(it) {
    const box = el(doc, "span", "dlg-opt-text");
    box.append(el(doc, "span", "dlg-opt-label", it.label));
    if (it.detail) box.append(el(doc, "span", "dlg-opt-detail", it.detail));
    return box;
  }

  function buildInput(d, { answer: reply, cancel: cancelAll, serial: n }) {
    const label = el(doc, "label", "dlg-label", d.label || d.title || "Valeur");
    const input = el(doc, "input", "dlg-input");
    input.id = `dlg-${n}-field`;
    label.htmlFor = input.id;
    input.type = d.secret ? "password" : "text";
    input.autocomplete = d.secret ? "new-password" : "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.value = d.value;
    const submit = button("Valider", "is-primary");
    const sync = () => {
      submit.disabled = d.secret && input.value === "";
    };
    input.addEventListener("input", sync);
    // Envoie la valeur puis vide le champ aussitôt : une valeur secrète ne reste nulle part.
    const go = () => {
      if (submit.disabled) return;
      const value = input.value;
      if (reply(value)) input.value = "";
    };
    submit.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        go();
      }
    });
    sync();
    return {
      title: d.title || d.label || "Saisie",
      nodes: [label, input],
      actions: [button("Annuler", "is-secondary", cancelAll), submit],
      focus: input,
      dispose: () => {
        input.value = "";
      },
    };
  }

  function buildConfirm(d, { answer: reply, cancel: cancelAll }) {
    const text = el(doc, "p", "dlg-text", d.text);
    const cancelBtn = button("Annuler", "is-secondary", cancelAll);
    const ok = button("Confirmer", d.danger ? "is-danger" : "is-primary", () => reply(true));
    const nodes = [text];
    if (d.danger) {
      const warn = el(doc, "p", "dlg-warn", "Cette action est sensible.");
      nodes.unshift(warn);
    }
    return {
      title: d.title || "Confirmation",
      nodes,
      actions: [cancelBtn, ok],
      // Danger : le focus est sur Annuler, Entrée n'y confirme jamais.
      focus: d.danger ? cancelBtn : ok,
      dispose: () => {},
    };
  }

  function buildFile(d, { answer: reply, cancel: cancelAll, error }) {
    const rules = { accept: d.accept, maxBytes: d.maxBytes };
    const input = el(doc, "input", "dlg-file");
    input.type = "file";
    input.accept = d.accept.join(",");
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    const zone = el(doc, "div", "dlg-drop");
    const pick = button("Choisir un fichier", "is-primary");
    zone.append(el(doc, "p", "dlg-drop-text", "Déposez un fichier ici ou"), pick);
    const limits = el(
      doc,
      "p",
      "dlg-hint",
      `Extensions acceptées : ${d.accept.join(", ")}. Taille maximale : ${formatBytes(d.maxBytes)}.`,
    );
    const progress = el(doc, "progress", "dlg-progress");
    progress.max = 1;
    progress.value = 0;
    progress.hidden = true;
    progress.setAttribute("aria-label", "Progression de l'envoi");
    const status = el(doc, "p", "dlg-status");
    status.setAttribute("role", "status");
    let current = null;
    let disposed = false;

    const setBusy = (busy) => {
      pick.disabled = busy;
      zone.classList.toggle("is-busy", busy);
    };
    async function start(file) {
      error.textContent = "";
      const check = validateFile(file, rules);
      if (!check.ok) {
        error.textContent = check.message;
        return;
      }
      setBusy(true);
      progress.hidden = false;
      progress.value = 0;
      status.textContent = `Envoi de ${safeText(file.name, 120)} (${formatBytes(file.size)})…`;
      const up = upload(file, d.id, (ratio) => {
        progress.value = Math.min(1, Math.max(0, ratio));
      });
      current = up;
      const res = await up.done;
      if (disposed || current !== up) return;
      current = null;
      setBusy(false);
      progress.hidden = true;
      status.textContent = "";
      if (res.status === 200 && isRecord(res.body) && typeof res.body.id === "string") {
        reply(res.body.id);
        return;
      }
      if (res.status === -1) return;
      error.textContent = uploadErrorMessage(res.status, rules);
    }
    pick.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) void start(file);
    });
    for (const type of ["dragenter", "dragover"]) {
      zone.addEventListener(type, (e) => {
        e.preventDefault();
        zone.classList.add("is-over");
      });
    }
    zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-over");
      if (current !== null) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) void start(file);
    });
    const cancelBtn = button("Annuler", "is-secondary", () => {
      current?.abort();
      cancelAll();
    });
    return {
      title: d.title || "Choisir un fichier",
      nodes: [zone, input, limits, progress, status],
      actions: [cancelBtn],
      focus: pick,
      dispose: () => {
        disposed = true;
        current?.abort();
        current = null;
      },
    };
  }

  function buildExternal(d, { answer: reply, cancel: cancelAll, error }) {
    const parts = splitUrl(d.url);
    const nodes = [];
    if (d.label) nodes.push(el(doc, "p", "dlg-text", d.label));
    const cancelBtn = button("Annuler", "is-secondary", cancelAll);
    if (parts === null) {
      // Schéma autre que http(s) : l'adresse n'est ni affichée ni ouvrable.
      error.textContent =
        "Adresse refusée : seules les adresses http et https peuvent être ouvertes.";
      const close = button("Fermer", "is-primary", () => reply(false));
      return {
        title: "Lien externe refusé",
        nodes,
        actions: [close],
        focus: close,
        dispose: () => {},
      };
    }
    const url = el(doc, "p", "dlg-url");
    url.append(
      el(doc, "span", "dlg-url-scheme", parts.scheme),
      el(doc, "strong", "dlg-url-host", parts.host),
      el(doc, "span", "dlg-url-rest", parts.rest),
    );
    nodes.push(
      el(doc, "p", "dlg-hint", "Ce lien s'ouvrira dans un nouvel onglet. Vérifiez le domaine :"),
      url,
    );
    const open = button("Ouvrir", "is-primary", () => reply(openUrl(parts.href) === true));
    return {
      title: "Ouvrir un lien externe",
      nodes,
      actions: [cancelBtn, open],
      focus: cancelBtn,
      dispose: () => {},
    };
  }

  return {
    /** Message `dialog` du serveur : mis en file (un identifiant déjà connu est ignoré, rien n'est réaffiché). */
    show(msg) {
      const d = parseDialog(msg);
      if (d === null) return false;
      if (!queue.add(d)) return false;
      render();
      return true;
    },
    /** `dialogClosed` : ferme sans répondre. */
    close(id) {
      if (typeof id !== "string") return;
      finish(id);
    },
    /** Coupure de la connexion : le serveur renverra les questions en attente à la reconnexion. */
    clear() {
      queue.clear();
      dispose();
      dispose = () => {};
      shownId = null;
      render();
    },
    isOpen: () => !overlay.hidden,
    size: () => queue.size(),
  };
}
