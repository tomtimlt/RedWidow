import { describe, expect, it } from "vitest";
import {
  activeKeys,
  CodedError,
  classifyProviderFailure,
  fingerprint,
  keyLabel,
  markFailure,
  newKeyId,
  type ProviderFailureInput,
  type ProviderFailureKind,
  parseRetryAfter,
  parseVault,
  pickKey,
  planRotation,
  soonestCooldown,
  type Vault,
  type VaultKey,
} from "../src/index.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const iso = (offsetS: number) => new Date(NOW.getTime() + offsetS * 1000).toISOString();

function key(id: string, extra: Partial<VaultKey> = {}): VaultKey {
  return {
    id,
    value: `sk-valeur-${id}`,
    addedAt: "2026-11-01T00:00:00.000Z",
    state: "active",
    ...extra,
  };
}

const vaultOf = (...keys: VaultKey[]): Vault => ({ keys });

function refused(json: string): CodedError {
  try {
    parseVault(json);
  } catch (e) {
    expect(e).toBeInstanceOf(CodedError);
    return e as CodedError;
  }
  throw new Error("aurait dû être refusé");
}

describe("parseVault", () => {
  it("accepte un coffre valide", () => {
    const v = vaultOf(
      key("a", { label: "perso" }),
      key("b", { state: "exhausted", cooldownUntil: iso(60) }),
    );
    expect(parseVault(JSON.stringify(v))).toEqual(v);
    expect(parseVault('{"keys":[]}')).toEqual({ keys: [] });
  });

  it("refuse un doublon de valeur sans la divulguer", () => {
    const a = key("a");
    const err = refused(JSON.stringify({ keys: [a, { ...a, id: "b" }] }));
    expect(err.code).toBe("vault.invalid");
    expect(err.message).not.toContain(a.value);
  });

  it("refuse une valeur vide, trop longue ou non textuelle", () => {
    expect(refused(JSON.stringify({ keys: [key("a", { value: "" })] })).code).toBe("vault.invalid");
    expect(refused(JSON.stringify({ keys: [key("a", { value: "x".repeat(4097) })] })).code).toBe(
      "vault.invalid",
    );
    expect(() =>
      parseVault(JSON.stringify({ keys: [key("a", { value: "x".repeat(4096) })] })),
    ).not.toThrow();
    expect(refused(JSON.stringify({ keys: [{ ...key("a"), value: 12 }] })).code).toBe(
      "vault.invalid",
    );
  });

  it("refuse plus de 10 clés", () => {
    const keys = Array.from({ length: 11 }, (_, i) => key(`k${i}`));
    expect(refused(JSON.stringify({ keys })).code).toBe("vault.invalid");
    expect(() => parseVault(JSON.stringify({ keys: keys.slice(0, 10) }))).not.toThrow();
  });

  it("refuse un JSON malformé, une forme inattendue, un état ou un id invalides", () => {
    for (const bad of [
      "{",
      "",
      "null",
      "[]",
      '{"keys":{}}',
      JSON.stringify({ keys: [{ ...key("a"), state: "dead" }] }),
      JSON.stringify({ keys: [{ ...key("a"), id: "" }] }),
      JSON.stringify({ keys: [key("a"), { ...key("b"), id: "a" }] }),
      JSON.stringify({ keys: [{ ...key("a"), addedAt: "hier" }] }),
      JSON.stringify({ keys: [{ ...key("a"), cooldownUntil: 3 }] }),
    ])
      expect(refused(bad).code, bad).toBe("vault.invalid");
  });

  it("newKeyId est aléatoire et sans rapport avec la valeur", () => {
    expect(newKeyId()).not.toBe(newKeyId());
    expect(newKeyId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("fingerprint", () => {
  const value = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";

  it("est stable, sur 8 caractères hexadécimaux", () => {
    expect(fingerprint(value)).toBe(fingerprint(value));
    expect(fingerprint(value)).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint("abc")).toBe("ba7816bf");
    expect(fingerprint(`${value}x`)).not.toBe(fingerprint(value));
  });

  it("ne contient aucune sous-chaîne de la valeur", () => {
    const fp = fingerprint(value);
    for (let i = 0; i + 3 <= value.length; i++)
      expect(fp.includes(value.slice(i, i + 3))).toBe(false);
    expect(value.includes(fp)).toBe(false);
  });

  it("keyLabel ne fournit que le rang et l'empreinte", () => {
    expect(keyLabel(2, "3fa9c1d0")).toEqual({ rank: 2, fingerprint: "3fa9c1d0" });
  });
});

describe("classifyProviderFailure", () => {
  const table: [string, ProviderFailureInput, ProviderFailureKind][] = [
    ["429", { status: 429 }, "quota"],
    ["429 avec code d'auth (429 prime)", { status: 429, code: "invalid_api_key" }, "quota"],
    ["insufficient_quota (code)", { code: "insufficient_quota" }, "quota"],
    ["quota dans le message", { message: "You exceeded your current QUOTA" }, "quota"],
    ["credit épuisé", { message: "Your credit balance is too low" }, "quota"],
    ["billing", { message: "check your billing details" }, "quota"],
    ["rate_limit (code)", { code: "rate_limit_exceeded" }, "quota"],
    ["Free usage exceeded", { message: "free usage exceeded, add credits" }, "quota"],
    ["retry annoncé à 61 s", { retryAfterSeconds: 61 }, "quota"],
    ["rateLimitStatus rejected", { rateLimitStatus: "rejected" }, "quota"],
    ["401", { status: 401 }, "invalidKey"],
    ["403", { status: 403 }, "invalidKey"],
    ["authentication_failed", { code: "authentication_failed" }, "invalidKey"],
    ["invalid_api_key", { code: "invalid_api_key" }, "invalidKey"],
    ["ProviderAuthError", { code: "ProviderAuthError" }, "invalidKey"],
    ["invalidKey avant quota", { status: 401, message: "quota" }, "invalidKey"],
    ["retry à 60 s (limite exclue)", { retryAfterSeconds: 60 }, "other"],
    ["rateLimitStatus allowed_warning", { rateLimitStatus: "allowed_warning" }, "other"],
    ["500", { status: 500, message: "internal server error" }, "other"],
    ["503", { status: 503 }, "other"],
    ["timeout", { code: "ETIMEDOUT", message: "request timed out" }, "other"],
    ["réseau", { code: "ECONNRESET", message: "socket hang up" }, "other"],
    ["400", { status: 400, message: "bad request" }, "other"],
    ["vide", {}, "other"],
  ];
  it.each(table)("%s", (_name, input, expected) => {
    expect(classifyProviderFailure(input)).toBe(expected);
  });

  it("parseRetryAfter extrait un délai simple", () => {
    expect(parseRetryAfter("Please retry in 30s")).toBe(30);
    expect(parseRetryAfter("retry in 45 seconds")).toBe(45);
    expect(parseRetryAfter("Retry in 2 min")).toBe(120);
    expect(parseRetryAfter("retry after 3 minutes.")).toBe(180);
    expect(parseRetryAfter("retry later")).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
  });
});

describe("rotation", () => {
  it("activeKeys réactive une clé dont le délai est passé, sans muter", () => {
    const v = vaultOf(
      key("a", { state: "exhausted", cooldownUntil: iso(-1) }),
      key("b", { state: "exhausted", cooldownUntil: iso(60) }),
    );
    const snapshot = structuredClone(v);
    const out = activeKeys(v, NOW);
    expect(out.keys[0]).toMatchObject({ id: "a", state: "active" });
    expect(out.keys[0]?.cooldownUntil).toBeUndefined();
    expect(out.keys[1]?.state).toBe("exhausted");
    expect(v).toEqual(snapshot);
  });

  it("pickKey circule dans l'ordre du coffre", () => {
    const v = vaultOf(key("a"), key("b"), key("c"));
    expect(pickKey(v, NOW)?.id).toBe("a");
    expect(pickKey(v, NOW, "a")?.id).toBe("b");
    expect(pickKey(v, NOW, "c")?.id).toBe("a");
    expect(pickKey(vaultOf(key("a")), NOW, "a")?.id).toBe("a");
    expect(pickKey(v, NOW, "inconnue")?.id).toBe("a");
    expect(pickKey({ keys: [] }, NOW)).toBeUndefined();
  });

  it("pickKey saute les clés invalid et exhausted", () => {
    const v = vaultOf(
      key("a"),
      key("b", { state: "invalid" }),
      key("c", { state: "exhausted", cooldownUntil: iso(60) }),
    );
    expect(pickKey(v, NOW, "a")?.id).toBe("a");
    expect(pickKey(vaultOf(key("b", { state: "invalid" })), NOW)).toBeUndefined();
  });

  it("pickKey rend la clé dont le délai a expiré", () => {
    const v = vaultOf(key("a", { state: "exhausted", cooldownUntil: iso(-5) }));
    expect(pickKey(v, NOW)).toMatchObject({ id: "a", state: "active" });
  });

  it("markFailure : quota, invalidKey, other", () => {
    const v = vaultOf(key("a"), key("b"));
    const q = markFailure(v, "a", "quota", NOW);
    expect(q.keys[0]).toMatchObject({ state: "exhausted", cooldownUntil: iso(3600) });
    expect(q.keys[1]).toEqual(v.keys[1]);
    expect(markFailure(v, "a", "quota", NOW, 90).keys[0]?.cooldownUntil).toBe(iso(90));
    const bad = markFailure(q, "a", "invalidKey", NOW);
    expect(bad.keys[0]?.state).toBe("invalid");
    expect(bad.keys[0]?.cooldownUntil).toBeUndefined();
    expect(markFailure(v, "a", "other", NOW)).toEqual(v);
    expect(markFailure(v, "inconnue", "quota", NOW)).toEqual(v);
  });

  it("soonestCooldown prend la plus proche fin de délai", () => {
    const v = vaultOf(
      key("a", { state: "exhausted", cooldownUntil: iso(300) }),
      key("b", { state: "exhausted", cooldownUntil: iso(100) }),
      key("c"),
    );
    expect(soonestCooldown(v)).toBe(iso(100));
    expect(soonestCooldown(vaultOf(key("c")))).toBeUndefined();
  });

  it("planRotation passe à la clé suivante", () => {
    const v = vaultOf(key("a"), key("b"), key("c"));
    const plan = planRotation(v, NOW, "a", { kind: "quota", retryAfterSeconds: 120 });
    expect(plan.exhausted).toBe(false);
    expect(plan.next?.id).toBe("b");
    expect(plan.vault.keys[0]).toMatchObject({ state: "exhausted", cooldownUntil: iso(120) });
    const wrap = planRotation(plan.vault, NOW, "c", { kind: "invalidKey" });
    expect(wrap.next?.id).toBe("b");
    expect(wrap.vault.keys[2]?.state).toBe("invalid");
  });

  it("planRotation : toutes épuisées, avec le plus court délai", () => {
    const v = vaultOf(
      key("a"),
      key("b", { state: "exhausted", cooldownUntil: iso(500) }),
      key("c", { state: "invalid" }),
    );
    const plan = planRotation(v, NOW, "a", { kind: "quota" });
    expect(plan.exhausted).toBe(true);
    expect(plan.next).toBeUndefined();
    expect(plan.soonest).toBe(iso(500));
    const allInvalid = planRotation(vaultOf(key("a")), NOW, "a", { kind: "invalidKey" });
    expect(allInvalid).toMatchObject({ exhausted: true });
    expect(allInvalid.soonest).toBeUndefined();
  });

  it("planRotation sur `other` ne change rien", () => {
    const v = vaultOf(key("a"), key("b"));
    const plan = planRotation(v, NOW, "a", { kind: "other" });
    expect(plan.vault).toEqual(v);
    expect(plan.next).toBeUndefined();
    expect(plan.exhausted).toBe(false);
  });

  it("aucune fonction ne modifie son argument", () => {
    const v = vaultOf(
      key("a"),
      key("b", { state: "exhausted", cooldownUntil: iso(-1) }),
      key("c", { state: "invalid" }),
    );
    const snapshot = structuredClone(v);
    activeKeys(v, NOW);
    pickKey(v, NOW, "a");
    markFailure(v, "a", "quota", NOW);
    markFailure(v, "a", "invalidKey", NOW);
    soonestCooldown(v);
    planRotation(v, NOW, "a", { kind: "quota" });
    expect(v).toEqual(snapshot);
  });
});
