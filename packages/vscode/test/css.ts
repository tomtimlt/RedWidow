import { readFileSync } from "node:fs";

/** Feuilles de `media/css`, dans l'ordre de chargement : la base commune, puis une feuille par page. */
export const CSS_FILES = [
  "base",
  "chat",
  "studio",
  "cockpit",
  "program",
  "engagement",
  "sessions",
  "killchain",
  "viewer",
] as const;
export type CssFile = (typeof CSS_FILES)[number];

/** Contenu d'une feuille de `media/css`. */
export const readCssFile = (name: CssFile): string =>
  readFileSync(new URL(`../media/css/${name}.css`, import.meta.url), "utf8");

/** Contenu concaténé des feuilles demandées (par défaut toutes), base en tête. */
export const readCss = (...names: CssFile[]): string =>
  (names.length > 0 ? names : [...CSS_FILES]).map(readCssFile).join("\n");
