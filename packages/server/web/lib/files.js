// Fenêtre Fichiers (pur, sans DOM) : chemins relatifs au projet, lecture des messages `fs*` du serveur,
// langages par extension, et modèle des onglets (texte modifié, etag, conflit d'écriture). Toute donnée
// reçue est contrôlée ici avant d'atteindre l'interface ; rien n'y est inséré en HTML.

export const MAX_PATH = 1024;
export const MAX_SEGMENT = 255;
/** Éléments que le serveur refuse : jamais proposés (arborescence, création). */
export const HIDDEN_NAMES = [".git", "node_modules"];

const hasControl = (s) => /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s);
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// ───────────── Chemins ─────────────

/**
 * Chemin relatif au dossier du projet → forme normalisée (sans barre en bordure ni segment vide), ou
 * `null` : absolu, `..`, `.`, antislash, contrôle, trop long. `""` désigne la racine.
 */
export function cleanRelPath(raw) {
  if (typeof raw !== "string") return null;
  if (raw === "") return "";
  if (raw.length > MAX_PATH + 2 || raw.includes("\\") || hasControl(raw)) return null;
  if (raw.startsWith("/") && raw.length > 0) return null;
  const segments = raw.endsWith("/") ? raw.slice(0, -1).split("/") : raw.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === ".." || seg.length > MAX_SEGMENT) return null;
  }
  const out = segments.join("/");
  return out.length <= MAX_PATH ? out : null;
}

export const joinPath = (dir, name) => (dir === "" ? name : `${dir}/${name}`);
export const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
export const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
/** Ancêtres d'un chemin, de la racine au parent : `a/b/c` → `["", "a", "a/b"]`. */
export function ancestorsOf(path) {
  const out = [""];
  if (path === "") return [];
  const segs = path.split("/");
  for (let i = 1; i < segs.length; i += 1) out.push(segs.slice(0, i).join("/"));
  return out;
}
/** Vrai si `path` est `base` ou se trouve dessous. */
export const isUnder = (path, base) =>
  path === base || (base !== "" && path.startsWith(`${base}/`));
/** Segments cliquables de la barre de chemin : `[{ name, path }]`, racine incluse (`name` vide). */
export function crumbsOf(path) {
  const out = [{ name: "", path: "" }];
  if (path === "") return out;
  const segs = path.split("/");
  segs.forEach((name, i) => {
    out.push({ name, path: segs.slice(0, i + 1).join("/") });
  });
  return out;
}

/** Nom saisi pour un fichier ou un dossier : message d'erreur français ou `null`. */
export function checkName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "") return "Donnez un nom.";
  if (name === "." || name === "..") return "Nom refusé.";
  if (name.length > MAX_SEGMENT) return `Nom trop long (${MAX_SEGMENT} caractères au plus).`;
  if (name.includes("/") || name.includes("\\"))
    return "Le nom ne peut contenir ni « / » ni « \\ ».";
  if (hasControl(name)) return "Le nom contient un caractère de contrôle.";
  if (HIDDEN_NAMES.includes(name)) return "Ce nom est réservé.";
  return null;
}

// ───────────── Types de fichiers ─────────────

const LANGUAGES = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  html: "html",
  htm: "html",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  css: "css",
};
const IMAGES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const extOf = (path) => {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** Identifiant de langage (`markdown`, `json`…) d'après l'extension, ou `null`. */
export const languageOf = (path) => LANGUAGES[extOf(path)] ?? null;
/** Type MIME d'une image affichable en aperçu, ou `null`. */
export const imageMime = (path) => IMAGES[extOf(path)] ?? null;
export const isMarkdown = (path) => languageOf(path) === "markdown";
/** Base64 plausible (donnée reçue) : alphabet strict, jamais interprété. */
export const isBase64 = (s) => typeof s === "string" && /^[A-Za-z0-9+/\r\n]*={0,2}$/.test(s);

// ───────────── Erreurs ─────────────

const ERRORS = {
  noProject: "Aucun projet actif : activez un projet dans Projets et réglages.",
  invalidPath: "Chemin invalide.",
  notFound: "Introuvable.",
  exists: "Un élément porte déjà ce nom.",
  symlink: "Les liens symboliques sont refusés.",
  protected: "Élément protégé : accès refusé.",
  notFile: "Ce n'est pas un fichier.",
  notDir: "Ce n'est pas un dossier.",
  notText: "Ce fichier n'est pas du texte.",
  tooLarge: "Fichier trop volumineux.",
  badType: "Type de fichier refusé.",
  empty: "Contenu vide refusé.",
  failed: "L'opération a échoué.",
};

/** Code de raison (`fs.notFound` ou `notFound`) → texte français ; un code inconnu reste générique. */
export function fsErrorText(code) {
  const key = typeof code === "string" ? code.replace(/^fs\./, "") : "";
  return Object.hasOwn(ERRORS, key) ? ERRORS[key] : "L'opération a été refusée.";
}
export const fsErrorKey = (code) => (typeof code === "string" ? code.replace(/^fs\./, "") : "");

// ───────────── Messages du serveur ─────────────

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const okPath = (v) => cleanRelPath(v);

/** Entrées d'un dossier : dossiers d'abord, puis par nom ; `.git` et `node_modules` écartés. */
export function parseEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, 2000)) {
    if (!isRecord(e) || typeof e.name !== "string") continue;
    if (checkName(e.name) !== null || HIDDEN_NAMES.includes(e.name)) continue;
    if (e.kind !== "file" && e.kind !== "dir") continue;
    out.push({ name: e.name, kind: e.kind, size: num(e.size), mtime: num(e.mtime) });
  }
  return out.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name, "fr"),
  );
}

/**
 * Message du serveur → intention typée, ou `null` (type inconnu, chemin invalide). Une seule fonction pour
 * tous les `fs*` : l'interface ne lit jamais un message brut.
 */
export function parseFsMessage(msg) {
  if (!isRecord(msg) || typeof msg.type !== "string") return null;
  switch (msg.type) {
    case "policyChanged":
      return { kind: "policyChanged" };
    case "fsEntries": {
      const path = okPath(msg.path);
      if (path === null) return null;
      return {
        kind: "entries",
        path,
        entries: parseEntries(msg.entries),
        truncated: msg.truncated === true,
      };
    }
    case "fsInfo": {
      const path = okPath(msg.path);
      if (path === null) return null;
      return {
        kind: "info",
        path,
        exists: msg.exists === true,
        type: msg.kind === "file" || msg.kind === "dir" ? msg.kind : null,
        size: num(msg.size),
        mtime: num(msg.mtime),
        etag: typeof msg.etag === "string" && msg.etag !== "" ? msg.etag.slice(0, 200) : null,
      };
    }
    case "fsContent": {
      const path = okPath(msg.path);
      if (path === null || path === "") return null;
      const text = typeof msg.text === "string" ? msg.text : null;
      const base64 = typeof msg.base64 === "string" && isBase64(msg.base64) ? msg.base64 : null;
      if (text === null && base64 === null) return null;
      return {
        kind: "content",
        path,
        text,
        base64,
        truncated: msg.truncated === true,
        etag: typeof msg.etag === "string" && msg.etag !== "" ? msg.etag.slice(0, 200) : null,
        mtime: num(msg.mtime),
        size: num(msg.size),
      };
    }
    case "fsWritten": {
      const path = okPath(msg.path);
      if (path === null || typeof msg.etag !== "string" || msg.etag === "") return null;
      return {
        kind: "written",
        path,
        etag: msg.etag.slice(0, 200),
        mtime: num(msg.mtime),
        size: num(msg.size),
      };
    }
    case "fsConflict": {
      const path = okPath(msg.path);
      return path === null ? null : { kind: "conflict", path };
    }
    case "fsDone":
    case "fsCancelled": {
      // `fsDone` : op `mkdir`, `rename` (`path` = destination, `from` = source), `delete`, `upload`,
      // `download`, `evidence` ; `fsCancelled` : op `fsDelete`, `fsUpload`, `fsCaptureEvidence`.
      const op = str(msg.op, 40);
      if (op === "") return null;
      const path = okPath(msg.path ?? "");
      if (path === null) return null;
      const from = typeof msg.from === "string" ? okPath(msg.from) : null;
      return { kind: msg.type === "fsDone" ? "done" : "cancelled", op, path, from };
    }
    case "fsError": {
      const code =
        isRecord(msg.reason) && typeof msg.reason.code === "string" ? msg.reason.code : "";
      const path = msg.path === undefined ? null : okPath(msg.path);
      return {
        kind: "error",
        op: str(msg.op, 40),
        path,
        code: fsErrorKey(code),
        text: fsErrorText(code),
      };
    }
    default:
      return null;
  }
}

// ───────────── Onglets ─────────────

/**
 * Modèle des onglets de fichiers ouverts (pur). Un onglet de texte est « modifié » quand son texte courant
 * diffère du texte enregistré. L'etag est celui du dernier état connu du disque : une écriture l'envoie, le
 * serveur refuse (`fsConflict`) si le fichier a changé. Rien n'est jamais écrasé sans demande explicite :
 * `Écraser` relit l'etag (`fsStat`) puis réécrit.
 */
export function createTabs() {
  /** @type {Map<string, object>} */
  const tabs = new Map();
  let activePath = null;

  const get = (path) => tabs.get(path) ?? null;
  const dirty = (t) => t.kind === "text" && !t.readOnly && (t.missing || t.text !== t.saved);

  return {
    list: () => [...tabs.values()],
    get,
    active: () => (activePath === null ? null : get(activePath)),
    activePath: () => activePath,
    isDirty: (path) => {
      const t = get(path);
      return t !== null && dirty(t);
    },
    dirtyPaths: () => [...tabs.values()].filter(dirty).map((t) => t.path),
    /** Ouvre (ou retrouve) l'onglet d'un fichier et le rend actif. `created` : il faut le lire. */
    open(path) {
      let t = get(path);
      const created = t === null;
      if (t === null) {
        t = {
          path,
          rev: 0,
          kind: "loading",
          text: "",
          saved: "",
          etag: null,
          mtime: 0,
          size: 0,
          readOnly: false,
          truncated: false,
          base64: null,
          mime: null,
          conflict: false,
          overwriting: false,
          saving: false,
          sending: "",
          missing: false,
          error: "",
        };
        tabs.set(path, t);
      }
      activePath = path;
      return { tab: t, created };
    },
    activate(path) {
      if (tabs.has(path)) activePath = path;
    },
    /** Ferme un onglet ; l'actif devient le voisin. */
    close(path) {
      if (!tabs.delete(path)) return;
      if (activePath === path) {
        const rest = [...tabs.keys()];
        activePath = rest.at(-1) ?? null;
      }
    },
    /** Contenu lu : texte (lecture seule si tronqué ou sans etag), ou image. Remplace tout état local. */
    applyContent(c) {
      const t = get(c.path);
      if (t === null) return null;
      t.error = "";
      t.rev += 1;
      t.conflict = false;
      t.overwriting = false;
      t.saving = false;
      t.missing = false;
      t.mtime = c.mtime;
      t.size = c.size;
      if (c.text !== null) {
        t.kind = "text";
        t.text = c.text;
        t.saved = c.text;
        t.etag = c.etag;
        t.truncated = c.truncated;
        t.readOnly = c.truncated || c.etag === null;
      } else {
        t.kind = "image";
        t.base64 = c.base64;
        t.mime = imageMime(c.path);
        t.readOnly = true;
        t.truncated = c.truncated;
      }
      return t;
    },
    /** Le serveur refuse de lire en texte : binaire, sans aperçu. */
    applyBinary(path) {
      const t = get(path);
      if (t !== null) {
        t.kind = "binary";
        t.readOnly = true;
      }
      return t;
    },
    applyError(path, text) {
      const t = get(path);
      if (t === null) return null;
      if (t.kind === "loading") t.kind = "error";
      t.error = text;
      t.saving = false;
      t.overwriting = false;
      return t;
    },
    /** Saisie dans l'éditeur. */
    edit(path, text) {
      const t = get(path);
      if (t !== null && t.kind === "text" && !t.readOnly) t.text = text;
    },
    /** Demande d'enregistrement : charge utile `fsWrite`, ou `null` (rien à écrire, déjà en cours). */
    beginSave(path) {
      const t = get(path);
      if (t === null || t.kind !== "text" || t.readOnly || t.saving || !dirty(t)) return null;
      t.saving = true;
      t.sending = t.text;
      return { path, text: t.text, etag: t.missing ? null : t.etag };
    },
    applyWritten(w) {
      const t = get(w.path);
      if (t === null) return null;
      t.saving = false;
      t.overwriting = false;
      t.conflict = false;
      t.missing = false;
      t.error = "";
      t.saved = t.sending;
      t.etag = w.etag;
      t.mtime = w.mtime;
      t.size = w.size;
      return t;
    },
    applyConflict(path) {
      const t = get(path);
      if (t === null) return null;
      t.saving = false;
      t.overwriting = false;
      t.conflict = true;
      return t;
    },
    /** « Écraser » confirmé : on relit d'abord l'etag du disque (`fsStat`). */
    beginOverwrite(path) {
      const t = get(path);
      if (t === null || t.kind !== "text" || t.readOnly || t.saving || t.overwriting) return false;
      t.overwriting = true;
      return true;
    },
    /** Réponse `fsStat` pendant un écrasement : charge utile `fsWrite` avec l'etag frais, ou `null`. */
    overwritePayload(info) {
      const t = get(info.path);
      if (t === null || !t.overwriting) return null;
      t.overwriting = false;
      if (info.exists && info.type !== "file") return null;
      t.saving = true;
      t.sending = t.text;
      t.conflict = false;
      return { path: t.path, text: t.text, etag: info.exists ? info.etag : null };
    },
    /** Dossier ou fichier renommé : les onglets dessous suivent. */
    rename(from, to) {
      const moved = [];
      for (const [path, t] of [...tabs]) {
        if (!isUnder(path, from)) continue;
        const next = to + path.slice(from.length);
        tabs.delete(path);
        t.path = next;
        moved.push([path, next]);
        tabs.set(next, t);
        if (activePath === path) activePath = next;
      }
      return moved;
    },
    /** Élément supprimé : les onglets propres sont fermés, les modifiés restent (à réenregistrer). */
    removed(base) {
      const closed = [];
      for (const [path, t] of [...tabs]) {
        if (!isUnder(path, base)) continue;
        if (dirty(t)) {
          t.missing = true;
          t.etag = null;
          t.conflict = false;
        } else {
          closed.push(path);
          tabs.delete(path);
          if (activePath === path) activePath = null;
        }
      }
      if (activePath === null) activePath = [...tabs.keys()].at(-1) ?? null;
      return closed;
    },
  };
}
