import type { ProviderFailureKind } from "./classify.js";
import type { Vault, VaultKey } from "./types.js";

/** Délai par défaut d'une clé épuisée sans retry annoncé. */
export const DEFAULT_COOLDOWN_SECONDS = 3600;

function cooldownPassed(key: VaultKey, now: Date): boolean {
  return (
    key.state === "exhausted" &&
    key.cooldownUntil !== undefined &&
    Date.parse(key.cooldownUntil) <= now.getTime()
  );
}

/** Coffre vu à l'instant `now` : une clé épuisée dont le délai est passé redevient active. */
export function activeKeys(vault: Vault, now: Date): Vault {
  return {
    keys: vault.keys.map((key) => {
      if (!cooldownPassed(key, now)) return { ...key };
      const { cooldownUntil: _drop, ...rest } = key;
      return { ...rest, state: "active" as const };
    }),
  };
}

/** Première clé active après `afterId` (circulaire, `afterId` lui-même en dernier), ou `undefined`. */
export function pickKey(vault: Vault, now: Date, afterId?: string): VaultKey | undefined {
  const keys = activeKeys(vault, now).keys;
  const at = afterId === undefined ? -1 : keys.findIndex((k) => k.id === afterId);
  for (let i = 1; i <= keys.length; i++) {
    const key = keys[(at + i + keys.length) % keys.length];
    if (key?.state === "active") return key;
  }
  return undefined;
}

/** Enregistre un échec : `quota` → exhausted + délai, `invalidKey` → invalid, `other` → rien. */
export function markFailure(
  vault: Vault,
  keyId: string,
  kind: ProviderFailureKind,
  now: Date,
  retryAfterSeconds?: number,
): Vault {
  if (kind === "other") return { keys: vault.keys.map((k) => ({ ...k })) };
  return {
    keys: vault.keys.map((key) => {
      if (key.id !== keyId) return { ...key };
      const { cooldownUntil: _drop, ...rest } = key;
      if (kind === "invalidKey") return { ...rest, state: "invalid" as const };
      const seconds =
        retryAfterSeconds !== undefined && retryAfterSeconds > 0
          ? retryAfterSeconds
          : DEFAULT_COOLDOWN_SECONDS;
      return {
        ...rest,
        state: "exhausted" as const,
        cooldownUntil: new Date(now.getTime() + seconds * 1000).toISOString(),
      };
    }),
  };
}

/** Fin (ISO) du plus court délai parmi les clés épuisées, ou `undefined`. */
export function soonestCooldown(vault: Vault): string | undefined {
  let best: string | undefined;
  for (const key of vault.keys) {
    if (key.state !== "exhausted" || key.cooldownUntil === undefined) continue;
    if (best === undefined || Date.parse(key.cooldownUntil) < Date.parse(best))
      best = key.cooldownUntil;
  }
  return best;
}

export interface RotationPlan {
  vault: Vault;
  next?: VaultKey;
  /** Aucune clé active : le run échoue en `vault.allExhausted`. */
  exhausted: boolean;
  soonest?: string;
}

/** Plan de rotation après l'échec de `failedKeyId`. Un échec `other` ne change rien et ne propose pas de clé. */
export function planRotation(
  vault: Vault,
  now: Date,
  failedKeyId: string,
  failure: { kind: ProviderFailureKind; retryAfterSeconds?: number },
): RotationPlan {
  if (failure.kind === "other")
    return { vault: markFailure(vault, failedKeyId, "other", now), exhausted: false };
  const marked = markFailure(vault, failedKeyId, failure.kind, now, failure.retryAfterSeconds);
  const next = pickKey(marked, now, failedKeyId);
  const result: RotationPlan = { vault: marked, exhausted: next === undefined };
  if (next) result.next = next;
  else {
    const soonest = soonestCooldown(marked);
    if (soonest !== undefined) result.soonest = soonest;
  }
  return result;
}
