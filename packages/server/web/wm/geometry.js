// Géométrie du bureau (pur, sans DOM). Une fenêtre se stocke en fractions du bureau (0..1) pour se
// rejouer sur n'importe quelle taille d'écran ; les interactions (glisser, redimensionner, aimanter)
// travaillent en pixels. Rect en pixels : { x, y, w, h }. Bureau : { w, h }.

export const MIN_W = 320;
export const MIN_H = 200;
/** Distance d'aimantation aux bords du bureau et aux autres fenêtres. */
export const SNAP = 12;
/** Hauteur de la barre de titre : elle doit rester atteignable. */
export const TITLE_H = 34;
/** Largeur minimale d'une fenêtre qui doit rester visible quand elle déborde latéralement. */
export const REACH = 96;
/** Bande de bord où le pointeur déclenche un aperçu de tuile. */
export const EDGE = 20;
/** Longueur le long du bord où l'aperçu devient un quart (coin). */
export const CORNER = 96;

export const TILES = ["left", "right", "tl", "tr", "bl", "br", "full"];

const TILE_FRACTIONS = {
  left: { x: 0, y: 0, w: 0.5, h: 1 },
  right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  tl: { x: 0, y: 0, w: 0.5, h: 0.5 },
  tr: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  bl: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  br: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  full: { x: 0, y: 0, w: 1, h: 1 },
};

export const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

const round4 = (value) => Math.round(value * 10000) / 10000;

/** Fractions d'une tuile (`left`, `right`, `tl`, `tr`, `bl`, `br`, `full`), ou `null`. */
export function tileFractions(kind) {
  const tile = Object.hasOwn(TILE_FRACTIONS, kind) ? TILE_FRACTIONS[kind] : undefined;
  return tile ? { ...tile } : null;
}

/** Fractions → pixels. Les bords sont arrondis, puis la taille déduite : deux tuiles voisines se touchent exactement. */
export function toPixels(fractions, desk) {
  const x1 = Math.round(fractions.x * desk.w);
  const y1 = Math.round(fractions.y * desk.h);
  const x2 = Math.round((fractions.x + fractions.w) * desk.w);
  const y2 = Math.round((fractions.y + fractions.h) * desk.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Pixels → fractions (4 décimales). Bureau vide : repli sur le plein bureau. */
export function toFractions(rect, desk) {
  if (desk.w <= 0 || desk.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: round4(rect.x / desk.w),
    y: round4(rect.y / desk.h),
    w: round4(rect.w / desk.w),
    h: round4(rect.h / desk.h),
  };
}

/** Fractions saines : nombres finis, taille non nulle ; sinon `null`. */
export function sanitizeFractions(value) {
  if (value === null || typeof value !== "object") return null;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (w <= 0 || h <= 0) return null;
  return { x: clamp(x, -1, 1), y: clamp(y, 0, 1), w: clamp(w, 0.01, 1), h: clamp(h, 0.01, 1) };
}

/**
 * Ramène une fenêtre dans le bureau : taille minimale (320x200, ou le bureau s'il est plus petit), taille
 * maximale le bureau, barre de titre toujours atteignable (jamais sous le bord bas, au moins `REACH` pixels
 * visibles horizontalement).
 */
export function clampRect(rect, desk, min = { w: MIN_W, h: MIN_H }) {
  const w = clamp(Math.round(rect.w), Math.min(min.w, desk.w), desk.w);
  const h = clamp(Math.round(rect.h), Math.min(min.h, desk.h), desk.h);
  const reach = Math.min(REACH, w, desk.w);
  const x = clamp(Math.round(rect.x), reach - w, desk.w - reach);
  const y = clamp(Math.round(rect.y), 0, desk.h - TITLE_H);
  return { x, y, w, h };
}

const overlaps = (a0, a1, b0, b1, slack) => a0 <= b1 + slack && b0 <= a1 + slack;

/** Meilleur décalage (le plus petit en valeur absolue, dans le seuil) parmi les couples bord mobile / bord cible. */
function bestShift(moving, targets, threshold) {
  let best = null;
  for (const m of moving) {
    for (const t of targets) {
      const delta = t - m;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) {
        best = delta;
      }
    }
  }
  return best ?? 0;
}

/**
 * Aimante `rect` aux bords du bureau et à ceux des autres fenêtres (`others` : rects en pixels, visibles) à
 * moins de `threshold` pixels. Le redimensionnement n'est pas touché, seule la position bouge.
 */
export function snapRect(rect, others, desk, threshold = SNAP) {
  const xTargets = [0, desk.w];
  const yTargets = [0, desk.h];
  for (const o of others) {
    if (overlaps(rect.y, rect.y + rect.h, o.y, o.y + o.h, threshold)) {
      xTargets.push(o.x, o.x + o.w);
    }
    if (overlaps(rect.x, rect.x + rect.w, o.x, o.x + o.w, threshold)) {
      yTargets.push(o.y, o.y + o.h);
    }
  }
  const dx = bestShift([rect.x, rect.x + rect.w], xTargets, threshold);
  const dy = bestShift([rect.y, rect.y + rect.h], yTargets, threshold);
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
}

/**
 * Tuile visée par le pointeur (coordonnées du bureau) : bord gauche/droit → moitié, coin → quart, haut →
 * plein bureau. `null` ailleurs (le bas du bureau, sans coin, ne tuile pas).
 */
export function dropZone(point, desk, edge = EDGE, corner = CORNER) {
  const left = point.x <= edge;
  const right = point.x >= desk.w - edge;
  const top = point.y <= edge;
  const bottom = point.y >= desk.h - edge;
  const nearTopEnd = point.y <= corner;
  const nearBottomEnd = point.y >= desk.h - corner;
  const nearLeftEnd = point.x <= corner;
  const nearRightEnd = point.x >= desk.w - corner;
  if (left && nearTopEnd) return "tl";
  if (left && nearBottomEnd) return "bl";
  if (right && nearTopEnd) return "tr";
  if (right && nearBottomEnd) return "br";
  if (top && nearLeftEnd) return "tl";
  if (top && nearRightEnd) return "tr";
  if (bottom && nearLeftEnd) return "bl";
  if (bottom && nearRightEnd) return "br";
  if (left) return "left";
  if (right) return "right";
  if (top) return "full";
  return null;
}

/**
 * Redimensionne par une poignée (`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`) : le bord opposé reste en
 * place, la taille minimale est respectée, la fenêtre ne dépasse pas le bureau.
 */
export function resizeRect(rect, handle, dx, dy, desk, min = { w: MIN_W, h: MIN_H }) {
  const minW = Math.min(min.w, desk.w);
  const minH = Math.min(min.h, desk.h);
  let { x, y, w, h } = rect;
  if (handle.includes("e")) {
    w = clamp(w + dx, minW, desk.w - x);
  }
  if (handle.includes("w")) {
    const right = x + w;
    const nx = clamp(x + dx, Math.min(0, x), right - minW);
    x = nx;
    w = right - nx;
  }
  if (handle.includes("s")) {
    h = clamp(h + dy, minH, desk.h - y);
  }
  if (handle.includes("n")) {
    const bottom = y + h;
    const ny = clamp(y + dy, 0, bottom - minH);
    y = ny;
    h = bottom - ny;
  }
  return { x, y, w, h };
}

/** Position par défaut d'une nouvelle fenêtre : cascade de `index` crans, taille en fractions. */
export function cascadeFractions(index, size = { w: 0.46, h: 0.7 }) {
  const step = 0.035;
  const turn = index % 6;
  const x = Math.min(0.04 + turn * step, 1 - size.w);
  const y = Math.min(0.04 + turn * step, 1 - size.h);
  return { x: round4(x), y: round4(y), w: size.w, h: size.h };
}
