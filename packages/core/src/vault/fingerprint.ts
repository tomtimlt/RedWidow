import { createHash } from "node:crypto";

/** Empreinte d'une clé : 8 premiers caractères hexadécimaux de `sha256(value)`. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Étiquette structurée d'une clé (le texte d'affichage appartient aux interfaces). */
export interface KeyLabel {
  /** Rang 1-based dans le coffre. */
  rank: number;
  fingerprint: string;
}

export function keyLabel(rank: number, fp: string): KeyLabel {
  return { rank, fingerprint: fp };
}
