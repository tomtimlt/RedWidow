import { describe, expect, it } from "vitest";
import { LoginLimiter } from "../src/auth/limiter.js";
import { readSessionCookie, SessionStore, sessionCookie } from "../src/auth/sessions.js";

describe("SessionStore", () => {
  it("valide, expire en glissant et en absolu", () => {
    let t = 0;
    const s = new SessionStore({ now: () => t, idleMs: 1000, absoluteMs: 2500 });
    const tok = s.create();
    expect(s.validate(tok)).toBeTypeOf("string");
    t = 900;
    expect(s.validate(tok)).toBeTypeOf("string"); // prolongée
    t = 1800;
    expect(s.validate(tok)).toBeTypeOf("string");
    t = 2600; // plus de 2500 ms depuis la création
    expect(s.validate(tok)).toBeUndefined();
    const tok2 = s.create();
    t += 1000;
    expect(s.validate(tok2)).toBeUndefined(); // inactivité
  });

  it("révoque, notifie et évince la plus ancienne au plafond", () => {
    const s = new SessionStore({ maxSessions: 2 });
    const ended: string[] = [];
    s.onEnd((id) => ended.push(id));
    const a = s.create();
    const ida = s.validate(a);
    const b = s.create();
    s.create();
    expect(s.size).toBe(2);
    expect(s.validate(a)).toBeUndefined();
    expect(ended).toEqual([ida]);
    expect(s.revoke(b)).toBe(true);
    expect(s.revoke(b)).toBe(false);
    expect(ended).toHaveLength(2);
  });

  it("ne garde pas le jeton et lit le cookie", () => {
    const s = new SessionStore();
    const tok = s.create();
    expect(
      JSON.stringify([...(s as unknown as { byHash: Map<string, unknown> }).byHash.keys()]),
    ).not.toContain(tok);
    expect(readSessionCookie(`a=b; ${sessionCookie(tok, 5).split(";")[0]}`)).toBe(tok);
    expect(readSessionCookie("autre=1")).toBeUndefined();
  });
});

describe("LoginLimiter", () => {
  it("double l'attente à chaque échec, plafonne et se remet à zéro", () => {
    let t = 0;
    const l = new LoginLimiter(() => t);
    const fail = () => {
      expect(l.begin("ip").ok).toBe(true);
      l.fail("ip");
    };
    fail(); // attente 1 s
    expect(l.begin("ip")).toEqual({ ok: false, retryAfterSeconds: 1 });
    t = 1000;
    fail(); // attente 2 s
    t = 2000;
    expect(l.begin("ip")).toEqual({ ok: false, retryAfterSeconds: 1 });
    t = 3000;
    for (let i = 0; i < 20; i++) {
      fail();
      t += 20 * 60_000;
    }
    fail();
    expect(l.begin("ip")).toEqual({ ok: false, retryAfterSeconds: 900 });
    t += 900_000;
    expect(l.begin("ip").ok).toBe(true);
    l.success("ip");
    expect(l.size).toBe(0);
  });

  it("refuse une vérification parallèle et borne la table", () => {
    const l = new LoginLimiter(() => 0, 3);
    expect(l.begin("a").ok).toBe(true);
    expect(l.begin("a").ok).toBe(false);
    l.release("a");
    expect(l.begin("a").ok).toBe(true);
    for (const ip of ["b", "c", "d", "e"]) l.begin(ip);
    expect(l.size).toBeLessThanOrEqual(3);
  });
});
