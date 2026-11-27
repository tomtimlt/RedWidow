import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUiTranslator } from "@warband/messages";
import { describe, expect, it } from "vitest";

/**
 * Banc de la webview pour la carte de proposition (`renderSubagentsCard`) et l'élément du fil
 * (`renderSubagentsItem`) : le code réel de chat.js, évalué sur de faux nœuds. Aucun HTML n'est
 * interprété : le faux nœud refuse `innerHTML`, comme le fait la règle du dépôt.
 */
const js = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");

type Handler = (event?: Record<string, unknown>) => void;
class Node {
  children: Node[] = [];
  className = "";
  id = "";
  textContent = "";
  type = "";
  value = "";
  checked = false;
  disabled = false;
  tabIndex = 0;
  handlers = new Map<string, Handler>();
  attrs = new Map<string, string>();
  classes = new Set<string>();
  constructor(readonly tag: string) {}
  set innerHTML(_value: string) {
    throw new Error("innerHTML interdit");
  }
  get classList() {
    return { add: (name: string) => this.classes.add(name) };
  }
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  addEventListener(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    this.handlers.get(type)?.({ preventDefault() {}, ...event });
  }
  /** Descendants de la balise demandée (la webview n'utilise que `input, button`). */
  querySelectorAll(selector: string): Node[] {
    const tags = selector.split(",").map((part) => part.trim());
    return this.children.flatMap((child) => [
      ...(tags.includes(child.tag) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  find(predicate: (node: Node) => boolean): Node[] {
    return this.children.flatMap((child) => [
      ...(predicate(child) ? [child] : []),
      ...child.find(predicate),
    ]);
  }
  text(): string {
    return this.textContent + this.children.map((child) => child.text()).join("");
  }
}

function harness() {
  const slice = (from: string, to: string) => js.slice(js.indexOf(from), js.indexOf(to));
  const card = slice("  let subagentsCard = null;", "  const seenCards =");
  const item = slice("  // Élément « Sous-agents » du fil", "  function renderItem(item) {");
  const sent: unknown[] = [];
  const focus: string[] = [];
  const modeCalls: boolean[] = [];
  const t = createUiTranslator(() => "fr");
  const context = {
    t,
    l: (...args: unknown[]) => ({ translation: args }),
    el: (tag: string, className?: string, text?: unknown) => {
      const node = new Node(tag);
      if (className) node.className = className;
      if (typeof text === "string") node.textContent = text;
      else if (text) node.textContent = String((text as { translation: unknown[] }).translation[0]);
      return node;
    },
    svg: (name: string) => new Node(`svg:${name}`),
    productBindings: new Set<{ node: Node; paint: () => void }>(),
    vscode: { postMessage: (message: unknown) => sent.push(message) },
    input: {
      focus: () => focus.push("input"),
    },
    setSubagentsMode: (enabled: boolean) => modeCalls.push(enabled),
  };
  const api = runInNewContext(
    `${card}\n${item}\n({ renderSubagentsCard, renderSubagentsItem })`,
    context,
  ) as {
    renderSubagentsCard: (proposal: unknown) => Node;
    renderSubagentsItem: (item: unknown) => Node;
  };
  return { ...api, sent, focus, modeCalls, bindings: context.productBindings };
}

const proposal = {
  proposalId: "p1",
  items: [
    { id: "s1", name: "Domaines", goal: "Énumérer les sous-domaines" },
    { id: "s2", name: "Fuzzing", goal: "Fuzzer les chemins" },
    { id: "s3", name: "API", goal: "Tester l'API" },
  ],
};
const boxesOf = (form: Node) => form.find((node) => node.tag === "input");
const boxAt = (form: Node, index: number): Node => {
  const box = boxesOf(form)[index];
  if (!box) throw new Error(`case ${index} absente`);
  return box;
};
const mainOf = (form: Node) => form.find((node) => node.className === "primary")[0] as Node;
const noneOf = (form: Node) =>
  form.find((node) => node.tag === "button" && !node.className)[0] as Node;

describe("carte de proposition de sous-agents (comportement de chat.js)", () => {
  it("une case cochée par sous-agent, nom et objectif posés comme texte, bouton principal à (n)", () => {
    const { renderSubagentsCard } = harness();
    const form = renderSubagentsCard(proposal);
    expect(form.tag).toBe("form");
    expect(form.className).toBe("card subagents-card enter");
    const boxes = boxesOf(form);
    expect(boxes.map((box) => [box.type, box.checked, box.value])).toEqual([
      ["checkbox", true, "s1"],
      ["checkbox", true, "s2"],
      ["checkbox", true, "s3"],
    ]);
    expect(mainOf(form).textContent).toBe("Lancer la sélection (3)");
    expect(mainOf(form).type).toBe("submit");
    expect(mainOf(form).disabled).toBe(false);
    expect(noneOf(form).type).toBe("button");
    // Chaque case est nommée par le nom du sous-agent et décrite par son objectif.
    for (const box of boxes) {
      const named = form.find((node) => node.id === box.attrs.get("aria-labelledby"));
      const described = form.find((node) => node.id === box.attrs.get("aria-describedby"));
      expect(named).toHaveLength(1);
      expect(described).toHaveLength(1);
    }
    expect(form.find((node) => node.tag === "strong").map((node) => node.textContent)).toEqual([
      "Domaines",
      "Fuzzing",
      "API",
    ]);
  });

  it("le texte du modèle n'est jamais interprété : il reste du texte brut", () => {
    const { renderSubagentsCard } = harness();
    const hostile = '<img src=x onerror="alert(1)"> $(id) {{0}}';
    const form = renderSubagentsCard({
      proposalId: "p1",
      items: [{ id: "a", name: hostile, goal: hostile }],
    });
    expect(form.text()).toContain(hostile);
    expect(form.find((node) => node.tag === "img")).toHaveLength(0);
  });

  it("le bouton principal suit le nombre de cases et se désactive à zéro", () => {
    const { renderSubagentsCard } = harness();
    const form = renderSubagentsCard(proposal);
    const [first, second, third] = boxesOf(form) as [Node, Node, Node];
    first.checked = false;
    form.fire("change");
    expect(mainOf(form).textContent).toBe("Lancer la sélection (2)");
    second.checked = false;
    third.checked = false;
    form.fire("change");
    expect(mainOf(form).textContent).toBe("Lancer la sélection (0)");
    expect(mainOf(form).disabled).toBe(true);
    first.checked = true;
    form.fire("change");
    expect(mainOf(form).textContent).toBe("Lancer la sélection (1)");
    expect(mainOf(form).disabled).toBe(false);
  });

  it("la liaison de langue recalcule le libellé avec le compte courant, sans en laisser d'ancien", () => {
    const { renderSubagentsCard, bindings } = harness();
    const form = renderSubagentsCard(proposal);
    boxAt(form, 0).checked = false;
    form.fire("change");
    expect(bindings.size).toBe(1);
    mainOf(form).textContent = "périmé";
    for (const binding of bindings) binding.paint();
    expect(mainOf(form).textContent).toBe("Lancer la sélection (2)");
  });

  it("l'envoi donne les identifiants cochés, une seule fois, et fige la carte", () => {
    const { renderSubagentsCard, sent, focus } = harness();
    const form = renderSubagentsCard(proposal);
    boxAt(form, 1).checked = false;
    form.fire("submit");
    expect(sent).toEqual([{ type: "answerSubagents", proposalId: "p1", selected: ["s1", "s3"] }]);
    for (const control of form.querySelectorAll("input, button"))
      expect(control.disabled).toBe(true);
    expect(mainOf(form).textContent).toBe("Lancement…");
    expect(form.classes.has("is-sent")).toBe(true);
    expect(focus).toEqual(["input"]);
    // Un second geste (formulaire, bouton secondaire, Entrée) ne renvoie rien.
    form.fire("submit");
    noneOf(form).fire("click");
    form.fire("keydown", { key: "Enter", target: boxesOf(form)[0] });
    expect(sent).toHaveLength(1);
  });

  it("« Aucun sous-agent » envoie une liste vide, même avec des cases cochées", () => {
    const { renderSubagentsCard, sent } = harness();
    const form = renderSubagentsCard(proposal);
    noneOf(form).fire("click");
    expect(sent).toEqual([{ type: "answerSubagents", proposalId: "p1", selected: [] }]);
    for (const control of form.querySelectorAll("input, button"))
      expect(control.disabled).toBe(true);
  });

  it("rien ne part à zéro case : ni formulaire ni Entrée", () => {
    const { renderSubagentsCard, sent } = harness();
    const form = renderSubagentsCard(proposal);
    for (const box of boxesOf(form)) box.checked = false;
    form.fire("change");
    form.fire("submit");
    form.fire("keydown", { key: "Enter", target: boxesOf(form)[0] });
    expect(sent).toEqual([]);
    expect(mainOf(form).disabled).toBe(true);
  });

  it("Entrée sur une case envoie la sélection ; Entrée ailleurs est laissée au navigateur", () => {
    const { renderSubagentsCard, sent } = harness();
    const form = renderSubagentsCard(proposal);
    let prevented = 0;
    form.fire("keydown", { key: "Enter", target: mainOf(form), preventDefault: () => prevented++ });
    form.fire("keydown", { key: "a", target: boxesOf(form)[0], preventDefault: () => prevented++ });
    expect(sent).toEqual([]);
    expect(prevented).toBe(0);
    form.fire("keydown", {
      key: "Enter",
      target: boxesOf(form)[2],
      preventDefault: () => prevented++,
    });
    expect(sent).toEqual([
      { type: "answerSubagents", proposalId: "p1", selected: ["s1", "s2", "s3"] },
    ]);
    expect(prevented).toBe(1);
  });

  it("Échap rend le focus au champ de saisie sans rien envoyer ni refuser", () => {
    const { renderSubagentsCard, sent, focus } = harness();
    const form = renderSubagentsCard(proposal);
    let prevented = false;
    form.fire("keydown", {
      key: "Escape",
      target: boxesOf(form)[0],
      preventDefault: () => (prevented = true),
    });
    expect(prevented).toBe(true);
    expect(focus).toEqual(["input"]);
    expect(sent).toEqual([]);
    expect(boxesOf(form).every((box) => !box.disabled && box.checked)).toBe(true);
    expect(mainOf(form).textContent).toBe("Lancer la sélection (3)");
  });
});

describe("élément « Sous-agents » du fil (comportement de chat.js)", () => {
  const base = {
    id: 1,
    kind: "subagents",
    proposalId: "p1",
    items: proposal.items,
    selected: [] as string[],
    live: false,
    canDisable: false,
  };

  it("en attente avec une proposition vivante : liste les noms et annonce l'attente", () => {
    const { renderSubagentsItem } = harness();
    const node = renderSubagentsItem({ ...base, status: "pending", live: true });
    expect(node.className).toBe("subagents-item pending");
    expect(node.text()).toBe(
      "Sous-agents proposés : Domaines, Fuzzing, API. En attente de votre choix.",
    );
  });

  it("en attente sans proposition vivante : restée sans réponse", () => {
    const { renderSubagentsItem } = harness();
    const node = renderSubagentsItem({ ...base, status: "pending", live: false });
    expect(node.text()).toBe("Proposition de sous-agents restée sans réponse.");
  });

  it("accepté : noms retenus, détail replié avec les objectifs et les non retenus en sourdine", () => {
    const { renderSubagentsItem } = harness();
    const node = renderSubagentsItem({ ...base, status: "accepted", selected: ["s1", "s3"] });
    expect(node.find((n) => n.className === "subagents-line")[0]?.text()).toBe(
      "Sous-agents lancés : Domaines, API",
    );
    const details = node.find((n) => n.tag === "details");
    expect(details).toHaveLength(1);
    const rows = node.find((n) => n.tag === "li");
    expect(rows.map((row) => row.className)).toEqual(["", "is-skipped", ""]);
    expect(rows[1]?.text()).toBe("Fuzzing (non lancé)Fuzzer les chemins");
    expect(rows[0]?.text()).toBe("DomainesÉnumérer les sous-domaines");
  });

  it("refusé : aucun lancé, note affichée comme texte, lien de désactivation seulement si offert", () => {
    const { renderSubagentsItem, modeCalls } = harness();
    const withoutOffer = renderSubagentsItem({ ...base, status: "declined" });
    expect(withoutOffer.text()).toBe("Aucun sous-agent lancé.");
    expect(withoutOffer.find((n) => n.tag === "button")).toHaveLength(0);

    const hostile = "<b>d'abord le scan</b>";
    const node = renderSubagentsItem({
      ...base,
      status: "declined",
      note: hostile,
      canDisable: true,
    });
    expect(node.text()).toBe(
      `Aucun sous-agent lancé.Note : ${hostile}Désactiver le mode sous-agents`,
    );
    const link = node.find((n) => n.tag === "button")[0] as Node;
    expect(link.className).toBe("link");
    expect(link.type).toBe("button");
    link.fire("click");
    expect(modeCalls).toEqual([false]);
  });

  it("le lien n'apparaît ni pour un accord ni pour une attente", () => {
    const { renderSubagentsItem } = harness();
    for (const status of ["pending", "accepted"]) {
      const node = renderSubagentsItem({ ...base, status, canDisable: true, selected: ["s1"] });
      expect(node.find((n) => n.tag === "button")).toHaveLength(0);
    }
  });
});
