import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { CodedError } from "../reason.js";

/** Valeur citée : d'où elle vient (citation, URL, date) et si le moteur a pu la recouper. */
export interface Cited<T> {
  value: T;
  quote: string;
  url: string;
  retrievedAt: string;
  verified: boolean;
}

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

const MAX_PATTERNS = 200;
const MAX_PATTERN = 253;
const MAX_QUOTE = 2000;
const MAX_URL = 2048;
const MAX_SUFFIX = 100;
const MAX_RPS = 1000;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const validHost = (host: string, minLabels: number): boolean => {
  if (host.length === 0 || host.length > MAX_PATTERN) return false;
  const labels = host.split(".");
  return labels.length >= minLabels && labels.every((l) => HOST_LABEL.test(l));
};

/** CIDR `adresse/préfixe` : adresse IPv4 ou IPv6 valide, préfixe entier dans la plage de la famille. */
const validCidr = (text: string): boolean => {
  const [addr, prefix, ...rest] = text.split("/");
  if (addr === undefined || prefix === undefined || rest.length > 0) return false;
  const family = isIP(addr);
  if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
};

/**
 * Motif de périmètre valide : hôte (`api.example.com`), joker de sous-domaines (`*.example.com`,
 * au moins deux étiquettes derrière le joker), adresse IP ou CIDR. Casse déjà ramenée en minuscules.
 */
export function isValidScopePattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN) return false;
  if (pattern.includes("/")) return validCidr(pattern);
  if (isIP(pattern) !== 0) return true;
  if (pattern.startsWith("*.")) return validHost(pattern.slice(2), 2);
  return validHost(pattern, 1);
}

const citedBase = {
  quote: z.string().max(MAX_QUOTE),
  url: z
    .string()
    .max(MAX_URL)
    .refine((u) => {
      try {
        const { protocol } = new URL(u);
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    }),
  retrievedAt: z
    .string()
    .max(40)
    .refine((d) => !Number.isNaN(Date.parse(d))),
  verified: z.boolean(),
};

const cited = <V extends z.ZodTypeAny>(value: V) => z.object({ value, ...citedBase }).strict();

const patterns = z
  .array(
    z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .refine(isValidScopePattern),
  )
  .max(MAX_PATTERNS);

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

const sortedUnique = (list: readonly string[]): string[] => [...new Set(list)].sort();

const canonicalCited = <T>(c: Cited<T>, value: unknown) => ({
  value,
  quote: c.quote,
  url: c.url,
  retrievedAt: c.retrievedAt,
  verified: c.verified,
});

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
