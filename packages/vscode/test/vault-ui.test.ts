import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { type EngineEvent, newKeyId, type Vault } from "@warband/core";
import { createUiTranslator, UI_EN } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";
import { chatHtml } from "../src/logic/html.js";
import { parseStudioMessage } from "../src/logic/studio.js";
import { vaultView } from "../src/logic/vault-view.js";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SENTINEL = "sk-SENTINELLE-valeur-secrete-987654321";
const ID = "3f2b8c1e-5d4a-4b6f-9a1c-0e7d2b4c6a8f";

describe("messages du coffre : validation stricte (ADR 0056, lot 3)", () => {
  it("accepte les quatre formes valides", () => {
    expect(parseStudioMessage({ type: "vaultAdd", provider: "claude" })).toEqual({
      type: "vaultAdd",
      provider: "claude",
    });
    expect(parseStudioMessage({ type: "vaultRemove", provider: "openai", id: ID })).toEqual({
      type: "vaultRemove",
      provider: "openai",
      id: ID,
    });
    expect(
      parseStudioMessage({ type: "vaultRename", provider: "claude", id: ID, label: "  perso  " }),
    ).toEqual({ type: "vaultRename", provider: "claude", id: ID, label: "perso" });
    expect(
      parseStudioMessage({ type: "vaultRename", provider: "claude", id: ID, label: "" }),
    ).toMatchObject({ label: "" });
    expect(
      parseStudioMessage({ type: "vaultMove", provider: "claude", id: ID, direction: "down" }),
    ).toEqual({ type: "vaultMove", provider: "claude", id: ID, direction: "down" });
  });

  it("refuse tout champ value ou key", () => {
    for (const extra of [{ value: SENTINEL }, { key: SENTINEL }]) {
      expect(parseStudioMessage({ type: "vaultAdd", provider: "claude", ...extra })).toBeNull();
      expect(
        parseStudioMessage({ type: "vaultRemove", provider: "claude", id: ID, ...extra }),
      ).toBeNull();
      expect(
        parseStudioMessage({
          type: "vaultRename",
          provider: "claude",
          id: ID,
          label: "a",
          ...extra,
        }),
      ).toBeNull();
      expect(
        parseStudioMessage({
          type: "vaultMove",
          provider: "claude",
          id: ID,
          direction: "up",
          ...extra,
        }),
      ).toBeNull();
    }
  });

  it("refuse un libellé de 41 caractères, de contrôle ou non textuel ; accepte 40", () => {
    const rename = (label: unknown) =>
      parseStudioMessage({ type: "vaultRename", provider: "claude", id: ID, label });
    expect(rename("a".repeat(41))).toBeNull();
    expect(rename("a".repeat(40))).not.toBeNull();
    expect(rename("a\nb")).toBeNull();
    expect(rename("a\u0000b")).toBeNull();
    expect(rename(12)).toBeNull();
  });

  it("refuse un id qui n'est pas un UUID, un fournisseur invalide et une direction inconnue", () => {
    for (const id of ["1", "../etc", `${ID}x`, "", 5, undefined])
      expect(parseStudioMessage({ type: "vaultRemove", provider: "claude", id })).toBeNull();
    for (const provider of ["", "../x", "Claude", "a b", 3, undefined])
      expect(parseStudioMessage({ type: "vaultAdd", provider })).toBeNull();
    expect(
      parseStudioMessage({ type: "vaultMove", provider: "claude", id: ID, direction: "left" }),
    ).toBeNull();
  });
});

/** Nœud DOM minimal pour exécuter studio.js. */
class Node {
  children: Node[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event?: unknown) => void>();
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  disabled = false;
  hidden = false;
  type = "";
  value = "";
  maxLength = -1;
  constructor(readonly tag: string) {}
  get firstChild() {
    return this.children[0];
  }
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      contains: (c: string) => this.classes.has(c),
      toggle: (c: string, on?: boolean) =>
        on === false || (on === undefined && this.classes.has(c))
          ? this.classes.delete(c)
          : this.classes.add(c),
    };
  }
  parent: Node | undefined;
  append(...nodes: Node[]) {
    for (const node of nodes) node.parent = this;
    this.children.push(...nodes);
  }
  replaceWith(node: Node) {
    const siblings = this.parent?.children;
    const index = siblings?.indexOf(this) ?? -1;
    if (siblings && index >= 0) {
      siblings[index] = node;
      node.parent = this.parent;
    }
  }
  focus() {}
  removeChild(node: Node) {
    this.children = this.children.filter((n) => n !== node);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  addEventListener(type: string, listener: (event?: unknown) => void) {
    this.listeners.set(type, listener);
  }
  all(predicate: (node: Node) => boolean, out: Node[] = []): Node[] {
    if (predicate(this)) out.push(this);
    for (const child of this.children) child.all(predicate, out);
    return out;
  }
  text(): string {
    return this.textContent + this.children.map((c) => c.text()).join(" ");
  }
}

function renderProviders(view: Record<string, unknown>, locale: "fr" | "en" = "fr") {
  const main = new Node("main");
  const nav = new Node("nav");
  const sent: Record<string, unknown>[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  const translate = createUiTranslator(() => locale);
  runInNewContext(read("../media/studio.js"), {
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => sent.push(m) }),
    WarbandI18n: { t: translate, getLocale: () => locale, auditLabel: (v: string) => v },
    document: {
      body: new Node("body"),
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
  receive({
    data: {
      type: "view",
      page: "providers",
      projectId: null,
      capabilities: { providers: ["claude"] },
      providerCatalog: [
        { id: "claude", label: "Claude" },
        { id: "openai", label: "OpenAI" },
      ],
      providerAuth: { claude: false, openai: false },
      ...view,
    },
  });
  // Messages de démarrage (ready, rendered) écartés : les tests ne regardent que les actions.
  sent.length = 0;
  return { main, sent };
}

const entries = (n: number, extra: Record<number, object> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: newKeyId(),
    rank: i + 1,
    fingerprint: `0000000${i}`.slice(-8),
    state: "active",
    ...(extra[i] ?? {}),
  }));

describe("page Fournisseurs : section Clés", () => {
  it("absente quand le fournisseur n'est pas dans vault", () => {
    const { main } = renderProviders({});
    expect(main.all((n) => n.className.includes("vault-keys"))).toHaveLength(0);
  });

  it("une ligne par clé : rang, empreinte, libellé, états et heure locale du délai", () => {
    const until = new Date(2026, 10, 16, 9, 5).toISOString();
    const keys = entries(3, {
      0: { label: "perso" },
      1: { state: "exhausted", cooldownUntil: until },
      2: { state: "invalid" },
    });
    const { main } = renderProviders({ vault: { claude: keys } });
    const rows = main.all((n) => n.className === "capability-row vault-key");
    expect(rows).toHaveLength(3);
    const text = rows.map((r) => r.text());
    expect(text[0]).toContain("clé 1 · 00000000");
    expect(text[0]).toContain("perso");
    expect(text[0]).toContain("active");
    expect(text[1]).toContain("clé 2 · 00000001");
    expect(text[1]).toContain("épuisée · jusqu'à 09:05");
    expect(text[2]).toContain("invalide");
    // Une section Clés avec son titre, sous Claude seulement.
    expect(main.all((n) => n.tag === "h3" && n.textContent === "Clés")).toHaveLength(1);
  });

  it("rendu anglais", () => {
    const keys = entries(2, {
      1: { state: "exhausted", cooldownUntil: new Date(2026, 10, 16, 14, 30).toISOString() },
    });
    const { main } = renderProviders({ vault: { openai: keys } }, "en");
    const text = main.text();
    expect(text).toContain("key 1 · 00000000");
    expect(text).toContain("exhausted · until 14:30");
    expect(text).toContain("Add key");
  });

  it("« Ajouter une clé » : actif sous 10 clés, désactivé à 10", () => {
    const add = (count: number) => {
      const { main, sent } = renderProviders({ vault: { claude: entries(count) } });
      const button = main.all((n) => n.tag === "button" && n.textContent === "Ajouter une clé")[0];
      return { button, sent };
    };
    const nine = add(9);
    expect(nine.button?.disabled).toBe(false);
    nine.button?.listeners.get("click")?.();
    expect(nine.sent.at(-1)).toEqual({ type: "vaultAdd", provider: "claude" });
    expect(add(10).button?.disabled).toBe(true);
  });

  it("Monter, Descendre et Supprimer envoient des messages sans valeur ; bornes désactivées", () => {
    const keys = entries(2);
    const { main, sent } = renderProviders({ vault: { claude: keys } });
    const buttons = (label: string) =>
      main.all((n) => n.tag === "button" && n.textContent === label);
    expect(buttons("Monter").map((b) => b.disabled)).toEqual([true, false]);
    expect(buttons("Descendre").map((b) => b.disabled)).toEqual([false, true]);
    buttons("Monter")[1]?.listeners.get("click")?.();
    buttons("Supprimer")[0]?.listeners.get("click")?.();
    expect(sent.slice(-2)).toEqual([
      { type: "vaultMove", provider: "claude", id: keys[1]?.id, direction: "up" },
      { type: "vaultRemove", provider: "claude", id: keys[0]?.id },
    ]);
    for (const message of sent) expect(parseStudioMessage(message)).not.toBeNull();
  });

  it("Renommer : champ de libellé seulement, envoyé sur Entrée ; jamais de champ de clé", () => {
    const keys = entries(1);
    const { main, sent } = renderProviders({ vault: { claude: keys } });
    main
      .all((n) => n.tag === "button" && n.textContent === "Renommer")[0]
      ?.listeners.get("click")?.();
    expect(sent).toEqual([]);
    const input = main.all((n) => n.tag === "input" && n.className.includes("vault-key-input"))[0];
    expect(input?.maxLength).toBe(40);
    expect(input?.type).toBe("text");
    if (input) input.value = "  mon libellé ";
    input?.listeners.get("keydown")?.({ key: "Enter" });
    expect(sent).toEqual([
      { type: "vaultRename", provider: "claude", id: keys[0]?.id, label: "mon libellé" },
    ]);
    expect(parseStudioMessage(sent[0])).not.toBeNull();
    const source = read("../media/studio.js");
    const fn = source.slice(
      source.indexOf("function vaultKeys("),
      source.indexOf("// Intégrations (Projet)"),
    );
    expect(fn).not.toMatch(/password|innerHTML/i);
    expect(source).not.toMatch(/type = "password"/);
  });

  it("claude en abonnement : mention « hors du coffre », sans section", () => {
    const { main } = renderProviders({ providerAuth: { claude: true, openai: false }, vault: {} });
    expect(main.all((n) => n.className.includes("vault-keys"))).toHaveLength(0);
    expect(main.text()).toContain("Jeton d'abonnement, hors du coffre");
  });
});

describe("chat : clé effective (ADR 0056, lot 3)", () => {
  const ev = (payload: Record<string, unknown>) =>
    ({
      id: `e${Math.random()}`,
      ts: "2026-11-16T10:00:00.000Z",
      runId: "r",
      parentId: null,
      ...payload,
    }) as EngineEvent;
  const noticeTexts = (state: ReturnType<typeof createChatState>) =>
    state.view().items.flatMap((i) => (i.kind === "notice" ? [i.text] : []));

  it("provider.key (coffre) place activeKey ; legacy l'ignore ; clearActiveKey l'efface", () => {
    const state = createChatState();
    expect(state.view().activeKey).toBeUndefined();
    state.event(
      ev({
        kind: "provider.key",
        provider: "claude",
        keyRank: 1,
        fingerprint: "aaaaaaaa",
        source: "legacy",
      }),
    );
    expect(state.view().activeKey).toBeUndefined();
    state.event(
      ev({
        kind: "provider.key",
        provider: "claude",
        keyRank: 2,
        fingerprint: "3fa9c1d0",
        source: "vault",
      }),
    );
    expect(state.view().activeKey).toEqual({
      provider: "claude",
      rank: 2,
      fingerprint: "3fa9c1d0",
    });
    state.clearActiveKey();
    expect(state.view().activeKey).toBeUndefined();
  });

  it("vault.rotated ajoute les deux phrases (quota, clé refusée)", () => {
    const state = createChatState();
    state.event(
      ev({
        kind: "vault.rotated",
        provider: "claude",
        fromRank: 1,
        fromFingerprint: "aaaaaaaa",
        toRank: 2,
        toFingerprint: "bbbbbbbb",
        cause: "quota",
      }),
    );
    state.event(
      ev({
        kind: "vault.rotated",
        provider: "claude",
        fromRank: 2,
        fromFingerprint: "bbbbbbbb",
        toRank: 3,
        toFingerprint: "cccccccc",
        cause: "invalidKey",
      }),
    );
    expect(noticeTexts(state)).toEqual([
      "Quota atteint sur la clé 1 · aaaaaaaa, passage à la clé 2 · bbbbbbbb.",
      "Clé 2 · bbbbbbbb refusée, passage à la clé 3 · cccccccc.",
    ]);
  });

  it("aucune valeur de clé dans la vue sérialisée du chat", () => {
    const state = createChatState();
    state.event(
      ev({
        kind: "provider.key",
        provider: "claude",
        keyRank: 1,
        fingerprint: "aaaaaaaa",
        source: "vault",
      }),
    );
    expect(JSON.stringify(state.view())).not.toContain(SENTINEL);
  });
});

describe("puce #key-chip", () => {
  const html = chatHtml({
    nonce: "abc123_-XYZ",
    cspSource: "https://x.vscode-cdn.net",
    scriptUri: "https://x.vscode-cdn.net/media/chat.js",
    iconsUri: "https://x.vscode-cdn.net/media/icons.js",
    uiUri: "https://x.vscode-cdn.net/media/ui.js",
    styleUri: "https://x.vscode-cdn.net/media/chat.css",
  });

  it("juste après #model-chip, avant la puce Multi, masquée au départ", () => {
    const model = html.indexOf('id="model-chip"');
    const key = html.indexOf('id="key-chip"');
    expect(key).toBeGreaterThan(model);
    expect(key).toBeLessThan(html.indexOf('id="multi-chip"'));
    expect(html.indexOf('</button><span id="key-chip"', model)).toBeGreaterThan(-1);
    expect(/<[^>]*\sid="key-chip"[^>]*\shidden[\s>]/.test(html)).toBe(true);
  });

  const js = read("../media/chat.js");
  const start = js.indexOf("  function paintKeyChip(");
  const slice = js.slice(start, js.indexOf("  function render(view) {"));
  const run = (activeKey: unknown, vaultEmpty?: boolean) => {
    const nodes = new Map<
      string,
      {
        hidden: boolean;
        textContent: string;
        classList: { toggle(c: string, on: boolean): void };
        empty?: boolean;
      }
    >();
    const $ = (id: string) => {
      let n = nodes.get(id);
      if (!n) {
        const node: {
          hidden: boolean;
          textContent: string;
          empty?: boolean;
          classList: { toggle(c: string, on: boolean): void };
        } = {
          hidden: true,
          textContent: "",
          classList: {
            toggle: (_c, on) => {
              node.empty = on;
            },
          },
        };
        n = node;
        nodes.set(id, n);
      }
      return n;
    };
    const api = runInNewContext(`${slice}\n({ paintKeyChip })`, {
      $,
      t: createUiTranslator(() => "fr"),
    }) as { paintKeyChip(k: unknown, e?: boolean): void };
    api.paintKeyChip(activeKey, vaultEmpty);
    return { chip: $("key-chip"), label: $("key-chip-label") };
  };

  it("masquée sans activeKey, visible avec une seule clé, texte « clé {rank} · {empreinte} »", () => {
    expect(run(undefined).chip.hidden).toBe(true);
    const shown = run({ provider: "claude", rank: 1, fingerprint: "3fa9c1d0" });
    expect(shown.chip.hidden).toBe(false);
    expect(shown.label.textContent).toBe("clé 1 · 3fa9c1d0");
  });

  it("coffre vide : « sans clé du coffre », discrète ; une clé ou hors éligibilité : inchangé", () => {
    const empty = run(undefined, true);
    expect(empty.chip.hidden).toBe(false);
    expect(empty.label.textContent).toBe("sans clé du coffre");
    expect(empty.chip.empty).toBe(true);
    // Une clé active prime : « clé N · empreinte ».
    const keyed = run({ provider: "claude", rank: 2, fingerprint: "abcd" }, true);
    expect(keyed.label.textContent).toBe("clé 2 · abcd");
    expect(keyed.chip.empty).toBe(false);
    // Fournisseur non éligible (vaultEmpty absent) : masquée.
    expect(run(undefined, undefined).chip.hidden).toBe(true);
  });

  it("textes anglais présents dans le catalogue", () => {
    for (const key of [
      "sans clé du coffre",
      "Ouvrir les clés",
      "Clés",
      "Ajouter une clé",
      "clé {0} · {1}",
      "épuisée",
      "jusqu'à {0}",
      "Supprimer la clé {0} ?",
      "Jeton d'abonnement, hors du coffre",
      "Quota atteint sur la clé {0}, passage à la clé {1}.",
      "Clé {0} refusée, passage à la clé {1}.",
    ])
      expect(UI_EN[key], key).toBeDefined();
  });
});

describe("aucune valeur de clé dans la vue des réglages", () => {
  it("la vue ne porte que vaultView ; la valeur n'est jamais sérialisée", () => {
    const vault: Vault = {
      keys: [
        {
          id: newKeyId(),
          value: SENTINEL,
          addedAt: "2026-11-16T10:00:00.000Z",
          state: "active",
        },
      ],
    };
    const view = { vault: { claude: vaultView(vault) } };
    expect(JSON.stringify(view)).not.toContain(SENTINEL);
    const extension = read("../src/extension/extension.ts");
    expect(extension).toContain("vault[id] = vaultView(await vaultStore.get(id))");
    // Le message de suppression n'affiche que rang et empreinte.
    expect(extension).toContain("keyDescription(index + 1, fingerprint(target.value))");
  });
});
