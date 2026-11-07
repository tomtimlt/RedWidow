/**
 * Niveau d'encadrement d'un chat : règle la fréquence des relances du moteur (bureau de mission,
 * relances de recherche, couverture) pour qu'un modèle faible applique quand même la méthode.
 * Aucun niveau ne bloque un outil ni ne touche à la gate : ce ne sont que des relances.
 */
export const SUPERVISION_LEVELS = ["light", "standard", "strict"] as const;
export type SupervisionLevel = (typeof SUPERVISION_LEVELS)[number];
export const DEFAULT_SUPERVISION: SupervisionLevel = "standard";

export function isSupervisionLevel(value: unknown): value is SupervisionLevel {
  return typeof value === "string" && (SUPERVISION_LEVELS as readonly string[]).includes(value);
}

/** Valeur inconnue ou absente : `standard`. */
export function parseSupervision(value: unknown): SupervisionLevel {
  return isSupervisionLevel(value) ? value : DEFAULT_SUPERVISION;
}

export interface SupervisionSettings {
  /** Répétitions (erreur, blocage, stagnation) à partir desquelles le moteur relance. */
  repeatThreshold: number;
  /** Technologies identifiées relancées au plus à la fois. */
  maxTechs: number;
  /** Appels d'outils sans `record_decision` avant le point de contrôle ; `null` : aucun point. */
  checkpointAfterCalls: number | null;
  /** Relance `coverage.untested` dans chaque `record_test` (sinon : résultats non positifs seulement). */
  coverageEveryTest: boolean;
}

/** Réglages par niveau (source unique). `standard` reproduit le comportement historique. */
export const SUPERVISION_SETTINGS: Readonly<Record<SupervisionLevel, SupervisionSettings>> = {
  light: { repeatThreshold: 3, maxTechs: 4, checkpointAfterCalls: null, coverageEveryTest: false },
  standard: {
    repeatThreshold: 2,
    maxTechs: 4,
    checkpointAfterCalls: null,
    coverageEveryTest: false,
  },
  strict: { repeatThreshold: 1, maxTechs: 4, checkpointAfterCalls: 8, coverageEveryTest: true },
};
