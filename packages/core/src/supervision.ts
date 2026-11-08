/**
 * Niveau d'encadrement d'un chat : règle la fréquence des relances du moteur (bureau de mission,
 * relances de recherche, couverture) pour qu'un modèle faible applique quand même la méthode.
 * `relentless` (« acharné ») vise la profondeur d'itération sur les longues missions autorisées :
 * relances dès la deuxième répétition, aucun point de contrôle, et continuation automatique
 * bornée des tours. Aucun niveau ne bloque un outil ni ne touche à la gate : ce ne sont que des
 * relances et des ré-amorçages de tour, soumis à l'annulation, à l'arrêt d'urgence et aux budgets.
 */
export const SUPERVISION_LEVELS = ["light", "standard", "strict", "relentless"] as const;
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
  /** Ré-amorce un tour quand le modèle conclut alors que des pistes restent ouvertes. */
  autoContinue: boolean;
  /** Plafond de tours ré-amorcés automatiquement (0 : aucun) ; compteur remis à zéro par un message humain. */
  maxAutoContinues: number;
}

/** Réglages par niveau (source unique). `standard` reproduit le comportement historique. */
export const SUPERVISION_SETTINGS: Readonly<Record<SupervisionLevel, SupervisionSettings>> = {
  light: {
    repeatThreshold: 3,
    maxTechs: 4,
    checkpointAfterCalls: null,
    coverageEveryTest: false,
    autoContinue: false,
    maxAutoContinues: 0,
  },
  standard: {
    repeatThreshold: 2,
    maxTechs: 4,
    checkpointAfterCalls: null,
    coverageEveryTest: false,
    autoContinue: false,
    maxAutoContinues: 0,
  },
  strict: {
    repeatThreshold: 1,
    maxTechs: 4,
    checkpointAfterCalls: 8,
    coverageEveryTest: true,
    autoContinue: false,
    maxAutoContinues: 0,
  },
  relentless: {
    repeatThreshold: 2,
    maxTechs: 4,
    checkpointAfterCalls: null,
    coverageEveryTest: true,
    autoContinue: true,
    maxAutoContinues: 20,
  },
};
