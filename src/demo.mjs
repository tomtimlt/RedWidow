export const SCENARIOS = [
  ["welcome", "Accueil"],
  ["conversation", "Conversation"],
  ["running", "Activité en cours"],
  ["approval", "Validation en attente"],
  ["unavailable", "Connexion indisponible"],
  ["long", "Historique long"]
];
export const PROJECT = "11111111-1111-4111-8111-111111111111";
const task = (id, status = "ok", count = 8) => ({
  id,
  kind: "tool",
  toolUseId: `task-${id}`,
  tool: "demo__workbench__exec",
  label: "Tâche de démonstration",
  summary: `Préparer le composant ${id}`,
  input: JSON.stringify({ space: "atelier-ui", argv: ["demo", "preview", `composant-${id}`] }),
  status,
  decision: "allow",
  output: Array.from({ length: count }, (_, i) => `Étape ${i + 1} · aperçu du composant ${id}`).join("\n")
});
const agent = (id, text) => ({ id, kind: "agent", text, blocks: [{ t: "p", c: [{ t: "text", v: text }] }] });
const graphEntries = () => [
  { id: "brief", kind: "resource", state: "complete", label: "Brief du projet", phase: "P01" },
  { id: "research", kind: "site", state: "complete", label: "Références visuelles", phase: "P02", from: ["brief"], pathFrom: ["brief"] },
  { id: "tokens", kind: "reference", state: "complete", label: "Palette et typographie", phase: "P02", from: ["brief"], pathFrom: ["brief"] },
  { id: "layout", kind: "step", state: "complete", label: "Disposition des panneaux", phase: "P03", from: ["research", "tokens"], pathFrom: ["tokens"] },
  { id: "variant", kind: "step", state: "failed", label: "Variante écartée", phase: "P03", from: ["research"] },
  { id: "review", kind: "step", state: "planned", label: "Relecture de la navigation et des états vides", phase: "P04", from: ["layout"], pathFrom: ["layout"] },
  { id: "delivery", kind: "result", state: "planned", label: "Maquette de présentation", phase: "P05", from: ["review"] }
];
export function createDemo({ onChange = () => {
}, onOpen = () => {
}, onInfo = () => {
} } = {}) {
  let scenario = "conversation", items = [], approvals = [], busy = false, readonly = null, page = 0;
  let automatic = false, nextId = 100, timer;
  let entries = graphEntries();
  const projects = [
    { id: PROJECT, name: "Atelier interface", workspace: "/demo/atelier-interface" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Bibliothèque de composants", workspace: "/demo/composants" }
  ];
  let activeId = PROJECT;
  const summaries = /* @__PURE__ */ new Map([[PROJECT, "Objectif : améliorer la lisibilité, les espacements et la navigation.\nToutes les données de cet atelier sont fictives."]]);
  const models = [
    { value: "demo/balanced", label: "Modèle équilibré", description: "Option visuelle de démonstration" },
    { value: "demo/quick", label: "Modèle rapide", description: "Autre état du sélecteur" },
    { value: "atelier/detailed", label: "Modèle détaillé", description: "Catalogue fictif" }
  ];
  const controls = {
    model: "demo/balanced",
    provider: "demo",
    models,
    modelsStatus: "ready",
    modelsMessage: null,
    effort: null,
    variant: null,
    reasoningVariants: [],
    effortLabel: "Auto",
    effortTip: "Réglage de présentation.",
    levels: ["low", "medium", "high", "xhigh", "max"].map((value, i) => ({ value, label: ["Léger", "Normal", "Élevé", "Approfondi", "Maximum"][i], tip: "Aperçu du réglage", enabled: true })),
    effortDisabled: false,
    locked: false,
    learning: false
  };
  const history = [
    { id: "33333333-3333-4333-8333-333333333333", title: "Améliorer le tableau de bord", updatedAt: "2026-10-27T09:00:00.000Z", tools: 4, provider: "Démo", model: "Équilibré", current: false, projectKey: PROJECT, projectLabel: "Atelier interface" },
    { id: "44444444-4444-4444-8444-444444444444", title: "Explorer les thèmes et les espacements", updatedAt: "2026-10-26T15:00:00.000Z", tools: 2, provider: "Démo", model: "Rapide", current: false, projectKey: PROJECT, projectLabel: "Atelier interface" }
  ];
  function selectScenario(value) {
    if (!SCENARIOS.some(([key]) => key === value)) return;
    clearTimeout(timer);
    scenario = value;
    page = 0;
    busy = value === "running" || value === "approval";
    readonly = null;
    approvals = [];
    items = value === "welcome" || value === "unavailable" ? [] : [
      { id: 1, kind: "user", text: "Peux-tu préparer une vue claire pour notre projet ?" },
      agent(2, "Je rassemble les composants, puis je prépare une proposition de disposition."),
      task(3),
      task(4),
      { id: 5, kind: "agent", text: "La proposition est prête.\n\nTrois vues : conversation, activités et graphe.", blocks: [
        { t: "h", level: 1, c: [{ t: "text", v: "Une base lisible et cohérente" }] },
        { t: "p", c: [{ t: "text", v: "Trois vues complémentaires : " }, { t: "b", c: [{ t: "text", v: "conversation, activités et graphe" }] }] },
        { t: "ul", items: [[{ t: "text", v: "Respecter les couleurs du thème VS Code" }], [{ t: "text", v: "Préserver le clavier et les états de focus" }]] },
        { t: "code", lang: "texte", text: "Espacements : 4 · 8 · 12 · 16\nRayons : 6 · 10 · 16" },
        { t: "table", headers: [[{ t: "text", v: "Composant" }], [{ t: "text", v: "État" }]], align: ["left", "left"], rows: [[[{ t: "text", v: "Navigation" }], [{ t: "text", v: "Prête" }]], [[{ t: "text", v: "Graphe" }], [{ t: "text", v: "À relire" }]]] }
      ] }
    ];
    if (value === "running" || value === "approval") items.push(task(6, "pending", 24));
    if (value === "approval") approvals = [{ toolUseId: "task-6", tool: "demo__workbench__exec", label: "Préparer la présentation", summary: "Afficher une variante du composant", detail: "Validation simulée pour présenter la carte et ses boutons.", reason: "Scénario de démonstration : validation attendue.", canRemember: true }];
    onChange();
  }
  function chatView() {
    const shown = scenario === "long" ? Array.from({ length: 50 }, (_, i) => task(1e3 - page * 50 + i, "ok", 35)) : items;
    return {
      conversation: `demo-${activeId}-${scenario}`,
      items: shown,
      approvals,
      busy,
      sandbox: null,
      sandboxNetwork: null,
      controls: { ...controls, locked: busy, modelsStatus: scenario === "unavailable" ? "unavailable" : "ready", modelsMessage: scenario === "unavailable" ? "Catalogue fictif indisponible dans ce scénario." : null },
      history,
      readonly,
      noProvider: scenario === "unavailable",
      paging: { earlier: scenario === "long" && page < 3, archived: page > 0, before: page ? `demo-page-${page}` : null, loading: false }
    };
  }
  function studioView(section = "project") {
    const project = projects.find((p) => p.id === activeId);
    return {
      type: "view",
      page: section,
      projectId: activeId,
      entries,
      projectBusy: false,
      projectChoices: { activeId, projects },
      projectSummary: { projectId: activeId, projectName: project.name, text: summaries.get(activeId) ?? "" },
      linkedBanner: { name: "atelier-ui", workspace: project.workspace },
      docker: "present",
      daemon: "reachable",
      workbench: "present",
      spaces: [{ name: "atelier-ui", state: "running" }, { name: "archive-demo", state: "stopped" }],
      sources: [{ name: "Guide des composants", droits: "Contenu de démonstration" }, { name: "Conventions visuelles", droits: "Exemples fictifs" }]
    };
  }
  function auxiliary() {
    return [
      { type: "spaces", items: [{ name: "atelier-ui", state: "running" }, { name: "archive-demo", state: "stopped" }] },
      { type: "terminals", items: [{ token: "apercu", label: "apercu", hint: "Journal de démonstration" }] },
      { type: "automatic", on: automatic, armed: false, expiresAt: Date.now() + 72e5 }
    ];
  }
  function receive(message, reply = () => {
  }) {
    if (!message || typeof message !== "object" || typeof message.type !== "string") return;
    switch (message.type) {
      case "ready":
      case "refresh":
      case "historyRefresh":
      case "refreshModels":
      case "refreshTerminals":
        onChange();
        for (const item of auxiliary()) reply(item);
        break;
      case "send":
        if (busy || readonly || typeof message.text !== "string" || !message.text.trim()) return;
        if (scenario === "long" || scenario === "welcome" || scenario === "unavailable") selectScenario("conversation");
        items.push({ id: nextId++, kind: "user", text: message.text.slice(0, 1e4) });
        busy = true;
        onChange();
        clearTimeout(timer);
        timer = setTimeout(() => {
          items.push(agent(nextId++, "Message reçu dans la démonstration. Cet aperçu permet de travailler la présentation, les interactions et les états visuels."));
          busy = false;
          onChange();
        }, 650);
        break;
      case "stop":
        clearTimeout(timer);
        busy = false;
        approvals = [];
        onChange();
        break;
      case "reset":
        selectScenario("welcome");
        break;
      case "approve":
        if (!approvals.some((a) => a.toolUseId === message.toolUseId)) return;
        approvals = [];
        busy = false;
        items = items.map((item) => item.kind === "tool" && item.toolUseId === message.toolUseId ? { ...item, status: message.choice === "deny" ? "denied" : "ok", decision: message.choice === "deny" ? "deny" : "allow" } : item);
        onChange();
        break;
      case "setModel":
        if (message.model === null || models.some((m) => m.value === message.model)) {
          controls.model = message.model;
          onChange();
        }
        break;
      case "setProvider":
        if (["demo", "local", "atelier"].includes(message.provider)) {
          controls.provider = message.provider;
          onChange();
        }
        break;
      case "setEffort":
        controls.effort = controls.levels.some((l) => l.value === message.effort) ? message.effort : null;
        controls.effortLabel = controls.effort ?? "Auto";
        onChange();
        break;
      case "setLearning":
        controls.learning = message.enabled === true;
        onChange();
        break;
      case "setAutomatic":
        automatic = message.enabled === true;
        reply(auxiliary().at(-1));
        break;
      case "addProvider":
        selectScenario("conversation");
        onInfo("Connexion simulée : aucune clé ni connexion externe.");
        break;
      case "openGraph":
        onOpen("graph");
        break;
      case "openMonitor":
        onOpen("monitor");
        break;
      case "openCockpit":
        onOpen("settings", "spaces");
        break;
      case "openCours":
        onInfo("Les documents listés sont des exemples de présentation.");
        break;
      case "timelinePage":
        if (scenario === "long") {
          page = message.direction === "latest" ? 0 : Math.max(0, Math.min(3, page + (message.direction === "older" ? 1 : -1)));
          onChange();
        }
        break;
      case "historyOpen": {
        const row = history.find((h) => h.id === message.id);
        if (!row) return;
        readonly = { id: row.id, title: row.title, invalid: 0, truncated: false, canResume: true };
        items = [agent(nextId++, "Exemple de conversation enregistrée pour travailler la vue de lecture.")];
        busy = false;
        onChange();
        break;
      }
      case "historyResume":
        readonly = null;
        onChange();
        break;
      case "historyRename": {
        const row = history.find((h) => h.id === message.id);
        if (row && typeof message.title === "string") row.title = message.title.slice(0, 120);
        onChange();
        break;
      }
      case "historyDelete": {
        const i = history.findIndex((h) => h.id === message.id);
        if (i >= 0) history.splice(i, 1);
        onChange();
        break;
      }
      case "historyClear":
        history.length = 0;
        onChange();
        break;
      case "activateProject":
        if (projects.some((p) => p.id === message.projectId)) {
          activeId = message.projectId;
          entries = graphEntries();
          selectScenario("conversation");
        }
        break;
      case "createProject":
        if (typeof message.name === "string" && message.name.trim()) {
          const id = `55555555-5555-4555-8555-${String(projects.length).padStart(12, "0")}`;
          projects.push({ id, name: message.name.trim().slice(0, 80), workspace: "/demo/nouveau-projet" });
          activeId = id;
          entries = graphEntries();
          onChange();
          reply({ ...studioView("project"), projectCreated: id });
        }
        break;
      case "saveSummary":
        if (message.projectId === activeId && typeof message.text === "string") {
          summaries.set(activeId, message.text.slice(0, 8192));
          onChange();
          reply({ ...studioView("project"), summarySaved: activeId });
        }
        break;
      case "setPathEdge": {
        const entry = entries.find((e) => e.id === message.to);
        if (message.projectId !== activeId || !entry?.from?.includes(message.from)) return;
        const values = new Set(entry.pathFrom ?? []);
        if (message.retained === true) values.add(message.from);
        else values.delete(message.from);
        entry.pathFrom = [...values];
        onChange();
        reply({ type: "pathEdgeState", projectId: activeId, from: message.from, to: message.to });
        break;
      }
      case "deleteEntry":
        if (message.projectId === activeId) {
          entries = entries.filter((e) => e.id !== message.id).map((e) => ({ ...e, from: e.from?.filter((id) => id !== message.id), pathFrom: e.pathFrom?.filter((id) => id !== message.id) }));
          onChange();
          reply({ type: "entryDeleteState", projectId: activeId, id: message.id, busy: false });
        }
        break;
      case "exportGraph":
      case "exportReport":
        onInfo("Aperçu de démonstration : cette action ne crée aucun fichier.");
        break;
      case "unlink":
        onInfo("Association fictive : aucun espace réel n’est modifié.");
        break;
    }
  }
  selectScenario("conversation");
  return { chatView, studioView, auxiliary, receive, selectScenario, dispose: () => clearTimeout(timer) };
}
