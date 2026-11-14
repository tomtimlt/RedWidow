// Effets de l'interface (ambiance seulement) : déchiffrement d'un titre. Ce module vit sous `/assets/`
// (public) pour que l'écran de connexion, sans session, puisse l'importer ; `lib/fx.js` le ré-exporte.
// Aucun effet sur les approbations, l'arrêt d'urgence, les dialogues, le Bypass, les toasts ni les champs :
// l'appelant ne l'applique qu'à des titres.

/** Caractères de brouillage (ASCII et blocs : aucun glyphe repris d'un jeu). */
export const GLYPHS = "▒░#%$&@*+=/<>01";

/**
 * Texte « en cours de déchiffrement » : les `progress × n` premiers caractères sont révélés, le reste est
 * brouillé (les espaces sont conservés pour garder la mise en page). `rand` renvoie un nombre dans [0, 1[.
 */
export function scrambleText(text, progress, rand = Math.random) {
  const chars = Array.from(text);
  const shown = Math.floor(Math.min(1, Math.max(0, progress)) * chars.length);
  return chars
    .map((c, i) =>
      i < shown || c === " " ? c : GLYPHS[Math.floor(rand() * GLYPHS.length) % GLYPHS.length],
    )
    .join("");
}

/**
 * Les effets sont-ils actifs ? Oui seulement si `<html data-fx="on">` (réglage serveur `effects`, activé par
 * défaut) et si le système n'a pas demandé de réduire les animations.
 */
export function fxActive(doc, win) {
  if (doc?.documentElement?.dataset?.fx !== "on") return false;
  try {
    return win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches !== true;
  } catch {
    return false;
  }
}

/**
 * Déchiffre `text` dans `el` (une seule fois, `duration` ms au plus). Sans effets, le texte est posé tel quel.
 * Pendant l'animation, le texte réel reste lisible par les lecteurs d'écran via `aria-label`. Renvoie une
 * fonction d'annulation (pose aussitôt le texte final).
 * @param {HTMLElement} el
 * @param {string} text
 * @param {{ active: boolean, duration?: number, rand?: () => number, raf?: (cb: (t: number) => void) => unknown, now?: () => number }} opts
 */
export function decryptText(el, text, opts) {
  const { active, duration = 400, rand = Math.random } = opts;
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const now = opts.now ?? (() => performance.now());
  if (!active || text === "") {
    el.textContent = text;
    return () => {};
  }
  let stopped = false;
  const finish = () => {
    stopped = true;
    el.textContent = text;
    el.removeAttribute("aria-label");
  };
  el.setAttribute("aria-label", text);
  const start = now();
  const step = () => {
    if (stopped) return;
    const progress = (now() - start) / duration;
    if (progress >= 1) {
      finish();
      return;
    }
    el.textContent = scrambleText(text, progress, rand);
    raf(step);
  };
  el.textContent = scrambleText(text, 0, rand);
  raf(step);
  return finish;
}
