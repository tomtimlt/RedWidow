import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const frames = await load("../web/lib/frames.js");
const { createFrameHost, parseBridgeMessage, parseDeepLink, viewUrl, RELAYED_KEYS } = frames;

const ORIGIN = "https://chasse.exemple.fr";

function fakeDoc() {
  const made: FakeIframe[] = [];
  class FakeIframe {
    className = "";
    title = "";
    referrerPolicy = "";
    src = "";
    hidden = false;
    posted: unknown[] = [];
    contentWindow = {
      postMessage: (msg: unknown, origin: string) => this.posted.push([msg, origin]),
    };
    addEventListener() {}
    remove() {
      this.removed = true;
    }
    removed = false;
  }
  return {
    made,
    doc: {
      createElement() {
        const f = new FakeIframe();
        made.push(f);
        return f;
      },
    },
    container: { append() {} },
  };
}

function host(over: Record<string, unknown> = {}) {
  const f = fakeDoc();
  const send = vi.fn(() => true);
  const onFocus = vi.fn();
  const onKey = vi.fn();
  const h = createFrameHost({
    container: f.container,
    doc: f.doc,
    origin: ORIGIN,
    send,
    onFocus,
    onKey,
    setTimer: () => 1,
    clearTimer: () => {},
    ...over,
  });
  return { h, f, send, onFocus, onKey };
}

describe("messages du pont", () => {
  it("accepte seulement les trois formes exactes", () => {
    expect(parseBridgeMessage({ rw: 1, msg: { type: "ready" } })).toEqual({
      msg: { type: "ready" },
    });
    expect(parseBridgeMessage({ rw: 1, focus: true })).toEqual({ focus: true });
    expect(parseBridgeMessage({ rw: 1, key: "Ctrl+Alt+A" })).toEqual({ key: "Ctrl+Alt+A" });
    for (const bad of [
      null,
      "x",
      { rw: 2, msg: {} },
      { rw: 1 },
      { rw: 1, msg: {}, extra: 1 },
      { rw: 1, msg: [] },
      { rw: 1, msg: "x" },
      { rw: 1, focus: false },
      { rw: 1, key: "Ctrl+C" },
      { rw: 1, key: "Ctrl+Alt+Q" },
      { rw: 1, key: 5 },
    ]) {
      expect(parseBridgeMessage(bad)).toBeNull();
    }
  });
});

describe("hébergement des cadres", () => {
  it("une seule instance par identité (vue, cadre)", () => {
    const { h, f } = host();
    const a = h.open("chat", "m1");
    expect(h.open("chat", "m1")).toBe(a);
    expect(h.open("viewer", "m1")).not.toBe(a);
    expect(f.made).toHaveLength(2);
    expect(a.iframe.src).toBe("/view/chat?frame=m1");
  });

  it("refuse un nom de vue ou un identifiant hors liste", () => {
    const { h } = host();
    expect(h.open("shell", "m1")).toBeNull();
    expect(h.open("chat", "a/b")).toBeNull();
    expect(h.open("chat", "")).toBeNull();
    expect(h.open("chat", "x".repeat(65))).toBeNull();
  });

  it("URL de la vue : mode du viewer seulement", () => {
    expect(viewUrl("viewer", "r1", "watch")).toBe("/view/viewer?frame=r1&mode=watch");
    expect(viewUrl("chat", "m1", "watch")).toBe("/view/chat?frame=m1");
  });

  it("relaie un message de la page vers le canal, avec sa vue et son cadre", () => {
    const { h, send } = host();
    const e = h.open("chat", "m1");
    h.handleMessage({
      origin: ORIGIN,
      source: e.iframe.contentWindow,
      data: { rw: 1, msg: { type: "ready" } },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("chat", "m1", { type: "ready" });
  });

  it("filtre origin ET source", () => {
    const { h, send, onFocus, onKey } = host();
    const e = h.open("chat", "m1");
    const good = { rw: 1, msg: { type: "stop" } };
    h.handleMessage({
      origin: "https://autre.exemple",
      source: e.iframe.contentWindow,
      data: good,
    });
    h.handleMessage({ origin: ORIGIN, source: {}, data: good });
    h.handleMessage({ origin: ORIGIN, source: null, data: good });
    h.handleMessage({
      origin: "null",
      source: e.iframe.contentWindow,
      data: { rw: 1, focus: true },
    });
    h.handleMessage({
      origin: ORIGIN,
      source: {},
      data: { rw: 1, key: "Ctrl+Alt+A" },
    });
    expect(send).not.toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();
    expect(onKey).not.toHaveBeenCalled();
  });

  it("focus et raccourcis listés seulement", () => {
    const { h, onFocus, onKey, send } = host();
    const e = h.open("chat", "m1");
    const from = (data: unknown) =>
      h.handleMessage({ origin: ORIGIN, source: e.iframe.contentWindow, data });
    from({ rw: 1, focus: true });
    from({ rw: 1, key: "Ctrl+K" });
    from({ rw: 1, key: "Enter" });
    from({ rw: 1, key: "Ctrl+Alt+A", approve: true });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith("Ctrl+K", e);
    expect(send).not.toHaveBeenCalled();
  });

  it("transmet un message du serveur à la bonne page, vers l'origine de la coquille", () => {
    const { h } = host();
    const a = h.open("chat", "m1");
    const b = h.open("chat", "m2");
    expect(h.deliver({ view: "chat", frame: "m1", msg: { type: "view" } })).toBe(true);
    expect(a.iframe.posted).toEqual([[{ rw: 1, msg: { type: "view" } }, ORIGIN]]);
    expect(b.iframe.posted).toEqual([]);
    expect(h.deliver({ view: "chat", frame: "absent", msg: {} })).toBe(false);
  });

  it("signale un chargement trop long et recharge sur demande", () => {
    const timers: (() => void)[] = [];
    const onError = vi.fn();
    const { h } = host({
      onError,
      setTimer: (fn: () => void) => {
        timers.push(fn);
        return timers.length;
      },
    });
    const e = h.open("chat", "m1");
    (timers[0] as () => void)();
    expect(onError).toHaveBeenCalledWith(e);
    h.reload(e);
    expect(timers).toHaveLength(2);
  });

  it("la fermeture retire le cadre ; il peut être rouvert", () => {
    const { h, f } = host();
    const a = h.open("chat", "m1");
    h.close("chat", "m1");
    expect(f.made[0]?.removed).toBe(true);
    expect(h.open("chat", "m1")).not.toBe(a);
  });

  it("pose l'iframe dans le parent demandé", () => {
    const appended: unknown[] = [];
    const { h } = host();
    const e = h.open("chat", "m1", undefined, { append: (n: unknown) => appended.push(n) });
    expect(appended).toEqual([e.iframe]);
  });

  it("veille : décharger vide la page, ne reçoit plus rien ; recharger la ramène", () => {
    const { h } = host();
    const e = h.open("chat", "m1");
    h.unload(e);
    expect(e.unloaded).toBe(true);
    expect(e.iframe.src).toBe("about:blank");
    expect(h.deliver({ view: "chat", frame: "m1", msg: { type: "x" } })).toBe(false);
    h.reload(e);
    expect(e.unloaded).toBe(false);
    expect(e.iframe.src).toBe("/view/chat?frame=m1");
  });

  it("la reconnexion ne réveille pas une page déchargée", () => {
    const { h } = host();
    const live = h.open("chat", "m1");
    const asleep = h.open("chat", "m2");
    h.unload(asleep);
    live.iframe.src = "";
    h.reloadAll();
    expect(live.iframe.src).toBe("/view/chat?frame=m1");
    expect(asleep.iframe.src).toBe("about:blank");
  });
});

describe("liens profonds", () => {
  it("fenêtres à instance et écrans natifs", () => {
    expect(parseDeepLink("#w=monitor:r1")).toEqual({ kind: "monitor", id: "r1" });
    expect(parseDeepLink("#w=graphe:m1")).toEqual({ kind: "graph", id: "m1" });
    expect(parseDeepLink("#w=conteneurs")).toEqual({ kind: "native", name: "containers" });
    expect(parseDeepLink("#w=constructor")).toBeNull();
    expect(parseDeepLink("#w=toString:x")).toBeNull();
  });

  it("approbations et mission seulement", () => {
    expect(parseDeepLink("#w=approbations")).toEqual({ kind: "approvals" });
    expect(parseDeepLink("#w=mission:abc_1")).toEqual({ kind: "mission", id: "abc_1" });
    for (const bad of [
      "",
      "#w=",
      "#w=mission:",
      "#w=mission:a/b",
      "#w=terminal",
      "w=approbations",
    ]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
  });
});

// ───────────────────────────── bridge.js dans un contexte isolé ─────────────────────────────

type Listener = (e: unknown) => void;

function runBridge(search = "?frame=m1", embedded = true) {
  const listeners: Record<string, { fn: Listener; capture: boolean }[]> = {};
  const add = (type: string, fn: Listener, capture?: boolean): void => {
    listeners[type] = [...(listeners[type] ?? []), { fn, capture: capture === true }];
  };
  const parentPosts: unknown[] = [];
  const parent = { postMessage: (m: unknown, o: string) => parentPosts.push([m, o]) };
  const store = new Map<string, string>();
  const dispatched: unknown[] = [];
  class MessageEventStub {
    data: unknown;
    constructor(_type: string, init: { data: unknown }) {
      this.data = init.data;
    }
  }
  const win: Record<string, unknown> = {
    addEventListener: add,
    dispatchEvent: (e: unknown) => dispatched.push(e),
  };
  win.parent = embedded ? parent : win;
  const sandbox = {
    window: win,
    document: { addEventListener: add },
    location: { search, origin: ORIGIN },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    URLSearchParams,
    MessageEvent: MessageEventStub,
    Object,
    JSON,
  };
  runInNewContext(readFileSync(new URL("../web/bridge.js", import.meta.url), "utf8"), sandbox);
  const api = (
    win.acquireVsCodeApi as () => {
      postMessage(msg: unknown): void;
      getState(): unknown;
      setState(state: unknown): unknown;
    }
  )();
  const fire = (type: string, event: Record<string, unknown>) => {
    for (const l of listeners[type] ?? []) l.fn(event);
  };
  return { win, api, parent, parentPosts, dispatched, fire, store };
}

const keyEvent = (over: Record<string, unknown>) => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  key: "",
  code: "",
  getModifierState: () => false,
  preventDefault: vi.fn(),
  ...over,
});

describe("bridge.js", () => {
  it("postMessage de la page part vers le parent, vers l'origine de la coquille", () => {
    const b = runBridge();
    b.api.postMessage({ type: "ready" });
    expect(b.parentPosts).toEqual([[{ rw: 1, msg: { type: "ready" } }, ORIGIN]]);
  });

  it("l'état de la page est conservé par cadre", () => {
    const b = runBridge("?frame=m7");
    b.api.setState({ top: 3 });
    expect(b.store.get("rw:state:m7")).toBe('{"top":3}');
    expect(b.api.getState()).toEqual({ top: 3 });
  });

  it("ne rejoue que les messages { rw: 1, msg } du parent, de même origine", () => {
    const b = runBridge();
    const ok = {
      origin: ORIGIN,
      source: b.parent,
      data: { rw: 1, msg: { type: "view" } },
      stopImmediatePropagation: vi.fn(),
    };
    b.fire("message", ok);
    expect(ok.stopImmediatePropagation).toHaveBeenCalled();
    expect(b.dispatched).toHaveLength(1);
    expect((b.dispatched[0] as { data: unknown }).data).toEqual({ type: "view" });
    for (const bad of [
      { origin: "https://autre.exemple", source: b.parent, data: { rw: 1, msg: {} } },
      { origin: ORIGIN, source: {}, data: { rw: 1, msg: {} } },
      { origin: ORIGIN, source: b.parent, data: { rw: 1, msg: {}, extra: 1 } },
      { origin: ORIGIN, source: b.parent, data: { rw: 1, msg: "x" } },
      { origin: ORIGIN, source: b.parent, data: { type: "view" } },
    ]) {
      b.fire("message", { ...bad, stopImmediatePropagation: vi.fn() });
    }
    expect(b.dispatched).toHaveLength(1);
  });

  it("pointerdown signale le focus", () => {
    const b = runBridge();
    b.fire("pointerdown", {});
    expect(b.parentPosts).toEqual([[{ rw: 1, focus: true }, ORIGIN]]);
  });

  it("ne relaie que les raccourcis de la liste, et la liste est celle de la coquille", () => {
    const b = runBridge();
    const bridgeKeys = (b.win.__rwBridge as { RELAYED_KEYS: string[] }).RELAYED_KEYS;
    expect([...bridgeKeys]).toEqual([...RELAYED_KEYS]);

    const relayed: [string, Record<string, unknown>][] = [
      ["Ctrl+K", { ctrlKey: true, key: "k" }],
      ["Ctrl+Shift+K", { ctrlKey: true, shiftKey: true, key: "K" }],
      ["Ctrl+Alt+ArrowLeft", { ctrlKey: true, altKey: true, code: "ArrowLeft" }],
      ["Ctrl+Alt+3", { ctrlKey: true, altKey: true, code: "Digit3" }],
      ["Ctrl+Alt+`", { ctrlKey: true, altKey: true, code: "Backquote" }],
      ["Ctrl+Alt+T", { ctrlKey: true, altKey: true, code: "KeyT" }],
      ["Ctrl+Alt+A", { ctrlKey: true, altKey: true, code: "KeyA" }],
    ];
    for (const [id, e] of relayed) {
      const ev = keyEvent(e);
      b.fire("keydown", ev);
      expect(b.parentPosts.at(-1)).toEqual([{ rw: 1, key: id }, ORIGIN]);
      expect(ev.preventDefault).toHaveBeenCalled();
    }
    const before = b.parentPosts.length;
    for (const e of [
      { key: "a", code: "KeyA" },
      { ctrlKey: true, key: "c", code: "KeyC" },
      { ctrlKey: true, key: "Enter", code: "Enter" },
      { ctrlKey: true, altKey: true, code: "KeyQ" },
      { ctrlKey: true, altKey: true, code: "Digit0" },
      { ctrlKey: true, altKey: true, shiftKey: true, code: "KeyT" },
      { altKey: true, code: "KeyT" },
      { ctrlKey: true, metaKey: true, key: "k" },
      // AltGr produit des caractères (« { » au clavier français) : jamais relayé.
      { ctrlKey: true, altKey: true, code: "Digit4", getModifierState: () => true },
      { key: "Enter", code: "Enter" },
    ]) {
      const ev = keyEvent(e);
      b.fire("keydown", ev);
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
    expect(b.parentPosts).toHaveLength(before);
  });

  it("hors iframe, rien ne part", () => {
    const b = runBridge("?frame=m1", false);
    b.api.postMessage({ type: "ready" });
    b.fire("keydown", keyEvent({ ctrlKey: true, key: "k" }));
    expect(b.parentPosts).toEqual([]);
  });
});
