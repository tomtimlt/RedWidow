import { CodedError } from "../reason.js";

/** Fournisseurs à variable fixe. */
const FIXED_ENV: Readonly<Record<string, string>> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Nom de variable admis pour la clé d'un fournisseur OpenCode configuré (ADR 0005, §4 ; ADR 0056). */
export const VAULT_ENV_NAME = /^[A-Z][A-Z0-9_]*_(API_KEY|TOKEN)$/;

/** Identifiant de fournisseur du coffre : minuscules, chiffres, `_` et `-`, 64 caractères au plus. */
export const VAULT_PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Variable d'environnement qui porte la clé du fournisseur dans l'enfant : `ANTHROPIC_API_KEY` (claude),
 * `OPENAI_API_KEY` (openai), sinon `<ID_EN_MAJUSCULES>_API_KEY` (les `-` de l'identifiant deviennent `_`).
 * Lève `vault.invalid` si l'identifiant ou le nom obtenu est invalide : le coffre du fournisseur est refusé.
 */
export function vaultEnvName(provider: string): string {
  if (typeof provider !== "string" || !VAULT_PROVIDER_ID.test(provider))
    throw new CodedError("vault.invalid", { field: "provider" });
  const fixed = FIXED_ENV[provider];
  if (fixed !== undefined) return fixed;
  const name = `${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`;
  if (!VAULT_ENV_NAME.test(name)) throw new CodedError("vault.invalid", { field: "provider" });
  return name;
}
