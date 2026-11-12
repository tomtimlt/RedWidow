/**
 * Messages de contrôle de la vue `shell` (arrêt d'urgence, Bypass, configuration). Entrée non fiable :
 * clés exactes, types et bornes vérifiés ; tout écart donne `null` et le message est ignoré.
 * Aucune valeur secrète n'apparaît dans un message sortant : ces types ne servent qu'à l'entrée.
 */
import { isContainerRef } from "../docker/containers.js";
import { hasControl, isLayoutName, type Layout, validateLayout } from "./layout.js";
import { isPoolProvider, MAX_POOL_KEYS, type PoolProvider } from "./rotation.js";

/** Fournisseurs à jeton et types acceptés (OpenAI : clé d'API seulement, comme `buildChatDeps`). */
export const TOKEN_KINDS = {
  claude: ["api-key", "subscription"],
  openai: ["api-key"],
} as const;
export type TokenProvider = keyof typeof TOKEN_KINDS;
export type TokenKindName = "api-key" | "subscription";

/** Réglages modifiables depuis la coquille : mêmes clés que `warband.*` (logic/settings.ts, chat-capabilities.ts). */
export const SETTING_KEYS = [
  "opencodeProviders",
  "burp.enabled",
  "burp.port",
  "burp.transport",
  "integrations",
  "profile",
  "model",
  "maxTurns",
  "ultracode.maxTurns",
  "ultracode.maxBudgetUsd",
  "chat.providers",
  "chat.skills",
  "chat.integrations",
  "chat.webSearch",
] as const;

export const MAX_BYPASS_MINUTES = 48 * 60;
export const MAX_SECRET = 8192;
export const MAX_PATCH_BYTES = 264 * 1024;
export const ACCOUNT_LABEL = /^[A-Z][A-Z0-9_]{0,15}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ShellControl =
  | {
      type:
        | "halt"
        | "resume"
        | "settingsGet"
        | "tokens"
        | "accounts"
        | "layouts"
        | "containersList"
        | "missionsList"
        | "projectsList";
    }
  | { type: "runsList"; project: string | null }
  | { type: "auditTail"; limit: number }
  | { type: "containerStart" | "containerStop"; id: string }
  | { type: "containerCreate"; kind: "kali"; name: string }
  | { type: "setBypass"; active: boolean; durationMinutes: number | null }
  | { type: "settingsSet"; patch: Record<string, unknown> }
  | { type: "tokenSet"; provider: TokenProvider; kind: TokenKindName; value: string }
  | { type: "tokenDelete"; provider: TokenProvider }
  | { type: "poolList" }
  | { type: "poolAdd"; provider: PoolProvider; label: string; value: string }
  | { type: "poolRemove" | "poolActivate"; provider: PoolProvider; id: string }
  | { type: "poolReorder"; provider: PoolProvider; order: string[] }
  | { type: "accountAdd"; programme: string; label: string; login: string; secret: string }
  | { type: "accountReveal" | "accountRemove"; id: string }
  | { type: "findingsList"; project: string | null }
  | { type: "findingGet"; project: string; id: string }
  | { type: "findingDelete"; project: string; id: string; confirmed: boolean }
  | { type: "layoutSave"; name: string | null; layout: Layout }
  | { type: "layoutDelete"; name: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const only = (m: Record<string, unknown>, ...keys: string[]) =>
  Object.keys(m).length === keys.length && keys.every((k) => k in m);

const noControl = (s: string) => !hasControl(s);

const isProvider = (v: unknown): v is TokenProvider =>
  typeof v === "string" && Object.hasOwn(TOKEN_KINDS, v);

const isPoolId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Texte court trimmé, non vide, sans caractère de contrôle. */
const shortText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= max && v === v.trim() && noControl(v);

export function parseShellControl(m: Record<string, unknown>): ShellControl | null {
  switch (m.type) {
    case "halt":
    case "resume":
    case "settingsGet":
    case "tokens":
    case "accounts":
    case "layouts":
    case "containersList":
    case "missionsList":
    case "projectsList":
      return only(m, "type") ? { type: m.type } : null;
    case "runsList":
      if (only(m, "type")) return { type: "runsList", project: null };
      return only(m, "type", "project") && isPoolId(m.project)
        ? { type: "runsList", project: m.project }
        : null;
    case "auditTail":
      return only(m, "type", "limit") &&
        Number.isInteger(m.limit) &&
        (m.limit as number) >= 1 &&
        (m.limit as number) <= 200
        ? { type: "auditTail", limit: m.limit as number }
        : null;
    case "containerStart":
    case "containerStop":
      return only(m, "type", "id") && isContainerRef(m.id) ? { type: m.type, id: m.id } : null;
    case "containerCreate":
      // Seul Kali se crée d'ici ; Exegol passe par sa CLI.
      return only(m, "type", "kind", "name") && m.kind === "kali" && isContainerRef(m.name)
        ? { type: "containerCreate", kind: "kali", name: m.name }
        : null;
    case "setBypass": {
      if (!only(m, "type", "active", "durationMinutes") || typeof m.active !== "boolean")
        return null;
      const d = m.durationMinutes;
      if (
        d !== null &&
        !(Number.isInteger(d) && (d as number) >= 1 && (d as number) <= MAX_BYPASS_MINUTES)
      )
        return null;
      return { type: "setBypass", active: m.active, durationMinutes: d as number | null };
    }
    case "settingsSet": {
      if (!only(m, "type", "patch") || !isRecord(m.patch)) return null;
      const keys = Object.keys(m.patch);
      if (keys.length === 0 || keys.length > SETTING_KEYS.length) return null;
      if (!keys.every((k) => (SETTING_KEYS as readonly string[]).includes(k))) return null;
      try {
        if (JSON.stringify(m.patch).length > MAX_PATCH_BYTES) return null;
      } catch {
        return null;
      }
      return { type: "settingsSet", patch: m.patch };
    }
    case "tokenSet": {
      if (!only(m, "type", "provider", "kind", "value") || !isProvider(m.provider)) return null;
      if (!(TOKEN_KINDS[m.provider] as readonly unknown[]).includes(m.kind)) return null;
      if (
        typeof m.value !== "string" ||
        m.value.length < 1 ||
        m.value.length > MAX_SECRET ||
        /\s/.test(m.value) ||
        hasControl(m.value)
      )
        return null;
      return {
        type: "tokenSet",
        provider: m.provider,
        kind: m.kind as TokenKindName,
        value: m.value,
      };
    }
    case "tokenDelete":
      return only(m, "type", "provider") && isProvider(m.provider)
        ? { type: "tokenDelete", provider: m.provider }
        : null;
    case "poolList":
      return only(m, "type") ? { type: "poolList" } : null;
    case "poolAdd": {
      if (!only(m, "type", "provider", "label", "value") || !isPoolProvider(m.provider))
        return null;
      if (!shortText(m.label, 40)) return null;
      if (
        typeof m.value !== "string" ||
        m.value.length < 1 ||
        m.value.length > MAX_SECRET ||
        /\s/.test(m.value) ||
        hasControl(m.value)
      )
        return null;
      return { type: "poolAdd", provider: m.provider, label: m.label, value: m.value };
    }
    case "poolRemove":
    case "poolActivate":
      return only(m, "type", "provider", "id") && isPoolProvider(m.provider) && isPoolId(m.id)
        ? { type: m.type, provider: m.provider, id: m.id }
        : null;
    case "poolReorder": {
      if (!only(m, "type", "provider", "order") || !isPoolProvider(m.provider)) return null;
      if (!Array.isArray(m.order) || m.order.length > MAX_POOL_KEYS || !m.order.every(isPoolId))
        return null;
      return { type: "poolReorder", provider: m.provider, order: m.order as string[] };
    }
    case "accountAdd": {
      if (!only(m, "type", "programme", "label", "login", "secret")) return null;
      if (
        !shortText(m.programme, 80) ||
        typeof m.label !== "string" ||
        !ACCOUNT_LABEL.test(m.label) ||
        !shortText(m.login, 512) ||
        typeof m.secret !== "string" ||
        m.secret.length < 1 ||
        m.secret.length > MAX_SECRET ||
        m.secret.includes("\0")
      )
        return null;
      return {
        type: "accountAdd",
        programme: m.programme,
        label: m.label,
        login: m.login,
        secret: m.secret,
      };
    }
    case "accountReveal":
    case "accountRemove":
      return only(m, "type", "id") && typeof m.id === "string" && UUID.test(m.id)
        ? { type: m.type, id: m.id }
        : null;
    case "findingsList":
      if (only(m, "type")) return { type: "findingsList", project: null };
      return only(m, "type", "project") && isPoolId(m.project)
        ? { type: "findingsList", project: m.project }
        : null;
    case "findingGet":
      return only(m, "type", "project", "id") && isPoolId(m.project) && shortText(m.id, 200)
        ? { type: "findingGet", project: m.project, id: m.id }
        : null;
    case "findingDelete":
      // `confirmed` doit être un booléen ; le hub refuse tout ce qui n'est pas `true`.
      return only(m, "type", "project", "id", "confirmed") &&
        isPoolId(m.project) &&
        shortText(m.id, 200) &&
        typeof m.confirmed === "boolean"
        ? { type: "findingDelete", project: m.project, id: m.id, confirmed: m.confirmed }
        : null;
    case "layoutSave": {
      if (!only(m, "type", "name", "layout")) return null;
      if (m.name !== null && !isLayoutName(m.name)) return null;
      const layout = validateLayout(m.layout);
      return layout === null ? null : { type: "layoutSave", name: m.name as string | null, layout };
    }
    case "layoutDelete":
      return only(m, "type", "name") && isLayoutName(m.name)
        ? { type: "layoutDelete", name: m.name }
        : null;
    default:
      return null;
  }
}
