// Spotlight des cartes des pages de vue (iframes) : pose --mx / --my (CSSOM, jamais d'attribut `style`) sur la
// carte survolée ; la feuille view-extras.css s'en sert pour une lueur rouge sous le curseur. Un seul
// écouteur `pointermove` passif regroupé par requestAnimationFrame, aucune boucle. Inactif avec
// `prefers-reduced-motion` (les iframes n'ont pas `data-fx`). Jamais sur les approbations ni l'arrêt d'urgence.
(() => {
  const SPOT = "body.cockpit section, .session-tile, .pal-card, .kc-node-card";
  const NEVER = ".eng-halt, #approvals, .card";
  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let last = null;
  let queued = false;
  let lit = null;

  const clear = () => {
    if (!lit) return;
    lit.style.removeProperty("--mx");
    lit.style.removeProperty("--my");
    lit = null;
  };
  const frame = () => {
    queued = false;
    const e = last;
    if (!e || mq?.matches) return clear();
    const target = e.target instanceof Element ? e.target : null;
    const card = target?.closest(SPOT) ?? null;
    if (!card || card.matches(NEVER) || target?.closest(NEVER)) return clear();
    if (card !== lit) clear();
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
    lit = card;
  };
  document.addEventListener(
    "pointermove",
    (e) => {
      last = e;
      if (queued) return;
      queued = true;
      requestAnimationFrame(frame);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", clear);
})();
