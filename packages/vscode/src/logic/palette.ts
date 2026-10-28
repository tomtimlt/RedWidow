/** Préférence purement visuelle ; toute valeur inconnue retombe sur la palette par défaut. */
export const PALETTES = [
  ["sentinelle", "Sentinelle", "Sarcelle et ardoise"],
  ["braise", "Braise", "Cramoisi et acier"],
  ["spectre", "Spectre", "Violet et glace"],
  ["editeur", "Éditeur", "Accent du thème VS Code"],
  ["multi", "Multicolore", "Six teintes réparties dans l’interface"],
] as const;
export type Palette = (typeof PALETTES)[number][0];
export const isPalette = (value: unknown): value is Palette =>
  PALETTES.some(([key]) => key === value);
export const paletteOf = (value: unknown): Palette => (isPalette(value) ? value : "sentinelle");
