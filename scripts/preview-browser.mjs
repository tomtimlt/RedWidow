import { createDemo, SCENARIOS } from "/src/demo.mjs";
const query = new URLSearchParams(location.search);
const kind = query.get("view") ?? "chat";
let section = "project", demo;
const send = (message) => window.postMessage(message, "*");
function draw() {
  if (!demo) return;
  send(kind === "graph" || kind === "settings" ? demo.studioView(kind === "graph" ? "graph" : section) : { type: "view", view: demo.chatView(), chatId: "demo" });
}
const toolbar = document.createElement("nav");
toolbar.className = "demo-toolbar";
toolbar.setAttribute("aria-label", "Options de démonstration");
function select(label, options, current, changed) {
  const field = document.createElement("select");
  field.setAttribute("aria-label", label);
  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    field.append(option);
  }
  field.value = current;
  field.addEventListener("change", () => changed(field.value));
  toolbar.append(field);
  return field;
}
select("Vue", [["chat", "Chat"], ["monitor", "Monitor"], ["graph", "Graphe"], ["settings", "Réglages"]], kind, (value) => {
  query.set("view", value);
  location.search = query.toString();
});
select("Scénario", SCENARIOS, query.get("scenario") ?? "conversation", (value) => demo.selectScenario(value));
function applyTheme(value) {
  document.body.dataset.theme = value;
  for (const cls of ["vscode-dark", "vscode-light", "vscode-high-contrast"]) document.body.classList.remove(cls);
  document.body.classList.add(value === "hc" ? "vscode-high-contrast" : `vscode-${value}`);
}
select("Thème", [["dark", "Sombre"], ["light", "Clair"], ["hc", "Contraste élevé"]], query.get("theme") ?? "dark", applyTheme);
applyTheme(query.get("theme") ?? "dark");
const PALETTES = [["sentinelle", "Sentinelle"], ["braise", "Braise"], ["bastion", "Bastion"], ["spectre", "Spectre"], ["editeur", "Éditeur"]];
const applyPalette = (value) => {
  document.body.dataset.palette = value;
  query.set("palette", value);
  history.replaceState(null, "", "?" + query.toString());
};
select("Palette", PALETTES, query.get("palette") ?? "sentinelle", applyPalette);
applyPalette(query.get("palette") ?? "sentinelle");
document.body.prepend(toolbar);
demo = createDemo({ onChange: draw, onOpen: (view, page) => {
  if (view === "settings" && page) section = page;
  query.set("view", view);
  location.search = query.toString();
}, onInfo: (text) => {
  const note = document.createElement("div");
  note.className = "notice info";
  note.textContent = text;
  toolbar.after(note);
  setTimeout(() => note.remove(), 3e3);
} });
if (kind === "monitor") send({ type: "role", role: "monitor" });
demo.selectScenario(query.get("scenario") ?? "conversation");
globalThis.__demoReceive = (message) => {
  if (message.type === "open" && kind === "settings") {
    section = message.page;
    draw();
    return;
  }
  if (message.type === "watch") {
    query.set("view", "monitor");
    location.search = query.toString();
    return;
  }
  demo.receive(message, send);
};
for (const message of globalThis.__demoQueue) globalThis.__demoReceive(message);
globalThis.__demoQueue.length = 0;
globalThis.demo = demo;
