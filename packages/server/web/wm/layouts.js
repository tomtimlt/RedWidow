// Espaces de travail (pur, sans DOM). Une disposition est la liste des fenêtres ouvertes (vue, identité,
// géométrie en fractions) telle que le serveur la conserve (`layoutSave`). Schéma serveur
// (`validateLayout`, source de vérité) : { windows: [{ id, view, x, y, w, h, space?, state?, mode? }],
// spaces: [{ id, name }], active? }. Ce module n'en fait qu'un miroir léger (mêmes bornes) pour ne pas
// appliquer une donnée illisible.
//
// Encodage :
// - identité d'une fenêtre : le couple (vue, identifiant) ;
// - ordre d'empilement : ordre du tableau `windows` (de l'arrière vers l'avant) ;
// - `state` : `minimized` ou `maximized` (la géométrie reste celle de la fenêtre restaurée) ;
// - `mode` : `watch` ou `report` pour la vue `viewer`, nom de l'écran pour un écran natif ;
// - écran natif : vue `shell`, identifiant et `mode` = nom de l'écran ;
// - nom de l'espace affiché : `spaces[0].name` de la disposition courante (un espace `main` unique).
import { iframeSpec, nativeSpec, terminalSpec } from "./types.js";

export const MAX_WINDOWS = 32;
export const MAX_SPACES = 20;
export const MAX_NAME = 40;
/** Nombre maximal d'espaces enregistrés (limite du serveur). */
export const MAX_SAVED = 50;
export const SAVE_DELAY_MS = 1000;
export const DEFAULT_NAME = "Bureau";
const SPACE_ID = "main";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VIEWS = [
  "chat",
  "cockpit",
  "sessions",
  "program",
  "engagement",
  "studio",
  "killchain",
  "viewer",
  "shell",
  "term",
];
const STATES = ["minimized", "maximized"];
/** Vue du serveur → type de fenêtre à instance. */
const KIND_OF_VIEW = {
  chat: "mission",
  killchain: "graph",
  program: "program",
  engagement: "engagement",
  cockpit: "cockpit",
  sessions: "sessions",
  studio: "studio",
  viewer: "monitor",
};

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isFraction = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const hasControl = (s) => /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s);

/** Nom d'espace valide (1 à 40 caractères, sans contrôle ni espace en bordure). */
export const isSpaceName = (v) =>
  typeof v === "string" &&
  v.length >= 1 &&
  v.length <= MAX_NAME &&
  v === v.trim() &&
  !hasControl(v);

/** Nom saisi → nom valide ou `null` (espaces de bordure retirés, espaces internes conservés). */
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return isSpaceName(name) ? name : null;
}

/** Miroir léger de la validation serveur : disposition lisible ou `null`. */
export function validateLayout(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.windows) || !Array.isArray(raw.spaces)) return null;
  if (raw.windows.length > MAX_WINDOWS || raw.spaces.length > MAX_SPACES) return null;
  const spaces = [];
  for (const s of raw.spaces) {
    if (!isRecord(s) || !ID_PATTERN.test(s.id ?? "") || !isSpaceName(s.name)) return null;
    if (spaces.some((o) => o.id === s.id)) return null;
    spaces.push({ id: s.id, name: s.name });
  }
  const windows = [];
  for (const w of raw.windows) {
    if (
      !isRecord(w) ||
      typeof w.id !== "string" ||
      !ID_PATTERN.test(w.id) ||
      !VIEWS.includes(w.view) ||
      !isFraction(w.x) ||
      !isFraction(w.y) ||
      !isFraction(w.w) ||
      !isFraction(w.h) ||
      windows.some((o) => o.id === w.id && o.view === w.view) ||
      (w.state !== undefined && !STATES.includes(w.state)) ||
      (w.mode !== undefined && !(typeof w.mode === "string" && ID_PATTERN.test(w.mode)))
    )
      return null;
    const out = { id: w.id, view: w.view, x: w.x, y: w.y, w: w.w, h: w.h };
    if (w.state !== undefined) out.state = w.state;
    if (w.mode !== undefined) out.mode = w.mode;
    windows.push(out);
  }
  return { windows, spaces };
}

/** Réponse `layouts` du serveur → { current, saved } lisibles (entrées illisibles écartées). */
export function parseLayouts(msg) {
  const current = msg?.current ? validateLayout(msg.current) : null;
  const saved = [];
  if (msg && Array.isArray(msg.saved)) {
    for (const entry of msg.saved) {
      if (!isRecord(entry) || !isSpaceName(entry.name)) continue;
      const layout = validateLayout(entry.layout);
      if (layout !== null && !saved.some((s) => s.name === entry.name)) {
        saved.push({ name: entry.name, layout });
      }
    }
  }
  return { current, saved };
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Spécification d'une fenêtre à partir de la disposition, ou `null` (fenêtre ignorée à l'application). */
export function specOfWindow(w) {
  if (w.view === "shell") return nativeSpec(w.mode ?? w.id);
  // Un terminal restauré s'ouvre sur le choix du conteneur : la session, elle, n'est pas rejouée.
  if (w.view === "term") return terminalSpec(w.id);
  if (w.view === "viewer") return iframeSpec(w.mode === "report" ? "report" : "monitor", w.id);
  const kind = Object.hasOwn(KIND_OF_VIEW, w.view) ? KIND_OF_VIEW[w.view] : null;
  return kind === null ? null : iframeSpec(kind, w.id);
}

/**
 * Fenêtres du bureau (`desktop.layoutWindows()`, de l'arrière vers l'avant) → disposition à enregistrer.
 * Au-delà de 32, on garde les plus à l'avant. `name` est le nom de l'espace affiché.
 */
export function serialize(items, name = DEFAULT_NAME) {
  // Identité = (vue, identifiant), comme côté serveur : un chat et un graphe de la même mission coexistent.
  const windows = [];
  const seen = new Set();
  for (let i = items.length - 1; i >= 0 && windows.length < MAX_WINDOWS; i -= 1) {
    const item = items[i];
    const spec = item.spec;
    const terminal = spec.type === "terminal";
    const view = terminal ? "term" : spec.kind === "native" ? "shell" : spec.view;
    const id = terminal ? spec.frame : spec.kind === "native" ? spec.name : spec.frame;
    const identity = `${view}:${id}`;
    if (!VIEWS.includes(view) || !ID_PATTERN.test(id) || seen.has(identity)) continue;
    seen.add(identity);
    const r = item.rect;
    const out = { id, view, x: clamp01(r.x), y: clamp01(r.y), w: clamp01(r.w), h: clamp01(r.h) };
    const mode = terminal ? undefined : spec.kind === "native" ? spec.name : spec.mode;
    if (typeof mode === "string" && ID_PATTERN.test(mode)) out.mode = mode;
    if (item.minimized) out.state = "minimized";
    else if (item.maximized) out.state = "maximized";
    windows.push(out);
  }
  return {
    windows: windows.reverse(),
    spaces: [{ id: SPACE_ID, name: isSpaceName(name) ? name : DEFAULT_NAME }],
  };
}

/** Nom de l'espace affiché dans une disposition courante. */
export const spaceNameOf = (layout) => layout?.spaces?.[0]?.name ?? DEFAULT_NAME;

/**
 * Plan d'application différentielle d'une disposition sur les fenêtres ouvertes. Une fenêtre absente de la
 * disposition est fermée, sauf si `isProtected(key)` (terminal actif) : elle est alors minimisée.
 * @returns {{ windows: { spec: object, rect: object, maximized: boolean, minimized: boolean }[], close: string[], minimize: string[] }}
 */
export function planApply(layout, openKeys, isProtected = () => false) {
  const windows = [];
  const wanted = new Set();
  for (const w of layout.windows) {
    const spec = specOfWindow(w);
    if (spec === null || wanted.has(spec.key)) continue;
    wanted.add(spec.key);
    const rect = { x: w.x, y: w.y, w: w.w, h: w.h };
    windows.push({
      spec,
      rect,
      maximized: w.state === "maximized",
      minimized: w.state === "minimized",
    });
  }
  const close = [];
  const minimize = [];
  for (const key of openKeys) {
    if (wanted.has(key)) continue;
    if (isProtected(key)) minimize.push(key);
    else close.push(key);
  }
  return { windows, close, minimize };
}

/**
 * Exécute un plan sur le bureau (`desktop` : has, open, close, minimize, setGeometry, focus). Les fenêtres
 * sont posées de l'arrière vers l'avant : la dernière de la liste finit au premier plan.
 */
export function applyPlan(desktop, plan) {
  for (const key of plan.close) desktop.close(key);
  for (const key of plan.minimize) desktop.minimize(key);
  for (const w of plan.windows) {
    if (desktop.has(w.spec.key)) {
      desktop.setGeometry(w.spec.key, w.rect, w.maximized);
      desktop.focus(w.spec.key);
    } else {
      desktop.open(w.spec, { rect: w.rect, maximized: w.maximized });
    }
  }
  // Minimisées en dernier : elles ne doivent pas rester au premier plan de l'empilement restauré.
  for (const w of plan.windows) if (w.minimized) desktop.minimize(w.spec.key);
}

/** Grille pour `count` fenêtres (rangée finale étirée) : fractions, sans trou. */
export function gridFractions(count) {
  if (!Number.isInteger(count) || count <= 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
    const col = i - row * cols;
    out.push({ x: r4(col / inRow), y: r4(row / rows), w: r4(1 / inRow), h: r4(1 / rows) });
  }
  return out;
}

/**
 * Enregistrement de la disposition courante : 1 s après le dernier changement, et seulement si elle
 * diffère de la dernière envoyée. Inactif tant que `enable(true)` n'a pas été appelé (avant la lecture
 * initiale) ou au téléphone (la disposition enregistrée n'est jamais modifiée depuis le mode pile).
 * @param {object} options
 * @param {(layout: object) => boolean} options.send envoie `layoutSave { name: null, layout }`
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @param {number} [options.delay]
 */
export function createLayoutSaver({
  send,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  delay = SAVE_DELAY_MS,
}) {
  let timer = null;
  let baseline = null;
  let pending = null;
  let enabled = false;
  const flush = () => {
    timer = null;
    if (pending === null || !enabled) return;
    const json = JSON.stringify(pending);
    if (json !== baseline && send(pending)) baseline = json;
    pending = null;
  };
  return {
    /** Nouvelle disposition courante : envoi différé. */
    schedule(layout) {
      if (!enabled) return;
      pending = layout;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, delay);
    },
    /** Disposition lue du serveur : référence de comparaison. */
    setBaseline(layout) {
      baseline = layout === null ? null : JSON.stringify(layout);
    },
    enable(on) {
      enabled = on === true;
      if (!enabled) {
        if (timer !== null) clearTimer(timer);
        timer = null;
        pending = null;
      }
    },
    isPending: () => pending !== null,
  };
}
