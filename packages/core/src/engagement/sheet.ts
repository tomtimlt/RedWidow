import { createHash } from "node:crypto";
import { z } from "zod";
import { type Cited, canonicalCited, cited, patterns, sortedUnique } from "../program/cited.js";
import { CodedError } from "../reason.js";

/** Autorisation nommée : qui mandate l'engagement, sous quelle référence, signé par qui. */
export interface EngagementAuthorization {
  principal: string;
  reference: string;
  signatory: string;
}

/** Fenêtre d'engagement : texte libre (dates, horaires) et bornes ISO facultatives. */
export interface EngagementWindow {
  text: string;
  notBefore?: string;
  notAfter?: string;
}

/** Contact de la white team et procédure de déconfliction. */
export interface EngagementWhiteTeam {
  contact: string;
  deconfliction: string;
  text?: string;
}

/**
 * Fiche d'engagement red team d'un projet (ADR 0041) : variante de la fiche programme.
 * Donnée, jamais une autorisation : elle ne s'applique qu'après approbation de son empreinte.
 * `infrastructure` (hôtes que l'agent peut administrer) reste distincte de `inScope` (cibles).
 */
export interface EngagementSheet {
  version: 1;
  authorization: Cited<EngagementAuthorization>;
  window: Cited<EngagementWindow>;
  inScope: Cited<string[]>;
  infrastructure: Cited<string[]>;
  outOfScope: Cited<string[]>;
  /** Techniques permises/interdites, systèmes critiques intouchables, données à ne jamais extraire. */
  rulesOfEngagement: Cited<string>;
  whiteTeam: Cited<EngagementWhiteTeam>;
  /** Rôles et informations professionnelles publiques seulement ; vie privée exclue ; minimisation. */
  osintPolicy: Cited<string>;
}

const MAX_SHORT = 500;
const MAX_TEXT = 8000;

const short = z.string().trim().min(1).max(MAX_SHORT);
const text = z.string().trim().min(1).max(MAX_TEXT);
const isoDate = z
  .string()
  .max(40)
  .refine((d) => !Number.isNaN(Date.parse(d)));

const authorization = z.object({ principal: short, reference: short, signatory: short }).strict();

const window = z
  .object({ text, notBefore: isoDate.optional(), notAfter: isoDate.optional() })
  .strict()
  .refine(
    (w) =>
      w.notBefore === undefined ||
      w.notAfter === undefined ||
      Date.parse(w.notBefore) <= Date.parse(w.notAfter),
  );

const whiteTeam = z.object({ contact: short, deconfliction: text, text: text.optional() }).strict();

export const engagementSheetSchema = z
  .object({
    version: z.literal(1),
    authorization: cited(authorization),
    window: cited(window),
    inScope: cited(patterns),
    infrastructure: cited(patterns),
    outOfScope: cited(patterns),
    rulesOfEngagement: cited(text),
    whiteTeam: cited(whiteTeam),
    osintPolicy: cited(text),
  })
  .strict()
  .superRefine((sheet, ctx) => {
    // Infrastructure et cibles sont distinctes : un même motif ne peut figurer dans les deux.
    const targets = new Set(sheet.inScope.value);
    if (sheet.infrastructure.value.some((p) => targets.has(p)))
      ctx.addIssue({ code: "custom", path: ["infrastructure", "value"] });
  });

/**
 * Valide une fiche brute (JSON déjà analysé). Motifs normalisés (minuscules, sans espaces autour).
 * Fiche invalide → `engagement.invalid` (chemin du premier champ fautif en paramètre).
 */
export function parseEngagementSheet(raw: unknown): EngagementSheet {
  const parsed = engagementSheetSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new CodedError("engagement.invalid", { field: path });
  }
  return parsed.data as EngagementSheet;
}

/**
 * Forme canonique : ordre des clés fixe, listes triées et dédoublonnées, sans mise en forme.
 * Deux fiches de même sens ont le même texte canonique, donc la même empreinte.
 */
export function canonicalEngagement(sheet: EngagementSheet): string {
  const a = sheet.authorization.value;
  const w = sheet.window.value;
  const t = sheet.whiteTeam.value;
  return JSON.stringify({
    version: 1,
    authorization: canonicalCited(sheet.authorization, {
      principal: a.principal,
      reference: a.reference,
      signatory: a.signatory,
    }),
    window: canonicalCited(sheet.window, {
      text: w.text,
      ...(w.notBefore !== undefined && { notBefore: w.notBefore }),
      ...(w.notAfter !== undefined && { notAfter: w.notAfter }),
    }),
    inScope: canonicalCited(sheet.inScope, sortedUnique(sheet.inScope.value)),
    infrastructure: canonicalCited(sheet.infrastructure, sortedUnique(sheet.infrastructure.value)),
    outOfScope: canonicalCited(sheet.outOfScope, sortedUnique(sheet.outOfScope.value)),
    rulesOfEngagement: canonicalCited(sheet.rulesOfEngagement, sheet.rulesOfEngagement.value),
    whiteTeam: canonicalCited(sheet.whiteTeam, {
      contact: t.contact,
      deconfliction: t.deconfliction,
      ...(t.text !== undefined && { text: t.text }),
    }),
    osintPolicy: canonicalCited(sheet.osintPolicy, sheet.osintPolicy.value),
  });
}

/** Empreinte SHA-256 (hexadécimal) de la forme canonique. */
export function engagementDigest(sheet: EngagementSheet): string {
  return createHash("sha256").update(canonicalEngagement(sheet)).digest("hex");
}
