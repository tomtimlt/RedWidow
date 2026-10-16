import { isAbsolute } from "node:path";
import {
  type AuthMode,
  type Decision,
  type Effort,
  type EngineEvent,
  type ErrorInfo,
  type ModelOption,
  type PendingApproval,
  REASON_CODES,
  type Reason,
  type RememberScope,
  reason,
  validateEvent,
} from "@john-studio/core";
import { parseEffort } from "./effort.js";
import { isModelId, parseModelOptions } from "./models.js";

/**
 * Protocole IPC entre l'extension (parent) et le moteur (processus enfant), ADR 0004.
 * Chaque côté valide tout ce qu'il reçoit : un message inconnu, mal formé ou d'une autre
 * version est rejeté (jamais exécuté). Les champs sont exacts : aucune clé supplémentaire
 * n'est acceptée, ce qui ferme aussi la voie à un secret glissé dans un message.
 * Aucun message ne porte de jeton : il n'existe que dans l'environnement de l'enfant.
 */
export const PROTOCOL_VERSION = 1;

/** Plafond d'un texte de consigne (caractères). */
export const MAX_PROMPT_CHARS = 1_000_000;

export interface StartParams {
  cwd: string;
  model?: string;
  effort?: Effort;
  maxTurns?: number;
  auth?: AuthMode;
  resume?: string;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  /** Dossier absolu des journaux (stockage de l'extension, hors du dépôt). */
  journalDir?: string;
}

/** Résumé de fin de run (déjà masqué côté moteur). */
export interface EndedSummary {
  status: "success" | "error";
  turns: number;
  costUsd: number;
  result: string | null;
  sessionId?: string;
}

/** Parent → moteur. */
export type ToEngine =
  | ({ v: 1; type: "start" } & StartParams)
  /** Sondage (moteur éphémère, aucune consigne) : demande la liste des modèles puis le moteur sort. */
  | { v: 1; type: "models"; cwd: string; auth?: AuthMode }
  | { v: 1; type: "prompt"; text: string }
  | { v: 1; type: "answer"; toolUseId: string; decision: Decision; remember?: RememberScope }
  | { v: 1; type: "abort" }
  | { v: 1; type: "dispose" };

/** Moteur → parent. */
export type FromEngine =
  | { v: 1; type: "ready" }
  | { v: 1; type: "started"; runId: string; policySource: string | null; warning?: Reason }
  | { v: 1; type: "models"; models: ModelOption[] }
  | { v: 1; type: "event"; event: EngineEvent }
  | { v: 1; type: "approval"; approval: PendingApproval }
  | { v: 1; type: "ended"; summary: EndedSummary }
  | { v: 1; type: "error"; reason: ErrorInfo };

export type Parsed<T> = { ok: true; message: T } | { ok: false; reason: Reason };

type Obj = Record<string, unknown>;

const bad = (field: string, why = "invalid"): Parsed<never> => ({
  ok: false,
  reason: reason("ipc.invalidMessage", { field, reason: why }),
});

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Clés autorisées par type de message : toute autre clé rejette le message. */
function onlyKeys(obj: Obj, allowed: readonly string[]): string | null {
  return Object.keys(obj).find((k) => !allowed.includes(k)) ?? null;
}

/** Contrôle commun : objet, version, type connu. Renvoie l'objet et son type, ou le rejet. */
function envelope(raw: unknown, types: readonly string[]): Parsed<{ obj: Obj; type: string }> {
  if (!isObj(raw)) return bad("message", "notObject");
  if (raw.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: reason("ipc.unsupportedVersion", {
        version: isFiniteNumber(raw.v) ? raw.v : -1,
        known: PROTOCOL_VERSION,
      }),
    };
  }
  if (!isString(raw.type) || !types.includes(raw.type)) return bad("type", "unknown");
  return { ok: true, message: { obj: raw, type: raw.type } };
}

const START_KEYS = [
  "v",
  "type",
  "cwd",
  "model",
  "effort",
  "maxTurns",
  "auth",
  "resume",
  "maxBudgetUsd",
  "systemPrompt",
  "journalDir",
] as const;

/** Valide un message reçu par le moteur. */
export function parseToEngine(raw: unknown): Parsed<ToEngine> {
  const env = envelope(raw, ["start", "models", "prompt", "answer", "abort", "dispose"]);
  if (!env.ok) return env;
  const { obj, type } = env.message;
  const extra = (keys: readonly string[]) => onlyKeys(obj, keys);
  let unexpected: string | null;
  switch (type) {
    case "start": {
      unexpected = extra(START_KEYS);
      if (unexpected) return bad(unexpected, "unexpected");
      if (!isString(obj.cwd) || obj.cwd === "" || !isAbsolute(obj.cwd)) return bad("cwd");
      for (const key of ["resume", "systemPrompt"] as const) {
        if (obj[key] !== undefined && !isString(obj[key])) return bad(key);
      }
      if (obj.journalDir !== undefined) {
        if (
          !isString(obj.journalDir) ||
          !isAbsolute(obj.journalDir) ||
          obj.journalDir.length > 1024
        )
          return bad("journalDir");
      }
      if (obj.model !== undefined && !isModelId(obj.model)) return bad("model");
      if (obj.effort !== undefined && parseEffort(obj.effort) === null) return bad("effort");
      if (
        obj.maxTurns !== undefined &&
        !(isFiniteNumber(obj.maxTurns) && Number.isInteger(obj.maxTurns) && obj.maxTurns > 0)
      ) {
        return bad("maxTurns");
      }
      if (obj.maxBudgetUsd !== undefined) {
        if (!isFiniteNumber(obj.maxBudgetUsd) || obj.maxBudgetUsd <= 0) return bad("maxBudgetUsd");
      }
      if (
        obj.auth !== undefined &&
        !["auto", "subscription", "api-key"].includes(String(obj.auth))
      ) {
        return bad("auth");
      }
      return { ok: true, message: obj as ToEngine };
    }
    case "models":
      unexpected = extra(["v", "type", "cwd", "auth"]);
      if (unexpected) return bad(unexpected, "unexpected");
      if (!isString(obj.cwd) || obj.cwd === "" || !isAbsolute(obj.cwd)) return bad("cwd");
      if (
        obj.auth !== undefined &&
        !["auto", "subscription", "api-key"].includes(String(obj.auth))
      ) {
        return bad("auth");
      }
      return { ok: true, message: obj as ToEngine };
    case "prompt":
      unexpected = extra(["v", "type", "text"]);
      if (unexpected) return bad(unexpected, "unexpected");
      if (!isString(obj.text) || obj.text === "" || obj.text.length > MAX_PROMPT_CHARS) {
        return bad("text");
      }
      return { ok: true, message: obj as ToEngine };
    case "answer":
      unexpected = extra(["v", "type", "toolUseId", "decision", "remember"]);
      if (unexpected) return bad(unexpected, "unexpected");
      if (!isString(obj.toolUseId) || obj.toolUseId === "") return bad("toolUseId");
      if (obj.decision !== "allow" && obj.decision !== "deny") return bad("decision");
      if (
        obj.remember !== undefined &&
        !["once", "session", "always"].includes(String(obj.remember))
      ) {
        return bad("remember");
      }
      return { ok: true, message: obj as ToEngine };
    default:
      unexpected = extra(["v", "type"]);
      if (unexpected) return bad(unexpected, "unexpected");
      return { ok: true, message: obj as ToEngine };
  }
}

/** Valide un motif (code connu, paramètres chaîne/nombre, cause imbriquée bornée). */
function validReason(value: unknown, depth = 0): boolean {
  if (!isObj(value) || depth > 4) return false;
  if (onlyKeys(value, ["code", "params", "cause", "message"]) !== null) return false;
  if (!isString(value.code) || !(REASON_CODES as readonly string[]).includes(value.code)) {
    return false;
  }
  if (value.params !== undefined) {
    if (!isObj(value.params)) return false;
    if (!Object.values(value.params).every((p) => isString(p) || isFiniteNumber(p))) return false;
  }
  // Le message brut n'existe que pour `error.unknown`.
  if (value.message !== undefined && (!isString(value.message) || value.code !== "error.unknown")) {
    return false;
  }
  return value.cause === undefined || validReason(value.cause, depth + 1);
}

function validApproval(value: unknown): boolean {
  if (!isObj(value)) return false;
  if (onlyKeys(value, ["toolUseId", "tool", "input", "verdict"]) !== null) return false;
  if (!isString(value.toolUseId) || !isString(value.tool) || !isObj(value.input)) return false;
  const verdict = value.verdict;
  if (!isObj(verdict) || onlyKeys(verdict, ["decision", "reason", "rule"]) !== null) return false;
  return (
    ["allow", "ask", "deny"].includes(String(verdict.decision)) &&
    validReason(verdict.reason) &&
    (verdict.rule === null || Number.isInteger(verdict.rule))
  );
}

function validSummary(value: unknown): boolean {
  if (!isObj(value)) return false;
  if (onlyKeys(value, ["status", "turns", "costUsd", "result", "sessionId"]) !== null) return false;
  return (
    (value.status === "success" || value.status === "error") &&
    isFiniteNumber(value.turns) &&
    isFiniteNumber(value.costUsd) &&
    (value.result === null || isString(value.result)) &&
    (value.sessionId === undefined || isString(value.sessionId))
  );
}

/** Valide un message reçu par l'extension. */
export function parseFromEngine(raw: unknown): Parsed<FromEngine> {
  const env = envelope(raw, ["ready", "started", "models", "event", "approval", "ended", "error"]);
  if (!env.ok) return env;
  const { obj, type } = env.message;
  const unexpected = onlyKeys(
    obj,
    {
      ready: ["v", "type"],
      started: ["v", "type", "runId", "policySource", "warning"],
      models: ["v", "type", "models"],
      event: ["v", "type", "event"],
      approval: ["v", "type", "approval"],
      ended: ["v", "type", "summary"],
      error: ["v", "type", "reason"],
    }[type] as string[],
  );
  if (unexpected) return bad(unexpected, "unexpected");
  const ok = { ok: true, message: obj as FromEngine } as const;
  switch (type) {
    case "started":
      if (!isString(obj.runId)) return bad("runId");
      if (obj.policySource !== null && !isString(obj.policySource)) return bad("policySource");
      if (obj.warning !== undefined && !validReason(obj.warning)) return bad("warning");
      return ok;
    case "models":
      return parseModelOptions(obj.models) ? ok : bad("models");
    case "event": {
      const invalid = validateEvent(obj.event);
      return invalid ? bad("event", invalid.code) : ok;
    }
    case "approval":
      return validApproval(obj.approval) ? ok : bad("approval");
    case "ended":
      return validSummary(obj.summary) ? ok : bad("summary");
    case "error":
      return validReason(obj.reason) ? ok : bad("reason");
    default:
      return ok;
  }
}
