// Mode pile (téléphone) : mêmes fenêtres, une seule à la fois en plein écran, barre d'onglets défilante en
// bas (le dock). Pas de déplacement, de redimensionnement ni de tuiles. Passer au téléphone ne modifie
// jamais la disposition du bureau : seul l'affichage change. La feuille d'approbation et la barre fixe
// restent devant (voir shell.css).

/** Téléphone : écran étroit, ou tactile sans souris. */
export const PHONE_QUERY = "(max-width: 719px), (pointer: coarse) and (hover: none)";

/**
 * @param {object} options
 * @param {Window} options.win
 * @param {Document} options.doc
 * @param {{ setMode(mode: string): void }} options.desktop
 * @param {(phone: boolean) => void} [options.onChange]
 */
export function createMobile({ win, doc, desktop, onChange = () => {} }) {
  const query = win.matchMedia(PHONE_QUERY);
  const apply = () => {
    doc.body.classList.toggle("is-phone", query.matches);
    desktop.setMode(query.matches ? "stack" : "desktop");
    onChange(query.matches);
  };
  query.addEventListener("change", apply);
  apply();
  return {
    isPhone: () => query.matches,
    /** Garde l'onglet actif visible dans la barre défilante. */
    revealActive(itemsEl) {
      if (!query.matches) return;
      const active = itemsEl.querySelector(".dock-item.is-focus");
      active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
  };
}
