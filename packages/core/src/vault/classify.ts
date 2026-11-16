/** Ce que l'on sait d'un échec de fournisseur. */
export interface ProviderFailureInput {
  status?: number;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
  rateLimitStatus?: string;
}

export type ProviderFailureKind = "quota" | "invalidKey" | "other";

const INVALID_CODES = ["authentication_failed", "invalid_api_key", "ProviderAuthError"];
const QUOTA_RE = /insufficient_quota|quota|credit|billing|rate_limit|free usage exceeded/i;

/**
 * Classe un échec. `other` ne provoque jamais de rotation.
 * Ordre : `invalidKey` avant `quota`, sauf pour un 429 (toujours `quota`).
 */
export function classifyProviderFailure(input: ProviderFailureInput): ProviderFailureKind {
  if (input.status === 429) return "quota";
  const invalid =
    input.status === 401 ||
    input.status === 403 ||
    (input.code !== undefined && INVALID_CODES.includes(input.code));
  if (invalid) return "invalidKey";
  if (
    QUOTA_RE.test(input.code ?? "") ||
    QUOTA_RE.test(input.message ?? "") ||
    (input.retryAfterSeconds !== undefined && input.retryAfterSeconds > 60) ||
    input.rateLimitStatus === "rejected"
  )
    return "quota";
  return "other";
}

/** Extrait un délai simple « retry in N s/sec/seconds/min/minutes » d'un message, sinon `undefined`. */
export function parseRetryAfter(message: string): number | undefined {
  const m = /retry (?:in|after) (\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i.exec(
    message,
  );
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return Math.ceil((m[2] ?? "s").toLowerCase().startsWith("m") ? n * 60 : n);
}
