/**
 * Configuration du serveur pilotée depuis la vue `shell` (ADR 0052) : réglages, jetons des
 * fournisseurs, dispositions. Les jetons vivent dans le coffre (`provider.<id>.token`) ; seuls leur
 * présence et leur type sortent d'ici, jamais la valeur. Rien de secret n'est journalisé.
 */
import { randomUUID } from "node:crypto";
import { CodedError } from "@warband/core";
import { capabilitySettings, isCapabilityId } from "@warband/vscode/logic/chat-capabilities";
import { isPalette } from "@warband/vscode/logic/palette";
import { resolveSettings } from "@warband/vscode/logic/settings";
import { isTerminalPrompt } from "@warband/vscode/logic/terminal-prompt";
import type { ServerStorage } from "../storage/index.js";
import { SETTINGS_KEY, tokenKindKey, tokenSecretKey } from "./deps.js";
import { isLayoutName, type Layout, MAX_SAVED_LAYOUTS } from "./layout.js";
import {
  currentKey,
  MAX_POOL_KEYS,
  type PoolProvider,
  type PoolState,
  parsePool,
  poolSecretKey,
  poolStateKey,
} from "./rotation.js";
import {
  SETTING_KEYS,
  TOKEN_KINDS,
  type TokenKindName,
  type TokenProvider,
} from "./shell-messages.js";

/** Clé d'état des dispositions : `{ current, saved: [{ name, layout }] }`. */
export const LAYOUTS_KEY = "layouts";

const PROFILES = ["mentor", "bug-bounty", "out-of-box", "red-team", "htb"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Valeur courante des réglages : objet `{ clé: valeur }` limité aux clés connues. */
export function readSettingsObject(storage: ServerStorage): Record<string, unknown> {
  const raw = storage.state.get(SETTINGS_KEY);
  const out: Record<string, unknown> = {};
  if (isRecord(raw))
    for (const key of SETTING_KEYS) if (raw[key] !== undefined) out[key] = raw[key];
  return out;
}

/** Contrôle strict de types en plus de `resolveSettings` (qui ignore sans erreur certaines valeurs). */
function checkTypes(values: Record<string, unknown>): boolean {
  const v = (k: string) => values[k];
  if (v("burp.enabled") !== undefined && typeof v("burp.enabled") !== "boolean") return false;
  if (v("chat.webSearch") !== undefined && typeof v("chat.webSearch") !== "boolean") return false;
  for (const key of ["chat.providers", "chat.skills", "chat.integrations"]) {
    const list = v(key);
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 512 || !list.every(isCapabilityId)) return false;
  }
  const profile = v("profile");
  if (profile !== undefined && !(typeof profile === "string" && PROFILES.includes(profile)))
    return false;
  if (v("locale") !== undefined && v("locale") !== "fr" && v("locale") !== "en") return false;
  if (v("palette") !== undefined && !isPalette(v("palette"))) return false;
  if (v("terminalPrompt") !== undefined && !isTerminalPrompt(v("terminalPrompt"))) return false;
  const model = v("model");
  if (model !== undefined && !(typeof model === "string" && model.length <= 200)) return false;
  return true;
}

/**
 * Applique un patch (`null` supprime la clé) après validation de l'ensemble résultant par les règles
 * de `logic/settings.ts`. Renvoie les réglages obtenus, ou `null` : rien n'est alors écrit.
 */
export function applySettingsPatch(
  storage: ServerStorage,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = readSettingsObject(storage);
  for (const [key, value] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) return null;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  if (!checkTypes(merged)) return null;
  try {
    const get = (key: string) => merged[key];
    resolveSettings(get);
    capabilitySettings(get);
    // Port et transport de Burp ne sont lus que si Burp est activé : on les valide aussi à plat.
    if (merged["burp.port"] !== undefined || merged["burp.transport"] !== undefined)
      resolveSettings((key) => (key === "burp.enabled" ? true : merged[key]));
  } catch (error) {
    if (error instanceof CodedError) return null;
    throw error;
  }
  storage.state.set(SETTINGS_KEY, merged);
  return merged;
}

export interface TokenItem {
  provider: TokenProvider;
  kind: TokenKindName | null;
  present: boolean;
}

/** État des jetons : présence et type seulement. */
export async function listTokens(storage: ServerStorage): Promise<TokenItem[]> {
  const items: TokenItem[] = [];
  for (const provider of Object.keys(TOKEN_KINDS) as TokenProvider[]) {
    const present = (await storage.secrets.get(tokenSecretKey(provider))) !== undefined;
    const kind = storage.state.get(tokenKindKey(provider));
    items.push({
      provider,
      present,
      kind: present && (kind === "api-key" || kind === "subscription") ? kind : null,
    });
  }
  return items;
}

export async function setToken(
  storage: ServerStorage,
  provider: TokenProvider,
  kind: TokenKindName,
  value: string,
): Promise<void> {
  await storage.secrets.set(tokenSecretKey(provider), value);
  storage.state.set(tokenKindKey(provider), kind);
}

export async function deleteToken(storage: ServerStorage, provider: TokenProvider): Promise<void> {
  await storage.secrets.delete(tokenSecretKey(provider));
  storage.state.set(tokenKindKey(provider), undefined);
}

export interface SavedLayouts {
  current: Layout | null;
  saved: { name: string; layout: Layout }[];
}

export function readLayouts(storage: ServerStorage): SavedLayouts {
  const raw = storage.state.get(LAYOUTS_KEY);
  if (!isRecord(raw)) return { current: null, saved: [] };
  const saved = Array.isArray(raw.saved)
    ? (raw.saved as unknown[]).filter(
        (e): e is { name: string; layout: Layout } => isRecord(e) && isLayoutName(e.name),
      )
    : [];
  return { current: (raw.current as Layout | null | undefined) ?? null, saved };
}

/** Enregistre la disposition courante (`name` nul) ou une disposition nommée. `false` : plafond atteint. */
export function saveLayout(storage: ServerStorage, name: string | null, layout: Layout): boolean {
  const state = readLayouts(storage);
  if (name === null) state.current = layout;
  else {
    const i = state.saved.findIndex((e) => e.name === name);
    if (i >= 0) state.saved[i] = { name, layout };
    else if (state.saved.length >= MAX_SAVED_LAYOUTS) return false;
    else state.saved.push({ name, layout });
  }
  storage.state.set(LAYOUTS_KEY, state);
  return true;
}

export function deleteLayout(storage: ServerStorage, name: string): boolean {
  const state = readLayouts(storage);
  const kept = state.saved.filter((e) => e.name !== name);
  if (kept.length === state.saved.length) return false;
  storage.state.set(LAYOUTS_KEY, { ...state, saved: kept });
  return true;
}

// ---------------------------------------------------------------------------
// Réserve de clés par fournisseur (ADR 0052, point 6) : valeurs dans le coffre, état dans `pool.<p>`.
// ---------------------------------------------------------------------------

export const readPool = (storage: ServerStorage, provider: PoolProvider): PoolState =>
  parsePool(storage.state.get(poolStateKey(provider)));

export const writePool = (storage: ServerStorage, provider: PoolProvider, pool: PoolState): void =>
  storage.state.set(poolStateKey(provider), pool);

/** Ajoute une clé (en dernier dans l'ordre). Renvoie son identifiant, ou `null` si le plafond est atteint. */
export async function addPoolKey(
  storage: ServerStorage,
  provider: PoolProvider,
  label: string,
  value: string,
  now: number,
): Promise<string | null> {
  if (readPool(storage, provider).order.length >= MAX_POOL_KEYS) return null;
  const id = randomUUID();
  await storage.secrets.set(poolSecretKey(provider, id), value);
  // Lecture et écriture de l'état sans intercalage : deux ajouts concurrents ne s'écrasent pas.
  const pool = readPool(storage, provider);
  if (pool.order.length >= MAX_POOL_KEYS) {
    await storage.secrets.delete(poolSecretKey(provider, id));
    return null;
  }
  pool.keys[id] = { label, state: "ok", since: now, retryAt: null };
  pool.order.push(id);
  pool.active ??= id;
  writePool(storage, provider, pool);
  return id;
}

export async function removePoolKey(
  storage: ServerStorage,
  provider: PoolProvider,
  id: string,
  now: number,
): Promise<boolean> {
  const pool = readPool(storage, provider);
  if (!(id in pool.keys)) return false;
  delete pool.keys[id];
  pool.order = pool.order.filter((k) => k !== id);
  if (pool.active === id) pool.active = currentKey(pool, now);
  writePool(storage, provider, pool);
  await storage.secrets.delete(poolSecretKey(provider, id));
  return true;
}

/** Nouvel ordre : doit être une permutation exacte des identifiants présents. */
export function reorderPool(
  storage: ServerStorage,
  provider: PoolProvider,
  order: readonly string[],
): boolean {
  const pool = readPool(storage, provider);
  if (order.length !== pool.order.length || new Set(order).size !== order.length) return false;
  if (!order.every((id) => id in pool.keys)) return false;
  pool.order = [...order];
  writePool(storage, provider, pool);
  return true;
}

/** Active une clé à la main : elle redevient `ok` (l'utilisateur sait qu'elle fonctionne). */
export function activatePoolKey(
  storage: ServerStorage,
  provider: PoolProvider,
  id: string,
  now: number,
): boolean {
  const pool = readPool(storage, provider);
  const key = pool.keys[id];
  if (!key) return false;
  pool.keys[id] = { ...key, state: "ok", since: now, retryAt: null };
  pool.active = id;
  writePool(storage, provider, pool);
  return true;
}

/** Clé active d'une réserve non vide : identifiant et valeur (jamais journalisée). `undefined` : pas de réserve. */
export async function activePoolKey(
  storage: ServerStorage,
  provider: PoolProvider,
  now: number,
): Promise<{ id: string; value: string } | undefined> {
  const pool = readPool(storage, provider);
  if (pool.order.length === 0) return undefined;
  const id = currentKey(pool, now);
  if (id === null) return undefined;
  const value = await storage.secrets.get(poolSecretKey(provider, id));
  return value === undefined ? undefined : { id, value };
}
