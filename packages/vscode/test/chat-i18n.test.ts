import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUiTranslator, type Locale } from "@warband/messages";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../media/ui.js", import.meta.url), "utf8");

describe("libellés du chat FR / EN", () => {
  it("traduit les statuts, activités et pluriels sans modifier les commandes ni leurs sorties", () => {
    let locale: Locale = "fr";
    const ui = runInNewContext(`${uiSource}\nWarbandUI`, {
      WarbandI18n: { t: createUiTranslator(() => locale), getLocale: () => locale },
    });
    const view = {
      busy: true,
      approvals: [{ toolUseId: "tool-1" }, { toolUseId: "tool-2" }],
      items: [
        { kind: "user", text: "Réflexion" },
        {
          kind: "tool",
          id: 2,
          toolUseId: "tool-1",
          tool: ui.EXEC_TOOL,
          input: JSON.stringify({ container: "lab", argv: ["echo", "Sortie"] }),
          output: "Copier\nRaison",
          status: "pending",
          label: "Outil brut",
        },
      ],
    };
    expect(ui.historyBadge({ current: true }, false)).toBe("actuelle");
    expect(ui.activityLabel(view)).toBe("En attente de votre accord");
    expect(ui.conversationActivity(view).phases[2].label).toBe("2 accords en attente");
    locale = "en";
    expect(ui.historyBadge({ current: true }, false)).toBe("current");
    expect(ui.activityLabel(view)).toBe("Awaiting your approval");
    expect(
      ui.conversationActivity(view).phases.map((phase: { label: string }) => phase.label),
    ).toEqual(["1 message", "1 tool · 1 running", "2 approvals pending"]);
    expect(ui.monitorRows(view)[0]).toMatchObject({
      status: "pending",
      command: "echo Sortie",
      output: "Copier\nRaison",
      container: "lab",
    });
    expect(ui.activityLabel({ ...view, approvals: [] })).toBe("Tool: Outil brut");
    expect(ui.bypassView({ type: "bypass", on: false, armed: true }, null, false, 0).text).toBe(
      "Pending: active once the agent confirms.",
    );
    locale = "fr";
    expect(ui.activityLabel(view)).toBe("En attente de votre accord");
  });

  it("bascule en conservant la carte, les décisions, le brouillon, le focus et le défilement", () => {
    let locale: Locale = "fr";
    let active: NodeStub | undefined;
    class NodeStub {
      children: NodeStub[] = [];
      parentElement: NodeStub | null = null;
      textContent = "";
      value = "";
      title = "";
      className = "";
      disabled = false;
      scrollTop = 0;
      scrollLeft = 0;
      selectionStart: number | null = null;
      selectionEnd: number | null = null;
      dataset: Record<string, string> = {};
      attributes: Record<string, string> = {};
      events: Record<string, () => void> = {};
      classList = { add() {} };
      constructor(readonly tag: string) {}
      get isConnected(): boolean {
        return this === body || !!this.parentElement?.isConnected;
      }
      append(...nodes: NodeStub[]) {
        for (const node of nodes) {
          node.parentElement = this;
          this.children.push(node);
        }
      }
      replaceChildren(...nodes: NodeStub[]) {
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        this.append(...nodes);
      }
      setAttribute(key: string, value: string) {
        this.attributes[key] = value;
      }
      getAttribute(key: string) {
        return this.attributes[key] ?? null;
      }
      addEventListener(name: string, listener: () => void) {
        this.events[name] = listener;
      }
      click() {
        if (!this.disabled) this.events.click?.();
      }
      focus() {
        active = this;
      }
      matches(selector: string) {
        return selector.includes("textarea") && this.tag === "textarea";
      }
      setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
      }
      querySelectorAll(selector: string): NodeStub[] {
        return this.children.flatMap((child) => [
          ...(child.tag === selector ? [child] : []),
          ...child.querySelectorAll(selector),
        ]);
      }
    }
    const body = new NodeStub("body");
    const input = new NodeStub("textarea");
    input.value = "Mon brouillon : Copier";
    input.selectionStart = 3;
    input.selectionEnd = 8;
    const log = new NodeStub("main");
    log.scrollTop = 87;
    log.scrollLeft = 12;
    const approvals = new NodeStub("section");
    body.append(input, log, approvals);
    active = input;
    const sent: unknown[] = [];
    let renders = 0;
    const declaration = source.slice(
      source.indexOf("  const productBindings"),
      source.indexOf("  const exampleKeys"),
    );
    const cards = source.slice(
      source.indexOf("  function cardTraits"),
      source.indexOf("\n  const ctlGroup"),
    );
    const switching = source.slice(
      source.indexOf("  function switchLocale("),
      source.indexOf("  let chatId;"),
    );
    const context = {
      t: createUiTranslator(() => locale),
      WarbandI18n: {
        t: createUiTranslator(() => locale),
        getLocale: () => locale,
        setLocale: (value: Locale) => {
          locale = value;
        },
        applyStatic() {},
      },
      document: {
        body,
        get activeElement() {
          return active;
        },
        createElement: (tag: string) => new NodeStub(tag),
        querySelectorAll: () => [input, log],
      },
      UI: { toolIcon: () => "terminal" },
      svg: () => new NodeStub("svg"),
      vscode: { postMessage: (message: unknown) => sent.push(message) },
      itemNodes: new Map(),
      monitorNodes: new Map(),
      lastView: { items: [] },
      render: () => {
        renders++;
        log.scrollTop = 999;
        input.value = "remplacé pendant le rendu";
      },
      mentionOpen: () => false,
      renderMentions() {},
      paintAttachments() {},
      providerHelp: new NodeStub("p"),
      projectFilter: new NodeStub("select"),
      monitorFollowBtn: new NodeStub("button"),
      monitorFollow: false,
    };
    const api = runInNewContext(
      `${declaration}\n${cards}\n${switching}\n({ renderCard, switchLocale })`,
      context,
    );
    const card = api.renderCard(
      {
        toolUseId: "tool-1",
        tool: "Bash",
        label: "Copier",
        summary: "Sortie",
        reason: "Raison",
        reasonByLocale: { fr: "Raison", en: "Product reason in English" },
        detail: "Votre consigne",
        canRemember: true,
      },
      false,
    ) as NodeStub;
    approvals.append(card);
    const buttons = card.querySelectorAll("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Autoriser une fois",
      "Refuser",
      "Toujours",
    ]);
    api.switchLocale("en");
    expect(buttons.map((button) => button.textContent)).toEqual(["Allow once", "Deny", "Always"]);
    expect(
      card.querySelectorAll("div").find((node) => node.className.includes("card-reason"))
        ?.textContent,
    ).toBe("Product reason in English");
    expect(card.attributes["aria-label"]).toBe("Approval request: Copier");
    expect(card.querySelectorAll("pre")[0]?.textContent).toBe("Votre consigne");
    expect(card.querySelectorAll("code")[0]?.textContent).toBe("Sortie");
    expect(approvals.children[0]).toBe(card);
    expect(input.value).toBe("Mon brouillon : Copier");
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
    expect(active).toBe(input);
    expect([log.scrollTop, log.scrollLeft]).toEqual([87, 12]);
    buttons[0]?.click();
    expect(sent).toEqual([{ type: "approve", toolUseId: "tool-1", choice: "once" }]);
    expect(card.dataset.decided).toBe("true");
    api.switchLocale("fr");
    expect(approvals.children[0]).toBe(card);
    expect(card.dataset.decided).toBe("true");
    expect(card.querySelectorAll("button")).toHaveLength(0);
    expect(card.querySelectorAll("span").some((node) => node.textContent === "Autorisé")).toBe(
      true,
    );
    buttons[0]?.click();
    expect(sent).toHaveLength(1);
    expect(renders).toBe(2);
    const updated = api.renderCard(
      {
        toolUseId: "tool-1",
        tool: "Bash",
        label: "Copier",
        summary: "Sortie",
        reason: "Translated product reason",
        detail: "Votre consigne",
        canRemember: true,
      },
      false,
      { card: {}, node: card },
    ) as NodeStub;
    expect(updated.dataset.decided).toBe("true");
    expect(updated.dataset.choice).toBe("once");
    expect(updated.querySelectorAll("button")).toHaveLength(0);
    // Une annulation native libère les choix, même si la carte précédente était verrouillée.
    const cancelled = api.renderCard({ toolUseId: "tool-1", confirming: false }, false, {
      card: { confirming: true },
      node: { dataset: { choice: "always" } },
    }) as NodeStub;
    expect(cancelled.querySelectorAll("button")).toHaveLength(2);
    expect(cancelled.dataset.decided).toBeUndefined();
    api.switchLocale("invalid");
    expect(renders).toBe(2);
  });
});
