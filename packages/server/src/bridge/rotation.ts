/**
 * Réserve de clés par fournisseur et bascule automatique quand la limite est atteinte (ADR 0052,
 * point 6). Ce module est pur : état sérialisable, classement des événements du moteur, choix de la
 * clé suivante. Les valeurs des clés vivent dans le coffre (`pool.<fournisseur>.<id>`) et ne passent
 * jamais ici : seuls des identifiants et des libellés sont manipulés.
 */
import type { EngineEvent } from "@warband/core";

/** Fournisseurs admis pour une réserve (backends du chat). */
export const POOL_PROVIDERS = ["claude", "openai", "opencode"] as const;
export type PoolProvider = (typeof POOL_PROVIDERS)[number];
export const isPoolProvider = (v: unknown): v is PoolProvider =>
  typeof v === "string" && (POOL_PROVIDERS as readonly string[]).includes(v);

export type KeyState = "ok" | "exhausted" | "invalid";
export type RotationReason = "quota" | "rateLimit" | "auth";

export interface PoolKey {
  label: string;
  state: KeyState;
  /** Instant (ms) du dernier changement d'état. */
  since: number;
  /** Instant (ms) à partir duquel une clé épuisée est de nouveau essayée ; `null` : inconnu. */
  retryAt: number | null;
}

export interface PoolState {
  order: string[];
  active: string | null;
  keys: Record<string, PoolKey>;
}

export const MAX_POOL_KEYS = 16;
export const QUOTA_RETRY_MS = 24 * 3_600_000;
export const RATE_LIMIT_RETRY_MS = 3_600_000;
/** Texte envoyé à la reprise de la mission, après la bascule. */
export const RESUME_TEXT = "Reprends la tâche là où elle s'est arrêtée.";

/** Clé d'état et clé du coffre. L'identifiant d'une clé est un UUID généré par le serveur. */
export const poolStateKey = (provider: string): string => `pool.${provider}`;
export const poolSecretKey = (provider: string, id: string): string => `pool.${provider}.${id}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const emptyPool = (): PoolState => ({ order: [], active: null, keys: {} });

/** Relit l'état persistant en l'assainissant : tout ce qui est incohérent est écarté. */
export function parsePool(raw: unknown): PoolState {
  if (!isRecord(raw) || !isRecord(raw.keys) || !Array.isArray(raw.order)) return emptyPool();
  const keys: Record<string, PoolKey> = {};
  for (const [id, k] of Object.entries(raw.keys)) {
    if (!isRecord(k) || typeof k.label !== "string") continue;
    keys[id] = {
      label: k.label,
      state: k.state === "exhausted" || k.state === "invalid" ? k.state : "ok",
      since: typeof k.since === "number" ? k.since : 0,
      retryAt: typeof k.retryAt === "number" ? k.retryAt : null,
    };
  }
  const order = [...new Set(raw.order.filter((id): id is string => typeof id === "string"))].filter(
    (id) => id in keys,
  );
  for (const id of Object.keys(keys)) if (!order.includes(id)) order.push(id);
  const active = typeof raw.active === "string" && raw.active in keys ? raw.active : null;
  return { order, active, keys };
}

/** Une clé est utilisable si elle est `ok`, ou épuisée dont l'échéance est passée. Jamais une clé invalide. */
export function usable(key: PoolKey, now: number): boolean {
  if (key.state === "ok") return true;
  return key.state === "exhausted" && key.retryAt !== null && key.retryAt <= now;
}

/** Clé à utiliser maintenant : l'active si elle est utilisable, sinon la première utilisable dans l'ordre. */
export function currentKey(pool: PoolState, now: number): string | null {
  const active = pool.active === null ? undefined : pool.keys[pool.active];
  if (pool.active !== null && active && usable(active, now)) return pool.active;
  return pool.order.find((id) => usable(pool.keys[id] as PoolKey, now)) ?? null;
}

/** Clé suivante dans l'ordre (circulaire, après `from`), hors `exclude`, utilisable. `null` : réserve épuisée. */
export function nextKey(
  pool: PoolState,
  from: string | null,
  now: number,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  const n = pool.order.length;
  const start = from === null ? -1 : pool.order.indexOf(from);
  for (let i = 1; i <= n; i++) {
    const id = pool.order[(start + i + n) % n];
    if (id === undefined || exclude.has(id)) continue;
    const key = pool.keys[id];
    if (key && usable(key, now)) return id;
  }
  return null;
}

/** Marque une clé (épuisée ou invalide) ; l'échéance d'une clé invalide n'a pas de sens (`null`). */
export function markKey(
  pool: PoolState,
  id: string,
  reason: RotationReason,
  retryAt: number | null,
  now: number,
): PoolState {
  const key = pool.keys[id];
  if (!key) return pool;
  const state: KeyState = reason === "auth" ? "invalid" : "exhausted";
  return {
    ...pool,
    keys: {
      ...pool.keys,
      [id]: { ...key, state, since: now, retryAt: state === "invalid" ? null : retryAt },
    },
  };
}

/** Plus tôt des échéances des clés épuisées ; `null` si aucune n'est connue. */
export function nextRetryAt(pool: PoolState): number | null {
  const times = Object.values(pool.keys)
    .filter((k) => k.state === "exhausted" && k.retryAt !== null)
    .map((k) => k.retryAt as number);
  return times.length ? Math.min(...times) : null;
}

export interface Limit {
  reason: RotationReason;
  retryAt: number | null;
}

/**
 * Limite ou échec d'authentification signalé par un événement du moteur, sinon `null`.
 * Quota gratuit : nouvel essai après 24 h ; 429 et délai annoncé : 1 h, ou l'instant donné par le
 * moteur (`resetsAt`, en secondes comme en millisecondes).
 */
export function classifyEvent(
  event: Pick<EngineEvent, "kind"> & object,
  now: number,
): Limit | null {
  const e = event as Record<string, unknown>;
  if (e.kind === "rate.limited") {
    if (e.status !== "rejected") return null;
    const at = typeof e.resetsAt === "number" ? e.resetsAt : undefined;
    // Les secondes Unix (< 1e11) sont converties ; une échéance passée ne vaut rien.
    const ms = at === undefined ? undefined : at < 1e11 ? at * 1000 : at;
    return {
      reason: "rateLimit",
      retryAt: ms !== undefined && ms > now ? ms : now + RATE_LIMIT_RETRY_MS,
    };
  }
  if (e.kind !== "error") return null;
  if (e.code === "provider.authFailed") return { reason: "auth", retryAt: null };
  if (e.code !== "provider.error") return null;
  const params = isRecord(e.params) ? e.params : {};
  if (params.name === "QuotaExceeded") return { reason: "quota", retryAt: now + QUOTA_RETRY_MS };
  if (params.name === "RetryDelayed" || params.status === 429)
    return { reason: "rateLimit", retryAt: now + RATE_LIMIT_RETRY_MS };
  return null;
}

/** Vue publique d'une réserve : jamais de valeur. */
export function publicPool(provider: string, pool: PoolState) {
  return {
    provider,
    active: pool.active,
    keys: pool.order.map((id) => {
      const k = pool.keys[id] as PoolKey;
      return { id, label: k.label, state: k.state, retryAt: k.retryAt };
    }),
  };
}
