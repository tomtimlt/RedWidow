/**
 * Messages de contrôle de la vue `shell` (arrêt d'urgence, Bypass, configuration). Entrée non fiable :
 * clés exactes, types et bornes vérifiés ; tout écart donne `null` et le message est ignoré.
 * Aucune valeur secrète n'apparaît dans un message sortant : ces types ne servent qu'à l'entrée.
 */
import { hasControl, isLayoutName, type Layout, validateLayout } from "./layout.js";

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
  | { type: "halt" | "resume" | "settingsGet" | "tokens" | "accounts" | "layouts" }
  | { type: "setBypass"; active: boolean; durationMinutes: number | null }
  | { type: "settingsSet"; patch: Record<string, unknown> }
  | { type: "tokenSet"; provider: TokenProvider; kind: TokenKindName; value: string }
  | { type: "tokenDelete"; provider: TokenProvider }
  | { type: "accountAdd"; programme: string; label: string; login: string; secret: string }
  | { type: "accountReveal" | "accountRemove"; id: string }
  | { type: "layoutSave"; name: string | null; layout: Layout }
  | { type: "layoutDelete"; name: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const only = (m: Record<string, unknown>, ...keys: string[]) =>
  Object.keys(m).length === keys.length && keys.every((k) => k in m);

const noControl = (s: string) => !hasControl(s);

const isProvider = (v: unknown): v is TokenProvider =>
  typeof v === "string" && Object.hasOwn(TOKEN_KINDS, v);

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
      return only(m, "type") ? { type: m.type } : null;
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
