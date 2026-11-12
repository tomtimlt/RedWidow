import { appendFile } from "node:fs/promises";

/** Champs qui ne doivent jamais figurer dans une entrée d'audit, même par erreur d'appel. */
const FORBIDDEN = /secret|token|password|value|key/i;

/**
 * Journal d'audit des gestes sensibles du serveur : une ligne JSON par entrée (`audit.jsonl`, 0600).
 * Les clés suspectes (secret, jeton, valeur…) sont retirées avant l'écriture ; une erreur d'écriture
 * est silencieuse (le geste humain est déjà appliqué).
 */
export function createAuditFile(file: string, now: () => Date = () => new Date()) {
  let chain: Promise<void> = Promise.resolve();
  const audit = (entry: Record<string, unknown>): void => {
    const safe: Record<string, unknown> = { ts: now().toISOString() };
    for (const [k, v] of Object.entries(entry)) if (!FORBIDDEN.test(k)) safe[k] = v;
    const line = `${JSON.stringify(safe)}\n`;
    chain = chain.then(() => appendFile(file, line, { mode: 0o600 })).catch(() => undefined);
  };
  return Object.assign(audit, { flush: () => chain });
}
