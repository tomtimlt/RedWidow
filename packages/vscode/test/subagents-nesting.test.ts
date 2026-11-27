import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { type EngineEvent, reason } from "@warband/core";
import { createUiTranslator, type Locale } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { type ApprovalCard, toCard } from "../src/logic/approval.js";
import { type ChatItem, createChatState, MAX_ITEMS } from "../src/logic/chat.js";
import { buildControls, DEFAULT_PREFS } from "../src/logic/controls.js";

const ev = (payload: Record<string, unknown>, id: string): EngineEvent =>
  ({
    v: 1,
    id,
    seq: 1,
    ts: "2026-11-27T00:00:00.000Z",
    runId: "r",
    parentId: null,
    ...payload,
  }) as EngineEvent;

let serial = 0;
const next = () => `e${++serial}`;

const requested = (
  toolUseId: string,
  tool: string,
  input: Record<string, unknown>,
  agent?: { agentToolUseId: string; agentId: string },
) => ev({ kind: "tool.requested", toolUseId, tool, input, ...agent }, next());
const allowed = (toolUseId: string) =>
  ev(
    {
      kind: "approval.decided",
      toolUseId,
      decision: "allow",
      source: "policy",
      reason: reason("subagents.approved", { description: "x" }),
    },
    next(),
  );
const denied = (toolUseId: string, code: "subagents.limit" | "subagents.not_approved") =>
  ev(
    {
      kind: "approval.decided",
      toolUseId,
      decision: "deny",
      source: "policy",
      reason: reason(code, { max: 4 }),
    },
    next(),
  );
const finished = (toolUseId: string, isError = false) =>
  ev({ kind: "tool.result", toolUseId, isError, output: "fini", truncated: false }, next());

const withMode = (enabled: boolean) => {
  const state = createChatState();
  state.setControls(
    buildControls({
      prefs: { ...DEFAULT_PREFS, subagents: enabled },
      models: null,
      status: "ready",
      defaultModel: undefined,
      busy: false,
    }),
  );
  return state;
};
type State = ReturnType<typeof createChatState>;
const tools = (state: State) =>
  state.view().items.flatMap((item) => (item.kind === "tool" ? [item] : []));
const tool = (state: State, toolUseId: string) => {
  const found = tools(state).find((item) => item.toolUseId === toolUseId);
  if (!found) throw new Error(`outil ${toolUseId} absent`);
  return found;
};
const card = (toolUseId: string, agentId?: string): ApprovalCard =>
  toCard({
    toolUseId,
    tool: "Read",
    input: { file_path: "/a" },
    verdict: { decision: "ask", reason: reason("policy.default"), rule: null },
    ...(agentId !== undefined && { agentId }),
  });

describe("sous-agents en cours : état du fil (ADR 0054, lot C)", () => {
  it("un Task de l'agent principal porte le nom du sous-agent, pris dans input.description", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { description: "Énumérer les domaines", prompt: "go" }));
    state.event(requested("t2", "Agent", { description: "Fuzzing" }));
    expect(tool(state, "t1")).toMatchObject({ agent: "Énumérer les domaines" });
    expect(tool(state, "t2")).toMatchObject({ agent: "Fuzzing" });
    expect(tool(state, "t1")).not.toHaveProperty("parentToolUseId");
  });

  it("le nom est neutralisé (contrôles, bidi) et plafonné à 200 caractères", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { description: `Do\x1b[2Kma‮ines${"x".repeat(300)}` }));
    const agent = tool(state, "t1").agent ?? "";
    expect(agent.startsWith("Domaines")).toBe(true);
    expect(agent.includes("\x1b")).toBe(false);
    expect(agent.includes("‮")).toBe(false);
    expect(agent).toHaveLength(201);
    expect(agent.endsWith("…")).toBe(true);
  });

  it("sans description lisible, ou pour un autre outil, il n'y a pas de nom", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { prompt: "go" }));
    state.event(requested("t2", "Task", { description: 42 }));
    state.event(requested("t3", "Task", { description: "  \x1b " }));
    state.event(requested("t4", "Bash", { command: "ls", description: "liste" }));
    for (const id of ["t1", "t2", "t3", "t4"]) expect(tool(state, id)).not.toHaveProperty("agent");
  });

  it("un appel venu d'un sous-agent porte le Task parent ; un Task imbriqué n'a pas de nom", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { description: "Domaines" }));
    state.event(
      requested("c1", "Read", { file_path: "/a" }, { agentToolUseId: "t1", agentId: "a1" }),
    );
    state.event(
      requested("t2", "Task", { description: "Imbriqué" }, { agentToolUseId: "t1", agentId: "a1" }),
    );
    expect(tool(state, "c1")).toMatchObject({ parentToolUseId: "t1" });
    expect(tool(state, "t2")).toMatchObject({ parentToolUseId: "t1" });
    expect(tool(state, "t2")).not.toHaveProperty("agent");
  });

  it("le compteur suit un Task autorisé, puis son résultat : de 1 à 0", () => {
    const state = withMode(true);
    expect(state.view().subagents).toEqual({ running: 0, max: 4 });
    state.event(requested("t1", "Task", { description: "Domaines" }));
    // Tant que la gate n'a pas accordé, rien ne tourne.
    expect(state.view().subagents).toEqual({ running: 0, max: 4 });
    state.event(allowed("t1"));
    expect(state.view().subagents).toEqual({ running: 1, max: 4 });
    // Les appels du sous-agent ne sont pas des sous-agents.
    state.event(
      requested("c1", "Read", { file_path: "/a" }, { agentToolUseId: "t1", agentId: "a1" }),
    );
    state.event(allowed("c1"));
    expect(state.view().subagents?.running).toBe(1);
    state.event(requested("t2", "Agent", { description: "Fuzzing" }));
    state.event(allowed("t2"));
    expect(state.view().subagents?.running).toBe(2);
    state.event(finished("t1"));
    expect(state.view().subagents?.running).toBe(1);
    state.event(finished("t2", true));
    expect(state.view().subagents).toEqual({ running: 0, max: 4 });
  });

  it("un Task interrompu n'est plus compté", () => {
    const state = withMode(true);
    state.event(requested("t1", "Task", { description: "Domaines" }));
    state.event(allowed("t1"));
    expect(state.interruptPending()).toBe(1);
    expect(state.view().subagents?.running).toBe(0);
    expect(tool(state, "t1").status).toBe("interrupted");
  });

  it("un Task refusé (subagents.limit) n'est pas compté et garde le libellé de refus", () => {
    const state = withMode(true);
    state.event(requested("t1", "Task", { description: "Domaines" }));
    state.event(denied("t1", "subagents.limit"));
    const refused = tool(state, "t1");
    expect(refused).toMatchObject({ status: "denied", decision: "deny" });
    expect(refused.output).toContain("4 sous-agents sont déjà en cours");
    expect(state.view().subagents?.running).toBe(0);
    // Le résultat tardif ne le fait pas revenir à « réussi ».
    state.event(finished("t1"));
    expect(tool(state, "t1").status).toBe("denied");
  });

  it("le compteur est absent quand le mode est inactif, ou en lecture seule", () => {
    const off = withMode(false);
    off.event(requested("t1", "Task", { description: "Domaines" }));
    off.event(allowed("t1"));
    expect(off.view()).not.toHaveProperty("subagents");
    expect(createChatState().view()).not.toHaveProperty("subagents");
    const readonly = withMode(true);
    readonly.setReadonly({ id: "x", title: "t", invalid: 0, truncated: false, canResume: false });
    expect(readonly.view()).not.toHaveProperty("subagents");
  });

  it("les tables sont vidées à l'éviction : le nom d'un sous-agent disparaît avec son Task", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { description: "Domaines" }));
    state.event(
      requested("c1", "Read", { file_path: "/a" }, { agentToolUseId: "t1", agentId: "a1" }),
    );
    state.approvals.set("p1", card("p1", "a1"));
    expect(state.view().approvals[0]?.agent).toBe("Domaines");
    for (let i = 0; i < MAX_ITEMS; i++)
      state.event(requested(`x${i}`, "Read", { file_path: "/b" }));
    expect(tools(state).some((item) => item.toolUseId === "t1")).toBe(false);
    expect(state.view().items).toHaveLength(MAX_ITEMS);
    expect(state.view().approvals[0]?.agent).toBe("");
    // La table des Task est vidée aussi : un nouvel appel du même Task ne retrouve pas le nom.
    state.event(
      requested("c2", "Read", { file_path: "/a" }, { agentToolUseId: "t1", agentId: "a2" }),
    );
    state.approvals.set("p2", card("p2", "a2"));
    expect(state.view().approvals.find((c) => c.toolUseId === "p2")?.agent).toBe("");
  });

  it("clear() vide les tables : un sous-agent d'une autre conversation reste anonyme", () => {
    const state = createChatState();
    state.event(requested("t1", "Task", { description: "Domaines" }));
    state.event(
      requested("c1", "Read", { file_path: "/a" }, { agentToolUseId: "t1", agentId: "a1" }),
    );
    state.clear();
    state.approvals.set("p1", card("p1", "a1"));
    expect(state.view().approvals[0]?.agent).toBe("");
  });

  it("la fenêtre n'est pas modifiée", () => {
    expect(MAX_ITEMS).toBe(60);
  });
});

describe("rendu du fil : imbrication, en-tête du Task, carte, compteur (comportement de chat.js)", () => {
  const js = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");

  type Handler = (event?: Record<string, unknown>) => void;
  /** Nœud à arbre réel, juste ce qu'utilisent `stableChildren`, `renderTool` et `renderTaskBox`. */
  class Node {
    children: Node[] = [];
    parentNode: Node | null = null;
    className = "";
    textContent = "";
    open = false;
    tabIndex = 0;
    dataset: Record<string, string> = {};
    attrs = new Map<string, string>();
    classes = new Set<string>();
    handlers = new Map<string, Handler>();
    constructor(readonly tag: string) {}
    set innerHTML(_value: string) {
      throw new Error("innerHTML interdit");
    }
    get classList() {
      return {
        add: (name: string) => this.classes.add(name),
        contains: (name: string) =>
          this.classes.has(name) || this.className.split(" ").includes(name),
      };
    }
    get nextElementSibling(): Node | null {
      const siblings = this.parentNode?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    detach() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    remove() {
      this.detach();
    }
    append(...nodes: Node[]) {
      for (const node of nodes) this.insertBefore(node, null);
    }
    insertBefore(node: Node, ref: Node | null) {
      node.detach();
      const at = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(at < 0 ? this.children.length : at, 0, node);
      node.parentNode = this;
    }
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value);
    }
    removeAttribute(name: string) {
      this.attrs.delete(name);
    }
    addEventListener(type: string, handler: Handler) {
      this.handlers.set(type, handler);
    }
    fire(type: string) {
      this.handlers.get(type)?.({});
    }
    is(className: string) {
      return this.className.split(" ").includes(className);
    }
    find(predicate: (node: Node) => boolean): Node[] {
      return this.children.flatMap((child) => [
        ...(predicate(child) ? [child] : []),
        ...child.find(predicate),
      ]);
    }
    byClass(className: string): Node[] {
      return this.find((node) => node.is(className));
    }
    text(): string {
      return this.textContent + this.children.map((child) => child.text()).join("");
    }
  }

  const harness = (locale: Locale = "fr") => {
    const t = createUiTranslator(() => locale);
    const slice = (from: string, to: string) => {
      const start = js.indexOf(from);
      const end = js.indexOf(to, start);
      if (start < 0 || end < 0) throw new Error(`repères absents : ${from}`);
      return js.slice(start, end);
    };
    const tool = slice("  const statusLabels = () => ({", "  function copyButton(text) {");
    const list = slice("  const itemNodes = ", "  function welcome(sandbox) {");
    const cardCode = slice("  function cardTraits(card) {", "  const ctlGroup =");
    const count = slice("  function paintSubagentsCount(", "  const subagentsSwitch =");
    const paint = (value: unknown): string => {
      if (typeof value === "string") return value;
      const translation = (
        value as { translation?: [string, Record<string, unknown>?] } | undefined
      )?.translation;
      return translation ? t(...translation) : "";
    };
    const countNode = new Node("span");
    const context = {
      t,
      l: (...args: unknown[]) => ({ translation: args }),
      el: (tag: string, className?: string, text?: unknown) => {
        const node = new Node(tag);
        if (className) node.className = className;
        node.textContent = paint(text);
        return node;
      },
      productAttribute: (node: Node, attribute: string, value: unknown) =>
        node.setAttribute(attribute, paint(value)),
      $: (id: string) => (id === "subagents-count" ? countNode : new Node("div")),
      UI: { toolIcon: () => "tool" },
      WarbandIcons: { create: (name: string) => new Node(`svg:${name}`) },
      vscode: { postMessage: () => undefined },
      seenCards: new Set(),
      copy: () => undefined,
    };
    const api = runInNewContext(
      `${tool}\n${list}\n${cardCode}\n${count}\n({ renderItems, renderCard, paintSubagentsCount, taskBoxes, openCalls })`,
      context,
    ) as {
      renderItems: (items: ChatItem[], view: Record<string, unknown>) => Node[];
      renderCard: (card: ApprovalCard, isNew: boolean, previous?: unknown) => Node;
      paintSubagentsCount: (subagents?: { running: number; max: number }) => void;
      taskBoxes: Map<string, unknown>;
      openCalls: Set<string>;
    };
    return { ...api, countNode };
  };

  let ids = 0;
  const toolItem = (
    toolUseId: string,
    tool: string,
    extra: Record<string, unknown> = {},
  ): ChatItem =>
    ({
      id: ++ids,
      kind: "tool",
      toolUseId,
      tool,
      label: tool === "Task" || tool === "Agent" ? "Sous-agent" : tool,
      summary: "",
      input: "{}",
      status: "pending",
      ...extra,
    }) as ChatItem;
  const render = (api: ReturnType<typeof harness>, items: ChatItem[]) => api.renderItems(items, {});
  const groupOf = (nodes: Node[]) => nodes.filter((node) => node.is("tool-group"));
  const stateText = (node: Node) => node.byClass("tool-state")[0]?.text();

  it("les appels d'un sous-agent se rangent sous leur Task, dans un bloc replié « n actions »", () => {
    const api = harness();
    const task = toolItem("t1", "Task", { agent: "Domaines", decision: "allow" });
    const c1 = toolItem("c1", "Read", { parentToolUseId: "t1" });
    const c2 = toolItem("c2", "Bash", { parentToolUseId: "t1" });
    const other = toolItem("z", "Glob");
    const nodes = render(api, [task, c1, other, c2]);
    const [group] = groupOf(nodes);
    // Un seul groupe : le bloc du Task, puis l'outil de l'agent principal ; aucun appel à plat.
    expect(group?.children.map((node) => node.className.split(" ")[0])).toEqual([
      "subagent-task",
      "tool",
    ]);
    const box = group?.children[0] as Node;
    expect(box.children[0]?.className).toBe("tool pending");
    const calls = box.children[1] as Node;
    expect(calls.tag).toBe("details");
    expect(calls.className).toBe("subagent-calls");
    expect(calls.open).toBe(false);
    expect(calls.byClass("subagent-calls-label")[0]?.text()).toBe("2 actions");
    const body = calls.byClass("subagent-calls-body")[0] as Node;
    expect(body.children).toHaveLength(2);
    expect(body.children.every((node) => node.is("tool"))).toBe(true);
    expect(nodes).toHaveLength(1);
  });

  it("une seule action se lit « 1 action » ; l'anglais traduit le résumé", () => {
    const task = toolItem("t1", "Task", { agent: "Domaines", decision: "allow" });
    const one = toolItem("c1", "Read", { parentToolUseId: "t1" });
    const fr = harness();
    expect(render(fr, [task, one])[0]?.byClass("subagent-calls-label")[0]?.text()).toBe("1 action");
    const en = harness("en");
    const two = toolItem("c2", "Read", { parentToolUseId: "t1" });
    expect(render(en, [task, one, two])[0]?.byClass("subagent-calls-label")[0]?.text()).toBe(
      "2 actions",
    );
  });

  it("l'outil Agent range ses appels comme Task", () => {
    const api = harness();
    const task = toolItem("t1", "Agent", { agent: "Fuzzing" });
    const nodes = render(api, [task, toolItem("c1", "Read", { parentToolUseId: "t1" })]);
    expect(nodes[0]?.byClass("subagent-calls-body")[0]?.children).toHaveLength(1);
  });

  it("l'état ouvert du bloc survit aux rendus, même quand le bloc disparaît puis revient", () => {
    const api = harness();
    const task = toolItem("t1", "Task", { agent: "Domaines" });
    const child = toolItem("c1", "Read", { parentToolUseId: "t1" });
    const first = render(api, [task, child]);
    const calls = first[0]?.byClass("subagent-calls")[0] as Node;
    calls.open = true;
    calls.fire("toggle");
    expect(render(api, [task, child])[0]?.byClass("subagent-calls")[0]?.open).toBe(true);
    // Sans appel, plus de bloc : le Task redevient un outil ordinaire du groupe…
    const alone = render(api, [task]);
    expect(alone[0]?.byClass("subagent-calls")).toHaveLength(0);
    expect(alone[0]?.children[0]?.is("tool")).toBe(true);
    expect(api.taskBoxes.size).toBe(0);
    // … et le bloc recréé reprend son état.
    expect(render(api, [task, child])[0]?.byClass("subagent-calls")[0]?.open).toBe(true);
    // Le Task sorti de la fenêtre : l'état est oublié.
    render(api, [toolItem("z", "Glob")]);
    expect(api.openCalls.size).toBe(0);
  });

  it("un appel dont le Task est hors fenêtre reste à plat, avec le préfixe « Sous-agent »", () => {
    const api = harness();
    const orphan = toolItem("c1", "Read", { parentToolUseId: "disparu" });
    const plain = toolItem("z", "Glob");
    const [group] = groupOf(render(api, [orphan, plain]));
    expect(group?.children).toHaveLength(2);
    expect(group?.children[0]?.byClass("subagent-tag")[0]?.text()).toBe("Sous-agent");
    expect(group?.children[1]?.byClass("subagent-tag")).toHaveLength(0);
    expect(harness("en").renderItems([orphan], {})[0]?.byClass("subagent-tag")[0]?.text()).toBe(
      "Subagent",
    );
  });

  it("un appel passe à plat quand son Task sort de la fenêtre au rendu suivant", () => {
    const api = harness();
    const task = toolItem("t1", "Task", { agent: "Domaines" });
    const child = toolItem("c1", "Read", { parentToolUseId: "t1" });
    render(api, [task, child]);
    const [group] = groupOf(render(api, [child]));
    expect(group?.children).toHaveLength(1);
    expect(group?.children[0]?.byClass("subagent-tag")[0]?.text()).toBe("Sous-agent");
  });

  it("l'en-tête du Task porte le nom (par textContent) et l'état du sous-agent", () => {
    const api = harness();
    const hostile = "<img src=x onerror=alert(1)>{0}";
    const labels: [string, string][] = [
      ["pending", "en cours"],
      ["ok", "terminé"],
      ["error", "échec"],
      ["denied", "refusé"],
      ["interrupted", "interrompu"],
    ];
    for (const [status, label] of labels) {
      const task = toolItem(`t-${status}`, "Task", { agent: hostile, status });
      const [group] = groupOf(render(api, [task]));
      const node = group?.children[0] as Node;
      expect(stateText(node)).toBe(label);
      const name = node.byClass("subagent-name")[0] as Node;
      expect(name.tag).toBe("span");
      expect(name.textContent).toBe(hostile);
      expect(name.children).toHaveLength(0);
      expect(node.byClass("tool-name")[0]?.textContent).toBe("Sous-agent");
    }
  });

  it("un outil ordinaire garde ses libellés d'état et n'a pas de nom de sous-agent", () => {
    const api = harness();
    const done = toolItem("a", "Read", { status: "ok" });
    const failed = toolItem("b", "Read", { status: "error" });
    const [group] = groupOf(render(api, [done, failed]));
    expect(group?.children.map(stateText)).toEqual(["réussi", "erreur"]);
    expect(group?.byClass("subagent-name")).toHaveLength(0);
    // Un Task sans nom lisible garde l'en-tête sans nom, avec l'état du sous-agent.
    const nameless = toolItem("n", "Task", { status: "ok" });
    const [other] = groupOf(render(harness(), [nameless]));
    expect(stateText(other?.children[0] as Node)).toBe("terminé");
    expect(other?.byClass("subagent-name")).toHaveLength(0);
  });

  it("l'en-tête du Task est traduit en anglais", () => {
    const api = harness("en");
    const [group] = groupOf(
      api.renderItems(
        [
          toolItem("t1", "Task", { agent: "A", status: "ok" }),
          toolItem("t2", "Task", { agent: "B", status: "error" }),
          toolItem("t3", "Task", { agent: "C", status: "interrupted" }),
        ],
        {},
      ),
    );
    expect(group?.children.map(stateText)).toEqual(["done", "failed", "interrupted"]);
  });

  const base: ApprovalCard = {
    toolUseId: "p1",
    tool: "Read",
    label: "Lecture",
    summary: "/a",
    detail: "/a",
    reason: "demande",
    canRemember: false,
  };

  it("la carte d'autorisation d'un sous-agent porte son nom, posé par textContent", () => {
    const api = harness();
    const hostile = '<b onmouseover="x">{0}</b>';
    const named = api.renderCard({ ...base, agent: hostile }, true);
    const [line] = named.byClass("card-agent");
    expect(line?.tag).toBe("p");
    expect(line?.textContent).toBe(`Sous-agent « ${hostile} »`);
    expect(line?.children).toHaveLength(0);
    // La ligne est en tête : sous le titre, avant la grille.
    const order = named.children.map((node) => node.className.split(" ")[0]);
    expect(order.indexOf("card-head")).toBeLessThan(order.indexOf("card-agent"));
    expect(order.indexOf("card-agent")).toBeLessThan(order.indexOf("card-grid"));
  });

  it("un nom inconnu donne la ligne générique ; sans sous-agent, pas de ligne", () => {
    const api = harness();
    expect(api.renderCard({ ...base, agent: "" }, true).byClass("card-agent")[0]?.textContent).toBe(
      "Sous-agent",
    );
    expect(api.renderCard(base, true).byClass("card-agent")).toHaveLength(0);
    const en = harness("en");
    expect(en.renderCard({ ...base, agent: "A" }, true).byClass("card-agent")[0]?.textContent).toBe(
      'Subagent "A"',
    );
    expect(en.renderCard({ ...base, agent: "" }, true).byClass("card-agent")[0]?.textContent).toBe(
      "Subagent",
    );
  });

  it("la puce affiche · n/4 et annonce n sous-agents en cours sur 4, seulement tant que n > 0", () => {
    const api = harness();
    api.paintSubagentsCount({ running: 2, max: 4 });
    expect(api.countNode.textContent).toBe(" · 2/4");
    expect(api.countNode.attrs.get("aria-label")).toBe("2 sous-agents en cours sur 4");
    api.paintSubagentsCount({ running: 1, max: 4 });
    expect(api.countNode.attrs.get("aria-label")).toBe("1 sous-agent en cours sur 4");
    api.paintSubagentsCount({ running: 0, max: 4 });
    expect(api.countNode.textContent).toBe("");
    expect(api.countNode.attrs.has("aria-label")).toBe(false);
    api.paintSubagentsCount({ running: 3, max: 4 });
    api.paintSubagentsCount(undefined);
    expect(api.countNode.textContent).toBe("");
    expect(api.countNode.attrs.has("aria-label")).toBe(false);
    const en = harness("en");
    en.paintSubagentsCount({ running: 2, max: 4 });
    expect(en.countNode.attrs.get("aria-label")).toBe("2 of 4 subagents running");
    en.paintSubagentsCount({ running: 1, max: 4 });
    expect(en.countNode.attrs.get("aria-label")).toBe("1 of 4 subagent running");
  });

  it("des valeurs hostiles de la vue ne passent pas dans le compteur", () => {
    const api = harness();
    api.paintSubagentsCount({ running: "<b>" as unknown as number, max: 4 });
    expect(api.countNode.textContent).toBe("");
    api.paintSubagentsCount({ running: 1, max: "<i>" as unknown as number });
    expect(api.countNode.textContent).toBe(" · 1/4");
  });
});
