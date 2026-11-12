import { randomBytes } from "node:crypto";

/** Marqueur remplacé par le nonce dans le HTML servi. */
export const NONCE_MARKER = "{{nonce}}";

/** Nonce aléatoire (128 bits) pour une réponse. */
export function makeNonce(): string {
  return randomBytes(16).toString("base64");
}

/** Politique CSP stricte (reprise de `logic/html.ts`, adaptée au serveur web). */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** Injecte le nonce dans un HTML (toutes les occurrences du marqueur). */
export function injectNonce(html: string, nonce: string): string {
  return html.split(NONCE_MARKER).join(nonce);
}
