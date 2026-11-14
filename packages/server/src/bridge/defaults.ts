import { isProvider, type Provider } from "@warband/vscode/logic/effort";
import type { ServerStorage } from "../storage/index.js";
import { PREFS_PREFIX, tokenKindKey, tokenSecretKey } from "./deps.js";
import { currentKey, parsePool, poolSecretKey, poolStateKey } from "./rotation.js";

/**
 * Défauts d'un nouveau chat, réglés par l'administrateur du serveur (`REDWIDOW_DEFAULT_PROVIDER`,
 * `REDWIDOW_DEFAULT_MODEL`). Le modèle n'est jamais écrit dans le dépôt : il vient de l'environnement.
 */
export interface ChatDefaults {
  provider?: Provider;
  model?: string;
}

/** Longueur maximale d'un identifiant de modèle (même borne que le réglage `model`). */
const MAX_MODEL = 200;
// biome-ignore lint/suspicious/noControlCharactersInRegex: détection volontaire des caractères de contrôle
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Lit les défauts de l'environnement ; toute valeur invalide est ignorée (jamais d'erreur bloquante). */
export function parseChatDefaults(env: Readonly<Record<string, string | undefined>>): ChatDefaults {
  const out: ChatDefaults = {};
  const provider = env.REDWIDOW_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (isProvider(provider)) out.provider = provider;
  const model = env.REDWIDOW_DEFAULT_MODEL?.trim();
  if (model && model.length <= MAX_MODEL && !CONTROL.test(model)) out.model = model;
  return out;
}

/** Clé d'état des préférences d'un cadre (équivalent de `prefsKey` de `buildChatDeps`). */
export const framePrefsKey = (frame: string): string => `${PREFS_PREFIX}chat.${frame}`;

/**
 * Le serveur possède-t-il une clé pour ce fournisseur ? OpenCode : jeton du coffre ou clé utilisable de la
 * réserve ; Claude et OpenAI : jeton du coffre (OpenAI : clé d'API seulement, comme `buildChatDeps`).
 * Lecture des noms seulement : aucune valeur n'est lue.
 */
export function hasProviderKey(storage: ServerStorage, provider: Provider, now: number): boolean {
  const names = new Set(storage.secrets.keys());
  if (provider === "opencode") {
    if (names.has(tokenSecretKey("opencode"))) return true;
    const pool = parsePool(storage.state.get(poolStateKey("opencode")));
    const id = currentKey(pool, now);
    return id !== null && names.has(poolSecretKey("opencode", id));
  }
  if (!names.has(tokenSecretKey(provider))) return false;
  return provider !== "openai" || storage.state.get(tokenKindKey("openai")) === "api-key";
}

/**
 * Fournisseur par défaut d'un nouveau chat : celui demandé explicitement ; sinon OpenCode s'il a une clé,
 * puis le premier autre fournisseur ayant un jeton ; `undefined` sans aucune clé (comportement habituel).
 */
export function resolveDefaultProvider(
  storage: ServerStorage,
  defaults: ChatDefaults,
  now: number,
): Provider | undefined {
  if (defaults.provider) return defaults.provider;
  for (const provider of ["opencode", "claude", "openai"] as const)
    if (hasProviderKey(storage, provider, now)) return provider;
  return undefined;
}
