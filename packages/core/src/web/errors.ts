import { CodedError } from "../reason.js";

const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"]);
const TLS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const TIMEOUT = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const CONNECTION = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EACCES",
  "EPERM",
  "UND_ERR_SOCKET",
  "UND_ERR_PRX_TLS",
]);

/** Inspecte les codes structurés, jamais le message brut ou une URL de proxy. */
export function webNetworkError(error: unknown, timedOut = false): CodedError {
  if (timedOut) return new CodedError("web.timeout", { seconds: 25 });
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  let connection: string | undefined;
  let timeout = false;
  for (let index = 0; index < pending.length && index < 16; index++) {
    const item = pending[index];
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const node = item as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    const code = typeof node.code === "string" ? node.code : "";
    if (TLS.has(code)) return new CodedError("web.tlsFailed", { code });
    if (DNS.has(code)) return new CodedError("web.dnsFailed", { code });
    if (TIMEOUT.has(code) || node.name === "TimeoutError") timeout = true;
    if (CONNECTION.has(code)) connection = code;
    if (node.cause !== undefined) pending.push(node.cause);
    if (Array.isArray(node.errors)) pending.push(...node.errors.slice(0, 8));
  }
  if (timeout) return new CodedError("web.timeout", { seconds: 25 });
  if (connection) return new CodedError("web.connectionFailed", { code: connection });
  return new CodedError("web.unavailable");
}
