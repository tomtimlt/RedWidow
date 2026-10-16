import { BYPASS_DEFAULT_MS } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { createBypassMirror } from "../src/engine/bypass-mirror.js";

/** Horloge du moteur factice. */
function fakeNow(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
}

const state = (since: number, span = BYPASS_DEFAULT_MS) => ({
  since,
  expiresAt: since + span,
});

describe("miroir du Bypass (moteur)", () => {
  it("naît « off » : rien n'est actif sans message de l'hôte", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    expect(m.current(clock.now())).toBeNull();
    expect(m.lastOffReason()).toBe("bypass.disabled");
  });

  it("retient exactement les bornes reçues (aucune durée calculée, aucune prolongation)", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    const s = state(clock.now(), 60_000);
    expect(m.apply(1, s)).toBe(true);
    expect(m.current(clock.now())).toEqual(s);
  });

  it("(q) rejeu et désordre : seq déjà vu ou inférieur ignoré", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    expect(m.apply(1, state(clock.now()))).toBe(true);
    expect(m.apply(2, null)).toBe(true);
    // Rejeu du « on » (seq 1) après le « off » : reste « off ».
    expect(m.apply(1, state(clock.now()))).toBe(false);
    expect(m.apply(2, state(clock.now()))).toBe(false);
    expect(m.current(clock.now())).toBeNull();
  });

  it("une désactivation (null) donne le motif « désactivé »", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    m.apply(1, state(clock.now()));
    m.apply(2, null);
    expect(m.current(clock.now())).toBeNull();
    expect(m.lastOffReason()).toBe("bypass.disabled");
  });

  it("expiration à l'horloge du moteur : état retiré à l'échéance, motif « expiré »", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    const start = clock.now();
    m.apply(1, state(start, 60_000));
    clock.set(start + 59_999);
    expect(m.current(clock.now())).not.toBeNull();
    clock.set(start + 60_000);
    expect(m.current(clock.now())).toBeNull();
    expect(m.lastOffReason()).toBe("bypass.expired");
  });

  it("un null reçu après l'échéance du dernier état donne le motif « expiré »", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    const start = clock.now();
    m.apply(1, state(start, 60_000));
    clock.set(start + 60_000);
    m.apply(2, null);
    expect(m.lastOffReason()).toBe("bypass.expired");
  });

  it("off() (canal coupé) : « off » immédiat, motif « désactivé » hors échéance", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    m.apply(1, state(clock.now()));
    m.off();
    expect(m.current(clock.now())).toBeNull();
    expect(m.lastOffReason()).toBe("bypass.disabled");
  });

  it("off() sur un miroir déjà « off » ne change rien", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    m.off();
    expect(m.current(clock.now())).toBeNull();
    expect(m.lastOffReason()).toBe("bypass.disabled");
  });

  it("un nouvel état remplace l'ancien (réactivation) sans prolonger le précédent", () => {
    const clock = fakeNow();
    const m = createBypassMirror({ now: clock.now });
    m.apply(1, state(clock.now(), 60_000));
    const later = state(clock.now() + 1000, 60_000);
    m.apply(2, later);
    expect(m.current(clock.now() + 1000)).toEqual(later);
  });
});
