// Placement du menu contextuel de la fenêtre Fichiers. La position passe par le CSSOM
// (`element.style.left = …`), jamais par un attribut `style` (CSP `style-src 'self'`), comme le bureau
// à fenêtres (wm/desktop.js). Pur : seuls des rectangles sont lus.

/**
 * Position (px, relative à `host`) d'un menu de taille `size` ouvert près de `anchor` : sous l'ancre, ou
 * au-dessus s'il ne tient pas dessous, toujours à l'intérieur de `host` (marge de 4 px).
 * @param {{ left: number, top: number, bottom: number }} anchor
 * @param {{ left: number, top: number, width: number, height: number }} host
 * @param {{ width: number, height: number }} size
 */
export function menuPosition(anchor, host, size) {
  const margin = 4;
  const left = Math.max(
    margin,
    Math.min(anchor.left - host.left, host.width - size.width - margin),
  );
  const below = anchor.bottom - host.top + 2;
  const above = anchor.top - host.top - size.height - 2;
  const fits = below + size.height <= host.height - margin;
  const top = Math.max(margin, fits ? below : above);
  return { left, top };
}

/** Pose `box` près de `anchor` dans `host` (éléments DOM). */
export function placeMenu(box, anchor, host) {
  const rect = host.getBoundingClientRect();
  const pos = menuPosition(anchor, rect, { width: box.offsetWidth, height: box.offsetHeight });
  box.style.left = `${pos.left}px`;
  box.style.top = `${pos.top}px`;
}
