import { z } from "zod";

/** Nom complet de l'outil d'agent qui enregistre un identifiant découvert dans le coffre de l'hôte. */
export const CREDENTIAL_TOOL = "mcp__desk__store_credential";

export const CREDENTIAL_KINDS = ["password", "token", "apiKey", "cookie"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/**
 * Entrée de l'outil `store_credential`. Le libellé suit celui des comptes de test (`testAccountSchema`) :
 * un libellé hors de ce format ferait rejeter toute la liste de comptes passée au moteur.
 */
export const credentialInputShape = {
  label: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/),
  login: z
    .string()
    .max(512)
    .refine((value) => !value.includes("\0"))
    .optional(),
  secret: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !value.includes("\0")),
  kind: z.enum(CREDENTIAL_KINDS),
  programme: z.string().min(1).max(200).optional(),
};
export const credentialInputSchema = z.object(credentialInputShape).strict();
export type CredentialInput = z.infer<typeof credentialInputSchema>;

/** Réponse de l'hôte : jamais de valeur secrète, seulement l'identifiant du compte créé. */
export interface CredentialResult {
  ok: boolean;
  id?: string;
}

/** Port fourni par l'hôte (via le moteur) : enregistre l'identifiant dans son coffre chiffré. */
export type CredentialStore = (input: CredentialInput) => Promise<CredentialResult>;
