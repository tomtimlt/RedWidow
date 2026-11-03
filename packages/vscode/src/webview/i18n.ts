import { auditLabel, getUiLocale, setUiLocale, t } from "../../../messages/src/ui.js";

interface ProductElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}
interface ProductRoot {
  querySelectorAll(selector: string): Iterable<ProductElement>;
}
declare const document: ProductRoot & { documentElement: { lang: string } };
setUiLocale(document.documentElement.lang);

/** Seules les annotations de libellés produit sont traduites ; jamais le texte libre du DOM. */
function applyStatic(root: ProductRoot = document): void {
  document.documentElement.lang = getUiLocale();
  for (const element of root.querySelectorAll("[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (key !== null) element.textContent = t(key);
  }
  for (const attribute of ["title", "aria-label", "placeholder"]) {
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key !== null) element.setAttribute(attribute, t(key));
    }
  }
}
Object.assign(globalThis, {
  WarbandI18n: { t, auditLabel, setLocale: setUiLocale, getLocale: getUiLocale, applyStatic },
});
