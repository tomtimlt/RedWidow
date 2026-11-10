import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EXEGOL_EXEC_TOOL } from "@warband/core";
import { createUiTranslator, type Locale } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { MAX_EXPORT_TEXT_CHARS, parseWebviewMessage } from "../src/logic/approval.js";
import { type ViewerKind, viewerHtml } from "../src/logic/html.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const viewerSource = readFileSync(new URL("../media/viewer.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../media/ui.js", import.meta.url), "utf8");
const KINDS: ViewerKind[] = ["monitor", "watch", "report"];
const PROJECT_ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

const page = (kind: ViewerKind, locale: Locale = "fr") =>
  viewerHtml({
    kind,
    locale,
    nonce: "n0nce",
    cspSource: "https://x.vscode-cdn.net",
    scriptUri: "https://x.vscode-cdn.net/media/viewer.js",
    uiUri: "https://x.vscode-cdn.net/media/ui.js",
    styleUri: "https://x.vscode-cdn.net/media/css/viewer.css",
  });

// Éléments propres au chat : aucun ne doit exister dans une page en lecture seule.
const CHAT_CONTROLS = [
  "composer",
  "form",
  "input",
  "send",
  "stop",
  "toolbar",
  "attachment-input",
  "model-chip",
  "cfg-btn",
  "composer-menu-btn",
  "research-next",
  "reset",
  "history-btn",
  "approvals",
  "log",
];

class Stub {
  children: Stub[] = [];
  className = "";
  hidden = false;
  title = "";
  value = "";
  type = "";
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  listeners = new Map<string, (() => unknown)[]>();
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  clientHeight = 0;
  style = { setProperty() {} };
  private text = "";
  constructor(
    readonly tag: string,
    readonly id = "",
  ) {}
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  append(...nodes: Stub[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Stub[]) {
    this.children = nodes;
  }
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value);
  }
  getAttribute(key: string) {
    return this.attrs.get(key) ?? null;
  }
  addEventListener(type: string, listener: () => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  querySelector() {
    return null;
  }
  scrollIntoView() {}
  all(): Stub[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

const IDS = [
  "viewer-main",
  "viewer-body",
  "viewer-strip",
  "viewer-empty",
  "viewer-count",
  "viewer-status",
  "viewer-filter",
  "viewer-follow",
  "viewer-copy",
  "viewer-export",
  "viewer-context",
  "viewer-clock",
];

function mount(kind: ViewerKind, saved?: unknown) {
  let locale: Locale = "fr";
  const nodes = new Map(IDS.map((id) => [id, new Stub("div", id)]));
  const node = (id: string) => nodes.get(id) as Stub;
  node("viewer-follow").setAttribute("aria-pressed", "true");
  const sent: Record<string, unknown>[] = [];
  const copied: string[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  const pagehide: (() => void)[] = [];
  let persisted: unknown;
  const root = new Stub("body");
  root.append(...nodes.values());
  runInNewContext(`${uiSource}\n${viewerSource}`, {
    acquireVsCodeApi: () => ({
      postMessage: (m: Record<string, unknown>) => sent.push(m),
      getState: () => saved,
      setState: (state: unknown) => {
        persisted = state;
      },
    }),
    document: {
      body: { dataset: { kind } },
      getElementById: (id: string) => nodes.get(id) ?? null,
      createElement: (tag: string) => new Stub(tag),
    },
    window: {
      addEventListener: (type: string, listener: typeof receive) => {
        if (type === "message") receive = listener;
        if (type === "pagehide") pagehide.push(() => listener({ data: null }));
      },
    },
    navigator: { clipboard: { writeText: async (text: string) => void copied.push(text) } },
    WarbandIcons: { create: () => new Stub("svg") },
    WarbandI18n: {
      t: createUiTranslator(() => locale),
      getLocale: () => locale,
      setLocale: (value: Locale) => {
        locale = value;
      },
      applyStatic: () => {},
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
  });
  node("viewer-main").scrollHeight = 1000;
  node("viewer-main").clientHeight = 200;
  return {
    node,
    sent,
    copied,
    root,
    hide: () => {
      for (const listener of pagehide) listener();
      return persisted;
    },
    post: (data: unknown) => receive({ data }),
    lines: () =>
      node("viewer-body")
        .all()
        .filter((n) => n.className === "mon-line"),
    shownLines: () =>
      node("viewer-body")
        .all()
        .filter((n) => n.className === "mon-line" && !n.hidden)
        .map((n) => n.textContent),
    filter: (text: string) => {
      node("viewer-filter").value = text;
      node("viewer-filter").fire("input");
    },
  };
}

const tool = (id: number, toolUseId: string, argv: string[], output: string) => ({
  kind: "tool",
  id,
  toolUseId,
  tool: EXEGOL_EXEC_TOOL,
  input: JSON.stringify({ container: "lab", argv }),
  output,
  status: "ok",
});
const rowsView = (...items: unknown[]) => ({ items, approvals: [], busy: false });
const SCAN = tool(1, "scan", ["nmap", "-sV"], "Starting Nmap\n80/tcp open\n22/tcp closed");
const WHOIS = tool(2, "whois", ["whois", "example.test"], "Registrar: Exemple");
const REPORT = {
  items: [
    {
      id: -1,
      kind: "report",
      projectId: PROJECT_ID,
      title: "Notes du projet — Labo",
      description: "Brouillon à compléter.",
      findings: [
        { label: "Injection SQL", severity: "unrated", detail: "Constat · Confirmé" },
        { label: "Bannière exposée", severity: "unrated", detail: "Observation · Brouillon" },
      ],
    },
  ],
  approvals: [],
  busy: false,
};

it("rapport : restaure uniquement la position et le suivi, jamais le texte du filtre", () => {
  const first = mount("report");
  first.post({ type: "view", view: REPORT });
  first.filter("texte privé");
  first.node("viewer-main").scrollTop = 123;
  const saved = first.hide();
  expect(saved).toEqual({ top: 123, follow: false });
  const restored = mount("report", saved);
  restored.post({ type: "view", view: REPORT });
  expect(restored.node("viewer-main").scrollTop).toBe(123);
  expect(restored.node("viewer-filter").value).toBe("");
  expect(restored.node("viewer-follow").getAttribute("aria-pressed")).toBe("false");
  const invalid = mount("report", { top: Infinity, follow: false });
  invalid.post({ type: "view", view: REPORT });
  expect(invalid.node("viewer-main").scrollTop).toBe(0);
});

describe("pages en lecture seule : HTML", () => {
  it("chaque page annonce sa nature et ne contient ni composer ni contrôle de chat", () => {
    const headings: Record<ViewerKind, string> = {
      monitor: "Monitor — lecture seule, ce n'est pas un shell",
      watch: "Sortie — lecture seule",
      report: "Rapport — brouillon",
    };
    for (const kind of KINDS) {
      const html = page(kind);
      expect(html).toContain(`<h1 id="title" class="viewer-heading"><span data-i18n=`);
      expect(html).toContain(`${headings[kind]}</span></h1>`);
      for (const id of CHAT_CONTROLS) expect(html, `${kind} ${id}`).not.toContain(`id="${id}"`);
      expect(html).not.toMatch(/<(form|textarea)\b/);
      if (kind === "monitor") expect(html).toContain('id="viewer-family"');
      else expect(html).not.toMatch(/<select\b/);
      expect(html.match(/<input\b/g)).toHaveLength(1);
      expect(html).toContain('<input id="viewer-filter" type="search"');
      // la CSP n'autorise que les scripts de l'extension, sans script inline ni gestionnaire
      expect(html).toContain("default-src 'none'; script-src 'nonce-n0nce'");
      expect(html).not.toMatch(/\son[a-z]+=|javascript:|<style\b|\sstyle=/i);
      expect(html).toContain("media/viewer.js");
      expect(html).not.toContain("media/chat.js");
    }
    expect(page("report")).toContain(
      'id="viewer-follow" type="button" class="ghost" aria-pressed="true" hidden',
    );
    expect(page("monitor", "en")).toContain("Monitor — read-only, not a shell");
  });

  it("refuse un genre ou une adresse dangereuse", () => {
    expect(() =>
      viewerHtml({
        kind: "chat" as ViewerKind,
        nonce: "n",
        cspSource: "https://x",
        scriptUri: "https://x/viewer.js",
        uiUri: "https://x/ui.js",
        styleUri: "https://x/css/viewer.css",
      }),
    ).toThrow("kind");
    expect(() =>
      viewerHtml({
        kind: "monitor",
        nonce: "n",
        cspSource: "https://x",
        scriptUri: 'a" onload="x',
        uiUri: "https://x/ui.js",
        styleUri: "https://x/css/viewer.css",
      }),
    ).toThrow("scriptUri");
  });

  it("le script ne construit jamais de HTML à partir des données", () => {
    expect(viewerSource).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,
    );
  });
});

describe("pages en lecture seule : DOM rendu", () => {
  it("aucun élément composer dans le DOM des trois rôles", () => {
    for (const kind of KINDS) {
      const view = mount(kind);
      view.post({ type: "view", view: kind === "report" ? REPORT : rowsView(SCAN, WHOIS) });
      const all = view.root.all();
      for (const n of all) {
        expect(["textarea", "form", "select"]).not.toContain(n.tag);
        expect(CHAT_CONTROLS, `${kind} #${n.id}`).not.toContain(n.id);
        expect(n.className.split(" ")).not.toContain("composer");
      }
      expect(view.sent[0]).toEqual({ type: "ready" });
    }
  });

  it("les données non fiables restent du texte", () => {
    const view = mount("monitor");
    view.post({
      type: "view",
      view: rowsView(tool(1, "x", ["echo", "<img src=x onerror=alert(1)>"], "<script>1</script>")),
    });
    expect(view.shownLines()).toEqual(["<script>1</script>"]);
    expect(
      view
        .node("viewer-body")
        .all()
        .some((n) => n.tag === "img" || n.tag === "script"),
    ).toBe(false);
  });

  it("le filtre masque les lignes sans le texte, puis les commandes vides", () => {
    const view = mount("monitor");
    view.post({ type: "view", view: rowsView(SCAN, WHOIS) });
    expect(view.shownLines()).toHaveLength(4);
    view.filter("OPEN");
    expect(view.shownLines()).toEqual(["80/tcp open"]);
    const rows = view
      .node("viewer-body")
      .all()
      .filter((n) => n.className.startsWith("mon-row "));
    expect(rows.map((n) => n.hidden)).toEqual([false, true]);
    expect(view.node("viewer-count").textContent).toBe("1 / 6 lignes");
    expect(view.node("viewer-strip").hidden).toBe(false);
    view.filter("introuvable");
    expect(view.shownLines()).toEqual([]);
    expect(view.node("viewer-empty").hidden).toBe(false);
    expect(view.node("viewer-empty").textContent).toBe("Aucune ligne ne contient ce texte.");
    expect(view.node("viewer-strip").hidden).toBe(true);
    view.filter("");
    expect(view.shownLines()).toHaveLength(4);
    expect(view.node("viewer-empty").hidden).toBe(true);
    expect(view.node("viewer-count").textContent).toBe("2 commandes");
  });

  it("le filtre s'applique aussi aux constats du rapport", () => {
    const view = mount("report");
    view.post({ type: "view", view: REPORT });
    const items = () =>
      view
        .node("viewer-body")
        .all()
        .filter((n) => n.className.startsWith("report-item"));
    expect(items()).toHaveLength(2);
    view.filter("bannière");
    expect(items().map((n) => n.hidden)).toEqual([true, false]);
    expect(view.node("viewer-count").textContent).toBe("1 / 2 lignes");
  });

  it("suivi de la fin : actif par défaut, coupé quand l'utilisateur remonte, rétabli par le bouton", () => {
    const view = mount("monitor");
    const main = view.node("viewer-main");
    const follow = view.node("viewer-follow");
    view.post({ type: "view", view: rowsView(SCAN) });
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(main.scrollTop).toBe(1000);
    // en bas : aucun effet
    main.scrollTop = 790;
    main.fire("scroll");
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    // l'utilisateur remonte
    main.scrollTop = 100;
    main.fire("scroll");
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    view.post({ type: "view", view: rowsView(SCAN, WHOIS) });
    expect(main.scrollTop).toBe(100);
    follow.fire("click");
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(main.scrollTop).toBe(1000);
    view.post({ type: "view", view: rowsView(SCAN, WHOIS, tool(3, "c", ["id"], "uid=0")) });
    expect(main.scrollTop).toBe(1000);
  });

  it("Copier prend le contenu visible, Exporter envoie ce texte à l'hôte", async () => {
    const view = mount("watch");
    view.post({ type: "view", view: rowsView(SCAN) });
    view.filter("open");
    view.node("viewer-copy").fire("click");
    await Promise.resolve();
    expect(view.copied).toEqual(["[lab] $ nmap -sV (approuvé)\n80/tcp open"]);
    view.node("viewer-export").fire("click");
    const message = view.sent.at(-1);
    expect(message).toEqual({
      type: "exportText",
      text: "[lab] $ nmap -sV (approuvé)\n80/tcp open",
    });
    expect(parseWebviewMessage(message)).toEqual(message);
  });

  it("Monitor : une commande se suit dans la page Sortie ; la Sortie n'a pas ce lien", () => {
    const monitor = mount("monitor");
    monitor.post({ type: "view", view: rowsView(SCAN) });
    const open = monitor
      .node("viewer-body")
      .all()
      .find((n) => n.className.includes("mon-open"));
    open?.fire("click");
    expect(monitor.sent.at(-1)).toEqual({ type: "watch", toolUseId: "scan" });
    expect(parseWebviewMessage(monitor.sent.at(-1))).toEqual({ type: "watch", toolUseId: "scan" });
    const watch = mount("watch");
    watch.post({ type: "view", view: rowsView(SCAN) });
    expect(
      watch
        .node("viewer-body")
        .all()
        .some((n) => n.className.includes("mon-open")),
    ).toBe(false);
  });

  it("Rapport : Exporter réutilise exportReport avec le seul identifiant du projet", () => {
    const view = mount("report");
    view.post({ type: "view", view: REPORT });
    view.node("viewer-export").fire("click");
    const message = view.sent.at(-1);
    expect(message).toEqual({ type: "exportReport", projectId: PROJECT_ID });
    expect(parseStudioMessage(message)).toEqual(message);
    expect(view.node("viewer-follow").getAttribute("aria-pressed")).toBe("false");
  });

  it("bascule de langue : mêmes données, libellés traduits", () => {
    const view = mount("monitor");
    view.post({ type: "view", view: rowsView(SCAN) });
    expect(view.node("viewer-count").textContent).toBe("1 commande");
    view.post({ type: "locale", locale: "en" });
    expect(view.node("viewer-count").textContent).toBe("1 command");
    expect(view.shownLines()).toHaveLength(3);
  });
});

describe("message d'export validé", () => {
  it("accepte un texte non vide borné, refuse le reste", () => {
    expect(parseWebviewMessage({ type: "exportText", text: "ligne" })).toEqual({
      type: "exportText",
      text: "ligne",
    });
    expect(
      parseWebviewMessage({ type: "exportText", text: "x".repeat(MAX_EXPORT_TEXT_CHARS) }),
    ).not.toBeNull();
    for (const bad of [
      { type: "exportText" },
      { type: "exportText", text: "" },
      { type: "exportText", text: 12 },
      { type: "exportText", text: "x".repeat(MAX_EXPORT_TEXT_CHARS + 1) },
      { type: "exportText", text: "ok", path: "/etc/passwd" },
      { type: "exportText", text: "ok", name: "../x" },
    ])
      expect(parseWebviewMessage(bad), JSON.stringify(bad).slice(0, 60)).toBeNull();
  });

  it("le plafond du script est celui de l'hôte", () => {
    expect(viewerSource).toContain(
      `MAX_EXPORT_CHARS = ${MAX_EXPORT_TEXT_CHARS.toLocaleString("en-US").replaceAll(",", "_")}`,
    );
  });
});
