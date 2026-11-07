import { auditTestSchema } from "./audit-schema.js";
import { type MissionDecision, missionDecisionSchema } from "./mission-decision-schema.js";
/**
 * Modèle d'événements du moteur. Tout ce que le moteur produit passe par ici :
 * les UI (CLI, export HTML, extension VS Code) ne consomment que ces objets.
 * Les motifs et erreurs sont des codes (`Reason`) : les libellés vivent dans
 * `@warband/messages`.
 */

import { type ErrorInfo, type Reason, reason } from "./reason.js";

/** Version du schéma d'événements écrite dans chaque événement (`v`). */
export const EVENT_SCHEMA_VERSION = 1;

export type Decision = "allow" | "deny";

/** Fiabilité du rattachement d'un processus à l'appel d'outil qui l'a provoqué. */
export type Correlation = "exact" | "inferred" | "none";

/** Étape du cycle de vie d'une tâche (sous-agent, commande de fond…). */
export type TaskPhase = "started" | "progress" | "updated" | "finished";

export interface TaskUsage {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

/**
 * Ce que l'on sait de l'authentification d'une session. Jamais d'adresse
 * e-mail ni de jeton : ce sont des données personnelles ou des secrets.
 */
export interface AuthInfo {
  /** Origine de la clé selon le moteur (`ANTHROPIC_API_KEY`, `none` = connexion OAuth/abonnement…). */
  apiKeySource?: string;
  /** Formule d'abonnement (`pro`, `max`…), `null` si le moteur n'en reconnaît pas. */
  subscriptionType?: string | null;
  tokenSource?: string;
  /** Fournisseur d'API actif (`firstParty`, `bedrock`, `vertex`…). */
  apiProvider?: string;
}

export type EventPayload =
  | { kind: "audit.test"; claim: import("./audit.js").AuditTestClaim }
  | { kind: "run.started"; prompt: string; cwd: string }
  | {
      kind: "session.started";
      sessionId: string;
      model: string;
      tools: string[];
      /** Origine des identifiants telle que l'annonce le message d'initialisation. */
      auth?: AuthInfo;
    }
  | ({
      /** Détails d'authentification obtenus après l'initialisation (abonnement, fournisseur…). */
      kind: "auth.info";
    } & AuthInfo)
  | {
      /** Progression d'une authentification en cours ; la sortie détaillée n'est pas journalisée. */
      kind: "auth.status";
      isAuthenticating: boolean;
      error?: string;
    }
  | { kind: "agent.text"; text: string }
  /** Consigne de l'utilisateur (un tour d'une conversation multi-tours) ; masquée par le recorder. */
  | { kind: "user.message"; text: string }
  | { kind: "mission.decision"; decision: MissionDecision }
  | { kind: "research.status"; status: "requested" | "completed" | "failed" | "cancelled" }
  | {
      /** Raisonnement du modèle ; `redacted` : bloc chiffré, `text` vaut alors "". */
      kind: "agent.thinking";
      text: string;
      redacted: boolean;
    }
  | {
      kind: "tool.requested";
      toolUseId: string;
      tool: string;
      input: Record<string, unknown>;
      /** tool_use_id de l'outil Task qui a lancé le sous-agent demandeur (absent = agent principal). */
      agentToolUseId?: string;
      /** Identifiant du sous-agent demandeur, tel que vu par le hook PreToolUse. */
      agentId?: string;
    }
  | {
      kind: "approval.decided";
      toolUseId: string;
      decision: Decision;
      /** `bypass` : auto-approbation du Bypass (motif d'origine conservé dans `reason.cause`). */
      source: "policy" | "user" | "bypass";
      reason: Reason;
    }
  | {
      /**
       * Transition de l'interrupteur de Bypass, observée par la gate à une décision (un seul
       * événement par transition). `since` / `expiresAt` : bornes de l'état « on », en ms epoch.
       */
      kind: "bypass.changed";
      state: "on" | "off";
      reason: Reason;
      since?: number;
      expiresAt?: number;
    }
  | {
      /** Changement d'état de la fiche programme d'un projet (ADR 0040) ; `digest` : empreinte SHA-256 concernée. */
      kind: "program.state";
      projectId: string;
      state: "approved" | "suspended" | "invalidated";
      digest: string;
    }
  | {
      /** Une approbation est sollicitée auprès de l'Asker ; `approval.decided` suivra. */
      kind: "approval.requested";
      toolUseId: string;
      tool: string;
      input: Record<string, unknown>;
      verdict: Reason;
    }
  | {
      kind: "permission.denied";
      toolUseId: string;
      tool: string;
      reasonType?: string;
      message: string;
    }
  | {
      kind: "tool.result";
      toolUseId: string;
      isError: boolean;
      /** Texte complet de la sortie, plafonné (voir `truncated`). */
      output: string;
      /** Vrai si `output` a été coupé au plafond. */
      truncated: boolean;
      /** Taille d'origine de la sortie, en octets UTF-8. */
      bytes: number;
    }
  | {
      kind: "process.started";
      argv: string[];
      pid: number | null;
      correlation?: Correlation;
    }
  | {
      kind: "process.output";
      stream: "stdout" | "stderr";
      line: string;
      /** Vrai si la ligne a été coupée à la longueur maximale. */
      truncated?: boolean;
    }
  | {
      kind: "process.exited";
      code: number | null;
      signal: string | null;
      durationMs: number;
      /** Lignes de sortie non journalisées (plafond `maxJournaledLines` dépassé). */
      droppedLines?: number;
      /** Cause de la terminaison demandée ; absent pour une fin naturelle. */
      termination?: "abort" | "timeout";
      /** Vrai si un SIGKILL a été nécessaire. */
      forced?: boolean;
    }
  | {
      kind: "api.retry";
      attempt: number;
      maxRetries: number;
      delayMs: number;
      errorStatus: number | null;
      error: string;
    }
  | {
      kind: "task.updated";
      taskId: string;
      toolUseId?: string;
      phase: TaskPhase;
      status?: string;
      description?: string;
      summary?: string;
      usage?: TaskUsage;
    }
  | {
      kind: "rate.limited";
      status: string;
      resetsAt?: number;
      limitType?: string;
      utilization?: number;
    }
  | {
      /** Fin d'un tour (message `result` du moteur) ; une session multi-tours en émet plusieurs. */
      kind: "turn.finished";
      turns: number;
      /** Coût cumulé de la session à ce tour. */
      costUsd: number;
      status: "success" | "error";
      result: string | null;
    }
  | {
      kind: "run.finished";
      status: "success" | "error";
      turns: number;
      costUsd: number;
      result: string | null;
      sessionId?: string;
      /** Messages SDK non traduits en événements, comptés par `type/subtype`. */
      unhandledMessages?: Record<string, number>;
    }
  | ({ kind: "error" } & ErrorInfo)
  | {
      /** Bac à sable Docker créé, vérifié et initialisé ; l'image est identifiée par son empreinte. */
      kind: "sandbox.started";
      containerId: string;
      image: string;
      /** Empreinte de l'image (`RepoDigests` sinon identifiant), `null` si Docker n'en donne pas. */
      imageDigest: string | null;
      network: string;
      limits: Record<string, string | number>;
    }
  | {
      kind: "sandbox.stopped";
      containerId: string;
      cause: "runEnd" | "abort" | "error" | "exit";
    }
  | {
      /** Un abonné (sink) a levé une exception ; émis vers les autres abonnés. */
      kind: "sink.error";
      message: string;
    }
  | {
      /** Dernière ligne d'un journal qui a atteint sa taille maximale. */
      kind: "journal.truncated";
      limitBytes: number;
      droppedEvents: number;
    };

export type EventKind = EventPayload["kind"];

export interface EventMeta {
  /** Version du schéma (`EVENT_SCHEMA_VERSION`). Absente dans un vieux journal = 1. */
  v: number;
  /** Identifiant unique, stable dans le journal. */
  id: string;
  /** Rang monotone dans le run (0, 1, 2…). */
  seq: number;
  /** ISO-8601. */
  ts: string;
  runId: string;
  /** Événement causal parent (sert à construire le graphe). */
  parentId: string | null;
}

export type EngineEvent = EventMeta & EventPayload;

export type EventOf<K extends EventKind> = Extract<EngineEvent, { kind: K }>;

// ---------------------------------------------------------------------------
// Validation de charge utile
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
/** Validateur d'une charge utile : motif d'invalidité, ou `null` si valide. */
export type PayloadValidator = (payload: Obj) => Reason | null;

/**
 * Descripteur de champ : `string`, `number`, `boolean`, `object`, `string[]`,
 * `enum:a,b`, avec `?` (champ optionnel) et/ou `|null` (null admis) en suffixe.
 */
type FieldType = string;

/** Un motif : `code` texte, `params` (chaînes ou nombres) et `cause` (motif) optionnels. */
function isReason(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Obj;
  if (typeof r.code !== "string") return false;
  if (r.params !== undefined) {
    const p = r.params;
    const ok =
      typeof p === "object" &&
      p !== null &&
      !Array.isArray(p) &&
      Object.values(p).every((v) => typeof v === "string" || typeof v === "number");
    if (!ok) return false;
  }
  return r.cause === undefined || isReason(r.cause);
}

function matches(value: unknown, type: string): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object")
    return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "string[]") return Array.isArray(value) && value.every((i) => typeof i === "string");
  if (type === "reason") return isReason(value);
  if (type.startsWith("enum:"))
    return type
      .slice(5)
      .split(",")
      .includes(value as string);
  return false;
}

function shape(fields: Record<string, FieldType>): PayloadValidator {
  return (payload) => {
    for (const [name, descriptor] of Object.entries(fields)) {
      let type = descriptor;
      const optional = type.endsWith("?");
      if (optional) type = type.slice(0, -1);
      const nullable = type.endsWith("|null");
      if (nullable) type = type.slice(0, -"|null".length);
      const value = payload[name];
      if (value === undefined) {
        if (optional) continue;
        return reason("event.missingField", { field: name });
      }
      if (value === null && nullable) continue;
      if (!matches(value, type)) return reason("event.invalidField", { field: name });
    }
    return null;
  };
}

const AUTH_FIELDS = shape({
  apiKeySource: "string?",
  subscriptionType: "string|null?",
  tokenSource: "string?",
  apiProvider: "string?",
});

const USAGE_FIELDS = shape({ totalTokens: "number", toolUses: "number", durationMs: "number" });

/**
 * Validateur par `kind`. Le typage (`[K in EventKind]`) le rend exhaustif :
 * ajouter un kind sans validateur ne compile pas. `EVENT_KINDS` en découle.
 */
export const EVENT_VALIDATORS: { [K in EventKind]: PayloadValidator } = {
  "audit.test": (p) =>
    auditTestSchema.safeParse(p.claim).success
      ? null
      : reason("event.invalidField", { field: "claim" }),
  "run.started": shape({ prompt: "string", cwd: "string" }),
  "session.started": (p) =>
    shape({ sessionId: "string", model: "string", tools: "string[]", auth: "object?" })(p) ??
    (p.auth === undefined ? null : prefix("auth", AUTH_FIELDS(p.auth as Obj))),
  "auth.info": AUTH_FIELDS,
  "auth.status": shape({ isAuthenticating: "boolean", error: "string?" }),
  "agent.text": shape({ text: "string" }),
  "user.message": shape({ text: "string" }),
  "mission.decision": (p) =>
    missionDecisionSchema.safeParse(p.decision).success
      ? null
      : reason("event.invalidField", { field: "decision" }),
  "research.status": shape({ status: "enum:requested,completed,failed,cancelled" }),
  "agent.thinking": shape({ text: "string", redacted: "boolean" }),
  "tool.requested": shape({
    toolUseId: "string",
    tool: "string",
    input: "object",
    agentToolUseId: "string?",
    agentId: "string?",
  }),
  "approval.decided": shape({
    toolUseId: "string",
    decision: "enum:allow,deny",
    source: "enum:policy,user,bypass",
    reason: "reason",
  }),
  // `since` / `expiresAt` sont obligatoires pour un « on » : les bornes décident des approbations auto.
  "bypass.changed": (p) =>
    shape({
      state: "enum:on,off",
      reason: "reason",
      since: "number?",
      expiresAt: "number?",
    })(p) ?? (p.state === "on" ? shape({ since: "number", expiresAt: "number" })(p) : null),
  "program.state": shape({
    projectId: "string",
    state: "enum:approved,suspended,invalidated",
    digest: "string",
  }),
  "approval.requested": shape({
    toolUseId: "string",
    tool: "string",
    input: "object",
    verdict: "reason",
  }),
  "permission.denied": shape({
    toolUseId: "string",
    tool: "string",
    reasonType: "string?",
    message: "string",
  }),
  "tool.result": shape({
    toolUseId: "string",
    isError: "boolean",
    output: "string",
    truncated: "boolean",
    bytes: "number",
  }),
  "process.started": shape({
    argv: "string[]",
    pid: "number|null",
    correlation: "enum:exact,inferred,none?",
  }),
  "process.output": shape({
    stream: "enum:stdout,stderr",
    line: "string",
    truncated: "boolean?",
  }),
  "process.exited": shape({
    code: "number|null",
    signal: "string|null",
    durationMs: "number",
    droppedLines: "number?",
    termination: "enum:abort,timeout?",
    forced: "boolean?",
  }),
  "api.retry": shape({
    attempt: "number",
    maxRetries: "number",
    delayMs: "number",
    errorStatus: "number|null",
    error: "string",
  }),
  "task.updated": (p) =>
    shape({
      taskId: "string",
      toolUseId: "string?",
      phase: "enum:started,progress,updated,finished",
      status: "string?",
      description: "string?",
      summary: "string?",
      usage: "object?",
    })(p) ?? (p.usage === undefined ? null : prefix("usage", USAGE_FIELDS(p.usage as Obj))),
  "rate.limited": shape({
    status: "string",
    resetsAt: "number?",
    limitType: "string?",
    utilization: "number?",
  }),
  "turn.finished": shape({
    turns: "number",
    costUsd: "number",
    status: "enum:success,error",
    result: "string|null",
  }),
  "run.finished": (p) =>
    shape({
      status: "enum:success,error",
      turns: "number",
      costUsd: "number",
      result: "string|null",
      sessionId: "string?",
      unhandledMessages: "object?",
    })(p) ?? countsError(p.unhandledMessages),
  error: shape({
    code: "string",
    params: "object?",
    cause: "reason?",
    message: "string?",
  }),
  "sandbox.started": shape({
    containerId: "string",
    image: "string",
    imageDigest: "string|null",
    network: "enum:none,bridge",
    limits: "object",
  }),
  "sandbox.stopped": shape({
    containerId: "string",
    cause: "enum:runEnd,abort,error,exit",
  }),
  "sink.error": shape({ message: "string" }),
  "journal.truncated": shape({ limitBytes: "number", droppedEvents: "number" }),
};

/** Préfixe le champ fautif d'un motif de validation par le nom de l'objet qui le contient. */
function prefix(name: string, error: Reason | null): Reason | null {
  if (error === null) return null;
  const field = error.params?.field;
  return field === undefined
    ? error
    : { ...error, params: { ...error.params, field: `${name}.${String(field)}` } };
}

function countsError(value: unknown): Reason | null {
  if (value === undefined) return null;
  const ok = Object.values(value as Obj).every((n) => typeof n === "number");
  return ok ? null : reason("event.invalidField", { field: "unhandledMessages" });
}

export const EVENT_KINDS: readonly EventKind[] = Object.keys(EVENT_VALIDATORS) as EventKind[];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && Object.hasOwn(EVENT_VALIDATORS, value);
}

/**
 * Valide un événement complet (métadonnées + charge utile par `kind`).
 * Renvoie le motif d'invalidité, ou `null`. Un `v` absent vaut 1 ; un `v`
 * supérieur à `EVENT_SCHEMA_VERSION` est signalé (le format est inconnu).
 */
export function validateEvent(value: unknown): Reason | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reason("event.notObject");
  }
  const v = value as Obj;
  if (!isEventKind(v.kind)) return reason("event.unknownKind", { kind: String(v.kind) });
  if (v.v !== undefined) {
    if (typeof v.v !== "number" || !Number.isInteger(v.v) || v.v < 1) {
      return reason("event.invalidVersion");
    }
    if (v.v > EVENT_SCHEMA_VERSION) {
      return reason("event.unsupportedVersion", { version: v.v, known: EVENT_SCHEMA_VERSION });
    }
  }
  const missing = (field: string) => reason("event.missingField", { field });
  if (typeof v.id !== "string") return missing("id");
  if (typeof v.seq !== "number") return missing("seq");
  if (typeof v.ts !== "string") return missing("ts");
  if (typeof v.runId !== "string") return missing("runId");
  if (v.parentId !== null && typeof v.parentId !== "string") {
    return reason("event.invalidField", { field: "parentId" });
  }
  return EVENT_VALIDATORS[v.kind](v);
}
