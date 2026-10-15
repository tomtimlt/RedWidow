import { EFFORTS, type Effort } from "@john-studio/core";

/** Un cran du curseur d'effort : libellé court et infobulle (effet qualitatif, jamais un chiffre). */
export interface EffortLevel {
  value: Effort;
  label: string;
  tip: string;
}

const SUFFIX = " L'effet exact dépend du modèle.";

/**
 * Crans du curseur, du plus léger au plus poussé. Un 6e cran se règle ici seulement : la vue, le
 * curseur et le repli se déduisent de cette liste (correspondance 1:1 avec `Effort` du cœur).
 */
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  { value: "low", label: "Low", tip: `Réponses rapides et économes, réflexion minimale.${SUFFIX}` },
  { value: "medium", label: "Medium", tip: `Équilibre entre vitesse et réflexion.${SUFFIX}` },
  {
    value: "high",
    label: "High",
    tip: `Réflexion soutenue, adaptée à la plupart des tâches.${SUFFIX}`,
  },
  {
    value: "xhigh",
    label: "Extra",
    tip: `Réflexion approfondie, plus lente et plus coûteuse.${SUFFIX}`,
  },
  {
    value: "max",
    label: "Max",
    tip: `Réflexion la plus poussée, la plus lente et la plus coûteuse.${SUFFIX}`,
  },
];

export const DEFAULT_EFFORT: Effort = "high";

export function parseEffort(value: unknown): Effort | null {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value)
    ? (value as Effort)
    : null;
}

const rank = (e: Effort) => EFFORT_LEVELS.findIndex((l) => l.value === e);

/** `supported` : niveaux du modèle ; `undefined` = inconnu (tous permis), vide = pas d'effort réglable. */
export function isSupported(effort: Effort, supported: readonly Effort[] | undefined): boolean {
  return supported === undefined || supported.includes(effort);
}

/**
 * Niveau applicable : le niveau demandé s'il est permis, sinon le plus haut niveau permis en dessous,
 * sinon le plus bas au-dessus. `effort: null` si le modèle n'a pas d'effort réglable.
 */
export function clampEffort(
  wanted: Effort,
  supported: readonly Effort[] | undefined,
): { effort: Effort | null; clamped: boolean } {
  if (supported === undefined || supported.includes(wanted)) {
    return { effort: wanted, clamped: false };
  }
  const known = EFFORT_LEVELS.map((l) => l.value).filter((v) => supported.includes(v));
  const pick = known.filter((v) => rank(v) < rank(wanted)).at(-1) ?? known[0] ?? null;
  return { effort: pick, clamped: pick !== wanted };
}
