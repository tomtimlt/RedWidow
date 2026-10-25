import { EFFORTS, type Effort } from "@warband/core";

/** Fournisseur sélectionné pour la conversation. */
export type Provider = "claude" | "openai" | "opencode";

export const isProvider = (value: unknown): value is Provider =>
  value === "claude" || value === "openai" || value === "opencode";

/**
 * Cran du curseur : un `Effort` du cœur, ou « ultracode ». Ultracode n'est PAS un niveau du SDK :
 * c'est un préréglage de l'extension (effort `max` + plafonds de tours et de dépense réglables), voir `resolveEffort`.
 */
export type EffortChoice = Effort | "ultracode";

/** Un cran du curseur d'effort : libellé court et infobulle (effet qualitatif, jamais un chiffre). */
export interface EffortLevel {
  value: EffortChoice;
  label: string;
  tip: string;
  /** Fournisseurs pour lesquels le cran existe ; absent = Claude. */
  providers?: readonly Provider[];
}

/** Réglages du préréglage Ultracode (réglages machine `warband.ultracode.*`). */
export interface UltracodeLimits {
  maxTurns?: number;
  maxBudgetUsd?: number;
}

/** Infobulle d'Ultracode : dit exactement ce que le préréglage fait avec les valeurs en vigueur. */
export function ultracodeTip(limits: UltracodeLimits | undefined): string {
  const turns =
    limits?.maxTurns === undefined ? "sans plafond de tours" : `${limits.maxTurns} tours au plus`;
  const budget =
    limits?.maxBudgetUsd === undefined
      ? "sans plafond de dépense"
      : `dépense plafonnée à ${limits.maxBudgetUsd} $`;
  return `Préréglage : réflexion « Max » (mêmes capacités que Max, pas un mode distinct du modèle) avec des limites longues réglables (${turns}, ${budget}). Réglages : warband.ultracode.maxTurns et warband.ultracode.maxBudgetUsd.${SUFFIX}`;
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
  {
    value: "ultracode",
    label: "Ultracode",
    tip: ultracodeTip(undefined),
    providers: ["claude"],
  },
];

/** Niveau réellement transmis : `ultracode` s'exécute en `max`. */
export const toEffort = (choice: EffortChoice): Effort => (choice === "ultracode" ? "max" : choice);

/** Crans visibles pour un fournisseur. */
export const levelsFor = (provider: Provider): EffortLevel[] =>
  EFFORT_LEVELS.filter((l) => (l.providers ?? ["claude"]).includes(provider));

/**
 * Paramètres de run d'un choix : effort du SDK et, pour Ultracode seulement, les plafonds du préréglage
 * (les plafonds de base `warband.maxTurns` s'appliquent sinon, côté appelant).
 */
export function resolveEffort(
  choice: EffortChoice,
  limits: UltracodeLimits | undefined,
): { effort: Effort; limits: UltracodeLimits | undefined } {
  return { effort: toEffort(choice), limits: choice === "ultracode" ? (limits ?? {}) : undefined };
}

export function parseEffortChoice(value: unknown): EffortChoice | null {
  return value === "ultracode" ? "ultracode" : parseEffort(value);
}

export function parseEffort(value: unknown): Effort | null {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value)
    ? (value as Effort)
    : null;
}

const rank = (e: Effort) => EFFORTS.indexOf(e);

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
  const known = EFFORTS.filter((v) => supported.includes(v));
  const pick = known.filter((v) => rank(v) < rank(wanted)).at(-1) ?? known[0] ?? null;
  return { effort: pick, clamped: pick !== wanted };
}
