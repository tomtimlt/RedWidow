import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BYPASS_DEFAULT_MS } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import {
  type BypassClock,
  type BypassPush,
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

function setup() {
  const f = fakeClock();
  const pushes: BypassPush[] = [];
  const host = createBypassHost({ clock: f.clock, onChange: (p) => pushes.push(p) });
  return { ...f, host, pushes };
}

describe("Bypass hôte : activation", () => {
  it("activation depuis une vue visible : durée BYPASS_DEFAULT_MS, poussée « on »", () => {
    const { host, pushes } = setup();
    expect(host.request(true, true)).toBe(true);
    const snap = host.snapshot();
    expect(snap.on).toBe(true);
    expect(snap.expiresAt).toBe(1_000_000 + BYPASS_DEFAULT_MS);
    expect(pushes).toEqual([
      { type: "bypass", on: true, expiresAt: 1_000_000 + BYPASS_DEFAULT_MS },
    ]);
  });

  it("enabled:true refusé si la vue est cachée : rien ne change, rien n'est poussé", () => {
    const { host, pushes } = setup();
    expect(host.request(true, false)).toBe(false);
    expect(host.snapshot()).toEqual({ type: "bypass", on: false, expiresAt: null });
    expect(pushes).toEqual([]);
  });

  it("enabled:false toujours accepté, même vue cachée", () => {
    const { host, pushes } = setup();
    host.request(true, true);
    expect(host.request(false, false)).toBe(true);
    expect(host.snapshot().on).toBe(false);
    expect(pushes.at(-1)).toEqual({ type: "bypass", on: false, expiresAt: null });
  });

  it("désactiver un Bypass inactif ne pousse rien", () => {
    const { host, pushes } = setup();
    expect(host.request(false, true)).toBe(true);
    expect(pushes).toEqual([]);
  });

  it("une prolongation (second enabled:true) pousse la nouvelle échéance", () => {
    const f = setup();
    f.host.request(true, true);
    f.advance(60_000);
    f.host.request(true, true);
    expect(f.pushes.at(-1)).toEqual({
      type: "bypass",
      on: true,
      expiresAt: 1_000_000 + 60_000 + BYPASS_DEFAULT_MS,
    });
  });
});

describe("Bypass hôte : retour à « off »", () => {
  it("expiration : « off » poussé exactement à l'échéance, minuteur soldé", () => {
    const { host, pushes, advance, pending } = setup();
    host.request(true, true);
    advance(BYPASS_DEFAULT_MS - 1);
    expect(host.snapshot().on).toBe(true);
    advance(1);
    expect(host.snapshot().on).toBe(false);
    expect(pushes.at(-1)).toEqual({ type: "bypass", on: false, expiresAt: null });
    expect(pending()).toBe(0);
    expect(host.remainingMs()).toBeNull();
  });

  it("reset : « off » immédiat", () => {
    const { host, pushes } = setup();
    host.request(true, true);
    host.reset();
    expect(host.snapshot().on).toBe(false);
    expect(pushes.at(-1)).toEqual({ type: "bypass", on: false, expiresAt: null });
  });

  it("reset sans Bypass actif : aucune poussée superflue", () => {
    const { host, pushes } = setup();
    host.reset();
    expect(pushes).toEqual([]);
  });

  it("changement de dossiers (reset) : « off » et minuteur annulé", () => {
    const { host, pending } = setup();
    host.request(true, true);
    host.reset();
    expect(pending()).toBe(0);
    expect(host.snapshot().on).toBe(false);
  });

  it("dispose annule le minuteur d'expiration", () => {
    const { host, pending } = setup();
    host.request(true, true);
    expect(pending()).toBe(1);
    host.dispose();
    expect(pending()).toBe(0);
  });
});

describe("Bypass hôte : temps restant", () => {
  it("remainingMs décroît avec l'horloge", () => {
    const { host, advance } = setup();
    host.request(true, true);
    advance(30_000);
    expect(host.remainingMs()).toBe(BYPASS_DEFAULT_MS - 30_000);
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
