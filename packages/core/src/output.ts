/** Plafond par défaut du texte complet d'un `tool.result` (octets UTF-8). */
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;

export interface CappedOutput {
  output: string;
  truncated: boolean;
  /** Taille d'origine, en octets UTF-8. */
  bytes: number;
}

/**
 * Plafonne un texte à `maxBytes` octets UTF-8 sans couper un caractère en deux.
 * À appliquer AVANT le recorder : le masquage des secrets s'exécute ensuite sur
 * le texte coupé.
 */
export function capOutput(text: string, maxBytes = DEFAULT_MAX_RESULT_BYTES): CappedOutput {
  const buffer = Buffer.from(text, "utf8");
  const bytes = buffer.length;
  if (bytes <= maxBytes) return { output: text, truncated: false, bytes };
  let end = maxBytes;
  // Recule jusqu'au début d'un caractère (octets de continuation 10xxxxxx).
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
  return { output: buffer.subarray(0, end).toString("utf8"), truncated: true, bytes };
}
