import type { ApprovalGate } from "./approval/gate.js";
import type { Recorder } from "./recorder.js";

/**
 * Origine des identifiants : `auto` hérite de l'environnement tel quel ;
 * `subscription` force la connexion d'abonnement (clés API écartées) ;
 * `api-key` exige une clé API et échoue avant de lancer sinon.
 */
export type AuthMode = "auto" | "subscription" | "api-key";

/** Niveau d'effort de raisonnement (type neutre ; l'adaptateur le traduit pour son moteur). */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Modèle proposé par un moteur d'agent (liste lue au runtime, jamais codée en dur). */
export interface ModelOption {
  /** Identifiant à transmettre en `RunInput.model`. */
  value: string;
  displayName: string;
  description?: string;
  /** Niveaux d'effort acceptés : absent = inconnu, vide = le modèle n'a pas d'effort réglable. */
  supportedEffortLevels?: Effort[];
  /** Variantes de raisonnement annoncées par OpenCode ; distinctes des efforts Claude. */
  reasoningVariants?: string[];
}

/** Paramètres du sondage de la liste des modèles (aucune consigne n'est envoyée). */
export interface ListModelsInput {
  cwd: string;
  auth?: AuthMode;
  signal?: AbortSignal;
}

/**
 * Entrée d'un run. `cwd` est obligatoire : le cœur ne devine jamais le
 * répertoire de travail. Aucune de ces options ne desserre les garde-fous du
 * moteur (politique, outils exposés, permissions) : l'adaptateur les verrouille.
 */
export interface RunInput {
  /** Consigne unique, ou flux de messages utilisateur (session multi-tours). */
  prompt: string | AsyncIterable<string>;
  cwd: string;
  model?: string;
  /** Effort de raisonnement Claude ; OpenCode utilise `variant` et refuse ce champ. */
  effort?: Effort;
  /** Variante OpenCode exacte ; absente = réglage automatique du moteur. */
  variant?: string;
  maxTurns?: number;
  /** Origine des identifiants (défaut : `auto`). */
  auth?: AuthMode;
  /** Identifiant imposé à une nouvelle session. */
  sessionId?: string;
  /** Identifiant d'une session à reprendre. */
  resume?: string;
  /** Plafond de dépense du run, en dollars. */
  maxBudgetUsd?: number;
  /** Texte ajouté au prompt système par défaut du moteur d'agent. */
  systemPrompt?: string;
}

/** Services fournis par l'appelant : journal d'événements, approbation, annulation. */
export interface RunContext {
  recorder: Recorder;
  gate: ApprovalGate;
  signal?: AbortSignal;
  /** Observation du paquet ajouté au tour courant ; aucun effet sur les autorisations. */
  onMissionContext?: (snapshot: import("./mission-desk.js").MissionContext) => void;
}

export interface RunSummary {
  status: "success" | "error";
  turns: number;
  costUsd: number;
  result: string | null;
  /** Identifiant de la session (pour `resume`), s'il est connu. */
  sessionId?: string;
  /** Messages du moteur d'agent non traduits en événements, comptés par `type/subtype`. */
  unhandledMessages?: Record<string, number>;
}

/**
 * Contrat d'un moteur d'agent. Le cœur ne connaît aucun SDK : un adaptateur
 * (ex. `@warband/agent-sdk`) l'implémente et traduit son flux en événements.
 */
export interface AgentRunner {
  run(input: RunInput, ctx: RunContext): Promise<RunSummary>;
  /** Modèles disponibles, obtenus sans envoyer de consigne (donc sans coût d'inférence). */
  listModels?(input: ListModelsInput): Promise<ModelOption[]>;
}
