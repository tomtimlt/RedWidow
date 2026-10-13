/**
 * Modèle d'événements du moteur. Tout ce que le moteur produit passe par ici :
 * les UI (CLI, export HTML, extension VS Code) ne consomment que ces objets.
 */

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

export type EventPayload =
  | { kind: "run.started"; prompt: string; cwd: string }
  | {
      kind: "session.started";
      sessionId: string;
      model: string;
      tools: string[];
    }
  | { kind: "agent.text"; text: string }
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
      source: "policy" | "user";
      reason: string;
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
      kind: "run.finished";
      status: "success" | "error";
      turns: number;
      costUsd: number;
      result: string | null;
      /** Messages SDK non traduits en événements, comptés par `type/subtype`. */
      unhandledMessages?: Record<string, number>;
    }
  | { kind: "error"; message: string }
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
/** Validateur d'une charge utile : message d'erreur, ou `null` si valide. */
export type PayloadValidator = (payload: Obj) => string | null;

/**
 * Descripteur de champ : `string`, `number`, `boolean`, `object`, `string[]`,
 * `enum:a,b`, avec `?` (champ optionnel) et/ou `|null` (null admis) en suffixe.
 */
type FieldType = string;

function matches(value: unknown, type: string): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object")
    return typeof value === "object" && value !== null && !Array.isArray(value);
  if (type === "string[]") return Array.isArray(value) && value.every((i) => typeof i === "string");
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
        return `${name} manquant`;
      }
      if (value === null && nullable) continue;
      if (!matches(value, type)) return `${name} invalide`;
    }
    return null;
  };
}

const USAGE_FIELDS = shape({ totalTokens: "number", toolUses: "number", durationMs: "number" });

/**
 * Validateur par `kind`. Le typage (`[K in EventKind]`) le rend exhaustif :
 * ajouter un kind sans validateur ne compile pas. `EVENT_KINDS` en découle.
 */
export const EVENT_VALIDATORS: { [K in EventKind]: PayloadValidator } = {
  "run.started": shape({ prompt: "string", cwd: "string" }),
  "session.started": shape({ sessionId: "string", model: "string", tools: "string[]" }),
  "agent.text": shape({ text: "string" }),
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
    source: "enum:policy,user",
    reason: "string",
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
  "run.finished": (p) =>
    shape({
      status: "enum:success,error",
      turns: "number",
      costUsd: "number",
      result: "string|null",
      unhandledMessages: "object?",
    })(p) ?? countsError(p.unhandledMessages),
  error: shape({ message: "string" }),
  "sink.error": shape({ message: "string" }),
  "journal.truncated": shape({ limitBytes: "number", droppedEvents: "number" }),
};

function prefix(name: string, error: string | null): string | null {
  return error === null ? null : `${name}.${error}`;
}

function countsError(value: unknown): string | null {
  if (value === undefined) return null;
  const ok = Object.values(value as Obj).every((n) => typeof n === "number");
  return ok ? null : "unhandledMessages invalide";
}

export const EVENT_KINDS: readonly EventKind[] = Object.keys(EVENT_VALIDATORS) as EventKind[];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && Object.hasOwn(EVENT_VALIDATORS, value);
}

/**
 * Valide un événement complet (métadonnées + charge utile par `kind`).
 * Renvoie un message d'erreur, ou `null`. Un `v` absent vaut 1 ; un `v`
 * supérieur à `EVENT_SCHEMA_VERSION` est signalé (le format est inconnu).
 */
export function validateEvent(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "objet attendu";
  const v = value as Obj;
  if (!isEventKind(v.kind)) return `kind inconnu : ${String(v.kind)}`;
  if (v.v !== undefined) {
    if (typeof v.v !== "number" || !Number.isInteger(v.v) || v.v < 1) return "v invalide";
    if (v.v > EVENT_SCHEMA_VERSION) {
      return `version de schéma ${v.v} non prise en charge (connue : ${EVENT_SCHEMA_VERSION})`;
    }
  }
  if (typeof v.id !== "string") return "id manquant";
  if (typeof v.seq !== "number") return "seq manquant";
  if (typeof v.ts !== "string") return "ts manquant";
  if (typeof v.runId !== "string") return "runId manquant";
  if (v.parentId !== null && typeof v.parentId !== "string") return "parentId invalide";
  return EVENT_VALIDATORS[v.kind](v);
}
