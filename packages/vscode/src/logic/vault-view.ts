import { fingerprint, type Vault, type VaultKeyState } from "@warband/core";

/**
 * Vue d'un coffre pour la webview des réglages (ADR 0056, lot 3). Fonction pure : seuls le rang, le libellé,
 * l'empreinte, l'état et la fin du délai sortent d'ici. Aucun champ `value`, jamais.
 */
export interface VaultEntryView {
  /** Identifiant aléatoire de la clé (UUID). */
  id: string;
  /** Rang 1-based dans le coffre. */
  rank: number;
  label?: string;
  /** Empreinte de la clé (8 caractères hexadécimaux). */
  fingerprint: string;
  state: VaultKeyState;
  /** Fin du délai d'une clé épuisée (ISO). */
  cooldownUntil?: string;
}

export function vaultView(vault: Vault): VaultEntryView[] {
  return vault.keys.map((key, index) => ({
    id: key.id,
    rank: index + 1,
    ...(key.label !== undefined && { label: key.label }),
    fingerprint: fingerprint(key.value),
    state: key.state,
    ...(key.cooldownUntil !== undefined && { cooldownUntil: key.cooldownUntil }),
  }));
}
