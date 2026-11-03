import { t } from "@warband/messages";
/** Préférence purement visuelle ; toute valeur inconnue retombe sur la palette par défaut. */
export const PALETTES = [
  ["widow", "Widow", "Noir profond et cramoisi : la marque RedWidow"],
  ["sentinelle", "Sentinelle", "Sarcelle et ardoise : veille, terminal, sécurité"],
  ["braise", "Braise", "Cramoisi et acier : la marque d'origine, plus offensive"],
  ["venom", "Venin", "Vert toxique sur acier : terminal, offensif"],
  ["arctic", "Arctique", "Bleu glacier : froid, net, défensif"],
  ["spectre", "Spectre", "Violet et glace : agents, recherche, nuit"],
  ["ultraviolet", "Ultraviolet", "Violet électrique : nuit, IA, laboratoire"],
  ["tactical", "Tactique", "Olive et kaki : terrain, opérations"],
  ["rouge", "Rouge", "Rouge franc"],
  ["orange", "Orange", "Orange vif ; proche de la couleur des alertes"],
  ["jaune", "Jaune", "Jaune soleil ; proche de la couleur des alertes"],
  ["vert", "Vert", "Vert franc"],
  ["bleu", "Bleu", "Bleu franc"],
  ["rose", "Rose", "Rose vif"],
  ["blanc", "Blanc", "Blanc pur, graphite en thème clair"],
  ["aurora", "Aurore", "Dégradé cyan, bleu et violet"],
  ["synthwave", "Synthwave", "Dégradé rose, violet et bleu"],
  ["toxic", "Toxique", "Dégradé lime, vert et cyan"],
  ["bloodmoon", "Lune de sang", "Dégradé cramoisi, magenta et violet"],
  ["ocean", "Abysse", "Dégradé sarcelle, bleu et indigo"],
  ["nebula", "Nébuleuse", "Dégradé rose, violet et cyan"],
  ["multi", "Multicolore", "Six teintes, une par rôle : corail, vert, cyan, bleu, violet et rose"],
  ["editeur", "Éditeur", "Accent du thème VS Code : intégration maximale"],
] as const;
export type Palette = (typeof PALETTES)[number][0];
export const isPalette = (value: unknown): value is Palette =>
  PALETTES.some(([key]) => key === value);
export const paletteOf = (value: unknown): Palette => (isPalette(value) ? value : "widow");

/** Texte relu à l’affichage pour suivre la langue active sans modifier les identifiants. */
for (const palette of PALETTES) {
  const [, label, detail] = palette;
  Object.defineProperty(palette, 1, { get: () => t(label), enumerable: true });
  Object.defineProperty(palette, 2, { get: () => t(detail), enumerable: true });
}
