import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

class CockpitNode {
  children: CockpitNode[] = [];
  listeners = new Map<string, () => void>();
  attributes = new Map<string, string>();
  id = "";
  className = "";
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  title = "";
  constructor(readonly tag: string) {}
  get firstChild() {
    return this.children[0];
  }
  append(...nodes: CockpitNode[]) {
    this.children.push(...nodes);
  }
  removeChild(node: CockpitNode) {
    this.children = this.children.filter((n) => n !== node);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  click() {
    if (!this.disabled) this.listeners.get("click")?.();
  }
  focus() {}
  querySelector() {
    return null;
  }
  find(predicate: (node: CockpitNode) => boolean): CockpitNode | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
}

it("création repliée, brouillon préservé et détails indépendants des actions", () => {
  const main = new CockpitNode("main");
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(readFileSync(new URL("../media/cockpit.js", import.meta.url), "utf8"), {
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      getElementById: (id: string) => (id === "main" ? main : main.find((n) => n.id === id)),
      createElement: (tag: string) => new CockpitNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new CockpitNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const view = {
    type: "view",
    docker: "present",
    exegol: "absent",
    daemon: "reachable",
    linked: "none",
    containers: [
      {
        name: "kali-lab",
        short: "lab",
        image: "kali:latest",
        family: "kali",
        state: "running",
        canLink: true,
        workspace: "/host/lab",
      },
    ],
  };
  const find = (predicate: (node: CockpitNode) => boolean) => {
    const node = main.find(predicate);
    if (!node) throw new Error("Élément attendu absent");
    return node;
  };
  receive({ data: view });
  expect(main.find((n) => n.tag === "input")).toBeUndefined();
  expect(sent).not.toContainEqual({ type: "listImages" });
  const exegol = find(
    (n) =>
      n.className.includes("cockpit-tile") && n.children.some((c) => c.textContent === "Exegol"),
  );
  expect(exegol.className).toContain("tone-off");
  find((n) => n.id === "cockpit-create-toggle").click();
  expect(sent).toContainEqual({ type: "listImages" });
  const name = find((n) => n.id === "cockpit-name");
  name.value = "brouillon";
  name.listeners.get("input")?.();
  find((n) => n.id === "cockpit-create-toggle").click();
  expect(main.find((n) => n.id === "cockpit-name")).toBeUndefined();
  find((n) => n.id === "cockpit-create-toggle").click();
  expect(find((n) => n.id === "cockpit-name").value).toBe("brouillon");
  const toggle = find((n) => n.className.includes("cockpit-row-toggle"));
  expect(toggle.attributes.get("aria-expanded")).toBe("false");
  toggle.click();
  expect(find((n) => n.className === "cockpit-row-details").hidden).toBe(false);
  receive({ data: view });
  expect(find((n) => n.className === "cockpit-row-details").hidden).toBe(false);
  find((n) => n.attributes.get("aria-label") === "Arrêter").click();
  expect(sent).toContainEqual({ type: "stop", name: "kali-lab" });
  find((n) => n.attributes.get("aria-label") === "Lier").click();
  expect(sent).toContainEqual({ type: "link", name: "kali-lab" });
});
