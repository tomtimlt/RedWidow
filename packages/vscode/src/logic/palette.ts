/** Préférence purement visuelle ; toute valeur inconnue retombe sur la palette par défaut. */
export const PALETTES = [
  ["sentinelle", "Sentinelle", "Sarcelle et ardoise"],
  ["braise", "Braise", "Cramoisi et acier"],
  ["bastion", "Bastion", "Cuivre et graphite"],
  ["spectre", "Spectre", "Violet et glace"],
  ["editeur", "Éditeur", "Accent du thème VS Code"],
] as const;
export type Palette = (typeof PALETTES)[number][0];
export const paletteOf = (value: unknown): Palette =>
  PALETTES.find(([key]) => key === value)?.[0] ?? "sentinelle";
