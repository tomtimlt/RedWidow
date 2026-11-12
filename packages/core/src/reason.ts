/**
 * Motifs et erreurs du moteur, exprimés en codes. Le cœur n'émet aucun texte
 * destiné à l'utilisateur : `@warband/messages` associe un libellé à chaque
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
  "account.invalid",
  "mission.noContainer",
  "pace.edgeBanSuspected",
  "task.invalidResponse",
  "output.invalidPath",
  "output.notFound",
  "output.patternInvalid",
  "opencode.httpFailed",
  "kali.taskRequired",
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
  "approval.bypassed",
  "approval.override",
  "bypass.enabled",
  "bypass.disabled",
  "bypass.expired",
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
  "opencode.invalidVariant",
  "opencode.unsupportedEffort",
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
  "policy.invalid.commandWildcard",
  "policy.repo.untrusted",
  "policy.repo.modified",
  "policy.repo.changedBeforeTrust",
  // Docker et processus
  "docker.failed",
  "docker.pathNotShared",
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
  "sandbox.networkUnsafe",
  "sandbox.execTimeout",
  "sandbox.execAborted",
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
  // Projet actif (conteneur lié)
  "project.notFound",
  "project.notExegol",
  "project.notRunning",
  "project.noWorkspace",
  "project.invalid",
  // Fiche programme (ADR 0040)
  "program.unreadable",
  "program.invalid",
  "program.absent",
  "program.out_of_scope",
  "program.host_unresolved",
  "program.flag_missing",
  "program.in_scope",
  "program.digestRequired",
  "program.digestMismatch",
  "program.required",
  "program.paced",
  "program.halted",
  // Fiche d'engagement et arrêt d'urgence (ADR 0041)
  "engagement.unreadable",
  "engagement.invalid",
  "engagement.absent",
  "engagement.required",
  "engagement.digestRequired",
  "engagement.digestMismatch",
  "engagement.halted",
  // Plan de campagne, contrôle d'étape et démontage (ADR 0041)
  "campaign.unreadable",
  "campaign.invalid",
  "campaign.absent",
  "campaign.digestRequired",
  "campaign.digestMismatch",
  "campaign.notApproved",
  "campaign.stepUnknown",
  "campaign.evidenceRequired",
  "campaign.evidenceUnknown",
  "teardown.itemUnknown",
  "teardown.closeBlocked",
  "engagement.out_of_scope",
  "engagement.infrastructure",
  "finding.labelInvalid",
  "finding.notFound",
  "finding.busy",
  "integration.invalidConfig",
  "integration.invalidResponse",
  "integration.unavailable",
  "integration.timeout",
  "burp.invalidConfig",
  "burp.invalidResponse",
  "burp.unavailable",
  "burp.timeout",
  "web.invalidUrl",
  "web.unavailable",
  "web.timeout",
  "web.dnsFailed",
  "web.tlsFailed",
  "web.connectionFailed",
  "web.rateLimited",
  "web.tooLarge",
  "web.unsupportedType",
  "web.searchFailed",
  "web.reference_source",
  "web.query_sensitive",
  "web.redirectOffList",
  "web.relayRefused",
  "web.relayDiscouraged",
  "web.targetRead",
  "web.invalidRequest",
  // Relances de recherche web et traçabilité (ADR 0039)
  "research.techUnsearched",
  "research.repeatedError",
  "research.blocked",
  "research.noSearch",
  "mission.sourceUnknown",
  // Matrice de couverture
  "coverage.testRefUnknown",
  "coverage.testRefRequired",
  "coverage.untested",
  "coverage.singleProbe",
  // Encadrement (niveau de supervision)
  "supervision.checkpoint",
  "kali.nmapUnavailable",
  "finding.invalidLinks",
  "finding.parentUnknown",
  "finding.pathNotSubset",
  "finding.invalidInput",
  "project.absent",
  "project.workspaceNotMounted",
  "project.readFailed",
  "cours.absent",
  "exegol.containerDenied",
  "kali.unavailable",
  // Hôte web : authentification et démarrage (ADR 0052)
  "server.originMissing",
  "server.originInvalid",
  "server.passwordHashMissing",
  "server.passwordHashInvalid",
  "server.passwordTooShort",
  "server.passwordMismatch",
  "server.passwordNeedsStdin",
  "server.secretKeyMissing",
  "server.secretKeyTooShort",
  "server.secretKeyWrong",
  "server.secretsCorrupt",
  "server.secretEntryInvalid",
  "server.secretNameInvalid",
  "auth.required",
  "auth.invalidCredentials",
  "auth.rateLimited",
  "auth.originDenied",
  "auth.badRequest",
  // Terminal humain et conteneurs gérés (ADR 0053)
  "docker.unavailable",
  "terminal.invalidContainer",
  "terminal.notManaged",
  "terminal.notRunning",
  "terminal.limit",
  "terminal.inputTooLarge",
  "terminal.failed",
  "container.invalidName",
  "container.exists",
  "container.failed",
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
