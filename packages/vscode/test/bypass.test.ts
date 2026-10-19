import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BYPASS_DEFAULT_MS, type BypassState } from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  BYPASS_ACK_TIMEOUT_MS,
  type BypassClock,
  type BypassEngineLink,
  type BypassPush,
  type BypassSend,
  createBypassHost,
  formatRemaining,
} from "../src/logic/bypass.js";

/** Horloge et minuteurs factices : `advance` exécute les minuteurs échus, dans l'ordre. */
function fakeClock(start = 1_000_000) {
  let t = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: BypassClock = {
    now: () => t,
    schedule(fn, delayMs) {
      const id = next++;
      timers.set(id, { at: t + delayMs, fn });
      return id;
    },
    cancel(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= target && (due === undefined || entry[1].at < due[1].at)) due = entry;
        }
        if (due === undefined) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = target;
    },
  };
}

/** Hôte branché sur un faux moteur : chaque envoi reçoit un `seq` croissant (comme le contrôleur). */
function setup() {
  const f = fakeClock();
  const pushes: BypassPush[] = [];
  const sent: Array<{ seq: number; state: BypassState | null }> = [];
  let seq = 0;
  const host = createBypassHost({ clock: f.clock, onChange: (p) => pushes.push(p) });
  const engine: BypassSend = (state) => {
    seq += 1;
    sent.push({ seq, state });
    return seq;
  };
  /** Accusé conforme au dernier envoi (ou non conforme si `state` est fourni). */
  const ack = (link: BypassEngineLink, state?: BypassState | null) => {
    const last = sent.at(-1);
    if (last === undefined) throw new Error("rien envoyé");
    link.acked(last.seq, state === undefined ? last.state : state);
  };
  return { ...f, host, pushes, sent, engine, ack };
}

const off = { type: "bypass", on: false, armed: false, expiresAt: null };

describe("Bypass hôte : armé sans moteur, actif seulement avec accusé", () => {
  it("activation sans moteur : « armé », jamais « actif »", () => {
    const { host, pushes } = setup();
    expect(host.request(true, true)).toBe(true);
    expect(host.snapshot()).toEqual({ type: "bypass", on: false, armed: true, expiresAt: null });
    expect(pushes).toEqual([{ type: "bypass", on: false, armed: true, expiresAt: null }]);
  });

  it("enabled:true refusé si la vue est cachée : rien ne change, rien n'est poussé", () => {
    const { host, pushes } = setup();
    expect(host.request(true, false)).toBe(false);
    expect(host.snapshot()).toEqual(off);
    expect(pushes).toEqual([]);
  });

  it("enabled:false toujours accepté, même vue cachée", () => {
    const s = setup();
    s.host.request(true, true);
    expect(s.host.request(false, false)).toBe(true);
    expect(s.host.snapshot()).toEqual(off);
  });

  it("désactiver un Bypass inactif ne pousse rien", () => {
    const { host, pushes } = setup();
    expect(host.request(false, true)).toBe(true);
    expect(pushes).toEqual([]);
  });

  it("attachement : l'état est envoyé au moteur tout de suite, sans effet d'affichage avant accusé", () => {
    const s = setup();
    s.host.request(true, true);
    s.host.attach(s.engine);
    expect(s.sent).toEqual([
      {
        seq: 1,
        state: { since: 1_000_000, expiresAt: 1_000_000 + BYPASS_DEFAULT_MS },
      },
    ]);
    expect(s.host.snapshot().on).toBe(false);
  });

  it("(t) accusé conforme au dernier seq : « actif » poussé avec l'échéance", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    expect(s.host.snapshot()).toEqual({
      type: "bypass",
      on: true,
      armed: false,
      expiresAt: 1_000_000 + BYPASS_DEFAULT_MS,
    });
    expect(s.pushes.at(-1)?.on).toBe(true);
  });

  it("(t) accusé d'un seq ancien ignoré : reste « armé »", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    link.acked(99, s.sent[0]?.state ?? null);
    expect(s.host.snapshot().on).toBe(false);
    expect(s.host.snapshot().armed).toBe(true);
  });

  it("(t) accusé non conforme (bornes différentes) : échec fermé, « off » et rien de réactivé", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link, { since: 0, expiresAt: 1 });
    expect(s.host.snapshot()).toEqual(off);
    expect(s.host.remainingMs()).toBeNull();
    expect(s.sent.at(-1)?.state).toBeNull();
  });

  it("(t) sans accusé sous 5 s : « off » (échec fermé), sans nouvelle activation", () => {
    const s = setup();
    s.host.request(true, true);
    s.host.attach(s.engine);
    s.advance(BYPASS_ACK_TIMEOUT_MS - 1);
    expect(s.host.snapshot().armed).toBe(true);
    s.advance(1);
    expect(s.host.snapshot()).toEqual(off);
    expect(s.sent.at(-1)?.state).toBeNull();
    // Pas de réactivation automatique : seul un nouvel appui de l'utilisateur réactive.
    s.advance(BYPASS_DEFAULT_MS);
    expect(s.host.snapshot()).toEqual(off);
  });

  it("(t) l'accusé annule le délai : pas de désactivation après 5 s", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    s.advance(BYPASS_ACK_TIMEOUT_MS * 10);
    expect(s.host.snapshot().on).toBe(true);
  });

  it("sans moteur, un accusé n'existe pas : l'état reste « armé » et rien n'est actif", () => {
    const s = setup();
    s.host.request(true, true);
    s.advance(BYPASS_ACK_TIMEOUT_MS * 10);
    expect(s.host.snapshot().on).toBe(false);
    expect(s.host.snapshot().armed).toBe(true);
  });

  it("release (moteur sorti) : repasse à « armé », sans envoi", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    const before = s.sent.length;
    link.release();
    expect(s.host.snapshot()).toEqual({
      type: "bypass",
      on: false,
      armed: true,
      expiresAt: null,
    });
    expect(s.sent.length).toBe(before);
  });

  it("deux liens : libérer l'un laisse l'autre actif, un accusé du lien libéré est ignoré", () => {
    const s = setup();
    const otherSent: Array<BypassState | null> = [];
    const other: BypassSend = (state) => {
      otherSent.push(state);
      return otherSent.length;
    };
    s.host.request(true, true);
    const first = s.host.attach(s.engine);
    const second = s.host.attach(other);
    expect(s.sent.at(-1)?.state).not.toBeNull();
    expect(otherSent.at(-1)).not.toBeNull();
    s.ack(first);
    expect(s.host.snapshot().on).toBe(false);
    second.acked(otherSent.length, otherSent.at(-1) ?? null);
    expect(s.host.snapshot().on).toBe(true);
    const before = otherSent.length;
    first.release();
    expect(otherSent).toHaveLength(before);
    expect(s.host.snapshot().on).toBe(true);
    first.acked(s.sent.length, s.sent.at(-1)?.state ?? null);
    expect(s.host.snapshot().on).toBe(true);
  });
});

describe("Bypass hôte : envois au moteur", () => {
  it("désactivation avec moteur attaché : « off » et état nul envoyé", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    s.host.request(false, true);
    expect(s.host.snapshot()).toEqual(off);
    expect(s.sent.at(-1)?.state).toBeNull();
  });

  it("une prolongation envoie les nouvelles bornes et redevient « armé » jusqu'à l'accusé", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    s.advance(60_000);
    s.host.request(true, true);
    expect(s.sent.at(-1)).toEqual({
      seq: 2,
      state: { since: 1_060_000, expiresAt: 1_060_000 + BYPASS_DEFAULT_MS },
    });
    expect(s.host.snapshot().on).toBe(false);
    s.ack(link);
    expect(s.host.snapshot().expiresAt).toBe(1_060_000 + BYPASS_DEFAULT_MS);
  });

  it("reset : « off » immédiat, moteur informé", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    s.host.reset();
    expect(s.host.snapshot()).toEqual(off);
    expect(s.sent.at(-1)?.state).toBeNull();
  });

  it("expiration : « off » à l'échéance, moteur informé, minuteurs soldés", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    s.advance(BYPASS_DEFAULT_MS - 1);
    expect(s.host.snapshot().on).toBe(true);
    s.advance(1);
    expect(s.host.snapshot()).toEqual(off);
    expect(s.sent.at(-1)?.state).toBeNull();
    expect(s.pending()).toBe(0);
    expect(s.host.remainingMs()).toBeNull();
  });

  it("dispose annule les minuteurs", () => {
    const s = setup();
    s.host.request(true, true);
    s.host.attach(s.engine);
    expect(s.pending()).toBeGreaterThan(0);
    s.host.dispose();
    expect(s.pending()).toBe(0);
  });
});

describe("Bypass hôte : temps restant", () => {
  it("remainingMs décroît avec l'horloge", () => {
    const s = setup();
    s.host.request(true, true);
    s.advance(30_000);
    expect(s.host.remainingMs()).toBe(BYPASS_DEFAULT_MS - 30_000);
  });
});

describe("formatRemaining", () => {
  it("arrondit à la minute supérieure", () => {
    expect(formatRemaining(1)).toBe("1 min");
    expect(formatRemaining(59_000)).toBe("1 min");
    expect(formatRemaining(0)).toBe("0 min");
  });
  it("affiche les heures", () => {
    expect(formatRemaining(BYPASS_DEFAULT_MS)).toBe("2 h 00");
    // 2 h - 61 s = 118,98 min : arrondi à la minute supérieure, 119 min.
    expect(formatRemaining(BYPASS_DEFAULT_MS - 61_000)).toBe("1 h 59");
  });
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Bypass : aucune persistance ni réglage", () => {
  it("le module hôte ne lit ni configuration, ni globalState, ni workspaceState, ni secrets", () => {
    // Commentaires retirés : seul le code compte (la doc cite les interdits).
    const src = read("../src/logic/bypass.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n");
    for (const token of [
      "getConfiguration",
      "globalState",
      "workspaceState",
      "secrets",
      "process.env",
    ]) {
      expect(src.includes(token), token).toBe(false);
    }
  });

  it("dans l'extension, les lignes liées au Bypass ne touchent ni configuration ni stockage", () => {
    const lines = read("../src/extension/extension.ts")
      .split("\n")
      .filter((l) => /bypass/i.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, line).not.toMatch(
        /getConfiguration|globalState|workspaceState|secrets|inspect\(/,
      );
    }
  });

  it("un seul point d'activation : bypass.request n'est appelé que par setBypass et la commande de désactivation", () => {
    const calls = read("../src/extension/extension.ts")
      .split("\n")
      .filter((l) => l.includes("bypass.request("));
    expect(calls).toHaveLength(2);
    expect(calls.some((l) => l.includes("message.enabled"))).toBe(true);
    expect(calls.some((l) => l.includes("request(false, true)"))).toBe(true);
  });
});

describe("Bypass hôte : faux accusés et moteur détaché (lot 2c)", () => {
  it("faux accusé d'état nul (bon seq) : « off », l'activation n'est jamais tenue pour effective", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    expect(s.host.snapshot().on).toBe(true);
    s.ack(link, null);
    expect(s.host.snapshot()).toEqual(off);
    expect(s.host.remainingMs()).toBeNull();
  });

  it("faux accusé de bornes différentes après confirmation : échec fermé, « off »", () => {
    const s = setup();
    s.host.request(true, true);
    const link = s.host.attach(s.engine);
    s.ack(link);
    const last = s.sent.at(-1)?.state as BypassState;
    link.acked(s.sent.length, { since: last.since, expiresAt: last.expiresAt + 1 });
    expect(s.host.snapshot()).toEqual(off);
    // Le moteur reçoit l'état nul : rien ne reste actif de son côté.
    expect(s.sent.at(-1)?.state).toBeNull();
  });

  it("reset envoie l'état nul à chaque lien ; un accusé tardif ne réactive rien", () => {
    const s = setup();
    const otherSent: Array<BypassState | null> = [];
    const other: BypassSend = (state) => {
      otherSent.push(state);
      return otherSent.length;
    };
    s.host.request(true, true);
    const first = s.host.attach(s.engine);
    const second = s.host.attach(other);
    s.ack(first);
    second.acked(otherSent.length, otherSent.at(-1) ?? null);
    expect(s.host.snapshot().on).toBe(true);
    s.host.reset();
    expect(s.host.snapshot()).toEqual(off);
    expect(s.sent.at(-1)?.state).toBeNull();
    expect(otherSent.at(-1)).toBeNull();
    first.acked(s.sent.length, null);
    expect(s.host.snapshot()).toEqual(off);
  });
});
