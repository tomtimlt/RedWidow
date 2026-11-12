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
  findAll(predicate: (node: CockpitNode) => boolean): CockpitNode[] {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.findAll(predicate)),
    ];
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

it("création repliée, brouillon préservé et actions portées par la carte", () => {
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
  // Le bouton d'entrée est masqué tant que le panneau est ouvert.
  expect(main.find((n) => n.id === "cockpit-create-toggle")).toBeUndefined();
  find((n) => n.className.includes("cockpit-create-close")).click();
  expect(main.find((n) => n.id === "cockpit-name")).toBeUndefined();
  expect(main.find((n) => n.id === "cockpit-create-toggle")).toBeDefined();
  find((n) => n.id === "cockpit-create-toggle").click();
  expect(find((n) => n.id === "cockpit-name").value).toBe("brouillon");
  expect(main.find((n) => n.className.includes("cockpit-card"))).toBeDefined();
  receive({ data: view });
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
  // Pendant la création : bouton inerte « Création… », un seul message publié.
  expect(ui.button("Création…").disabled).toBe(true);
  ui.button("Création…").click();
  expect(
    ui.sent.filter((message) => (message as { type: string }).type === "createExegol"),
  ).toEqual([
    {
      type: "createExegol",
      shareMode: "project",
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
  ui.send({ type: "operation", busy: false, stage: "Opération annulée" });
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
    shareMode: "project",
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
    shareMode: "multi",
    name: "mission",
    image: "warband/kali:complete-1",
  });
});

it("change de langue sans perdre le formulaire, le focus et la sélection", () => {
  const ui = cockpit("absent");
  ui.field("cockpit-create-toggle").click();
  const name = ui.field("cockpit-name");
  name.value = "Projet français";
  name.listeners.get("input")?.();
  name.focus();
  name.setSelectionRange(2, 6, "backward");
  ui.main.scrollTop = 123;
  ui.send({ type: "locale", locale: "en" });
  expect(ui.button("Create")).toBeDefined();
  expect(ui.field("cockpit-name").value).toBe("Projet français");
  expect(ui.active()).toBe(ui.field("cockpit-name"));
  expect(ui.field("cockpit-name").selectionStart).toBe(2);
  expect(ui.field("cockpit-name").selectionEnd).toBe(6);
  expect(ui.main.scrollTop).toBe(123);
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
  // Mode multi-projets choisi : aucune valeur par défaut, le dossier du projet n'est pas proposé.
  ui.field("cockpit-share-multi").listeners.get("change")?.();
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
  ui.send({ type: "operation", busy: false, stage: "Opération annulée" });
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
  expect(ui.main.find((n) => n.id === "cockpit-create-toggle")).toBeUndefined();
});

const sectionOrder = (main: CockpitNode) =>
  main.children
    .map((n) =>
      n.id === "cockpit-create" || n.className === "cockpit-create-bar" ? "create" : n.className,
    )
    .filter((c) => ["cockpit-linked", "cockpit-list", "create"].includes(c));

it("la fermeture du panneau réaffiche le bouton et lui rend le focus", () => {
  const ui = cockpit();
  ui.field("cockpit-create-toggle").click();
  expect(ui.main.find((n) => n.id === "cockpit-create-toggle")).toBeUndefined();
  ui.button("Replier le formulaire").click();
  expect(ui.active()).toBe(ui.field("cockpit-create-toggle"));
});

it("la carte liée affiche image et dossier sans repli, et l'ordre suit le lien", () => {
  const ui = cockpit();
  expect(sectionOrder(ui.main)).toEqual(["create", "cockpit-list"]);
  ui.send({
    ...ui.view,
    linkedBanner: { name: "lab", short: "lab", state: "running", image: "kali", workspace: "/w" },
  });
  expect(ui.main.find((n) => n.tag === "details")).toBeUndefined();
  expect(ui.main.find((n) => n.textContent === "Dossier et image")).toBeUndefined();
  expect(ui.main.find((n) => n.tag === "dl")).toBeDefined();
  expect(sectionOrder(ui.main)).toEqual(["cockpit-linked", "cockpit-list", "create"]);
});

// ── Refonte : stepper, état de réussite, échec, rechargement ──

const kaliCreation = (project?: string) => {
  const ui = cockpit("absent");
  if (project) ui.send({ ...ui.view, projectWorkspace: project });
  ui.field("cockpit-create-toggle").click();
  ui.field("cockpit-share-multi").listeners.get("change")?.();
  ui.field("cockpit-name").value = "lab2";
  ui.field("cockpit-name").listeners.get("input")?.();
  ui.send({ type: "pickedSharedFolder", path: "/srv/partage" });
  ui.button("Créer").click();
  const steps = () =>
    ui.main
      .findAll((n) => n.className.startsWith("cockpit-step "))
      .map((n) => ({
        label: n.children[1]?.textContent,
        state: n.className.split(" is-")[1],
      }));
  const stage = (text: string, extra: object = {}) =>
    ui.send({ type: "operation", busy: true, stage: text, ...extra });
  return { ui, steps, stage };
};

it("le stepper avance sur la séquence Kali et ne recule jamais", () => {
  const { ui, steps, stage } = kaliCreation();
  expect(steps().map((s) => s.label)).toEqual([
    "Image",
    "Téléchargement / Construction",
    "Démarrage",
    "Vérification MCP",
  ]);
  expect(steps()[0]?.state).toBe("active");
  stage("Préparation de l’image Kali…");
  stage("Téléchargement de l’image…", {
    layers: [{ id: "a", status: "Téléchargement", current: 1, total: 2 }],
  });
  expect(steps().map((s) => s.state)).toEqual(["done", "active", "todo", "todo"]);
  // Les couches restent affichées dans l’étape de téléchargement.
  expect(ui.main.find((n) => n.tag === "progress")).toBeDefined();
  stage("Création et démarrage du conteneur…", { layers: [] });
  expect(steps().map((s) => s.state)).toEqual(["done", "done", "active", "todo"]);
  stage("Préparation de l’image Kali…");
  expect(steps().map((s) => s.state)).toEqual(["done", "done", "active", "todo"]);
  stage("Serveur MCP Kali : démarrage");
  expect(steps().map((s) => s.state)).toEqual(["done", "done", "done", "active"]);
});

it("l’étape Liaison n’apparaît que si le projet est dans le dossier partagé", () => {
  expect(
    kaliCreation("/autre")
      .steps()
      .map((s) => s.label),
  ).not.toContain("Liaison");
  const linked = kaliCreation("/srv/partage/mission");
  expect(linked.steps().map((s) => s.label)).toContain("Liaison");
  linked.stage("Liaison au projet…");
  expect(linked.steps().at(-1)?.state).toBe("active");
});

it("pendant la création, les champs gardent leur valeur et le bouton est inerte", () => {
  const { ui } = kaliCreation();
  expect(ui.field("cockpit-name").value).toBe("lab2");
  const submit = ui.field("cockpit-submit");
  expect(submit.disabled).toBe(true);
  expect(submit.children.some((c) => c.textContent === "Création…")).toBe(true);
  expect(ui.button("Annuler").className).toContain("cockpit-cancel-link");
});

it("une vue en chargement pendant l’opération garde progression et formulaire", () => {
  const { ui, stage } = kaliCreation();
  stage("Téléchargement de l’image…");
  ui.send({ type: "view", loading: true });
  expect(ui.main.find((n) => n.id === "cockpit-progress")).toBeDefined();
  expect(ui.field("cockpit-name").value).toBe("lab2");
  expect(ui.main.find((n) => n.className === "cockpit-loading")).toBeDefined();
  ui.send({ ...ui.view, type: "view" });
  expect(ui.main.find((n) => n.className === "cockpit-loading")).toBeUndefined();
});

it("sans opération, une vue en chargement remplace toujours l’écran", () => {
  const ui = cockpit();
  ui.send({ type: "view", loading: true });
  expect(ui.main.find((n) => n.className === "cockpit-notice")?.textContent).toBe("Actualisation…");
});

it("affiche la réussite sans erreur, puis « Voir le conteneur » met la carte en évidence", () => {
  const { ui, stage } = kaliCreation();
  stage("Création et démarrage du conteneur…");
  ui.send({ type: "operation", busy: false, stage: "Terminé" });
  ui.send({ type: "pickedSharedFolder", path: "" });
  const created = { name: "lab2", short: "lab2", family: "kali", image: "kali", state: "running" };
  ui.send({ ...ui.view, containers: [...ui.view.containers, created] });
  expect(ui.main.find((n) => n.className === "cockpit-check")).toBeDefined();
  expect(ui.main.find((n) => n.id === "cockpit-name")).toBeUndefined();
  expect(
    ui.main
      .findAll((n) => n.className.startsWith("cockpit-step "))
      .every((n) => n.className.endsWith("is-done")),
  ).toBe(true);
  ui.button("Voir le conteneur").click();
  expect(ui.main.find((n) => n.id === "cockpit-create")).toBeUndefined();
  const cards = ui.main.findAll((n) => n.className.startsWith("cockpit-card "));
  expect(cards.find((n) => n.className.includes("is-highlight"))).toBeDefined();
  expect(ui.main.find((n) => n.id === "cockpit-create-toggle")).toBeDefined();
});

it("l’échec marque l’étape fautive et « Réessayer » republie le même message", () => {
  const { ui, steps, stage } = kaliCreation();
  const created = ui.sent.filter((m) => (m as { type: string }).type === "createKali");
  stage("Création et démarrage du conteneur…");
  ui.send({ type: "operation", busy: false, stage: "Échec de l’opération", error: "boom" });
  expect(steps().find((s) => s.state === "failed")?.label).toBe("Démarrage");
  expect(ui.main.find((n) => n.className === "cockpit-error")?.textContent).toBe("boom");
  expect(ui.field("cockpit-name").value).toBe("lab2");
  ui.button("Réessayer").click();
  const after = ui.sent.filter((m) => (m as { type: string }).type === "createKali");
  expect(after).toHaveLength(2);
  expect(after[1]).toEqual(created[0]);
  expect(steps()[0]?.state).toBe("active");
});

it("la position du panneau reste figée quand la liaison réussit pendant l’opération", () => {
  const { ui } = kaliCreation();
  const order = () => sectionOrder(ui.main);
  expect(order()[0]).toBe("create");
  ui.send({
    ...ui.view,
    linkedBanner: { name: "lab", short: "lab", state: "running", image: "kali", workspace: "/w" },
  });
  expect(order()[0]).toBe("create");
  ui.send({ type: "operation", busy: false, stage: "Opération annulée" });
  ui.send({
    ...ui.view,
    linkedBanner: { name: "lab", short: "lab", state: "running", image: "kali", workspace: "/w" },
  });
  expect(order().at(-1)).toBe("create");
});

it("l’état vide propose un seul appel « Nouveau conteneur »", () => {
  const ui = cockpit();
  ui.send({ ...ui.view, containers: [], empty: "list" });
  expect(ui.main.findAll((n) => n.id === "cockpit-create-toggle")).toHaveLength(1);
  expect(ui.main.find((n) => n.className === "cockpit-empty")).toBeDefined();
});

it("un champ absent de la vue n’affiche aucun voyant", () => {
  const ui = cockpit();
  const { daemon: _daemon, ...partial } = ui.view;
  ui.send(partial);
  const tiles = ui.main.findAll((n) => n.className.startsWith("cockpit-tile "));
  expect(tiles.map((n) => n.children[1]?.textContent)).toEqual([
    "Docker",
    "Exegol",
    "Conteneur lié",
  ]);
});

it("cockpit.css : toute animation cockpit vit sous prefers-reduced-motion: no-preference", () => {
  const css = readFileSync(new URL("../media/css/cockpit.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const start = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .cockpit-card");
  expect(start).toBeGreaterThan(0);
  const guarded = css.slice(start);
  const outside = css.slice(0, start);
  expect(outside).not.toMatch(/animation:\s*cockpit-/);
  expect(guarded).toMatch(/animation:\s*cockpit-pulse/);
  expect(css).toMatch(/@media \(hover: none\)/);
});

const withProjects = (ui: ReturnType<typeof cockpit>, extra: object = {}) =>
  ui.send({
    ...ui.view,
    projectWorkspace: "/srv/partage/mission",
    containers: [
      {
        name: "kali-ok",
        short: "ok",
        family: "kali",
        image: "kali",
        state: "running",
        canLink: true,
        workspace: "/srv/partage",
        compatible: true,
        projects: [
          { id: "11111111-1111-4111-8111-111111111111", name: "mission", active: true },
          { id: "22222222-2222-4222-8222-222222222222", name: "autre", active: false },
        ],
      },
      {
        name: "kali-ko",
        short: "ko",
        family: "kali",
        image: "kali",
        state: "running",
        canLink: false,
        linkTitle: "Ce conteneur ne voit pas le dossier du projet.",
        workspace: "/srv/ailleurs",
        compatible: false,
        projects: [],
      },
    ],
    ...extra,
  });

it("les formulaires proposent deux modes ; le mode projet masque le choix du dossier", () => {
  const ui = cockpit();
  withProjects(ui);
  ui.field("cockpit-create-toggle").click();
  const project = ui.field("cockpit-share-project");
  const multi = ui.field("cockpit-share-multi");
  expect(project.checked).toBe(true);
  expect(multi.checked).toBe(false);
  expect(project.disabled).toBe(false);
  expect(ui.main.find((n) => n.id === "cockpit-folder")).toBeUndefined();
  expect(ui.main.find((n) => n.textContent === "Conteneur projet")).toBeDefined();
  expect(ui.main.find((n) => n.textContent === "Conteneur multi-projets")).toBeDefined();
  ui.field("cockpit-name").value = "lab";
  ui.field("cockpit-name").listeners.get("input")?.();
  // Aucun dossier à choisir : la création est possible tout de suite et n'envoie aucune source.
  expect(ui.button("Créer").disabled).toBe(false);
  ui.button("Créer").click();
  const created = ui.sent.find(
    (message) => (message as { type: string }).type === "createExegol",
  ) as Record<string, unknown>;
  expect(created).toMatchObject({ type: "createExegol", shareMode: "project" });
  expect(created).not.toHaveProperty("source");
});

it("le mode multi-projets garde « Choisir… » et exige le dossier choisi sur l'hôte", () => {
  const ui = cockpit("absent");
  withProjects(ui, { exegol: "absent" });
  ui.field("cockpit-create-toggle").click();
  ui.field("cockpit-share-multi").listeners.get("change")?.();
  expect(ui.field("cockpit-share-multi").checked).toBe(true);
  expect(ui.field("cockpit-folder")).toBeDefined();
  ui.field("cockpit-name").value = "lab";
  ui.field("cockpit-name").listeners.get("input")?.();
  expect(ui.button("Créer").disabled).toBe(true);
  ui.send({ type: "pickedSharedFolder", path: "/srv/partage" });
  expect(ui.button("Créer").disabled).toBe(false);
  ui.button("Créer").click();
  expect(ui.sent).toContainEqual({
    type: "createKali",
    shareMode: "multi",
    name: "lab",
    image: "warband/kali:complete-1",
  });
});

it("sans projet actif, « Conteneur projet » est désactivé et le mode multi est utilisé", () => {
  const ui = cockpit();
  ui.field("cockpit-create-toggle").click();
  const project = ui.field("cockpit-share-project");
  expect(project.disabled).toBe(true);
  expect(project.title).toBe("Ouvrez un projet pour créer un conteneur projet.");
  expect(ui.field("cockpit-share-multi").checked).toBe(true);
  // Forcer le choix désactivé ne change rien.
  project.listeners.get("change")?.();
  expect(ui.field("cockpit-share-multi").checked).toBe(true);
  expect(ui.field("cockpit-folder")).toBeDefined();
});

it("la carte liste les projets du partage, marque le projet actif et active un autre projet", () => {
  const ui = cockpit();
  withProjects(ui);
  expect(ui.main.find((n) => n.textContent === "Projets dans ce conteneur")).toBeDefined();
  expect(ui.main.find((n) => n.textContent === "Aucun projet dans ce partage.")).toBeDefined();
  const current = ui.find((n) => n.className.includes("is-project"));
  expect(current.textContent).toBe("mission");
  expect(current.title).toBe("Projet actif");
  ui.button("autre").click();
  expect(ui.sent).toContainEqual({
    type: "activateProject",
    projectId: "22222222-2222-4222-8222-222222222222",
  });
  // Le projet actif n'est pas un bouton : il n'y a rien à activer.
  expect(ui.main.find((n) => n.attributes.get("aria-label") === "mission")).toBeUndefined();
});

it("le badge de compatibilité suit la vue et Lier est désactivé pour un conteneur incompatible", () => {
  const ui = cockpit();
  withProjects(ui);
  expect(ui.main.find((n) => n.textContent === "Compatible avec le projet actif")).toBeDefined();
  expect(
    ui.main.find(
      (n) =>
        n.className.includes("cockpit-compat") &&
        n.textContent === "Ce conteneur ne voit pas le dossier du projet.",
    ),
  ).toBeDefined();
  const links = ui.main.findAll((n) => n.attributes.get("aria-label") === "Lier");
  expect(links).toHaveLength(2);
  expect(links.map((n) => n.disabled)).toEqual([false, true]);
  expect(links[1]?.title).toBe("Ce conteneur ne voit pas le dossier du projet.");
  links[1]?.click();
  expect(ui.sent.filter((m) => (m as { type: string }).type === "link")).toEqual([]);
  links[0]?.click();
  expect(ui.sent).toContainEqual({ type: "link", name: "kali-ok" });
});

it("sans projet actif, aucun badge de compatibilité n'est affiché", () => {
  const ui = cockpit();
  ui.send({
    ...ui.view,
    containers: [{ ...ui.view.containers[0], workspace: "/s", compatible: false, projects: [] }],
  });
  expect(ui.main.find((n) => n.className.includes("cockpit-compat"))).toBeUndefined();
});

const mountIssue = {
  container: "kali-ko",
  mounted: "/srv/ailleurs",
  projectId: "11111111-1111-4111-8111-111111111111",
  projectName: "mission",
};

it("le bandeau de partage s'affiche avec ses trois actions", () => {
  const ui = cockpit();
  withProjects(ui, { mountIssue });
  expect(ui.main.find((n) => n.id === "cockpit-mount-issue")).toBeDefined();
  expect(
    ui.main.find(
      (n) =>
        n.textContent === "Le projet « mission » n’est pas visible depuis le conteneur « ko ».",
    ),
  ).toBeDefined();
  expect(ui.button("Créer un conteneur projet pour ce dossier")).toBeDefined();
  expect(ui.button("Choisir un conteneur compatible")).toBeDefined();
  expect(ui.main.find((n) => n.id === "cockpit-issue-move")).toBeDefined();
});

it("sans mountIssue, pas de bandeau", () => {
  const ui = cockpit();
  withProjects(ui);
  expect(ui.main.find((n) => n.id === "cockpit-mount-issue")).toBeUndefined();
});

it("« Créer un conteneur projet » présélectionne le mode projet du formulaire", () => {
  const ui = cockpit();
  withProjects(ui, { mountIssue });
  ui.field("cockpit-create-toggle").click();
  ui.field("cockpit-share-multi").listeners.get("change")?.();
  expect(ui.field("cockpit-share-multi").checked).toBe(true);
  ui.button("Créer un conteneur projet pour ce dossier").click();
  expect(ui.field("cockpit-share-project").checked).toBe(true);
  expect(ui.field("cockpit-share-multi").checked).toBe(false);
});

it("« Choisir un conteneur compatible » ne garde que les compatibles, puis les réaffiche", () => {
  const ui = cockpit();
  withProjects(ui, { mountIssue });
  const cards = () => ui.main.findAll((n) => n.className.startsWith("cockpit-card ")).length;
  expect(cards()).toBe(2);
  ui.button("Choisir un conteneur compatible").click();
  expect(cards()).toBe(1);
  expect(ui.main.find((n) => n.textContent === "ok")).toBeDefined();
  ui.button("Afficher tous les conteneurs").click();
  expect(cards()).toBe(2);
});

it("Déplacer le projet envoie moveProject, Masquer envoie dismissMountIssue", () => {
  const ui = cockpit();
  withProjects(ui, { mountIssue });
  ui.field("cockpit-issue-move").click();
  expect(ui.sent).toContainEqual({ type: "moveProject" });
  ui.field("cockpit-issue-dismiss").click();
  expect(ui.sent).toContainEqual({ type: "dismissMountIssue" });
});
