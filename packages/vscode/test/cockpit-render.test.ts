import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUiTranslator } from "@warband/messages";
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
  checked = false;
  title = "";
  scrollTop = 0;
  scrollLeft = 0;
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection = "none";
  onFocus = () => {};
  setSelectionRange(start: number, end: number, direction: string) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
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
  focus() {
    this.onFocus();
  }
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

const cockpit = (exegol = "present") => {
  const main = new CockpitNode("main");
  const sent: unknown[] = [];
  let locale: "fr" | "en" = "fr";
  let activeElement: CockpitNode | undefined;
  const descendants = (node: CockpitNode): CockpitNode[] => [
    node,
    ...node.children.flatMap(descendants),
  ];
  const i18n = {
    t: createUiTranslator(() => locale),
    getLocale: () => locale,
    setLocale: (next: "fr" | "en") => {
      locale = next;
    },
    applyStatic() {},
  };
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(readFileSync(new URL("../media/cockpit.js", import.meta.url), "utf8"), {
    WarbandI18n: i18n,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      getElementById: (id: string) => (id === "main" ? main : main.find((n) => n.id === id)),
      querySelectorAll: () => descendants(main),
      get activeElement() {
        return activeElement;
      },
      createElement: (tag: string) => {
        const node = new CockpitNode(tag);
        node.onFocus = () => {
          activeElement = node;
        };
        return node;
      },
    },
    window: {
      WarbandIcons: { create: () => new CockpitNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const send = (data: unknown) => receive({ data });
  const view = {
    type: "view",
    docker: "present",
    exegol,
    daemon: "reachable",
    linked: "none",
    containers: [{ name: "lab", family: "kali", image: "kali", state: "stopped", canLink: true }],
  };
  send(view);
  const find = (predicate: (node: CockpitNode) => boolean) => {
    const node = main.find(predicate);
    if (!node) throw new Error("Élément attendu absent");
    return node;
  };
  const field = (id: string) => find((node) => node.id === id);
  const button = (label: string) => find((node) => node.attributes.get("aria-label") === label);
  return { main, sent, send, view, field, button, find, active: () => activeElement };
};

it("transmet les options Exegol et conserve le brouillon pendant la progression", () => {
  const ui = cockpit();
  ui.send({ ...ui.view, projectWorkspace: "/tmp/mission" });
  ui.field("cockpit-create-toggle").click();
  const name = ui.field("cockpit-name");
  name.value = "mission";
  name.listeners.get("input")?.();
  ui.send({ type: "pickedSharedFolder", path: "/tmp/mission" });
  ui.send({ type: "pickedVpn", label: "mission.ovpn" });
  expect(ui.main.find((node) => node.textContent === "mission.ovpn")).toBeDefined();
  ui.button("Créer").click();
  ui.button("Créer").click();
  expect(
    ui.sent.filter((message) => (message as { type: string }).type === "createExegol"),
  ).toEqual([
    {
      type: "createExegol",
      name: "mission",
      image: "free",
      vpn: false,
      desktop: false,
      desktopPort: 6080,
      network: "nat",
      shareResources: true,
      shareMyResources: true,
    },
  ]);
  ui.send({
    type: "operation",
    busy: true,
    stage: "Téléchargement",
    layers: [
      {
        id: "abc",
        status: "Téléchargement",
        current: 25,
        total: 100,
        speedBytesPerSecond: 2097152,
      },
      { id: "def", status: "Extraction" },
    ],
  });
  expect(ui.field("cockpit-name").value).toBe("mission");
  expect(ui.button("Supprimer").disabled).toBe(true);
  const bar = ui.find((node) => node.tag === "progress");
  expect(bar.value).toBe(25);
  expect(bar.attributes.get("aria-label")).toContain("2.0 Mio/s");
  const cancel = ui.button("Annuler");
  const draft = ui.field("cockpit-name");
  ui.send({
    type: "operation",
    busy: true,
    stage: "Extraction",
    layers: [{ id: "abc", status: "Pull complete" }],
  });
  expect(ui.button("Annuler")).toBe(cancel);
  expect(ui.field("cockpit-name")).toBe(draft);
  expect(ui.find((node) => node.tag === "progress").value).toBe(1);
  cancel.click();
  expect(ui.sent).toContainEqual({ type: "cancelOperation" });
  ui.send({ type: "operation", busy: false, stage: "Annulé" });
  expect(ui.button("Créer").disabled).toBe(false);
});

it("propose Kali Warband sans attendre les images locales et transmet la suppression", () => {
  const ui = cockpit("absent");
  ui.field("cockpit-create-toggle").click();
  expect(ui.field("cockpit-image").value).toBe("warband/kali:complete-1");
  ui.send({ type: "images", images: ["local/kali:latest"] });
  expect(ui.field("cockpit-image").children.map((node) => node.value)).toEqual([
    "warband/kali:complete-1",
    "kalilinux/kali-rolling:latest",
    "local/kali:latest",
  ]);
  ui.button("Supprimer").click();
  expect(ui.sent).toContainEqual({ type: "remove", name: "lab" });
  expect(ui.button("Démarrer").disabled).toBe(true);
});

it("garde les choix Exegol et bloque le bureau hors NAT", () => {
  const ui = cockpit();
  ui.send({ ...ui.view, projectWorkspace: "/tmp/mission" });
  ui.field("cockpit-create-toggle").click();
  ui.field("cockpit-name").value = "mission";
  ui.field("cockpit-name").listeners.get("input")?.();
  ui.send({ type: "pickedSharedFolder", path: "/tmp/mission" });
  for (const id of ["vpn", "desktop"]) {
    const input = ui.field(`cockpit-${id}`);
    input.checked = true;
    input.listeners.get("change")?.();
  }
  ui.button("Choisir une configuration VPN").click();
  expect(ui.sent).toContainEqual({ type: "pickVpn" });
  const network = ui.field("cockpit-network");
  network.value = "host";
  network.listeners.get("change")?.();
  expect(ui.button("Créer").disabled).toBe(true);
  const nat = ui.field("cockpit-network");
  nat.value = "nat";
  nat.listeners.get("change")?.();
  const resources = ui.field("cockpit-shareResources");
  resources.checked = false;
  resources.listeners.get("change")?.();
  ui.button("Créer").click();
  expect(ui.sent).toContainEqual({
    type: "createExegol",
    name: "mission",
    image: "free",
    vpn: true,
    desktop: true,
    desktopPort: 6080,
    network: "nat",
    shareResources: false,
    shareMyResources: true,
  });
});

it("refuse les brouillons invalides et réactive la création Kali après choix du dossier", () => {
  const ui = cockpit("absent");
  ui.field("cockpit-create-toggle").click();
  expect(ui.button("Créer").disabled).toBe(true);
  const name = ui.field("cockpit-name");
  name.value = "nom avec espaces";
  name.listeners.get("input")?.();
  ui.send({ type: "pickedSharedFolder", path: "/tmp/mission" });
  expect(ui.button("Créer").disabled).toBe(true);
  name.value = "mission";
  name.listeners.get("input")?.();
  expect(ui.button("Créer").disabled).toBe(false);
  ui.button("Créer").click();
  expect(ui.sent).toContainEqual({
    type: "createKali",
    name: "mission",
    image: "warband/kali:complete-1",
  });
});

it("change de langue sans perdre le formulaire, le focus, la sélection et les détails", () => {
  const ui = cockpit("absent");
  ui.field("cockpit-create-toggle").click();
  const name = ui.field("cockpit-name");
  name.value = "Projet français";
  name.listeners.get("input")?.();
  name.focus();
  name.setSelectionRange(2, 6, "backward");
  ui.main.scrollTop = 123;
  ui.find((node) => node.className.includes("cockpit-row-toggle")).click();
  ui.send({ type: "locale", locale: "en" });
  expect(ui.button("Create")).toBeDefined();
  expect(ui.field("cockpit-name").value).toBe("Projet français");
  expect(ui.active()).toBe(ui.field("cockpit-name"));
  expect(ui.field("cockpit-name").selectionStart).toBe(2);
  expect(ui.field("cockpit-name").selectionEnd).toBe(6);
  expect(ui.main.scrollTop).toBe(123);
  expect(ui.find((node) => node.className === "cockpit-row-details").hidden).toBe(false);
  expect(ui.find((node) => node.textContent === "lab")).toBeDefined();
  ui.send({ type: "locale", locale: "fr" });
  expect(ui.button("Créer")).toBeDefined();
  expect(ui.field("cockpit-name").value).toBe("Projet français");
});

it("la création attend le dossier partagé choisi sur l'hôte et ne le déduit pas du projet", () => {
  const ui = cockpit();
  ui.field("cockpit-create-toggle").click();
  ui.field("cockpit-name").value = "lab";
  ui.field("cockpit-name").listeners.get("input")?.();
  ui.send({ ...ui.view, projectWorkspace: "/tmp/project-A" });
  // Aucune valeur par défaut : le dossier du projet n'est pas proposé.
  expect(ui.button("Créer").disabled).toBe(true);
  expect(ui.main.find((node) => node.id === "cockpit-source")).toBeUndefined();
  ui.button("Choisir…").click();
  expect(ui.sent).toContainEqual({ type: "pickSharedFolder" });
  ui.send({ type: "pickedSharedFolder", path: "/srv/partage" });
  expect(ui.button("Créer").disabled).toBe(false);
  expect(ui.field("cockpit-source").textContent).toContain("/srv/partage");
  // Un changement de projet ne touche pas au dossier choisi.
  ui.send({ ...ui.view, projectWorkspace: "/tmp/project-B" });
  expect(ui.field("cockpit-source").textContent).toContain("/srv/partage");
  ui.button("Créer").click();
  const created = ui.sent.find(
    (message) => (message as { type: string }).type === "createExegol",
  ) as Record<string, unknown>;
  expect(created).toBeDefined();
  expect(created).not.toHaveProperty("source");
  // L'hôte oublie le dossier après une création réussie : la webview le retire et bloque Créer.
  ui.send({ type: "pickedSharedFolder", path: "" });
  expect(ui.button("Créer").disabled).toBe(true);
  expect(ui.main.find((node) => node.id === "cockpit-source")).toBeUndefined();
});

it("la recommandation de créer un conteneur ouvre directement le formulaire", () => {
  const ui = cockpit();
  ui.send({ ...ui.view, projectWorkspace: "/tmp/mission" });
  ui.send({ type: "focusCreate" });
  expect(ui.field("cockpit-name")).toBeDefined();
  expect(ui.field("cockpit-create-toggle").attributes.get("aria-expanded")).toBe("true");
});
