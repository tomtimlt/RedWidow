import { describe, expect, it } from "vitest";
import { createPaceController, type PaceEventData, validateEvent } from "../src/index.js";

const H = "cible.example";

function setup(
  opts: { maxRequestsPerSecond?: number; preset?: "fast" | "normal" | "careful" } = {},
) {
  let t = 1_000_000;
  const events: PaceEventData[] = [];
  const pace = createPaceController({
    ...(opts.preset ? {} : { maxRequestsPerSecond: 1 }),
    ...opts,
    now: () => t,
    onEvent: (e) => events.push(e),
  });
  return {
    pace,
    events,
    advance: (ms: number) => {
      t += ms;
    },
    time: () => t,
  };
}

/** Envoie une requête en avançant l'horloge de l'attente demandée. */
function sendNow(c: ReturnType<typeof setup>, host = H) {
  for (let i = 0; i < 5; i++) {
    const d = c.pace.acquire(host);
    if (d.action === "send") return;
    if (d.action === "halted") throw new Error("hôte arrêté");
    c.advance(d.ms);
  }
  throw new Error("attente sans fin");
}

describe("seau global", () => {
  it("envoie immédiatement la première requête", () => {
    const c = setup();
    expect(c.pace.acquire(H)).toEqual({ action: "send" });
  });

  it("fait attendre le seau, sans consommer pendant l'attente", () => {
    const c = setup();
    c.pace.acquire(H);
    expect(c.pace.acquire("autre.example")).toEqual({ action: "wait", ms: 1000 });
    c.advance(400);
    expect(c.pace.acquire("autre.example")).toEqual({ action: "wait", ms: 600 });
    c.advance(600);
    expect(c.pace.acquire("autre.example")).toEqual({ action: "send" });
  });

  it("applique les préréglages", () => {
    expect(createPaceController({ preset: "fast" }).ceilingRps).toBe(1);
    expect(createPaceController({ preset: "normal" }).ceilingRps).toBe(0.5);
    expect(createPaceController({ preset: "careful" }).ceilingRps).toBe(0.2);
    const c = setup({ preset: "careful" });
    c.pace.acquire(H);
    expect(c.pace.acquire(H)).toEqual({ action: "wait", ms: 5000 });
  });

  it("préfère le débit explicite et refuse une valeur invalide", () => {
    expect(createPaceController({ maxRequestsPerSecond: 4, preset: "careful" }).ceilingRps).toBe(4);
    expect(() => createPaceController({ maxRequestsPerSecond: 0 })).toThrow(RangeError);
    expect(() => createPaceController({ maxRequestsPerSecond: Number.NaN })).toThrow(RangeError);
  });
});

describe("signal : pause et ÷ 2", () => {
  it("pause 60 s et divise le débit par 2", () => {
    const c = setup();
    sendNow(c);
    c.pace.report(H, "http429");
    expect(c.events).toEqual([
      { kind: "pace.adjusted", host: H, fromRps: 1, toRps: 0.5, cause: "http429" },
    ]);
    c.advance(1000);
    expect(c.pace.acquire(H)).toEqual({ action: "wait", ms: 59_000 });
    c.advance(59_000);
    expect(c.pace.acquire(H)).toEqual({ action: "send" });
    // Après la pause, l'espacement suit le débit réduit (2 s).
    c.advance(1000);
    expect(c.pace.acquire(H)).toEqual({ action: "wait", ms: 1000 });
  });

  it("accepte les trois signaux", () => {
    for (const s of ["http429", "waf403", "timeout"] as const) {
      const c = setup();
      c.pace.report(H, s);
      expect(c.events[0]).toMatchObject({ kind: "pace.adjusted", cause: s });
    }
  });

  it("la pause d'un hôte ne bloque pas les autres", () => {
    const c = setup();
    c.pace.report(H, "timeout");
    expect(c.pace.acquire("autre.example")).toEqual({ action: "send" });
  });

  it("descend jusqu'au plancher (÷ 8) sans le dépasser", () => {
    const c = setup();
    c.pace.report(H, "http429");
    c.advance(11 * 60_000);
    c.pace.report(H, "http429");
    c.advance(11 * 60_000);
    c.pace.report(H, "http429");
    expect(c.pace.status(H).rps).toBeCloseTo(0.125);
    expect(c.pace.status(H).halted).toBe(false);
    expect(c.events.map((e) => (e.kind === "pace.adjusted" ? e.toRps : -1))).toEqual([
      0.5, 0.25, 0.125,
    ]);
  });
});

describe("remontée", () => {
  it("remonte ×1,5 après 20 réponses saines consécutives", () => {
    const c = setup();
    c.pace.report(H, "http429"); // 0,5
    for (let i = 0; i < 19; i++) c.pace.report(H, "ok");
    expect(c.pace.status(H).rps).toBe(0.5);
    c.pace.report(H, "ok");
    expect(c.pace.status(H).rps).toBeCloseTo(0.75);
    expect(c.events.at(-1)).toMatchObject({
      kind: "pace.adjusted",
      fromRps: 0.5,
      toRps: 0.75,
      cause: "recovery",
    });
  });

  it("un signal remet le compteur de réponses saines à zéro", () => {
    const c = setup();
    c.pace.report(H, "http429");
    for (let i = 0; i < 19; i++) c.pace.report(H, "ok");
    c.advance(11 * 60_000);
    c.pace.report(H, "timeout"); // 0,25
    for (let i = 0; i < 19; i++) c.pace.report(H, "ok");
    expect(c.pace.status(H).rps).toBe(0.25);
  });

  it("ne dépasse jamais le plafond et n'émet rien une fois au plafond", () => {
    const c = setup();
    c.pace.report(H, "http429"); // 0,5
    for (let i = 0; i < 20; i++) c.pace.report(H, "ok"); // 0,75
    for (let i = 0; i < 20; i++) c.pace.report(H, "ok"); // 1 (plafonné)
    expect(c.pace.status(H).rps).toBe(1);
    const count = c.events.length;
    for (let i = 0; i < 40; i++) c.pace.report(H, "ok");
    expect(c.pace.status(H).rps).toBe(1);
    expect(c.events).toHaveLength(count);
    expect(c.events.at(-1)).toMatchObject({ fromRps: 0.75, toRps: 1 });
  });
});

describe("arrêt de l'hôte", () => {
  it("s'arrête au 3e signal en 10 minutes", () => {
    const c = setup();
    c.pace.report(H, "http429");
    c.advance(60_000);
    c.pace.report(H, "http429");
    c.advance(60_000);
    c.pace.report(H, "waf403");
    expect(c.events.at(-1)).toEqual({ kind: "pace.halted", host: H, cause: "burst" });
    expect(c.pace.acquire(H)).toEqual({ action: "halted" });
    expect(c.pace.status(H).halted).toBe(true);
  });

  it("des signaux espacés de plus de 10 minutes ne déclenchent pas l'arrêt par rafale", () => {
    const c = setup();
    c.pace.report(H, "http429");
    c.advance(6 * 60_000);
    c.pace.report(H, "http429");
    c.advance(6 * 60_000); // le 1er signal sort de la fenêtre
    c.pace.report(H, "http429");
    expect(c.pace.status(H).halted).toBe(false);
  });

  it("s'arrête sur un signal alors que le débit est au plancher", () => {
    const c = setup();
    for (let i = 0; i < 3; i++) {
      c.pace.report(H, "timeout");
      c.advance(11 * 60_000);
    }
    expect(c.pace.status(H).rps).toBeCloseTo(0.125);
    c.pace.report(H, "timeout");
    expect(c.events.at(-1)).toEqual({ kind: "pace.halted", host: H, cause: "floor" });
  });

  it("ignore les réponses d'un hôte arrêté et n'émet plus rien", () => {
    const c = setup();
    for (let i = 0; i < 3; i++) c.pace.report(H, "http429");
    const count = c.events.length;
    for (let i = 0; i < 50; i++) c.pace.report(H, "ok");
    c.pace.report(H, "http429");
    expect(c.events).toHaveLength(count);
  });

  it("ne reprend jamais automatiquement, quel que soit le temps écoulé", () => {
    const c = setup();
    for (let i = 0; i < 3; i++) c.pace.report(H, "http429");
    c.advance(24 * 3600_000);
    expect(c.pace.acquire(H)).toEqual({ action: "halted" });
    expect(c.pace.acquire("autre.example")).toEqual({ action: "send" });
  });

  it("resume reprend l'hôte à ÷2 du plafond, historique effacé", () => {
    const c = setup();
    for (let i = 0; i < 3; i++) c.pace.report(H, "http429");
    c.pace.resume(H);
    expect(c.pace.status(H)).toMatchObject({ halted: false, pausedUntil: 0 });
    expect(c.pace.status(H).rps).toBeCloseTo(0.5);
    c.advance(2000);
    expect(c.pace.acquire(H)).toEqual({ action: "send" });
    // Remontée possible après reprise.
    for (let i = 0; i < 20; i++) c.pace.report(H, "ok");
    expect(c.pace.status(H).rps).toBeCloseTo(0.75);
    // Un signal après reprise ne ré-arrête pas l'hôte (historique effacé, pas au plancher).
    c.pace.report(H, "http429");
    expect(c.pace.status(H).halted).toBe(false);
  });

  it("resume sur un hôte actif ou inconnu est sans effet", () => {
    const c = setup();
    c.pace.resume("inconnu.example");
    c.pace.report(H, "http429");
    c.pace.resume(H);
    expect(c.pace.status(H).rps).toBe(0.5);
  });
});

describe("événements pace.*", () => {
  const meta = { id: "e1", seq: 1, ts: "2026-01-01T00:00:00Z", runId: "r", parentId: null };

  it("valide pace.adjusted", () => {
    const ok = {
      ...meta,
      kind: "pace.adjusted",
      host: H,
      fromRps: 1,
      toRps: 0.5,
      cause: "http429",
    };
    expect(validateEvent(ok)).toBeNull();
    expect(validateEvent({ ...ok, cause: "autre" })).not.toBeNull();
    expect(validateEvent({ ...ok, host: undefined })).not.toBeNull();
    expect(validateEvent({ ...ok, toRps: "0.5" })).not.toBeNull();
  });

  it("valide pace.halted", () => {
    const ok = { ...meta, kind: "pace.halted", host: H, cause: "floor" };
    expect(validateEvent(ok)).toBeNull();
    expect(validateEvent({ ...ok, cause: "burst" })).toBeNull();
    expect(validateEvent({ ...ok, cause: "recovery" })).not.toBeNull();
    expect(validateEvent({ ...ok, host: 3 })).not.toBeNull();
  });

  it("les données émises par le contrôleur forment des événements valides", () => {
    const c = setup();
    for (let i = 0; i < 3; i++) c.pace.report(H, "http429");
    for (const data of c.events) expect(validateEvent({ ...meta, ...data })).toBeNull();
  });
});

describe("groupes d’edge", () => {
  it("fusionne les alias, partage le débit et l’arrêt et reprend le groupe", () => {
    const c = setup();
    c.pace.bind?.("a.example", ["203.0.113.1"]);
    c.pace.bind?.("b.example", ["203.0.113.1", "203.0.113.2"]);
    c.pace.bind?.("c.example", ["203.0.113.2"]);
    c.pace.report("a.example", "http429");
    expect(c.pace.status("c.example")).toMatchObject({ rps: 0.5, pausedUntil: c.time() + 60000 });
    c.pace.report("b.example", "http429");
    c.pace.report("a.example", "http429");
    expect(c.pace.acquire("c.example")).toEqual({ action: "halted" });
    c.pace.resume("b.example");
    expect(c.pace.status("a.example")).toMatchObject({ halted: false, pausedUntil: 0 });
    // La rotation DNS conserve les observations précédentes.
    c.pace.bind?.("b.example", ["203.0.113.3"]);
    expect(c.pace.members?.("a.example")).toEqual(["a.example", "b.example", "c.example"]);
  });
  it("un délai après une réponse saine suspend l’edge cinq minutes, puis le second signal l’arrête", () => {
    const c = setup();
    c.pace.bind?.("a.example", ["203.0.113.1"]);
    c.pace.bind?.("b.example", ["203.0.113.1"]);
    c.pace.report("a.example", "ok");
    c.advance(1000);
    c.pace.report("a.example", "timeout");
    expect(c.pace.status("b.example")).toMatchObject({
      suspected: true,
      pausedUntil: c.time() + 300000,
    });
    // Une réponse saine déjà en vol ne lève pas la pause.
    c.pace.report("b.example", "ok");
    c.pace.report("b.example", "disconnect");
    expect(c.pace.status("a.example").halted).toBe(true);
    c.pace.resume("b.example");
    expect(c.pace.status("a.example").halted).toBe(false);
  });
  it("le signal à l’échéance exacte n’est pas un second signal pendant la pause", () => {
    const c = setup();
    c.pace.report(H, "ok");
    c.pace.report(H, "timeout");
    c.advance(300000);
    c.pace.report(H, "timeout");
    expect(c.pace.status(H).halted).toBe(false);
  });
});
it("regroupe les représentations équivalentes d’une IPv6", () => {
  const c = setup();
  c.pace.bind?.("a.example", ["2001:db8::1"]);
  c.pace.bind?.("b.example", ["2001:0db8:0000:0000:0000:0000:0000:0001"]);
  c.pace.report("a.example", "http429");
  expect(c.pace.status("b.example").rps).toBe(0.5);
});
