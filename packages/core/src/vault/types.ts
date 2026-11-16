import { randomUUID } from "node:crypto";
import { CodedError } from "../reason.js";

/** État d'une clé du coffre. */
export type VaultKeyState = "active" | "exhausted" | "invalid";

/** Une clé d'API du coffre. `value` ne quitte jamais l'hôte, sauf vers l'environnement d'un moteur enfant. */
export interface VaultKey {
  /** Identifiant aléatoire (`newKeyId`), jamais dérivé de la valeur. */
  id: string;
  label?: string;
  value: string;
  /** Horodatage ISO d'ajout. */
  addedAt: string;
  state: VaultKeyState;
  /** Fin du délai d'une clé `exhausted` (ISO). */
  cooldownUntil?: string;
}

/** Coffre d'un fournisseur : au plus `MAX_VAULT_KEYS` clés, valeurs distinctes. */
export interface Vault {
  keys: VaultKey[];
}

export const MAX_VAULT_KEYS = 10;
export const MAX_KEY_VALUE_LENGTH = 4096;
const MAX_LABEL_LENGTH = 200;

const STATES: readonly string[] = ["active", "exhausted", "invalid"];

/** Nouvel identifiant de clé : aléatoire, sans lien avec la valeur. */
export function newKeyId(): string {
  return randomUUID();
}

function invalid(field: string): CodedError {
  return new CodedError("vault.invalid", { field });
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Lit le JSON d'un coffre. Strict : toute anomalie lève `vault.invalid` (le paramètre `field` ne contient jamais de valeur de clé). */
export function parseVault(json: string): Vault {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalid("json");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid("vault");
  const list = (raw as { keys?: unknown }).keys;
  if (!Array.isArray(list) || list.length > MAX_VAULT_KEYS) throw invalid("keys");
  const values = new Set<string>();
  const ids = new Set<string>();
  const keys: VaultKey[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw invalid("key");
    const k = item as Record<string, unknown>;
    if (typeof k.id !== "string" || k.id === "" || ids.has(k.id)) throw invalid("id");
    if (typeof k.value !== "string" || k.value === "" || k.value.length > MAX_KEY_VALUE_LENGTH)
      throw invalid("value");
    if (values.has(k.value)) throw invalid("value");
    if (k.label !== undefined && (typeof k.label !== "string" || k.label.length > MAX_LABEL_LENGTH))
      throw invalid("label");
    if (!isIso(k.addedAt)) throw invalid("addedAt");
    if (typeof k.state !== "string" || !STATES.includes(k.state)) throw invalid("state");
    if (k.cooldownUntil !== undefined && !isIso(k.cooldownUntil)) throw invalid("cooldownUntil");
    ids.add(k.id);
    values.add(k.value);
    keys.push({
      id: k.id,
      ...(k.label !== undefined && { label: k.label }),
      value: k.value,
      addedAt: k.addedAt,
      state: k.state as VaultKeyState,
      ...(k.cooldownUntil !== undefined && { cooldownUntil: k.cooldownUntil }),
    });
  }
  return { keys };
}
