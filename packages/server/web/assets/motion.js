// Effets visuels de la coquille et de la connexion : fond en grille avec halo qui suit la souris, spotlight
// des cartes, inclinaison 3D des cartes « héro », révélation des titres mot par mot. Tout passe par le CSSOM
// (`element.style.setProperty`), jamais par un attribut `style` du HTML (CSP stricte). Un seul écouteur
// `pointermove` passif, regroupé par `requestAnimationFrame` ; aucune boucle sans fin (les animations
// continues sont en CSS, que le navigateur suspend onglet caché). Coupé par `data-fx="off"` (réglage
// serveur) ou `prefers-reduced-motion` : plus de suivi, et l'inclinaison revient à plat.

/** Cartes qui s'illuminent sous le curseur (la fenêtre n'illumine que son bord). */
const SPOT =
  ".wm-win, .scr-section, .ctn-card, .ctn-group, .scr-pool, .scr-detail, .scr-card, .wm-empty-box, .lg-card";
/** Inclinaison maximale en degrés. */
export const TILT_MAX = 6;

/** Effets actifs ? Faux avec `data-fx="off"` ou `prefers-reduced-motion: reduce`. */
export function fxEnabled(doc) {
  const root = doc.documentElement;
  if (root?.dataset?.fx === "off") return false;
  const mq = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  return !(mq?.matches ?? false);
}

/**
 * Remplace le texte d'un titre par un `<span class="rv-w">` par mot (décalage `--i`) pour la révélation
 * mot par mot (CSS). Le texte complet reste lisible pour les lecteurs d'écran.
 */
export function revealWords(doc, node, text) {
  node.textContent = "";
  node.setAttribute("aria-label", text);
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((word, i) => {
    const span = doc.createElement("span");
    span.className = "rv-w";
    span.setAttribute("aria-hidden", "true");
    span.style.setProperty("--i", String(i));
    span.textContent = word;
    node.append(span);
    if (i < words.length - 1) node.append(doc.createTextNode(" "));
  });
}

/**
 * Branche le fond et le suivi de souris. Idempotent. Retourne une fonction d'arrêt.
 * @param {Document} doc
 */
export function initMotion(doc) {
  const win = doc.defaultView;
  if (!win || doc.body.dataset.motion === "1") return () => {};
  doc.body.dataset.motion = "1";

  // Fond : grille fine, halo (variables --mx / --my posées sur lui seul) et nappe rouge diffuse.
  const bg = doc.createElement("div");
  bg.className = "fx-bg";
  bg.setAttribute("aria-hidden", "true");
  const nappe = doc.createElement("div");
  nappe.className = "fx-bg-nappe";
  bg.append(nappe);
  doc.body.prepend(bg);

  let last = null;
  let queued = false;
  let tilted = null;

  const resetTilt = () => {
    if (!tilted) return;
    tilted.style.removeProperty("--rx");
    tilted.style.removeProperty("--ry");
    tilted.style.removeProperty("--glare");
    tilted = null;
  };

  const frame = () => {
    queued = false;
    const e = last;
    if (!e) return;
    if (!fxEnabled(doc)) {
      resetTilt();
      return;
    }
    bg.style.setProperty("--mx", `${e.clientX}px`);
    bg.style.setProperty("--my", `${e.clientY}px`);
    const target = e.target instanceof win.Element ? e.target : null;
    const spot = target?.closest(SPOT);
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${e.clientX - r.left}px`);
      spot.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
    const tilt = target?.closest("[data-tilt]") ?? null;
    if (tilt !== tilted) resetTilt();
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / Math.max(r.width, 1);
      const py = (e.clientY - r.top) / Math.max(r.height, 1);
      tilt.style.setProperty("--ry", `${((px - 0.5) * 2 * TILT_MAX).toFixed(2)}deg`);
      tilt.style.setProperty("--rx", `${(-(py - 0.5) * 2 * TILT_MAX).toFixed(2)}deg`);
      tilt.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      tilt.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
      tilt.style.setProperty("--glare", "1");
      if (!tilt.querySelector(":scope > .tilt-glare")) {
        const glare = doc.createElement("i");
        glare.className = "tilt-glare";
        glare.setAttribute("aria-hidden", "true");
        tilt.append(glare);
      }
      tilted = tilt;
    }
  };

  const onMove = (e) => {
    if (doc.hidden) return;
    last = e;
    if (!queued) {
      queued = true;
      win.requestAnimationFrame(frame);
    }
  };
  // Le pointeur quitte la fenêtre : la carte inclinée revient à plat.
  const onLeave = (e) => {
    if (e.relatedTarget === null) {
      last = null;
      resetTilt();
    }
  };

  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.documentElement.addEventListener("pointerleave", onLeave);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) {
      last = null;
      resetTilt();
    }
  });
  return () => {
    doc.removeEventListener("pointermove", onMove);
    doc.documentElement.removeEventListener("pointerleave", onLeave);
    resetTilt();
    bg.remove();
    delete doc.body.dataset.motion;
  };
}
