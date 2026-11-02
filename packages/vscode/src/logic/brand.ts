/** Marque publique ; les identifiants techniques restent stables. */
export const PRODUCT_NAME = "Venator Ops";
export const LEGACY_PRODUCT_NAME = "Warband";

/** Partie après le préfixe exact d'un terminal actuel ou conservé d'une session antérieure. */
export function productTitleSuffix(title: string): string | null {
  for (const name of [PRODUCT_NAME, LEGACY_PRODUCT_NAME]) {
    const prefix = `${name} : `;
    if (title.startsWith(prefix)) return title.slice(prefix.length);
  }
  return null;
}
