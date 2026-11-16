import { CodedError, type EngineEvent, fingerprint } from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  createFailureTracker,
  keyMismatch,
  pickVaultChoice,
  rotateAfterFailure,
} from "../src/logic/vault-launch.js";
import { createVaultStore, type SecretsLike } from "../src/logic/vault-store.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");

function storeWith() {
  const data = new Map<string, string>();
  const secrets: SecretsLike = {
    get: async (key) => data.get(key),
    store: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
  return createVaultStore(secrets, { now: () => NOW, opencodeProviders: () => ["venator-acme"] });
}

const ev = (e: Record<string, unknown>) => e as unknown as EngineEvent;

describe("choix de la clé du coffre au lancement", () => {
  it("coffre vide : null (chemin actuel, source legacy)", async () => {
    expect(await pickVaultChoice(storeWith(), "claude", NOW, { launch: true })).toBeNull();
  });

  it("la première clé active, avec rang, nom de variable et empreinte attendue côté hôte", async () => {
    const store = storeWith();
    const a = await store.add("claude", "sk-a-aaaaaaaa");
    await store.add("claude", "sk-b-bbbbbbbb");
    await store.markFailure("claude", a.id, "quota");
    const choice = await pickVaultChoice(store, "claude", NOW, { launch: true });
    expect(choice).toMatchObject({
      auth: { name: "ANTHROPIC_API_KEY", value: "sk-b-bbbbbbbb" },
      mode: "api-key",
      vault: {
        provider: "claude",
        rank: 2,
        name: "ANTHROPIC_API_KEY",
        fingerprint: fingerprint("sk-b-bbbbbbbb"),
      },
    });
  });

  it("après une clé fautive : la suivante, en tournant", async () => {
    const store = storeWith();
    const a = await store.add("openai", "sk-a-aaaaaaaa");
    const b = await store.add("openai", "sk-b-bbbbbbbb");
    const c = await store.add("openai", "sk-c-cccccccc");
    expect((await pickVaultChoice(store, "openai", NOW, { afterKeyId: a.id }))?.vault.keyId).toBe(
      b.id,
    );
    expect((await pickVaultChoice(store, "openai", NOW, { afterKeyId: c.id }))?.vault.keyId).toBe(
      a.id,
    );
  });

  it("fournisseur OpenCode : variable <ID>_API_KEY et mode auto", async () => {
    const store = storeWith();
    await store.add("venator-acme", "plain-acme-value-1");
    const choice = await pickVaultChoice(store, "venator-acme", NOW, { launch: true });
    expect(choice).toMatchObject({
      auth: { name: "VENATOR_ACME_API_KEY", value: "plain-acme-value-1" },
      mode: "auto",
    });
  });

  it("toutes les clés épuisées : vault.allExhausted avec le plus court délai au lancement, la première clé sinon", async () => {
    const store = storeWith();
    const a = await store.add("claude", "sk-a-aaaaaaaa");
    const b = await store.add("claude", "sk-b-bbbbbbbb");
    await store.markFailure("claude", a.id, "quota", 600);
    await store.markFailure("claude", b.id, "quota", 120);
    const error = await pickVaultChoice(store, "claude", NOW, { launch: true }).catch((e) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({
      code: "vault.allExhausted",
      params: { until: "2026-11-16T12:02:00.000Z" },
    });
    // Affichage ou sondage : l'état ne bloque rien.
    expect((await pickVaultChoice(store, "claude", NOW))?.vault.rank).toBe(1);
    // Le délai de la clé 2 passé (120 s), elle redevient active ; la clé 1 attend encore (600 s).
    const later = new Date("2026-11-16T12:03:00.000Z");
    expect((await pickVaultChoice(store, "claude", later, { launch: true }))?.vault.rank).toBe(2);
  });
});

describe("relevé des échecs d'un tour", () => {
  it("lit status, code, message et délai dans l'événement error des adaptateurs", () => {
    const tracker = createFailureTracker();
    tracker.observe(
      ev({
        kind: "error",
        code: "provider.error",
        params: {
          status: 429,
          code: "APIError",
          message: "Too many requests",
          retryAfterSeconds: 90,
        },
      }),
    );
    expect(tracker.take()).toEqual({
      status: 429,
      code: "APIError",
      message: "Too many requests",
      retryAfterSeconds: 90,
    });
    expect(tracker.take()).toBeUndefined();
  });

  it("déduit le code des raisons d'authentification, et le délai du message", () => {
    const tracker = createFailureTracker();
    tracker.observe(ev({ kind: "error", code: "auth.failed" }));
    expect(tracker.take()).toMatchObject({ code: "authentication_failed" });
    tracker.observe(ev({ kind: "error", code: "provider.authFailed", params: { message: "x" } }));
    expect(tracker.take()).toMatchObject({ code: "ProviderAuthError" });
    tracker.observe(
      ev({ kind: "error", code: "error.unknown", message: "quota exceeded, retry in 2 minutes" }),
    );
    expect(tracker.take()).toMatchObject({ retryAfterSeconds: 120 });
  });

  it("rate.limited rejeté compte ; un tour réussi remet le relevé à zéro", () => {
    const tracker = createFailureTracker();
    tracker.observe(ev({ kind: "rate.limited", status: "allowed_warning" }));
    expect(tracker.take()).toBeUndefined();
    tracker.observe(ev({ kind: "rate.limited", status: "rejected" }));
    expect(tracker.take()).toEqual({ rateLimitStatus: "rejected" });
    tracker.observe(ev({ kind: "error", code: "auth.failed" }));
    tracker.observe(ev({ kind: "turn.finished", status: "success" }));
    expect(tracker.take()).toBeUndefined();
  });

  it("préfère l'échec qui se classe (quota, clé invalide) à une erreur banale", () => {
    const tracker = createFailureTracker();
    tracker.observe(ev({ kind: "error", code: "provider.error", params: { status: 429 } }));
    tracker.observe(ev({ kind: "error", code: "error.unknown", message: "autre" }));
    expect(tracker.take()).toMatchObject({ status: 429 });
  });
});

describe("rotation après un échec classé", () => {
  it("quota : la clé est épuisée (persisté), la suivante est annoncée sans valeur", async () => {
    const store = storeWith();
    const a = await store.add("claude", "sk-a-aaaaaaaa");
    await store.add("claude", "sk-b-bbbbbbbb");
    const pick = (await pickVaultChoice(store, "claude", NOW, { launch: true }))?.vault;
    if (!pick) throw new Error("clé attendue");
    const outcome = await rotateAfterFailure(
      store,
      pick,
      { status: 429, retryAfterSeconds: 90 },
      NOW,
    );
    expect(outcome).toMatchObject({
      kind: "rotated",
      cause: "quota",
      event: {
        kind: "vault.rotated",
        provider: "claude",
        fromRank: 1,
        fromFingerprint: fingerprint("sk-a-aaaaaaaa"),
        toRank: 2,
        toFingerprint: fingerprint("sk-b-bbbbbbbb"),
        cause: "quota",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("sk-");
    expect((await store.get("claude")).keys.find((k) => k.id === a.id)).toMatchObject({
      state: "exhausted",
      cooldownUntil: "2026-11-16T12:01:30.000Z",
    });
  });

  it("clé invalide : la clé passe en invalid", async () => {
    const store = storeWith();
    const a = await store.add("openai", "sk-a-aaaaaaaa");
    await store.add("openai", "sk-b-bbbbbbbb");
    const pick = (await pickVaultChoice(store, "openai", NOW, { launch: true }))?.vault;
    if (!pick) throw new Error("clé attendue");
    const outcome = await rotateAfterFailure(store, pick, { status: 401 }, NOW);
    expect(outcome).toMatchObject({ kind: "rotated", cause: "invalidKey" });
    expect((await store.get("openai")).keys.find((k) => k.id === a.id)?.state).toBe("invalid");
  });

  it("other : aucune rotation, le coffre est inchangé", async () => {
    const store = storeWith();
    await store.add("claude", "sk-a-aaaaaaaa");
    await store.add("claude", "sk-b-bbbbbbbb");
    const before = JSON.stringify(await store.get("claude"));
    const pick = (await pickVaultChoice(store, "claude", NOW, { launch: true }))?.vault;
    if (!pick) throw new Error("clé attendue");
    for (const failure of [{ status: 500 }, { message: "réseau coupé" }, {}]) {
      expect(await rotateAfterFailure(store, pick, failure, NOW)).toEqual({ kind: "none" });
    }
    expect(JSON.stringify(await store.get("claude"))).toBe(before);
  });

  it("dernière clé : exhausted avec until (le plus court délai)", async () => {
    const store = storeWith();
    await store.add("claude", "sk-a-aaaaaaaa");
    const b = await store.add("claude", "sk-b-bbbbbbbb");
    const a = (await store.get("claude")).keys[0];
    await store.markFailure("claude", a?.id ?? "", "quota", 600);
    const pick = (await pickVaultChoice(store, "claude", NOW, { launch: true }))?.vault;
    expect(pick?.keyId).toBe(b.id);
    if (!pick) throw new Error("clé attendue");
    const outcome = await rotateAfterFailure(
      store,
      pick,
      { status: 429, retryAfterSeconds: 60 },
      NOW,
    );
    expect(outcome).toMatchObject({
      kind: "exhausted",
      cause: "quota",
      until: "2026-11-16T12:01:00.000Z",
    });
    expect(outcome.kind === "exhausted" && outcome.event.toRank).toBeUndefined();
  });
});

describe("garde de la clé effective", () => {
  const key = (fp: string) =>
    ev({ kind: "provider.key", provider: "claude", keyRank: 1, fingerprint: fp, source: "vault" });

  it("une empreinte différente de celle attendue est un écart ; la même, non", () => {
    expect(keyMismatch("aaaaaaaa", key("bbbbbbbb"))).toBe(true);
    expect(keyMismatch("aaaaaaaa", key("aaaaaaaa"))).toBe(false);
  });

  it("sans empreinte attendue, ou pour un autre événement, rien à comparer", () => {
    expect(keyMismatch(undefined, key("bbbbbbbb"))).toBe(false);
    expect(keyMismatch("aaaaaaaa", ev({ kind: "agent.text", text: "x" }))).toBe(false);
  });
});
