/**
 * Motifs et erreurs du moteur, exprimés en codes. Le cœur n'émet aucun texte
 * destiné à l'utilisateur : `@john-studio/messages` associe un libellé à chaque
 * code (`REASON_CODES` en est la liste exhaustive, testée contre le catalogue).
 */

/** Paramètres d'un motif : des chaînes et des nombres seulement (ils transitent par le redactor). */
export type ReasonParams = Record<string, string | number>;

/** Motif structuré : un code stable, ses paramètres et, au besoin, le motif qu'il enrobe. */
export interface Reason {
  code: string;
  params?: ReasonParams;
  /** Motif sous-jacent (ex. `approval.noAsker` enrobe le verdict de la politique). */
  cause?: Reason;
}

/** Erreur consignée dans un événement `error` : un motif, plus le texte brut d'une erreur inconnue. */
export interface ErrorInfo extends Reason {
  /** Présent seulement pour `error.unknown` : message brut de l'exception. */
  message?: string;
}

/** Tous les codes que le cœur et l'adaptateur peuvent émettre. */
export const REASON_CODES = [
  // Verdicts de la politique
  "policy.rule",
  "policy.rule.custom",
  "policy.default",
  "bash.unparseable",
  "bash.empty",
  "bash.missingCommand",
  "bash.noRule",
  "bash.hazard",
  "shell.unanalyzable",
  "docker.hostAccess",
  "path.sensitive",
  "path.outside",
  "path.unsupported",
  // Approbation et garde
  "approval.noAsker",
  "approval.interrupted",
  "approval.timeout",
  "approval.remembered",
  "guard.unrouted",
  // Outils inattendus annoncés par le SDK
  "sdk.unexpectedTool",
  // Authentification
  "auth.missingApiKey",
  "auth.failed",
  "auth.orgNotAllowed",
  // Fournisseurs de modèles et budget
  "provider.authFailed",
  "provider.error",
  "budget.exceeded",
  // Adaptateur OpenCode
  "opencode.unsafeConfig",
  "opencode.noModel",
  "opencode.invalidModel",
  "opencode.serverFailed",
  "opencode.serverTimeout",
  "opencode.sessionNotFound",
  "opencode.pathUnknown",
  "opencode.replyFailed",
  // Analyse du shell
  "shell.unclosedQuote",
  "shell.trailingBackslash",
  // Validation d'une politique
  "policy.invalid.object",
  "policy.invalid.default",
  "policy.invalid.rules",
  "policy.invalid.ruleObject",
  "policy.invalid.ruleField",
  "policy.repo.untrusted",
  "policy.repo.modified",
  // Docker et processus
  "docker.failed",
  "docker.invalidOperand",
  "docker.invalidTail",
  "docker.invalidPort",
  "docker.invalidEnvKey",
  "docker.invalidArgument",
  "docker.invalidBinary",
  "docker.unexpectedOutput",
  "process.emptyArgv",
  "process.notFound",
  "process.commandTooLong",
  "binary.shimUnsupported",
  // Bac à sable Docker
  "sandbox.tampered",
  "sandbox.unavailable",
  "sandbox.unknownContainer",
  "sandbox.imageUnsupported",
  "sandbox.invalidArgument",
  // Extension VS Code : moteur enfant et protocole IPC (ADR 0004)
  "extension.binaryMismatch",
  "ipc.invalidMessage",
  "ipc.unsupportedVersion",
  "ipc.startTimeout",
  "ipc.engineExited",
  "sandbox.interpreter",
  "sandbox.tarRejected",
  // Journal et événements
  "journal.invalidJson",
  "event.notObject",
  "event.unknownKind",
  "event.invalidVersion",
  "event.unsupportedVersion",
  "event.missingField",
  "event.invalidField",
  // Divers
  "error.unknown",
  /** Motif ou erreur d'un ancien journal, relu comme texte (`params.text`). */
  "legacy",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Construit un motif en vérifiant à la compilation que le code est connu. */
export function reason(code: ReasonCode, params?: ReasonParams, cause?: Reason): Reason {
  return { code, ...(params && { params }), ...(cause && { cause }) };
}

/** Erreur portant un code et des paramètres ; `message` n'est qu'un repli technique (logs, piles). */
export class CodedError extends Error {
  readonly code: ReasonCode;
  readonly params: ReasonParams | undefined;

  constructor(code: ReasonCode, params?: ReasonParams) {
    super(params ? `${code} ${JSON.stringify(params)}` : code);
    this.name = new.target.name;
    this.code = code;
    this.params = params;
  }
}

/** Entrée refusée à la validation (politique, argument d'une commande docker…). */
export class ValidationError extends CodedError {}

/** Motif d'une erreur quelconque : codée → son code, sinon `error.unknown` avec le message brut. */
export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof CodedError) return reason(err.code, err.params);
  return {
    code: "error.unknown",
    message: err instanceof Error ? err.message : String(err),
  };
}
