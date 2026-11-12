import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const screen = await load("../web/screens/files.js");
const lib = await load("../web/lib/files.js");

/** Mini DOM permissif : assez pour monter la fenêtre Fichiers et lire les bandeaux. */
class FakeEl {
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners = new Map<string, (() => void)[]>();
  classes = new Set<string>();
  hidden = false;
  disabled = false;
  inert = false;
  tabIndex = 0;
  clientWidth = 1000;
  own = "";
  type = "";
  title = "";
  constructor(public tag: string) {}
  set className(v: string) {
    this.classes = new Set(v.split(" ").filter(Boolean));
  }
  get className(): string {
    return [...this.classes].join(" ");
  }
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
    };
  }
  set textContent(v: string) {
    this.own = v;
    this.children = [];
  }
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join("");
  }
  append(...n: FakeEl[]) {
    this.children.push(...n);
  }
  replaceChildren(...n: FakeEl[]) {
    this.own = "";
    this.children = n;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener(t: string, fn: () => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  removeEventListener() {}
  fire(t: string) {
    for (const fn of this.listeners.get(t) ?? []) fn();
  }
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel === "[data-act]") return this.all().filter((n) => n.dataset.act === "1");
    if (sel === "[data-path]") return this.all().filter((n) => n.dataset.path !== undefined);
    return [];
  }
  contains() {
    return false;
  }
  focus() {}
  scrollIntoView() {}
}

const makeDoc = () => {
  const doc = new FakeEl("doc") as FakeEl & Record<string, unknown>;
  doc.createElement = (tag: string) => new FakeEl(tag);
  doc.createElementNS = (_ns: string, tag: string) => new FakeEl(tag);
  doc.activeElement = null;
  doc.visibilityState = "visible";
  return doc;
};

const entries = (names: string[]) => ({
  type: "fsEntries",
  path: "",
  truncated: false,
  entries: names.map((name) => ({ name, kind: "file", size: 1, mtime: 1 })),
});
const noProject = (op = "fsList", path = "") => ({
  type: "fsError",
  op,
  path,
  reason: { code: "fs.noProject" },
});
const projects = { type: "projects", items: [{ id: "p", name: "P" }] };

function setup() {
  const doc = makeDoc();
  const sent: { type: string; path?: string }[] = [];
  const host = screen.createFilesHost({
    doc,
    win: { addEventListener() {}, removeEventListener() {} },
    send: (m: { type: string; path?: string }) => {
      sent.push(m);
      return true;
    },
    loadEditor: () => Promise.reject(new Error("pas d'éditeur")),
  });
  host.setOnline(true);
  const body = new FakeEl("div");
  const api = host.mount(body, {});
  const lists = () => sent.filter((m) => m.type === "fsList");
  const banner = () => {
    const b = body.all().find((n) => n.classes.has("fx-project"));
    return b && !b.hidden ? b.textContent : null;
  };
  const root = body.children[0] as FakeEl;
  return { host, api, sent, lists, banner, root };
}

/** Ouvre a.txt (texte lu) dans la fenêtre. */
function openTab(host: { onMessage(m: unknown): void; navigate(p: string): void }) {
  host.onMessage(entries(["README.md", "a.txt"]));
  host.navigate("a.txt");
  host.onMessage({
    type: "fsInfo",
    path: "a.txt",
    exists: true,
    kind: "file",
    size: 1,
    mtime: 1,
    etag: "v1",
  });
  host.onMessage({ type: "fsContent", path: "a.txt", text: "x", etag: "v1", mtime: 1, size: 1 });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fichiers : changement de projet", () => {
  it("projects est lu comme un signal", () => {
    expect(lib.parseFsMessage(projects)).toEqual({ kind: "projects" });
  });

  it("sans projet actif, projects relance fsList de la racine", () => {
    const { host, lists } = setup();
    expect(lists()).toHaveLength(1);
    host.onMessage(noProject());
    host.onMessage(projects);
    expect(lists()).toHaveLength(1);
    vi.advanceTimersByTime(250);
    expect(lists()).toHaveLength(2);
    expect(lists()[1]?.path).toBe("");
  });

  it("une rafale de projects ne donne qu'un seul fsList", () => {
    const { host, lists } = setup();
    host.onMessage(noProject());
    for (let i = 0; i < 6; i += 1) host.onMessage(projects);
    vi.advanceTimersByTime(1000);
    expect(lists()).toHaveLength(2);
  });

  it("le focus relit l'état « aucun projet », une fois par rafale", () => {
    const { host, lists, root } = setup();
    host.onMessage(noProject());
    vi.advanceTimersByTime(1000);
    root.fire("focusin");
    root.fire("focusin");
    expect(lists()).toHaveLength(2);
  });

  it("même projet : relecture sans bannière, onglet conservé", () => {
    const { host, api, lists, banner } = setup();
    openTab(host);
    host.onMessage(projects);
    vi.advanceTimersByTime(250);
    expect(lists().length).toBeGreaterThanOrEqual(2);
    host.onMessage(entries(["README.md", "a.txt"]));
    expect(banner()).toBeNull();
    expect(api.dirtyCount()).toBe(0);
  });

  it("racine incompatible : bannière, onglet modifié conservé", () => {
    const { host, api, banner } = setup();
    openTab(host);
    api.handle({ kind: "projects" });
    vi.advanceTimersByTime(250);
    host.onMessage(entries(["autre.md"]));
    expect(banner()).toContain("Le projet actif a changé");
  });

  it("fs.noProject après un projet affiché : bannière, onglets gardés", () => {
    const { host, banner } = setup();
    openTab(host);
    host.onMessage(noProject());
    expect(banner()).toContain("Le projet actif a changé");
  });

  it("fs.noProject après une sauvegarde : bannière claire", () => {
    const { host, banner } = setup();
    host.onMessage(entries(["a.txt"]));
    host.onMessage(noProject("fsWrite", "a.txt"));
    expect(banner()).toContain("Aucun projet actif");
  });

  it("rootsIncompatible : racines sans point commun seulement", () => {
    const e = (n: string) => ({ name: n, kind: "file" });
    expect(lib.rootsIncompatible([e("a")], [e("b")])).toBe(true);
    expect(lib.rootsIncompatible([e("a")], [e("a"), e("b")])).toBe(false);
    expect(lib.rootsIncompatible([], [e("b")])).toBe(false);
  });
});
