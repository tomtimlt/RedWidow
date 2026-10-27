import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDemo, SCENARIOS, PROJECT } from "../src/demo.mjs";
import { chatHtml, graphHtml, studioHtml } from "../src/views.mjs";
test("les scénarios montrent accueil, activité, validation, catalogue indisponible et pages", () => {
  const demo = createDemo();
  for (const [key] of SCENARIOS) {
    demo.selectScenario(key);
    assert.ok(Array.isArray(demo.chatView().items));
  }
  demo.selectScenario("welcome");
  assert.equal(demo.chatView().items.length, 0);
  demo.selectScenario("running");
  assert.equal(demo.chatView().busy, true);
  demo.selectScenario("approval");
  assert.equal(demo.chatView().approvals.length, 1);
  demo.receive({ type: "approve", toolUseId: "task-6", choice: "once" });
  assert.equal(demo.chatView().busy, false);
  demo.selectScenario("unavailable");
  assert.equal(demo.chatView().noProvider, true);
  demo.selectScenario("long");
  const first = demo.chatView().items[0].id;
  demo.receive({ type: "timelinePage", direction: "older" });
  assert.ok(demo.chatView().items[0].id < first);
  demo.receive({ type: "timelinePage", direction: "latest" });
  assert.equal(demo.chatView().items[0].id, first);
  demo.dispose();
});
test("liens et suppression modifient uniquement les éléments fictifs du projet actif", () => {
  const demo = createDemo();
  const before = JSON.stringify(demo.studioView());
  demo.receive({ type: "deleteEntry", projectId: "autre", id: "brief" });
  assert.equal(JSON.stringify(demo.studioView()), before);
  demo.receive({ type: "setPathEdge", projectId: PROJECT, from: "research", to: "layout", retained: true });
  assert.ok(demo.studioView().entries.find((e) => e.id === "layout").pathFrom.includes("research"));
  demo.receive({ type: "deleteEntry", projectId: PROJECT, id: "research" });
  assert.ok(demo.studioView().entries.every((e) => e.id !== "research" && !e.from?.includes("research") && !e.pathFrom?.includes("research")));
  demo.dispose();
});
test("un message est affiché en texte et sa réponse est simulée, sans fournisseur", async () => {
  const demo = createDemo();
  demo.receive({ type: "send", text: "<script>exemple<\/script>" });
  assert.equal(demo.chatView().busy, true);
  assert.equal(demo.chatView().items.at(-1).text, "<script>exemple<\/script>");
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(demo.chatView().busy, false);
  assert.equal(demo.chatView().items.at(-1).kind, "agent");
  demo.dispose();
});
test("les pages gardent leur CSP et les messages passent par un pont local de présentation", async () => {
  const options = { nonce: "testNonce123", cspSource: "https://local.invalid", scriptUri: "https://local.invalid/media/chat.js", uiUri: "https://local.invalid/media/ui.js", styleUri: "https://local.invalid/media/chat.css" };
  for (const view of [chatHtml, graphHtml, studioHtml]) {
    const html = view(options);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-testNonce123'"));
  }
  const extension = await readFile(new URL("../extension.cjs", import.meta.url), "utf8");
  assert.ok(extension.includes("enableCommandUris:false"));
  assert.ok(extension.includes("localResourceRoots:[media]"));
});
test("le pont VS Code ouvre les vues et transmet les interactions de la simulation", async () => {
  const { Module } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const commands = /* @__PURE__ */ new Map(), panels = [];
  let provider;
  const disposable = () => ({ dispose() {
  } });
  const resource = (path2) => ({ path: path2, toString: () => `https://local.invalid${path2}` });
  const makeView = () => {
    const disposed = [];
    const messages = [];
    let receive;
    const view = { messages, webview: { cspSource: "https://local.invalid", asWebviewUri: (uri) => uri, postMessage: (message) => {
      messages.push(message);
      return Promise.resolve(true);
    }, onDidReceiveMessage: (fn) => {
      receive = fn;
      return disposable();
    } }, onDidDispose: (fn) => {
      disposed.push(fn);
      return disposable();
    }, dispose: () => disposed.forEach((fn) => fn()), reveal() {
    }, send: (message) => receive(message) };
    return view;
  };
  const api = {
    Uri: { joinPath: (base, ...parts) => resource(base.path + "/" + parts.join("/")) },
    ViewColumn: { One: 1 },
    window: { registerWebviewViewProvider: (_id, value) => {
      provider = value;
      return disposable();
    }, createWebviewPanel: () => {
      const panel = makeView();
      panels.push(panel);
      return panel;
    }, showInformationMessage() {
    }, showQuickPick: async () => ({ value: "approval" }) },
    commands: { registerCommand: (name, fn) => {
      commands.set(name, fn);
      return disposable();
    } }
  };
  const path = fileURLToPath(new URL("../extension.cjs", import.meta.url));
  const loaded = new Module(path);
  loaded.filename = path;
  loaded.require = (name) => {
    assert.equal(name, "vscode");
    return api;
  };
  loaded._compile(await readFile(path, "utf8"), path);
  const context = { extensionUri: resource(""), subscriptions: [] };
  await loaded.exports.activate(context);
  const sidebar = makeView();
  provider.resolveWebviewView(sidebar);
  sidebar.send({ type: "ready" });
  assert.ok(sidebar.webview.html.includes("Content-Security-Policy"));
  assert.ok(sidebar.messages.some((m) => m.type === "view" && m.view.items.length > 0));
  commands.get("warbandDesign.graph")();
  assert.ok(panels[0].webview.html.includes("graph-full"));
  await commands.get("warbandDesign.scenario")();
  assert.ok(sidebar.messages.some((m) => m.type === "view" && m.view.approvals.length === 1));
  sidebar.send({ type: "approve", toolUseId: "task-6", choice: "once" });
  assert.equal(sidebar.messages.filter((m) => m.type === "view").at(-1).view.busy, false);
  for (const item of context.subscriptions) item.dispose();
});
test("les pictogrammes viennent d'une source unique et la palette est validée", async () => {
  const source = await readFile(new URL("../media/icons.js", import.meta.url), "utf8");
  const names = new Set();
  const fakeWindow = {};
  new Function("window", "document", source)(fakeWindow, { querySelectorAll: () => [] });
  for (const name of fakeWindow.WarbandIcons.names) names.add(name);
  const options = { nonce: "testNonce123", cspSource: "https://local.invalid", scriptUri: "https://local.invalid/media/chat.js", uiUri: "https://local.invalid/media/ui.js", styleUri: "https://local.invalid/media/chat.css" };
  for (const view of [chatHtml, graphHtml, studioHtml]) {
    const html = view({ ...options, palette: "\"><script>" });
    for (const [, name] of html.matchAll(/data-icon="([^"]+)"/g)) assert.ok(names.has(name), name);
    assert.match(html, /data-palette="sentinelle"/);
    assert.match(view({ ...options, palette: "spectre" }), /data-palette="spectre"/);
  }
  const studio = await readFile(new URL("../media/studio.js", import.meta.url), "utf8");
  for (const [, name] of studio.matchAll(/WarbandIcons\.create\("([a-zA-Z]+)"/g)) assert.ok(names.has(name), name);
});
