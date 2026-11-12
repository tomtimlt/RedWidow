import { describe, expect, it, vi } from "vitest";

// Modules de l'interface (JavaScript natif, sans déclaration de types) : chargés tels quels.
// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const channelModule = await load("../web/lib/channel.js");
const { createChannel, decodeEnvelope, encodeEnvelope, backoffDelay } = channelModule;

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  open() {
    this.onopen?.();
  }
  drop() {
    this.onclose?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data });
  }
}

function setup(extra: Record<string, unknown> = {}) {
  FakeSocket.all = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const channel = createChannel({
    url: () => "ws://exemple/ws",
    connect: (url: string) => new FakeSocket(url),
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: () => {},
    ...extra,
  });
  return { channel, timers };
}

describe("enveloppe du canal", () => {
  it("encode exactement quatre champs", () => {
    const raw = JSON.parse(encodeEnvelope("shell", "shell", { type: "ready" }));
    expect(Object.keys(raw).sort()).toEqual(["frame", "msg", "v", "view"]);
    expect(raw.v).toBe(1);
  });

  it("décode une enveloppe valide", () => {
    const env = decodeEnvelope(
      JSON.stringify({
        v: 1,
        view: "shell",
        frame: "shell",
        msg: { type: "approvals", items: [] },
      }),
    );
    expect(env).toEqual({ view: "shell", frame: "shell", msg: { type: "approvals", items: [] } });
  });

  it.each([
    ["binaire", new ArrayBuffer(2)],
    ["json invalide", "{"],
    ["tableau", "[]"],
    ["champ en trop", JSON.stringify({ v: 1, view: "chat", frame: "a", msg: {}, x: 1 })],
    ["version", JSON.stringify({ v: 2, view: "chat", frame: "a", msg: {} })],
    ["cadre invalide", JSON.stringify({ v: 1, view: "chat", frame: "a/b", msg: {} })],
    ["msg non objet", JSON.stringify({ v: 1, view: "chat", frame: "a", msg: "x" })],
    ["msg tableau", JSON.stringify({ v: 1, view: "chat", frame: "a", msg: [] })],
  ])("ignore une trame invalide : %s", (_nom, data) => {
    expect(decodeEnvelope(data)).toBeNull();
  });
});

describe("canal WebSocket", () => {
  it("n'envoie rien et ne met rien en file hors ligne", () => {
    const { channel } = setup();
    channel.start();
    const socket = FakeSocket.all[0] as FakeSocket;
    expect(channel.send("shell", "shell", { type: "approve" })).toBe(false);
    socket.open();
    expect(socket.sent).toEqual([]);
    expect(channel.send("shell", "shell", { type: "ready" })).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });

  it("ne rejoue rien à la reconnexion", () => {
    const { channel, timers } = setup();
    channel.start();
    (FakeSocket.all[0] as FakeSocket).open();
    (FakeSocket.all[0] as FakeSocket).drop();
    expect(channel.send("shell", "shell", { type: "approve" })).toBe(false);
    (timers[0] as { fn: () => void }).fn();
    const second = FakeSocket.all[1] as FakeSocket;
    second.open();
    expect(second.sent).toEqual([]);
  });

  it("reconnecte de 1 s à 30 s puis repart de 1 s après une ouverture", async () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    const { channel, timers } = setup();
    channel.start();
    for (let i = 0; i < 3; i++) {
      (FakeSocket.all[i] as FakeSocket).drop();
      await Promise.resolve();
      expect((timers[i] as { ms: number }).ms).toBe(1000 * 2 ** i);
      (timers[i] as { fn: () => void }).fn();
    }
    (FakeSocket.all[3] as FakeSocket).open();
    (FakeSocket.all[3] as FakeSocket).drop();
    await Promise.resolve();
    expect((timers[3] as { ms: number }).ms).toBe(1000);
  });

  it("transmet les enveloppes valides et ignore les autres", () => {
    const { channel } = setup();
    const seen = vi.fn();
    channel.onMessage(seen);
    channel.start();
    const socket = FakeSocket.all[0] as FakeSocket;
    socket.open();
    socket.push("n'importe quoi");
    socket.push(JSON.stringify({ v: 1, view: "shell", frame: "shell", msg: { type: "x" } }));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("session expirée : retour à la connexion, pas de reconnexion", async () => {
    const lost = vi.fn();
    const { channel, timers } = setup({ sessionAlive: async () => false, onSessionLost: lost });
    channel.start();
    (FakeSocket.all[0] as FakeSocket).drop();
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(0);
  });

  it("session valide : reconnexion planifiée", async () => {
    const { channel, timers } = setup({ sessionAlive: async () => true });
    channel.start();
    (FakeSocket.all[0] as FakeSocket).drop();
    await Promise.resolve();
    await Promise.resolve();
    expect(timers).toHaveLength(1);
    expect(channel.state).toBe("closed");
  });
});
