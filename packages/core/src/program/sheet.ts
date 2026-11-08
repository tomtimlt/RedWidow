import { createHash } from "node:crypto";
import { z } from "zod";
import { CodedError } from "../reason.js";
import { type Cited, canonicalCited, cited, patterns, sortedUnique } from "./cited.js";

export { type Cited, isValidScopePattern } from "./cited.js";

/** Rythme : un préréglage nommé, ou un plafond explicite de requêtes par seconde. */
export type ProgramPace =
  | { preset: "fast" | "normal" | "careful" }
  | { maxRequestsPerSecond: number };

/**
 * Fiche programme d'un projet (ADR 0040) : périmètre, suffixe User-Agent, rythme.
 * Donnée, jamais une autorisation : elle ne s'applique qu'après approbation de son empreinte.
 */
export interface ProgramSheet {
  version: 1;
  inScope: Cited<string[]>;
  outOfScope: Cited<string[]>;
  userAgentSuffix?: Cited<string>;
  pace: Cited<ProgramPace>;
}

const MAX_SUFFIX = 100;
const MAX_RPS = 1000;

/** En-tête HTTP : ASCII imprimable seulement (pas de CR/LF, pas de NUL). */
const suffix = z
  .string()
  .min(1)
  .max(MAX_SUFFIX)
  .regex(/^[\x20-\x7e]+$/);

const pace = z.union([
  z.object({ preset: z.enum(["fast", "normal", "careful"]) }).strict(),
  z.object({ maxRequestsPerSecond: z.number().positive().max(MAX_RPS) }).strict(),
]);

export const programSheetSchema = z
  .object({
    version: z.literal(1),
    inScope: cited(patterns),
    outOfScope: cited(patterns),
    userAgentSuffix: cited(suffix).optional(),
    pace: cited(pace),
  })
  .strict();

/**
 * Valide une fiche brute (JSON déjà analysé). Motifs normalisés (minuscules, sans espaces autour).
 * Fiche invalide → `program.invalid` (chemin du premier champ fautif en paramètre).
 */
export function parseProgramSheet(raw: unknown): ProgramSheet {
  const parsed = programSheetSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new CodedError("program.invalid", { field: path });
  }
  return parsed.data as ProgramSheet;
}

/**
 * Forme canonique : ordre des clés fixe, listes triées et dédoublonnées, sans mise en forme.
 * Deux fiches de même sens ont le même texte canonique, donc la même empreinte.
 */
export function canonicalProgram(sheet: ProgramSheet): string {
  const p = sheet.pace.value;
  const pacePart =
    "preset" in p ? { preset: p.preset } : { maxRequestsPerSecond: p.maxRequestsPerSecond };
  return JSON.stringify({
    version: 1,
    inScope: canonicalCited(sheet.inScope, sortedUnique(sheet.inScope.value)),
    outOfScope: canonicalCited(sheet.outOfScope, sortedUnique(sheet.outOfScope.value)),
    ...(sheet.userAgentSuffix && {
      userAgentSuffix: canonicalCited(sheet.userAgentSuffix, sheet.userAgentSuffix.value),
    }),
    pace: canonicalCited(sheet.pace, pacePart),
  });
}

/** Empreinte SHA-256 (hexadécimal) de la forme canonique. */
export function programDigest(sheet: ProgramSheet): string {
  return createHash("sha256").update(canonicalProgram(sheet)).digest("hex");
}
