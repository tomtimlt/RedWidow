import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

/** Nœud DOM minimal : assez pour que studio.js construise la navigation et une page. */
class Node {
  children: Node[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  constructor(readonly tag: string) {}
  get firstChild() {
    return this.children[0];
  }
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      contains: (c: string) => this.classes.has(c),
    };
  }
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  removeChild(node: Node) {
    this.children = this.children.filter((n) => n !== node);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  find(predicate: (node: Node) => boolean): Node | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
}

it("un clic dans la navigation change la page sans attendre l'hôte", () => {
  const main = new Node("main");
  const nav = new Node("nav");
  const sent: { type: string; page?: string }[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  const body = new Node("body");
  runInNewContext(readFileSync(new URL("../media/studio.js", import.meta.url), "utf8"), {
    acquireVsCodeApi: () => ({ postMessage: (m: { type: string }) => sent.push(m) }),
    document: {
      body,
      activeElement: null,
      hidden: false,
      addEventListener: () => {},
      getElementById: (id: string) =>
        id === "studio-main" ? main : id === "studio-nav" ? nav : null,
      createElement: (tag: string) => new Node(tag),
    },
    window: {
      WarbandIcons: { create: () => new Node("svg") },
      addEventListener: (type: string, listener: typeof receive) => {
        if (type === "message") receive = listener;
      },
    },
  });
  receive({ data: { type: "view", page: "accounts", projectId: null, testAccounts: [] } });
  const title = () => main.find((n) => n.tag === "h2")?.textContent;
  expect(title()).toBe("Comptes de test");
  const button = (page: string) => nav.find((n) => n.dataset.page === page);
  const providers = button("providers");
  expect(providers).toBeDefined();
  providers?.listeners.get("click")?.();
  // Contenu déjà remplacé, sans état de chargement, et l'hôte est prévenu.
  expect(title()).not.toBe("Comptes de test");
  expect(main.classes.has("is-loading")).toBe(false);
  expect(button("providers")?.attributes.get("aria-current")).toBe("page");
  expect(sent.at(-1)).toEqual({ type: "open", page: "providers" });
  // Une page dont les données viennent de l'hôte garde l'état de chargement.
  button("audit")?.listeners.get("click")?.();
  expect(main.classes.has("is-loading")).toBe(true);
  expect(sent.at(-1)).toEqual({ type: "open", page: "audit" });
});
