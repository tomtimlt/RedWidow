import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  currentKey,
  emptyPool,
  markKey,
  nextKey,
  nextRetryAt,
  type PoolState,
  parsePool,
  publicPool,
  QUOTA_RETRY_MS,
  RATE_LIMIT_RETRY_MS,
} from "../src/bridge/rotation.js";

const NOW = 1_000_000_000_000;
const pool = (): PoolState => ({
  order: ["a", "b", "c"],
  active: "a",
  keys: {
    a: { label: "A", state: "ok", since: 0, retryAt: null },
    b: { label: "B", state: "ok", since: 0, retryAt: null },
    c: { label: "C", state: "ok", since: 0, retryAt: null },
  },
});
const ev = (e: Record<string, unknown>) => e as never;

describe("classifyEvent", () => {
  it("quota gratuit : 24 h", () => {
    expect(
      classifyEvent(
        ev({ kind: "error", code: "provider.error", params: { name: "QuotaExceeded" } }),
        NOW,
      ),
    ).toEqual({ reason: "quota", retryAt: NOW + QUOTA_RETRY_MS });
  });

  it("délai annoncé et 429 : 1 h", () => {
    const limit = { reason: "rateLimit", retryAt: NOW + RATE_LIMIT_RETRY_MS };
    expect(
      classifyEvent(
        ev({ kind: "error", code: "provider.error", params: { name: "RetryDelayed" } }),
        NOW,
      ),
    ).toEqual(limit);
    expect(
      classifyEvent(
        ev({ kind: "error", code: "provider.error", params: { name: "X", status: 429 } }),
        NOW,
      ),
    ).toEqual(limit);
  });

  it("rate.limited rejeté : resetsAt (secondes ou ms) s'il est dans le futur, sinon 1 h", () => {
    const base = { kind: "rate.limited", status: "rejected" };
    expect(classifyEvent(ev({ ...base, resetsAt: NOW / 1000 + 600 }), NOW)?.retryAt).toBe(
      NOW + 600_000,
    );
    expect(classifyEvent(ev({ ...base, resetsAt: NOW + 5000 }), NOW)?.retryAt).toBe(NOW + 5000);
    expect(classifyEvent(ev({ ...base, resetsAt: 1 }), NOW)?.retryAt).toBe(
      NOW + RATE_LIMIT_RETRY_MS,
    );
    expect(classifyEvent(ev(base), NOW)).toEqual({
      reason: "rateLimit",
      retryAt: NOW + RATE_LIMIT_RETRY_MS,
    });
    expect(classifyEvent(ev({ kind: "rate.limited", status: "allowed" }), NOW)).toBeNull();
  });

  it("authentification échouée : clé invalide ; autres événements : rien", () => {
    expect(classifyEvent(ev({ kind: "error", code: "provider.authFailed" }), NOW)).toEqual({
      reason: "auth",
      retryAt: null,
    });
    expect(
      classifyEvent(ev({ kind: "error", code: "provider.error", params: { status: 500 } }), NOW),
    ).toBeNull();
    expect(classifyEvent(ev({ kind: "error", code: "autre" }), NOW)).toBeNull();
    expect(classifyEvent(ev({ kind: "agent.text", text: "x" }), NOW)).toBeNull();
  });
});

describe("réserve", () => {
  it("nextKey : ordre circulaire, saute les clés marquées et exclues", () => {
    let p = markKey(pool(), "a", "quota", NOW + 1000, NOW);
    expect(nextKey(p, "a", NOW)).toBe("b");
    p = markKey(p, "b", "auth", null, NOW);
    expect(p.keys.b).toMatchObject({ state: "invalid", retryAt: null });
    expect(nextKey(p, "b", NOW)).toBe("c");
    expect(nextKey(p, "b", NOW, new Set(["c"]))).toBeNull();
    // `a` redevient utilisable une fois l'échéance passée ; `b` (invalide) jamais.
    expect(nextKey(p, "c", NOW + 2000)).toBe("a");
    expect(nextKey(markKey(p, "c", "rateLimit", null, NOW), "c", NOW + 10 * QUOTA_RETRY_MS)).toBe(
      "a",
    );
  });

  it("currentKey : l'active si utilisable, sinon la première utilisable ; nextRetryAt : la plus proche", () => {
    const p = markKey(
      markKey(pool(), "a", "quota", NOW + 500, NOW),
      "c",
      "rateLimit",
      NOW + 100,
      NOW,
    );
    expect(currentKey(p, NOW)).toBe("b");
    expect(nextRetryAt(p)).toBe(NOW + 100);
    expect(currentKey(markKey(p, "b", "auth", null, NOW), NOW + 1000)).toBe("a");
    expect(nextRetryAt(emptyPool())).toBeNull();
  });

  it("parsePool assainit ; publicPool ne contient que id, libellé, état et échéance", () => {
    expect(parsePool("n'importe quoi")).toEqual(emptyPool());
    const p = parsePool({
      order: ["a", "a", "zz"],
      active: "zz",
      keys: {
        a: { label: "A", state: "?" },
        b: { label: "B", state: "exhausted", retryAt: 5 },
        c: 3,
      },
    });
    expect(p.order).toEqual(["a", "b"]);
    expect(p.active).toBeNull();
    expect(p.keys.a).toMatchObject({ state: "ok", retryAt: null });
    expect(publicPool("opencode", p)).toEqual({
      provider: "opencode",
      active: null,
      keys: [
        { id: "a", label: "A", state: "ok", retryAt: null },
        { id: "b", label: "B", state: "exhausted", retryAt: 5 },
      ],
    });
  });
});
