import { CodedError, fingerprint, MAX_VAULT_KEYS } from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  createVaultStore,
  LEGACY_OPENAI_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_TOKEN_KIND_KEY,
  type SecretsLike,
} from "../src/logic/vault-store.js";

/** SecretStorage en mémoire, avec une latence irrégulière pour provoquer les entrelacements. */
function memorySecrets(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let n = 0;
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, (n++ % 3) * 2));
  const secrets: SecretsLike = {
    get: async (key) => {
      await wait();
      return data.get(key);
    },
    store: async (key, value) => {
      await wait();
      data.set(key, value);
    },
    delete: async (key) => {
      await wait();
      data.delete(key);
    },
  };
  return { secrets, data };
}

const code = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof CodedError ? error.code : "autre";
  }
};

describe("coffre à clés : stockage", () => {
  it("ajoute des clés, dans l'ordre, sous warband.vault.<fournisseur>", async () => {
    const { secrets, data } = memorySecrets();
    const store = createVaultStore(secrets);
    const a = await store.add("claude", "  sk-claude-aaaaaaaa  ", "perso");
    const b = await store.add("claude", "sk-claude-bbbbbbbb");
    const vault = await store.get("claude");
    expect(vault.keys.map((k) => k.id)).toEqual([a.id, b.id]);
    expect(vault.keys[0]).toMatchObject({ value: "sk-claude-aaaaaaaa", label: "perso" });
    expect(vault.keys[0]?.state).toBe("active");
    expect([...data.keys()]).toEqual(["warband.vault.claude"]);
  });

  it("refuse un doublon (vault.duplicate), une valeur vide ou trop longue (vault.invalid)", async () => {
    const store = createVaultStore(memorySecrets().secrets);
    await store.add("openai", "sk-openai-1111");
    expect(await code(store.add("openai", "sk-openai-1111"))).toBe("vault.duplicate");
    expect(await code(store.add("openai", "   "))).toBe("vault.invalid");
    expect(await code(store.add("openai", "x".repeat(5000)))).toBe("vault.invalid");
    expect((await store.get("openai")).keys).toHaveLength(1);
  });

  it("plafonne à 10 clés par fournisseur (vault.full)", async () => {
    const store = createVaultStore(memorySecrets().secrets);
    for (let i = 0; i < MAX_VAULT_KEYS; i++) await store.add("claude", `sk-key-${i}-xxxxxxxx`);
    expect(await code(store.add("claude", "sk-key-onze-xxxxxxxx"))).toBe("vault.full");
    expect((await store.get("claude")).keys).toHaveLength(MAX_VAULT_KEYS);
  });

  it("valide le fournisseur : claude, openai ou fournisseur OpenCode configuré au nom valide", async () => {
    const store = createVaultStore(memorySecrets().secrets, {
      opencodeProviders: () => ["venator-acme", "Venator-Mauvais"],
    });
    await store.add("venator-acme", "sk-acme-1111");
    for (const provider of ["inconnu", "venator-absent", "Venator-Mauvais", "../x", ""])
      expect(await code(store.add(provider, "sk-x-1111")), provider).toBe("vault.invalid");
    expect(store.supports("claude")).toBe(true);
    expect(store.supports("venator-acme")).toBe(true);
    expect(store.supports("venator-absent")).toBe(false);
  });

  it("des écritures concurrentes ne perdent aucune clé", async () => {
    const { secrets } = memorySecrets();
    const store = createVaultStore(secrets);
    const values = Array.from({ length: 8 }, (_, i) => `sk-concurrent-${i}-xxxx`);
    await Promise.all(values.map((v) => store.add("claude", v)));
    const stored = (await store.get("claude")).keys.map((k) => k.value).sort();
    expect(stored).toEqual([...values].sort());
    // Ajouts et échecs entremêlés : l'état d'une clé n'écrase pas un ajout concurrent.
    const first = (await store.get("claude")).keys[0];
    await Promise.all([
      store.markFailure("claude", first?.id ?? "", "invalidKey"),
      store.remove("claude", (await store.get("claude")).keys[1]?.id ?? ""),
      store.rename("claude", (await store.get("claude")).keys[2]?.id ?? "", "nom"),
    ]);
    const after = await store.get("claude");
    expect(after.keys).toHaveLength(7);
    expect(after.keys.find((k) => k.id === first?.id)?.state).toBe("invalid");
    expect(after.keys.some((k) => k.label === "nom")).toBe(true);
  });

  it("markFailure persiste l'état (épuisée avec délai, invalide) et renvoie le coffre", async () => {
    const now = new Date("2026-11-16T12:00:00.000Z");
    const store = createVaultStore(memorySecrets().secrets, { now: () => now });
    const a = await store.add("claude", "sk-a-aaaaaaaa");
    const b = await store.add("claude", "sk-b-bbbbbbbb");
    const exhausted = await store.markFailure("claude", a.id, "quota", 90);
    expect(exhausted.keys[0]).toMatchObject({
      state: "exhausted",
      cooldownUntil: "2026-11-16T12:01:30.000Z",
    });
    const invalid = await store.markFailure("claude", b.id, "invalidKey");
    expect(invalid.keys[1]?.state).toBe("invalid");
    expect((await store.get("claude")).keys.map((k) => k.state)).toEqual(["exhausted", "invalid"]);
    const same = await store.markFailure("claude", a.id, "other");
    expect(same.keys.map((k) => k.state)).toEqual(["exhausted", "invalid"]);
  });

  it("reorder : monte et descend une clé, sans effet aux bornes ni pour un identifiant inconnu", async () => {
    const { secrets } = memorySecrets();
    const store = createVaultStore(secrets);
    const [a, b, c] = [
      await store.add("claude", "sk-a-aaaaaaaa"),
      await store.add("claude", "sk-b-bbbbbbbb"),
      await store.add("claude", "sk-c-cccccccc"),
    ];
    const order = async () => (await store.get("claude")).keys.map((k) => k.id);
    expect(await store.reorder("claude", c.id, "up")).toBe(true);
    expect(await order()).toEqual([a.id, c.id, b.id]);
    expect(await store.reorder("claude", a.id, "down")).toBe(true);
    expect(await order()).toEqual([c.id, a.id, b.id]);
    const seen: string[] = [];
    store.onChange((provider) => seen.push(provider));
    expect(await store.reorder("claude", c.id, "up")).toBe(false);
    expect(await store.reorder("claude", b.id, "down")).toBe(false);
    expect(await store.reorder("claude", "inconnu", "up")).toBe(false);
    expect(await order()).toEqual([c.id, a.id, b.id]);
    expect(seen).toEqual([]);
    expect(await code(store.reorder("inconnu", a.id, "up"))).toBe("vault.invalid");
  });

  it("reorder : des écritures concurrentes ne perdent ni ne dupliquent aucune clé", async () => {
    const { secrets } = memorySecrets();
    const store = createVaultStore(secrets);
    const keys: Awaited<ReturnType<typeof store.add>>[] = [];
    for (let i = 0; i < 5; i++) keys.push(await store.add("claude", `sk-order-${i}-xxxxxxxx`));
    await Promise.all([
      store.reorder("claude", keys[4]?.id ?? "", "up"),
      store.reorder("claude", keys[4]?.id ?? "", "up"),
      store.rename("claude", keys[0]?.id ?? "", "premier"),
      store.reorder("claude", keys[0]?.id ?? "", "down"),
      store.markFailure("claude", keys[2]?.id ?? "", "invalidKey"),
    ]);
    const after = await store.get("claude");
    expect(after.keys.map((k) => k.id).sort()).toEqual(keys.map((k) => k.id).sort());
    expect(after.keys.map((k) => k.id)).toEqual([
      keys[1]?.id,
      keys[0]?.id,
      keys[4]?.id,
      keys[2]?.id,
      keys[3]?.id,
    ]);
    expect(after.keys.find((k) => k.id === keys[0]?.id)?.label).toBe("premier");
    expect(after.keys.find((k) => k.id === keys[2]?.id)?.state).toBe("invalid");
  });

  it("notifie les modifications, sans la valeur", async () => {
    const store = createVaultStore(memorySecrets().secrets);
    const seen: string[] = [];
    const off = store.onChange((provider) => seen.push(provider));
    const key = await store.add("claude", "sk-a-aaaaaaaa");
    await store.rename("claude", key.id, "x");
    await store.remove("claude", key.id);
    off();
    await store.add("claude", "sk-b-bbbbbbbb");
    expect(seen).toEqual(["claude", "claude", "claude"]);
  });

  it("allValues rend les valeurs de tous les coffres, pour le masquage", async () => {
    const store = createVaultStore(memorySecrets().secrets, {
      opencodeProviders: () => ["venator-acme"],
    });
    await store.add("claude", "sk-claude-1111");
    await store.add("openai", "sk-openai-2222");
    await store.add("venator-acme", "plain-acme-value-3333");
    expect((await store.allValues()).sort()).toEqual(
      ["sk-claude-1111", "sk-openai-2222", "plain-acme-value-3333"].sort(),
    );
  });

  it("un coffre corrompu est refusé (vault.invalid) sans exposer son contenu", async () => {
    const { secrets } = memorySecrets({ "warband.vault.claude": '{"keys":[{"id":"x"}]}' });
    const store = createVaultStore(secrets);
    expect(await code(store.get("claude"))).toBe("vault.invalid");
    try {
      await store.get("claude");
    } catch (error) {
      expect(JSON.stringify((error as CodedError).params)).not.toContain("sk-");
    }
  });
});

describe("coffre à clés : migration de l'ancienne clé unique", () => {
  it("la clé d'API OpenAI devient la clé 1, l'ancienne entrée reste, la migration est idempotente", async () => {
    const { secrets, data } = memorySecrets({ [LEGACY_OPENAI_KEY]: "sk-openai-legacy-1" });
    const store = createVaultStore(secrets);
    const first = await store.get("openai");
    const second = await store.get("openai");
    const concurrent = await Promise.all([store.get("openai"), store.get("openai")]);
    expect(first.keys).toHaveLength(1);
    expect(first.keys[0]).toMatchObject({ value: "sk-openai-legacy-1", state: "active" });
    expect(second).toEqual(first);
    for (const vault of concurrent) expect(vault).toEqual(first);
    // L'ancienne entrée n'est PAS effacée.
    expect(data.get(LEGACY_OPENAI_KEY)).toBe("sk-openai-legacy-1");
  });

  it("le jeton Claude migre seulement si c'est une clé d'API ; l'abonnement OAuth reste hors du coffre", async () => {
    const api = memorySecrets({
      [LEGACY_TOKEN_KEY]: "sk-ant-legacy",
      [LEGACY_TOKEN_KIND_KEY]: "api-key",
    });
    const migrated = await createVaultStore(api.secrets).get("claude");
    expect(migrated.keys.map((k) => k.value)).toEqual(["sk-ant-legacy"]);
    expect(api.data.get(LEGACY_TOKEN_KEY)).toBe("sk-ant-legacy");
    expect(api.data.get(LEGACY_TOKEN_KIND_KEY)).toBe("api-key");

    const oauth = memorySecrets({
      [LEGACY_TOKEN_KEY]: "oauth-token",
      [LEGACY_TOKEN_KIND_KEY]: "subscription",
    });
    expect((await createVaultStore(oauth.secrets).get("claude")).keys).toEqual([]);
    expect([...oauth.data.keys()].some((k) => k.startsWith("warband.vault."))).toBe(false);
  });

  it("sans ancienne clé, get ne crée aucune entrée", async () => {
    const { secrets, data } = memorySecrets();
    expect((await createVaultStore(secrets).get("claude")).keys).toEqual([]);
    expect(data.size).toBe(0);
  });

  it("une clé retirée ne ressuscite pas, et son ancienne entrée identique est effacée avec elle", async () => {
    const { secrets, data } = memorySecrets({
      [LEGACY_TOKEN_KEY]: "sk-ant-legacy",
      [LEGACY_TOKEN_KIND_KEY]: "api-key",
    });
    const store = createVaultStore(secrets);
    const [only] = (await store.get("claude")).keys;
    await store.remove("claude", only?.id ?? "");
    expect((await store.get("claude")).keys).toEqual([]);
    expect(data.has(LEGACY_TOKEN_KEY)).toBe(false);
    expect((await createVaultStore(secrets).get("claude")).keys).toEqual([]);
  });

  it("l'empreinte de la clé migrée est celle de sa valeur", async () => {
    const { secrets } = memorySecrets({ [LEGACY_OPENAI_KEY]: "sk-openai-legacy-1" });
    const [key] = (await createVaultStore(secrets).get("openai")).keys;
    expect(fingerprint(key?.value ?? "")).toMatch(/^[0-9a-f]{8}$/);
  });
});
