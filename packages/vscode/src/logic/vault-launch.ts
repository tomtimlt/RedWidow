import {
  type AuthMode,
  CodedError,
  classifyProviderFailure,
  type EngineEvent,
  fingerprint,
  type ProviderFailureInput,
  type ProviderFailureKind,
  parseRetryAfter,
  pickKey,
  soonestCooldown,
  type Vault,
  type VaultKey,
  vaultEnvName,
} from "@warband/core";
import type { EngineAuth } from "./controller.js";
import type { VaultStore } from "./vault-store.js";

/**
 * Choix de la clé du coffre au lancement, relevé des échecs et rotation (ADR 0056, lot 2). Module sans
 * `vscode` ni processus : la valeur d'une clé ne sort d'ici que dans `EngineAuth` (environnement de l'enfant).
 */

/** Clé du coffre retenue pour un moteur. L'empreinte attendue reste ICI, côté hôte : le moteur ne la reçoit jamais. */
export interface VaultPick {
  provider: string;
  keyId: string;
  /** Rang 1-based dans le coffre. */
  rank: number;
  /** Nom de la variable portée par l'enfant. */
  name: string;
  /** Empreinte attendue (`fingerprint(valeur)`). */
  fingerprint: string;
}

/** Jeton issu du coffre : l'authentification de l'enfant et la clé retenue. */
export interface VaultChoice {
  auth: EngineAuth;
  mode: AuthMode;
  vault: VaultPick;
}

const rankOf = (vault: Vault, key: VaultKey): number =>
  vault.keys.findIndex((k) => k.id === key.id) + 1;

/** Clé retenue pour `key` dans `vault` (la valeur est dans `auth`, jamais dans `vault`). */
function choiceFor(provider: string, vault: Vault, key: VaultKey): VaultChoice {
  const name = vaultEnvName(provider);
  return {
    auth: { name, value: key.value },
    // Claude et OpenAI exigent la clé (`api-key`) ; un fournisseur OpenCode configuré garde `auto`.
    mode: provider === "claude" || provider === "openai" ? "api-key" : "auto",
    vault: {
      provider,
      keyId: key.id,
      rank: rankOf(vault, key),
      name,
      fingerprint: fingerprint(key.value),
    },
  };
}

export interface PickOptions {
  /** Clé fautive : la suivante est choisie après elle (ordre du coffre, circulaire). */
  afterKeyId?: string;
  /**
   * Lancement d'un moteur : un coffre non vide sans clé active lève `vault.allExhausted`.
   * Sinon (affichage, sondage des modèles) : la première clé est rendue, l'état ne bloque rien.
   */
  launch?: boolean;
}

/**
 * Clé du coffre à passer au moteur : `pickKey(vault, now)`. `null` si le coffre est vide : l'appelant
 * garde le chemin actuel (clé unique ou abonnement, `source: "legacy"`).
 */
export async function pickVaultChoice(
  store: VaultStore,
  provider: string,
  now: Date,
  { afterKeyId, launch = false }: PickOptions = {},
): Promise<VaultChoice | null> {
  const vault = await store.get(provider);
  const first = vault.keys[0];
  if (first === undefined) return null;
  const key = pickKey(vault, now, afterKeyId);
  if (key !== undefined) return choiceFor(provider, vault, key);
  if (!launch) return choiceFor(provider, vault, first);
  const until = soonestCooldown(vault);
  throw new CodedError("vault.allExhausted", until === undefined ? {} : { until });
}

/** Libellé d'affichage d'une clé : rang et empreinte, jamais la valeur. */
export function keyDescription(rank: number, fp: string): string {
  return `${rank} · ${fp}`;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Échec décrit par un événement `error` : paramètres des adaptateurs, ou code de raison connu. */
function fromErrorEvent(event: Extract<EngineEvent, { kind: "error" }>): ProviderFailureInput {
  const params = (event.params ?? {}) as Record<string, unknown>;
  const input: ProviderFailureInput = {};
  const status = num(params.status);
  if (status !== undefined) input.status = status;
  const code =
    text(params.code) ??
    (event.code === "auth.failed"
      ? "authentication_failed"
      : event.code === "provider.authFailed"
        ? "ProviderAuthError"
        : undefined);
  if (code !== undefined) input.code = code;
  const message = text(params.message) ?? text(event.message);
  if (message !== undefined) input.message = message;
  const retry =
    num(params.retryAfterSeconds) ?? (message === undefined ? undefined : parseRetryAfter(message));
  if (retry !== undefined) input.retryAfterSeconds = retry;
  const limit = text(params.rateLimitStatus);
  if (limit !== undefined) input.rateLimitStatus = limit;
  return input;
}

export interface FailureTracker {
  /** Observe un événement du moteur courant. */
  observe(event: EngineEvent): void;
  /** Échec du tour qui vient de finir (le plus parlant : quota ou clé invalide d'abord), puis remise à zéro. */
  take(): ProviderFailureInput | undefined;
}

/**
 * Relevé des derniers événements d'erreur d'un tour : `error` (adaptateurs) et `rate.limited` rejeté.
 * `take` est appelé à la fin d'un tour en échec ; un tour réussi remet le relevé à zéro.
 */
export function createFailureTracker(): FailureTracker {
  let failures: ProviderFailureInput[] = [];
  return {
    observe(event) {
      if (event.kind === "error") failures.push(fromErrorEvent(event));
      else if (event.kind === "rate.limited" && event.status === "rejected") {
        failures.push({ rateLimitStatus: "rejected" });
      } else if (event.kind === "turn.finished" && event.status === "success") failures = [];
    },
    take() {
      const taken = failures;
      failures = [];
      return taken.find((f) => classifyProviderFailure(f) !== "other") ?? taken[taken.length - 1];
    },
  };
}

/** Issue d'un échec classé. */
export type RotationOutcome =
  | { kind: "none" }
  | {
      kind: "rotated";
      cause: Exclude<ProviderFailureKind, "other">;
      /** Charge de l'événement `vault.rotated` (rangs et empreintes, jamais de valeur). */
      event: VaultRotatedPayload;
    }
  | {
      kind: "exhausted";
      cause: Exclude<ProviderFailureKind, "other">;
      event: VaultRotatedPayload;
      /** Fin du plus court délai (ISO), s'il y en a un. */
      until?: string;
    };

export interface VaultRotatedPayload {
  kind: "vault.rotated";
  provider: string;
  fromRank: number;
  fromFingerprint: string;
  toRank?: number;
  toFingerprint?: string;
  cause: "quota" | "invalidKey";
}

/**
 * Après l'échec de la clé `pick` : classe l'échec ; sur `quota` ou `invalidKey` persiste l'état de la clé
 * (`markFailure`), puis indique s'il reste une clé. `other` ne change rien (aucune rotation).
 */
export async function rotateAfterFailure(
  store: VaultStore,
  pick: VaultPick,
  failure: ProviderFailureInput,
  now: Date,
): Promise<RotationOutcome> {
  const kind = classifyProviderFailure(failure);
  if (kind === "other") return { kind: "none" };
  const retry =
    failure.retryAfterSeconds ??
    (failure.message === undefined ? undefined : parseRetryAfter(failure.message));
  const vault = await store.markFailure(pick.provider, pick.keyId, kind, retry);
  const next = pickKey(vault, now, pick.keyId);
  const event: VaultRotatedPayload = {
    kind: "vault.rotated",
    provider: pick.provider,
    fromRank: pick.rank,
    fromFingerprint: pick.fingerprint,
    ...(next !== undefined && {
      toRank: rankOf(vault, next),
      toFingerprint: fingerprint(next.value),
    }),
    cause: kind,
  };
  if (next !== undefined) return { kind: "rotated", cause: kind, event };
  const until = soonestCooldown(vault);
  return { kind: "exhausted", cause: kind, event, ...(until !== undefined && { until }) };
}

/** Consigne de reprise quand la session existe déjà : le tour échoué est repris, sans rejouer la consigne. */
export const ROTATION_RESUME_PROMPT =
  "La clé d'API vient d'être changée après un échec du fournisseur : reprends le tour précédent là où il s'est arrêté.";

/**
 * Garde de clé : compare l'empreinte annoncée par le moteur (`provider.key`) à celle que l'hôte attend.
 * `true` : le moteur utilise une autre clé que celle choisie, il faut l'arrêter (`vault.keyMismatch`).
 */
/**
 * Événements qui prouvent que le moteur travaille déjà : avec une clé du coffre, ils ne doivent jamais
 * précéder une annonce `provider.key` conforme (échec fermé si le moteur n'annonce rien).
 */
const KEY_REQUIRED_BEFORE = new Set<EngineEvent["kind"]>([
  "session.started",
  "agent.text",
  "agent.thinking",
  "tool.requested",
  "approval.decided",
]);

/**
 * Garde de clé avec état : `observe(event)` vaut `true` s'il faut arrêter le moteur, soit parce que
 * l'empreinte annoncée diffère, soit parce que le moteur agit avant d'avoir annoncé une clé conforme.
 * Sans empreinte attendue (clé hors coffre), la garde ne refuse rien.
 */
export function createKeyGuard(expected: string | undefined): {
  observe(event: EngineEvent): boolean;
} {
  let confirmed = false;
  return {
    observe(event) {
      if (expected === undefined) return false;
      if (event.kind === "provider.key") {
        confirmed = event.fingerprint === expected;
        return !confirmed;
      }
      return !confirmed && KEY_REQUIRED_BEFORE.has(event.kind);
    },
  };
}

export function keyMismatch(expected: string | undefined, event: EngineEvent): boolean {
  if (event.kind !== "provider.key") return false;
  return expected !== undefined && event.fingerprint !== expected;
}
