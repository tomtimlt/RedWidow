import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { renderViewPage, withChatExtras } from "../src/web/view-page.js";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const types = await load("../web/wm/types.js");
const chatBridge = await load("../web/lib/chat-bridge.js");
const layouts = await load("../web/wm/layouts.js");
const { chatErrorText } = chatBridge;
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const ORIGIN = "https://chasse.exemple.fr";

describe("specFromOpenWindow : viewer, term, chat", () => {
  it("viewer : clé viewer:<cadre> quel que soit le mode, mode absent = monitor", () => {
    for (const [mode, kind, urlMode] of [
      ["report", "report", "report"],
      ["watch", "output", "watch"],
      ["monitor", "monitor", "monitor"],
      [undefined, "monitor", "monitor"],
    ] as const) {
      expect(types.specFromOpenWindow({ view: "viewer", frame: "m-abc123", mode })).toMatchObject({
        key: "viewer:m-abc123",
        view: "viewer",
        frame: "m-abc123",
        type: kind,
        mode: urlMode,
      });
    }
    expect(types.specFromOpenWindow({ view: "viewer", frame: "m1", mode: "autre" })).toBeNull();
    expect(types.specFromOpenWindow({ view: "viewer", frame: "../x", mode: "report" })).toBeNull();
    expect(types.specFromOpenWindow({ view: "viewer", mode: "report" })).toBeNull();
  });

  it("term : nouvelle fenêtre Terminal, conteneur présélectionné, jamais ouvert d'office", () => {
    const spec = types.specFromOpenWindow({ view: "term", frame: "term", container: "kali-recon" });
    expect(spec).toMatchObject({ kind: "native", type: "terminal", container: "kali-recon" });
    expect(spec.frame).toMatch(/^t-[0-9a-f-]{36}$/);
    expect(spec.key).toBe(`term:${spec.frame}`);
    // Un identifiant de cadre explicite est conservé ; sans conteneur, aucune présélection.
    const plain = types.specFromOpenWindow({ view: "term", frame: "t1" });
    expect(plain.key).toBe("term:t1");
    expect(plain.container).toBeUndefined();
    expect(types.specFromOpenWindow({ view: "term", frame: "t1", container: 12 }).container).toBe(
      undefined,
    );
  });

  it("chat : nouvelle mission (identifiant généré si le cadre est la valeur par défaut)", () => {
    const fixed = () => "a";
    expect(types.specFromOpenWindow({ view: "chat", frame: "chat" }, fixed)).toMatchObject({
      key: "chat:m-aaaaaa",
      type: "mission",
      view: "chat",
    });
    expect(types.specFromOpenWindow({ view: "chat", frame: "m-xyz789" })?.key).toBe(
      "chat:m-xyz789",
    );
    expect(types.specFromOpenWindow({ view: "chat" }, fixed)?.key).toBe("chat:m-aaaaaa");
    expect(types.specFromOpenWindow({ view: "chat", frame: "a/b" }, fixed)?.key).toBe(
      "chat:m-aaaaaa",
    );
  });

  it("les vues hors liste restent refusées", () => {
    expect(types.specFromOpenWindow({ view: "studio", frame: "main" })).toBeNull();
    expect(types.specFromOpenWindow({ view: "sessions", frame: "main" })).toBeNull();
    expect(types.specFromOpenWindow({ view: "__proto__", frame: "x" })).toBeNull();
  });

  it("openWindowExtras : brouillon borné, toolUseId du seul mode watch", () => {
    expect(types.openWindowExtras({ view: "chat", draft: "Étudier le port 22" })).toEqual({
      draft: "Étudier le port 22",
    });
    expect(types.openWindowExtras({ view: "chat", draft: "x".repeat(4001) })).toEqual({});
    expect(types.openWindowExtras({ view: "chat", draft: "x".repeat(4000) }).draft).toHaveLength(
      4000,
    );
    expect(types.openWindowExtras({ view: "chat", draft: "  " })).toEqual({});
    expect(types.openWindowExtras({ view: "chat", draft: 3 })).toEqual({});
    // Le brouillon n'a de sens que pour le chat.
    expect(types.openWindowExtras({ view: "cockpit", draft: "x" })).toEqual({});
    expect(
      types.openWindowExtras({ view: "viewer", mode: "watch", toolUseId: "toolu_01" }),
    ).toEqual({ toolUseId: "toolu_01" });
    expect(types.openWindowExtras({ view: "viewer", mode: "monitor", toolUseId: "t" })).toEqual({});
    expect(types.openWindowExtras({ view: "viewer", mode: "watch", toolUseId: "a\nb" })).toEqual(
      {},
    );
    expect(types.openWindowExtras(null)).toEqual({});
  });

  it("une disposition enregistrée restaure le mode du viewer", () => {
    expect(layouts.specOfWindow({ view: "viewer", id: "r1", mode: "report" }).type).toBe("report");
    expect(layouts.specOfWindow({ view: "viewer", id: "r1", mode: "watch" }).type).toBe("output");
    expect(layouts.specOfWindow({ view: "viewer", id: "r1" }).type).toBe("monitor");
  });
});

describe("messages du chat côté coquille", () => {
  it("chatErrorText : français, code inconnu générique, code invalide jamais recopié", () => {
    expect(chatErrorText("view.failed")).toContain("échoué");
    expect(chatErrorText("code.inconnu")).toBe("Action refusée ou impossible (code.inconnu).");
    expect(chatErrorText("<img onerror=x>")).toBe("Action refusée ou impossible.");
    expect(chatErrorText(undefined)).toBe("Action refusée ou impossible.");
    expect(chatErrorText("x".repeat(80))).toBe("Action refusée ou impossible.");
  });

  it("parseMissionContext : cadre valide, texte non vide et borné", () => {
    expect(
      chatBridge.parseMissionContext({ frame: "m1", runId: "r", text: "  Périmètre : acme  " }),
    ).toEqual({ frame: "m1", text: "Périmètre : acme" });
    expect(
      chatBridge.parseMissionContext({ frame: "m1", text: "x".repeat(9000) }).text,
    ).toHaveLength(4000);
    for (const bad of [
      null,
      { frame: "a/b", text: "x" },
      { frame: "m1", text: "   " },
      { frame: "m1", text: 3 },
      { text: "x" },
    ]) {
      expect(chatBridge.parseMissionContext(bad)).toBeNull();
    }
  });

  it("afterReady : l'action ponctuelle ne se rejoue pas, la durable oui, un nouvel ordre remplace", () => {
    const q = chatBridge.createAfterReady();
    const once = { run: vi.fn() };
    const durable = { durable: true, run: vi.fn() };
    q.set("chat", "m1", [once, durable]);
    expect(q.take("chat", "m1")).toEqual([once, durable]);
    expect(q.take("chat", "m1")).toEqual([durable]);
    expect(q.take("chat", "m2")).toEqual([]);
    q.set("chat", "m1", []);
    expect(q.take("chat", "m1")).toEqual([]);
    expect(q.size()).toBe(0);
    for (let i = 0; i < 100; i += 1) q.set("chat", `m${i}`, [once]);
    expect(q.size()).toBeLessThanOrEqual(32);
  });
});

describe("page de chat : chat-extras.js", () => {
  it("le script est ajouté au chat seulement, sous le nonce, après le dernier script", () => {
    const nonce = "bm9uY2UtZGUtdGVzdC0xMjM=";
    const chat = renderViewPage("chat", { nonce });
    const scripts = chat.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.at(-1)).toBe(`<script nonce="${nonce}" src="/chat-extras.js">`);
    expect(scripts.filter((s) => s.includes("chat-extras"))).toHaveLength(1);
    for (const view of ["cockpit", "viewer", "killchain", "studio"] as const) {
      expect(renderViewPage(view, { nonce })).not.toContain("chat-extras");
    }
    expect(withChatExtras("<p>x</p>", "n")).toContain('src="/chat-extras.js"');
  });
});

// ───────────────────────────── bridge.js : ready du viewer ─────────────────────────────

function runBridge(pathname: string, search: string) {
  const parentPosts: unknown[] = [];
  const parent = { postMessage: (m: unknown, o: string) => parentPosts.push([m, o]) };
  const win: Record<string, unknown> = { addEventListener: () => {}, dispatchEvent: () => {} };
  win.parent = parent;
  runInNewContext(source("../web/bridge.js"), {
    window: win,
    document: { addEventListener: () => {} },
    location: { search, pathname, origin: ORIGIN },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    URLSearchParams,
    MessageEvent: class {},
    Object,
    JSON,
  });
  const api = (win.acquireVsCodeApi as () => { postMessage(msg: unknown): void })();
  return { api, parentPosts };
}

describe("bridge.js : ready du viewer porte le mode de l'URL", () => {
  it.each(["report", "watch", "monitor"])("mode=%s", (mode) => {
    const b = runBridge("/view/viewer", `?frame=m1&mode=${mode}`);
    b.api.postMessage({ type: "ready" });
    expect(b.parentPosts).toEqual([[{ rw: 1, msg: { type: "ready", mode } }, ORIGIN]]);
  });

  it("les autres messages du viewer ne sont pas modifiés", () => {
    const b = runBridge("/view/viewer", "?frame=m1&mode=report");
    b.api.postMessage({ type: "exportReport", projectId: "p" });
    b.api.postMessage({ type: "watch", toolUseId: "t1" });
    expect(b.parentPosts).toEqual([
      [{ rw: 1, msg: { type: "exportReport", projectId: "p" } }, ORIGIN],
      [{ rw: 1, msg: { type: "watch", toolUseId: "t1" } }, ORIGIN],
    ]);
  });

  it("un mode absent, inconnu ou une autre vue : ready inchangé", () => {
    for (const [path, search] of [
      ["/view/viewer", "?frame=m1"],
      ["/view/viewer", "?frame=m1&mode=autre"],
      ["/view/chat", "?frame=m1&mode=report"],
    ]) {
      const b = runBridge(path as string, search as string);
      b.api.postMessage({ type: "ready" });
      expect(b.parentPosts).toEqual([[{ rw: 1, msg: { type: "ready" } }, ORIGIN]]);
    }
  });

  it("un mode déjà fixé par la page est respecté", () => {
    const b = runBridge("/view/viewer", "?frame=m1&mode=report");
    b.api.postMessage({ type: "ready", mode: "monitor" });
    expect(b.parentPosts).toEqual([[{ rw: 1, msg: { type: "ready", mode: "monitor" } }, ORIGIN]]);
  });
});

// ───────────────────────────── chat-extras.js dans un DOM factice ─────────────────────────────

type Handler = (e: unknown) => void;
class FakeEl {
  id = "";
  type = "";
  className = "";
  title = "";
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  children: unknown[] = [];
  after = vi.fn((n: unknown) => this.siblings.push(n));
  siblings: unknown[] = [];
  focus = vi.fn();
  attrs = new Map<string, string>();
  handlers = new Map<string, Handler[]>();
  dispatched: { type: string; init?: { dataTransfer?: { files: unknown[] } } }[] = [];
  constructor(private svg = false) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  append(n: unknown) {
    this.children.push(n);
  }
  querySelector(sel: string) {
    return this.svg && sel === "svg" ? { cloneNode: () => ({ cloned: true }) } : null;
  }
  addEventListener(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  dispatchEvent(e: { type: string }) {
    this.dispatched.push(e as never);
    for (const h of this.handlers.get(e.type) ?? []) h(e);
    return true;
  }
  setSelectionRange = vi.fn();
  click() {
    for (const h of this.handlers.get("click") ?? []) h({});
  }
}

function runExtras() {
  const els: Record<string, FakeEl> = {
    input: new FakeEl(),
    "composer-menu-btn": new FakeEl(),
    "attach-btn": new FakeEl(true),
    composer: new FakeEl(),
    "attachment-status": new FakeEl(),
  };
  const posted: Record<string, unknown>[] = [];
  const created: FakeEl[] = [];
  const winHandlers: Handler[] = [];
  const observers: (() => void)[] = [];
  class DataTransferStub {
    files: unknown[] = [];
    items = { add: (f: unknown) => this.files.push(f) };
  }
  class FileStub {
    constructor(
      public parts: unknown[],
      public name: string,
      public opts: { type: string },
    ) {}
  }
  class DragEventStub {
    type: string;
    init: { dataTransfer: DataTransferStub };
    constructor(type: string, init: { dataTransfer: DataTransferStub }) {
      this.type = type;
      this.init = init;
    }
  }
  class EventStub {
    constructor(public type: string) {}
  }
  const sandbox = {
    document: {
      getElementById: (id: string) => els[id] ?? null,
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
    },
    window: { addEventListener: (_t: string, fn: Handler) => winHandlers.push(fn) },
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
    MutationObserver: class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
    },
    DataTransfer: DataTransferStub,
    File: FileStub,
    DragEvent: DragEventStub,
    Event: EventStub,
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    Uint8Array,
    Object,
    Date,
    setTimeout,
    clearTimeout,
  };
  runInNewContext(source("../web/chat-extras.js"), sandbox);
  /** Message de la coquille tel que le pont le rejoue : sans source ni origine. */
  const fromShell = (data: unknown) => {
    for (const h of winHandlers) h({ source: null, origin: "", data });
  };
  // Premier message : l'annonce à la coquille (elle attend ce signal pour poser un brouillon).
  const hello = [...posted];
  posted.length = 0;
  return { els, posted, created, fromShell, winHandlers, observers, hello };
}

describe("chat-extras.js", () => {
  it("annonce extrasReady à la coquille une fois à l'écoute, et rien d'autre", () => {
    expect(runExtras().hello).toEqual([{ type: "extrasReady" }]);
  });

  it("ajoute le bouton « Joindre un fichier » à côté du +, désactivé comme le bouton de la page", () => {
    const x = runExtras();
    const button = x.created[0];
    expect(button?.attrs.get("aria-label")).toBe("Joindre un fichier");
    expect(button?.id).toBe("attach-pick-btn");
    expect(x.els["composer-menu-btn"]?.siblings).toEqual([button]);
    x.els["attach-btn"]!.disabled = true;
    x.observers[0]?.();
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(x.posted).toEqual([]);
  });

  it("un clic envoie attachPick, un seul à la fois ; le texte renvoyé est déposé comme un fichier", () => {
    const x = runExtras();
    const button = x.created[0]!;
    button.click();
    button.click();
    expect(x.posted).toHaveLength(1);
    const { requestId } = x.posted[0] as { type: string; requestId: string };
    expect(x.posted[0]).toMatchObject({ type: "attachPick" });
    // Une autre demande est ignorée.
    x.fromShell({
      type: "attachmentPicked",
      requestId: "autre",
      attachment: { name: "n.txt", text: "x" },
    });
    expect(x.els.composer?.dispatched).toHaveLength(0);
    x.fromShell({
      type: "attachmentPicked",
      requestId,
      attachment: { name: "notes.md", text: "# Notes" },
    });
    const drop = x.els.composer?.dispatched[0] as unknown as {
      type: string;
      init: { dataTransfer: { files: { name: string; parts: unknown[] }[] } };
    };
    expect(drop.type).toBe("drop");
    expect(drop.init.dataTransfer.files[0]).toMatchObject({ name: "notes.md", parts: ["# Notes"] });
    // Le dépôt ne déclenche aucun envoi.
    expect(x.posted.filter((m) => m.type === "send")).toEqual([]);
    expect(button.disabled).toBe(false);
  });

  it("une image (base64) devient un fichier binaire du bon type", () => {
    const x = runExtras();
    x.created[0]?.click();
    const { requestId } = x.posted[0] as { requestId: string };
    x.fromShell({
      type: "attachmentPicked",
      requestId,
      attachment: { name: "capture.png", mimeType: "image/png", data: "iVBORw0KGgo=" },
    });
    const drop = x.els.composer?.dispatched[0] as unknown as {
      init: {
        dataTransfer: { files: { name: string; opts: { type: string }; parts: Uint8Array[] }[] };
      };
    };
    const file = drop.init.dataTransfer.files[0];
    expect(file?.opts.type).toBe("image/png");
    expect(Array.from(file?.parts[0] ?? []).slice(0, 4)).toEqual([137, 80, 78, 71]);
  });

  it("un refus s'affiche en français ; l'annulation reste silencieuse ; un attachement forgé est refusé", () => {
    const x = runExtras();
    const button = x.created[0]!;
    const status = x.els["attachment-status"]!;
    button.click();
    x.fromShell({
      type: "attachmentRefused",
      requestId: (x.posted[0] as { requestId: string }).requestId,
      reason: "type",
    });
    expect(status.textContent).toContain("Type refusé");
    expect(status.hidden).toBe(false);
    button.click();
    x.fromShell({
      type: "attachmentRefused",
      requestId: (x.posted[1] as { requestId: string }).requestId,
      reason: "cancelled",
    });
    expect(status.textContent).toBe("");
    button.click();
    x.fromShell({
      type: "attachmentPicked",
      requestId: (x.posted[2] as { requestId: string }).requestId,
      attachment: { name: "../../etc/passwd", text: "x" },
    });
    expect(status.textContent).toBe("Impossible de joindre ce fichier.");
    expect(x.els.composer?.dispatched).toHaveLength(0);
  });

  it("draft : le texte est posé dans le champ, jamais envoyé", () => {
    const x = runExtras();
    x.fromShell({ type: "draft", text: "Cartographier le périmètre acme" });
    expect(x.els.input?.value).toBe("Cartographier le périmètre acme");
    expect(x.els.input?.dispatched.map((e) => e.type)).toEqual(["input"]);
    expect(x.els.input?.focus).toHaveBeenCalled();
    expect(x.posted).toEqual([]);
    // Texte déjà saisi : conservé, le brouillon suit.
    x.fromShell({ type: "draft", text: "Deuxième" });
    expect(x.els.input?.value).toBe("Cartographier le périmètre acme\n\nDeuxième");
    expect(x.posted).toEqual([]);
  });

  it("draft invalide, trop long ou champ désactivé : ignoré", () => {
    const x = runExtras();
    for (const bad of [
      { type: "draft" },
      { type: "draft", text: 3 },
      { type: "draft", text: " " },
    ]) {
      x.fromShell(bad);
    }
    x.fromShell({ type: "draft", text: "x".repeat(4001) });
    expect(x.els.input?.value).toBe("");
    x.els.input!.disabled = true;
    x.fromShell({ type: "draft", text: "ok" });
    expect(x.els.input?.value).toBe("");
  });

  it("ignore les vrais messages (source ou origine renseignées) : seuls ceux du pont comptent", () => {
    const x = runExtras();
    for (const h of x.winHandlers) {
      h({ source: {}, origin: ORIGIN, data: { type: "draft", text: "forgé" } });
      h({ source: null, origin: ORIGIN, data: { type: "draft", text: "forgé" } });
    }
    expect(x.els.input?.value).toBe("");
  });

  it("ne contient ni innerHTML ni attribut style ni envoi de message de chat", () => {
    const text = source("../web/chat-extras.js");
    for (const forbidden of ["innerHTML", ".style", 'type: "send"', "submit(", "requestSubmit"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
