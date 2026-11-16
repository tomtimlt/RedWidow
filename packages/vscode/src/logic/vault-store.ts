import {
  CodedError,
  MAX_KEY_VALUE_LENGTH,
  MAX_VAULT_KEYS,
  markFailure as markVaultFailure,
  newKeyId,
  type ProviderFailureKind,
  parseVault,
  type Vault,
  type VaultKey,
  vaultEnvName,
} from "@warband/core";

/**
 * Coffre à clés (ADR 0056, lot 2) : une entrée `SecretStorage` par fournisseur, `warband.vault.<fournisseur>`.
 * Module sans `vscode`. La valeur d'une clé ne sort que par `get`, pour l'environnement d'un moteur enfant
 * (et pour le masquage) : jamais dans un message, un journal, un libellé ni une erreur.
 */

/** Anciennes entrées à clé unique (`extension.ts`) : source de la migration, jamais effacées par elle. */
export const LEGACY_TOKEN_KEY = "warband.token";
export const LEGACY_TOKEN_KIND_KEY = "warband.tokenKind";
export const LEGACY_OPENAI_KEY = "warband.openai.apiKey";

/** Sous-ensemble de `vscode.SecretStorage` utilisé ici. */
export interface SecretsLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface VaultStoreOptions {
  /** Identifiants des fournisseurs OpenCode configurés (relus à chaque appel). Absent : aucun. */
  opencodeProviders?: () => Iterable<string>;
  /** Le fournisseur OpenCode (Zen intégré, id `opencode`) est-il activé ? Relu à chaque appel. Absent : non. */
  zenEnabled?: () => boolean;
  /** Horloge (défaut : heure courante). */
  now?: () => Date;
}

export interface VaultStore {
  /** Le fournisseur peut-il avoir un coffre ? (`claude`, `openai`, ou fournisseur OpenCode configuré au nom valide) */
  supports(provider: string): boolean;
  /** Coffre du fournisseur (vide s'il n'existe pas). Migre l'ancienne clé unique au premier appel. */
  get(provider: string): Promise<Vault>;
  /** Ajoute une clé : `vault.duplicate`, `vault.full` ou `vault.invalid` (valeur vide ou trop longue). */
  add(provider: string, value: string, label?: string): Promise<VaultKey>;
  /** Retire une clé ; `undefined` si l'identifiant est inconnu. Efface aussi l'ancienne entrée de même valeur. */
  remove(provider: string, id: string): Promise<VaultKey | undefined>;
  /** Renomme une clé (libellé vide : retiré). `false` si l'identifiant est inconnu. */
  rename(provider: string, id: string, label: string | undefined): Promise<boolean>;
  /** Déplace une clé d'un rang (`up` : vers le rang 1). `false` si l'identifiant est inconnu ou si la clé est déjà à la borne. */
  reorder(provider: string, id: string, direction: "up" | "down"): Promise<boolean>;
  /** Enregistre un échec de la clé (épuisée ou invalide) et renvoie le coffre mis à jour. */
  markFailure(
    provider: string,
    id: string,
    kind: ProviderFailureKind,
    retryAfterSeconds?: number,
  ): Promise<Vault>;
  /** Vide le coffre du fournisseur et efface l'ancienne entrée correspondante. */
  clear(provider: string): Promise<void>;
  /** Toutes les valeurs de tous les coffres (pour le masquage ; jamais pour l'affichage). */
  allValues(): Promise<string[]>;
  /** Abonnement aux modifications (fournisseur concerné). Renvoie le désabonnement. */
  onChange(listener: (provider: string) => void): () => void;
}

const storageKey = (provider: string) => `warband.vault.${provider}`;

export function createVaultStore(
  secrets: SecretsLike,
  options: VaultStoreOptions = {},
): VaultStore {
  const now = options.now ?? (() => new Date());
  const listeners = new Set<(provider: string) => void>();
  /** File d'écritures par fournisseur : lecture-modification-écriture sans perte en cas d'appels concurrents. */
  const queues = new Map<string, Promise<unknown>>();

  const opencodeIds = (): string[] => [...(options.opencodeProviders?.() ?? [])];

  /** Valide le fournisseur : `claude`, `openai`, ou un fournisseur OpenCode configuré au nom de variable valide. */
  const check = (provider: string): void => {
    vaultEnvName(provider); // `vault.invalid` si l'identifiant ou le nom de variable est refusé
    const zen = provider === "opencode" && options.zenEnabled?.() === true;
    if (provider !== "claude" && provider !== "openai" && !zen && !opencodeIds().includes(provider))
      throw new CodedError("vault.invalid", { field: "provider" });
  };

  const notify = (provider: string): void => {
    for (const listener of [...listeners]) {
      try {
        listener(provider);
      } catch {
        // Un abonné défaillant ne doit pas gêner les autres.
      }
    }
  };

  const legacyValue = async (provider: string): Promise<string | undefined> => {
    if (provider === "openai") return (await secrets.get(LEGACY_OPENAI_KEY)) || undefined;
    if (provider !== "claude") return undefined;
    if ((await secrets.get(LEGACY_TOKEN_KIND_KEY)) !== "api-key") return undefined;
    return (await secrets.get(LEGACY_TOKEN_KEY)) || undefined;
  };

  const persist = async (provider: string, vault: Vault): Promise<void> => {
    await secrets.store(storageKey(provider), JSON.stringify(vault));
  };

  /** Lit le coffre ; sans entrée, migre l'ancienne clé unique (qui reste en place). Idempotent. */
  const read = async (provider: string): Promise<{ vault: Vault; migrated: boolean }> => {
    const raw = await secrets.get(storageKey(provider));
    if (raw !== undefined) return { vault: parseVault(raw), migrated: false };
    const legacy = await legacyValue(provider);
    if (legacy === undefined || legacy.length > MAX_KEY_VALUE_LENGTH)
      return { vault: { keys: [] }, migrated: false };
    const vault: Vault = {
      keys: [{ id: newKeyId(), value: legacy, addedAt: now().toISOString(), state: "active" }],
    };
    await persist(provider, vault);
    return { vault, migrated: true };
  };

  /** Exécute `fn` à son tour dans la file du fournisseur. Une erreur ne bloque pas les suivants. */
  const enqueue = <T>(provider: string, fn: () => Promise<T>): Promise<T> => {
    const previous = queues.get(provider) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    queues.set(provider, tail);
    void tail.then(() => {
      if (queues.get(provider) === tail) queues.delete(provider);
    });
    return run;
  };

  /** Lecture-modification-écriture sérialisée ; `change` renvoie le nouveau coffre (ou `null` : inchangé) et le résultat. */
  const mutate = async <T>(
    provider: string,
    change: (vault: Vault) => { vault: Vault | null; result: T },
  ): Promise<T> => {
    check(provider);
    return enqueue(provider, async () => {
      const { vault, migrated } = await read(provider);
      const { vault: next, result } = change(vault);
      if (next !== null) await persist(provider, next);
      if (next !== null || migrated) notify(provider);
      return result;
    });
  };

  const eraseLegacy = async (provider: string, value: string): Promise<void> => {
    if (provider === "openai") {
      if ((await secrets.get(LEGACY_OPENAI_KEY)) === value) await secrets.delete(LEGACY_OPENAI_KEY);
    } else if (provider === "claude") {
      if (
        (await secrets.get(LEGACY_TOKEN_KIND_KEY)) === "api-key" &&
        (await secrets.get(LEGACY_TOKEN_KEY)) === value
      ) {
        await secrets.delete(LEGACY_TOKEN_KEY);
        await secrets.delete(LEGACY_TOKEN_KIND_KEY);
      }
    }
  };

  const store: VaultStore = {
    supports(provider) {
      try {
        check(provider);
        return true;
      } catch {
        return false;
      }
    },
    async get(provider) {
      check(provider);
      return enqueue(provider, async () => {
        const { vault, migrated } = await read(provider);
        if (migrated) notify(provider);
        return vault;
      });
    },
    add(provider, value, label) {
      const clean = typeof value === "string" ? value.trim() : "";
      if (clean === "" || clean.length > MAX_KEY_VALUE_LENGTH)
        return Promise.reject(new CodedError("vault.invalid", { field: "value" }));
      const name = label?.trim();
      if (name !== undefined && name.length > 200)
        return Promise.reject(new CodedError("vault.invalid", { field: "label" }));
      return mutate(provider, (vault) => {
        if (vault.keys.some((k) => k.value === clean)) throw new CodedError("vault.duplicate");
        if (vault.keys.length >= MAX_VAULT_KEYS) throw new CodedError("vault.full");
        const key: VaultKey = {
          id: newKeyId(),
          ...(name !== undefined && name !== "" && { label: name }),
          value: clean,
          addedAt: now().toISOString(),
          state: "active",
        };
        return { vault: { keys: [...vault.keys, key] }, result: key };
      });
    },
    async remove(provider, id) {
      const removed = await mutate(provider, (vault) => {
        const key = vault.keys.find((k) => k.id === id);
        return key === undefined
          ? { vault: null, result: undefined }
          : { vault: { keys: vault.keys.filter((k) => k.id !== id) }, result: key };
      });
      if (removed !== undefined) await eraseLegacy(provider, removed.value);
      return removed;
    },
    rename(provider, id, label) {
      const name = label?.trim();
      if (name !== undefined && name.length > 200)
        return Promise.reject(new CodedError("vault.invalid", { field: "label" }));
      return mutate(provider, (vault) => {
        if (!vault.keys.some((k) => k.id === id)) return { vault: null, result: false };
        return {
          vault: {
            keys: vault.keys.map((k) => {
              if (k.id !== id) return k;
              const { label: _drop, ...rest } = k;
              return name === undefined || name === "" ? rest : { ...rest, label: name };
            }),
          },
          result: true,
        };
      });
    },
    reorder(provider, id, direction) {
      return mutate(provider, (vault) => {
        const from = vault.keys.findIndex((k) => k.id === id);
        const to = direction === "up" ? from - 1 : from + 1;
        const moved = vault.keys[from];
        const other = vault.keys[to];
        if (from < 0 || to < 0 || moved === undefined || other === undefined)
          return { vault: null, result: false };
        const keys = [...vault.keys];
        keys[from] = other;
        keys[to] = moved;
        return { vault: { keys }, result: true };
      });
    },
    markFailure(provider, id, kind, retryAfterSeconds) {
      return mutate(provider, (vault) => {
        const next = markVaultFailure(vault, id, kind, now(), retryAfterSeconds);
        return { vault: kind === "other" ? null : next, result: next };
      });
    },
    async clear(provider) {
      const old = await mutate(provider, (vault) => ({ vault: { keys: [] }, result: vault }));
      for (const key of old.keys) await eraseLegacy(provider, key.value);
    },
    async allValues() {
      const values = new Set<string>();
      for (const provider of ["claude", "openai", ...opencodeIds()]) {
        try {
          for (const key of (await store.get(provider)).keys) values.add(key.value);
        } catch {
          // Coffre illisible ou fournisseur refusé : ses valeurs ne peuvent pas être connues.
        }
      }
      // Zen : masqué même si OpenCode est désactivé (le coffre reste en place), sans migration.
      try {
        const raw = await secrets.get(storageKey("opencode"));
        if (raw !== undefined) for (const key of parseVault(raw).keys) values.add(key.value);
      } catch {
        // Coffre illisible.
      }
      return [...values];
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return store;
}
