/**
 * Dispositions des fenêtres du poste web (vue `shell`, ADR 0052). Entrée non fiable : schéma borné et
 * strict (clés exactes, listes fermées, fractions dans [0,1]) ; tout écart rejette la disposition entière.
 */
import { FRAME_PATTERN, VIEWS } from "./envelope.js";

export const MAX_WINDOWS = 32;
export const MAX_SPACES = 20;
export const MAX_LAYOUT_NAME = 40;
/** Nombre maximal de dispositions nommées conservées. */
export const MAX_SAVED_LAYOUTS = 50;

/** Fenêtre : cadre (identifiant), vue affichée, position et taille en fraction de l'espace [0,1]. */
export interface LayoutWindow {
  id: string;
  view: (typeof VIEWS)[number];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Espace (bureau) qui porte la fenêtre ; absent : le premier. */
  space?: string;
}

export interface LayoutSpace {
  id: string;
  name: string;
}

export interface Layout {
  windows: LayoutWindow[];
  spaces: LayoutSpace[];
  /** Espace affiché ; absent : le premier. */
  active?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const exactKeys = (o: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((k) => k in o) &&
  Object.keys(o).every((k) => required.includes(k) || optional.includes(k));

const isFraction = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

const isId = (v: unknown): v is string => typeof v === "string" && FRAME_PATTERN.test(v);

const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/** Caractère de contrôle, de format ou séparateur de ligne Unicode (invisibles, trompeurs à l'affichage). */
export const hasControl = (s: string): boolean => CONTROL.test(s);

/** Nom d'une disposition : 1 à 40 caractères, sans caractère de contrôle ni espace en bordure. */
export function isLayoutName(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 1 &&
    v.length <= MAX_LAYOUT_NAME &&
    v === v.trim() &&
    !hasControl(v)
  );
}

/** Valide une disposition : copie normalisée, ou `null` si le schéma n'est pas respecté à la lettre. */
export function validateLayout(raw: unknown): Layout | null {
  if (!isRecord(raw) || !exactKeys(raw, ["windows", "spaces"], ["active"])) return null;
  const { windows, spaces } = raw;
  if (!Array.isArray(windows) || windows.length > MAX_WINDOWS) return null;
  if (!Array.isArray(spaces) || spaces.length > MAX_SPACES) return null;

  const outSpaces: LayoutSpace[] = [];
  for (const s of spaces) {
    if (!isRecord(s) || !exactKeys(s, ["id", "name"]) || !isId(s.id) || !isLayoutName(s.name))
      return null;
    if (outSpaces.some((o) => o.id === s.id)) return null;
    outSpaces.push({ id: s.id, name: s.name });
  }

  const outWindows: LayoutWindow[] = [];
  for (const w of windows) {
    if (
      !isRecord(w) ||
      !exactKeys(w, ["id", "view", "x", "y", "w", "h"], ["space"]) ||
      !isId(w.id) ||
      typeof w.view !== "string" ||
      !(VIEWS as readonly string[]).includes(w.view) ||
      !isFraction(w.x) ||
      !isFraction(w.y) ||
      !isFraction(w.w) ||
      !isFraction(w.h)
    )
      return null;
    if (outWindows.some((o) => o.id === w.id)) return null;
    const out: LayoutWindow = {
      id: w.id,
      view: w.view as LayoutWindow["view"],
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
    };
    if (w.space !== undefined) {
      if (!isId(w.space) || !outSpaces.some((s) => s.id === w.space)) return null;
      out.space = w.space;
    }
    outWindows.push(out);
  }

  const layout: Layout = { windows: outWindows, spaces: outSpaces };
  if (raw.active !== undefined) {
    if (!isId(raw.active) || !outSpaces.some((s) => s.id === raw.active)) return null;
    layout.active = raw.active;
  }
  return layout;
}
