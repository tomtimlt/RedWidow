import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  activeProject,
  CodedError,
  coursRoot,
  createDockerClient,
  createRecorder,
  defaultConfigDir,
  lookupContainer,
  readFindings,
  readProjects,
  resolveBinary,
  shortContainerName,
  unlink,
} from "@warband/core";
import { formatError } from "@warband/messages";
import * as vscode from "vscode";
import { parseWebviewMessage } from "../logic/approval.js";
import { type BypassPush, createBypassHost, formatRemaining } from "../logic/bypass.js";
import {
  containerMentions,
  controlListedContainer,
  linkContainer,
  linkedProjectStatus,
  linkedTerminalChoices,
  listCockpitImages,
  loadCockpitView,
  parseCockpitMessage,
  planEditorShell,
  prepareTerminal,
  setPrimary,
} from "../logic/cockpit.js";
import { createJournalFiles } from "../logic/historyStore.js";
import { chatHtml, cockpitHtml, killchainHtml, makeNonce, studioHtml } from "../logic/html.js";
import { type ChatSession, createChatSession, type TokenChoice } from "../logic/session.js";
import { machineValue, resolveSettings } from "../logic/settings.js";
import { readSources } from "../logic/sources.js";
import { parseStudioMessage, type StudioPage } from "../logic/studio.js";
import {
  capturedShell,
  classifyMessageHashes,
  containerLogPath,
  lastCommand,
  mentionToken,
  parseHashes,
  readableTerminal,
  removeLogCommand,
  shellToken,
  tailCommand,
  withTerminalContext,
} from "../logic/termlog.js";
import { parseWindows, WINDOW_CAP, type WindowEntry } from "../logic/windows.js";

const TOKEN_KEY = "warband.token";
const TOKEN_KIND_KEY = "warband.tokenKind";
const WINDOWS_KEY = "warband.windows";
// Version du SDK embarquée par le paquetage (clé du cache des modèles) ; absente en développement.
declare const __SDK_VERSION__: string | undefined;
type TokenKind = "subscription" | "api-key";

/** Couche fine : seule autorisée à importer `vscode` (test de frontière). Toute la logique est dans `src/logic`. */
export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("warband");
  context.subscriptions.push(out);

  // Défense en profondeur : `capabilities.untrustedWorkspaces` empêche déjà l'activation.
  if (!vscode.workspace.isTrusted) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  /** Un chat de la barre, plus des chats d'éditeur. Au plus quatre sessions (ADR 0008). */
  const CHAT_CAP = 4;
  const SIDEBAR_CHAT = "sidebar";
  const CHAT_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
  interface Slot {
    session?: ChatSession;
    panel?: vscode.WebviewPanel;
  }
  const slots = new Map<string, Slot>();
  /** Terminaux d'éditeur ouverts par cet hôte, par nom Docker réel. */
  interface TrackedShell {
    term: vscode.Terminal;
    token: string | null;
    /** Nom court affiché. Deux shells du même conteneur partagent ce libellé. */
    label: string;
    /** Nom Docker réel du conteneur qui porte le shell. */
    container: string;
    /** Journal de la session, DANS le conteneur (`termlog.ts`). `null` : pas de capture. */
    logPath: string | null;
  }
  const editorShells = new Map<string, TrackedShell[]>();
  let cockpitListOk = false;
  /** Shells mémorisés non encore réconciliés avec une liste cockpit réussie. */
  let pendingTerminalRestore: string[] = [];
  let post: (message: unknown) => void = () => {};
  let activeId = SIDEBAR_CHAT;
  let monitorPanel: vscode.WebviewPanel | undefined;
  const watches: { panel: vscode.WebviewPanel; chatId: string; toolUseId: string }[] = [];
  let cockpitPanel: vscode.WebviewPanel | undefined;
  let studioPanel: vscode.WebviewPanel | undefined;
  let killchainPanel: vscode.WebviewPanel | undefined;
  let seq = 1;
  let restoring = false;

  const getToken = async (): Promise<TokenChoice | undefined> => {
    const value = await context.secrets.get(TOKEN_KEY);
    if (!value) return undefined;
    return (await context.secrets.get(TOKEN_KIND_KEY)) === "api-key"
      ? { auth: { name: "ANTHROPIC_API_KEY", value }, mode: "api-key" }
      : { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value }, mode: "subscription" };
  };

  // Réglages sensibles : valeur utilisateur/machine ou défaut, jamais celle de l'espace de travail.
  const readSettings = () => {
    const config = vscode.workspace.getConfiguration("warband");
    return resolveSettings((key) => machineValue(config.inspect(key)));
  };

  const seats = (reserveSidebar: boolean) => {
    let n = reserveSidebar || slots.get(SIDEBAR_CHAT)?.session ? 1 : 0;
    for (const [id, slot] of slots) if (id !== SIDEBAR_CHAT && slot.session) n++;
    return n;
  };
  const chatName = (id: string) => {
    if (id === SIDEBAR_CHAT) return "Chat";
    const ids = [...slots.keys()].filter((key) => key !== SIDEBAR_CHAT);
    const n = ids.indexOf(id);
    return `Chat ${n < 0 ? ids.length + 2 : n + 2}`;
  };
  const getSession = (id = SIDEBAR_CHAT): ChatSession => {
    const existing = slots.get(id)?.session;
    if (existing) return existing;
    if (!CHAT_ID.test(id)) throw new Error("Identifiant de chat refusé.");
    if (seats(id !== SIDEBAR_CHAT) >= CHAT_CAP) throw new Error("Quatre chats au maximum.");
    if (!folder) throw new Error("Ouvrez un dossier avant de lancer Warband.");
    const historyKey = `warband.history.${id}`;
    // Mode apprentissage (ADR 0010) : une clé par chat, séparée de `warband.prefs` (partagé).
    const learningKey = `warband.learning.${id}`;
    const runs = join((context.storageUri ?? context.globalStorageUri).fsPath, "runs");
    const session = createChatSession({
      cwd: folder.uri.fsPath,
      enginePath: join(context.extensionPath, "run-engine.mjs"),
      engineArgs: [context.extensionPath],
      readSettings,
      // Bypass (ADR 0006, 0008) : un lien par moteur, l'interrupteur reste celui de la fenêtre.
      bypass: { attach: (send) => bypass.attach(send), reset: () => bypass.reset() },
      getToken,
      // Sans jeton, le chat est grisé et propose d'en ajouter un.
      requireProvider: true,
      learningKey,
      store: {
        get: (key: string) => context.globalState.get(key),
        set: (key: string, value: unknown) => context.globalState.update(key, value),
      },
      // Journaux hors du dépôt. Le chat latéral garde `runs/` et relit l'ancienne clé.
      history: {
        key: historyKey,
        index: {
          get: (key: string) => {
            const value = context.workspaceState.get(key);
            if (value === undefined && id === SIDEBAR_CHAT && key === historyKey) {
              return context.workspaceState.get("warband.history");
            }
            return value;
          },
          set: (key: string, value: unknown) => context.workspaceState.update(key, value),
        },
        files: createJournalFiles(id === SIDEBAR_CHAT ? runs : join(runs, id)),
        confirmDelete: async (text) =>
          (await vscode.window.showWarningMessage(text, { modal: true }, "Supprimer")) ===
          "Supprimer",
      },
      ...(typeof __SDK_VERSION__ === "string" && { sdkVersion: __SDK_VERSION__ }),
      confirmAlways: async (text) =>
        (await vscode.window.showWarningMessage(text, { modal: true }, "Toujours autoriser")) ===
        "Toujours autoriser",
      onView: (view) => {
        const message = { type: "view", view };
        const slot = slots.get(id);
        if (id === SIDEBAR_CHAT) post(message);
        else void slot?.panel?.webview.postMessage(message);
        if (id === activeId) pushMonitor(view);
        for (const watch of watches) {
          if (watch.chatId === id) void watch.panel.webview.postMessage(message);
        }
        updateModelStatus();
      },
      onLog: (text) => out.append(text),
    });
    const slot = slots.get(id) ?? {};
    slot.session = session;
    slots.set(id, slot);
    return session;
  };

  /**
   * Lance `exegol start <nom>` dans un terminal VS Code (création depuis le cockpit).
   * Un terminal de même nom est seulement montré.
   */
  const startContainerTerminal = (slash: string) => {
    const exegol = resolveBinary("exegol");
    if (exegol === null) {
      void vscode.window.showErrorMessage(
        formatError(new CodedError("process.notFound", { binary: "exegol" })),
      );
      return;
    }
    const title = `Warband : start ${slash}`;
    const existing = vscode.window.terminals.find((t) => t.name === title);
    if (existing) {
      existing.show();
      return;
    }
    const term = vscode.window.createTerminal({
      name: title,
      shellPath: exegol,
      shellArgs: ["start", slash],
    });
    term.show();
  };

  const openTitlesFor = (container: string): string[] =>
    (editorShells.get(container) ?? []).map((shell) => shell.term.name);

  const findTrackedShell = (title: string): TrackedShell | undefined => {
    for (const terms of editorShells.values()) {
      const found = terms.find((shell) => shell.term.name === title);
      if (found) return found;
    }
    return undefined;
  };

  const findShellByToken = (token: string): TrackedShell | undefined => {
    for (const terms of editorShells.values()) {
      const found = terms.find((shell) => shell.token === token);
      if (found) return found;
    }
    return undefined;
  };

  const terminalsMessage = async () => {
    const items: { token: string; label: string; hint: string }[] = [];
    for (const shells of editorShells.values()) {
      let session = 0;
      for (const shell of shells) {
        if (shell.token === null) continue;
        session += 1;
        const raw = await readLogTail(shell);
        const hint = raw === null ? "" : lastCommand(readableTerminal(raw));
        items.push({
          token: shell.token,
          label: shell.label,
          hint: hint || `session ${session}`,
        });
      }
    }
    return { type: "terminals" as const, items };
  };

  const broadcastTerminals = async () => {
    const message = await terminalsMessage();
    post(message);
    for (const [id, slot] of slots) {
      if (id !== SIDEBAR_CHAT) void slot.panel?.webview.postMessage(message);
    }
  };

  /** Client Docker des journaux de shell : appels courts, rien n'est journalisé. */
  const shellDocker = () =>
    createDockerClient({ recorder: createRecorder(), binary: "docker", timeoutMs: 8_000 });

  /**
   * Fin du journal `script` d'un shell, lue dans son conteneur (`docker exec … tail`). Marche quel
   * que soit l'hôte (Windows compris). `null` : pas de capture, fichier absent ou conteneur arrêté.
   */
  const readLogTail = async (shell: TrackedShell): Promise<string | null> => {
    if (shell.logPath === null) return null;
    try {
      const lines = await shellDocker().execWorkspace(shell.container, tailCommand(shell.logPath));
      return lines.join("\n");
    } catch {
      return null;
    }
  };

  const dropTrackedShell = (term: vscode.Terminal) => {
    for (const [name, list] of editorShells) {
      const gone = list.find((shell) => shell.term === term);
      if (!gone) continue;
      const next = list.filter((shell) => shell.term !== term);
      if (next.length === 0) editorShells.delete(name);
      else editorShells.set(name, next);
      if (gone.logPath !== null) {
        void shellDocker()
          .execWorkspace(gone.container, removeLogCommand(gone.logPath))
          .catch(() => {});
      }
      void saveWindows();
      broadcastTerminals();
      return;
    }
  };

  /**
   * Shell interactif dans l'éditeur (`prepareTerminal`, transient). Ne suit que les terminaux
   * créés ici pour le nom réel résolu.
   */
  const openEditorShell = async (token: string): Promise<"skip" | "ok"> => {
    let view: Awaited<ReturnType<typeof loadCockpitView>>;
    try {
      view = await loadCockpitView();
      cockpitListOk = true;
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
      return "skip";
    }
    const real = lookupContainer(token, view.containers);
    const plan = planEditorShell(token, view.containers, real ? openTitlesFor(real) : []);
    if (plan.action === "skip") return "skip";
    if (plan.action === "reveal") {
      const shell = findTrackedShell(plan.title);
      if (shell) shell.term.show();
      return "ok";
    }
    try {
      const label = shortContainerName(plan.name);
      const used = new Set(
        (editorShells.get(plan.name) ?? []).map((shell) => shell.token).filter((t) => t !== null),
      );
      let token = mentionToken(plan.name, plan.title, label);
      if (token === null || used.has(token)) {
        token = null;
        for (let index = 1; index <= 4; index++) {
          const next = shellToken(label, index);
          if (next !== null && !used.has(next)) {
            token = next;
            break;
          }
        }
      }
      // Session journalisée dans le conteneur : indépendant de l'hôte (Windows, macOS, Linux).
      const logPath =
        token === null ? null : containerLogPath(token, randomBytes(4).toString("hex"));
      const { shellPath, shellArgs } = await prepareTerminal(
        plan.name,
        undefined,
        logPath === null ? undefined : capturedShell(logPath),
      );
      const term = vscode.window.createTerminal({
        name: plan.title,
        shellPath,
        shellArgs: [...shellArgs],
        location: vscode.TerminalLocation.Editor,
        isTransient: true,
      });
      const list = editorShells.get(plan.name) ?? [];
      list.push({ term, token, label, container: plan.name, logPath });
      editorShells.set(plan.name, list);
      term.show();
      void saveWindows();
      broadcastTerminals();
      return "ok";
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
      return "skip";
    }
  };

  /** Noms courts pour le menu `@`. Échec de lecture : liste vide (le menu n'invente rien). */
  const containersMessage = async () => {
    try {
      const view = await loadCockpitView();
      return { type: "containers" as const, items: containerMentions(view.containers) };
    } catch {
      return {
        type: "containers" as const,
        items: [] as { name: string; state: "running" | "stopped" }[],
      };
    }
  };
  const broadcastContainers = (
    containers: readonly { name: string; state: "running" | "stopped" }[],
  ) => {
    const message = { type: "containers", items: containerMentions(containers) };
    post(message);
    for (const [id, slot] of slots) {
      if (id !== SIDEBAR_CHAT) void slot.panel?.webview.postMessage(message);
    }
  };

  /**
   * Messages d'une webview de chat (barre latérale ou panneau). `reply` répond à cet émetteur.
   */
  const handleChatMessage = async (
    raw: unknown,
    id: string,
    reply: (message: unknown) => void,
    visible: () => boolean,
  ) => {
    const message = parseWebviewMessage(raw);
    if (message === null) return;
    try {
      setActive(id);
      // Bypass (ADR 0006) : hôte seul, avant `getSession`. `enabled: true` refusé si la vue est cachée.
      if (message.type === "setBypass") {
        bypass.request(message.enabled, visible());
        return;
      }
      // Chat grisé sans fournisseur : ouvre la saisie du jeton (hôte seul, aucune donnée venue de la webview).
      if (message.type === "addProvider") {
        void vscode.commands.executeCommand("warband.setToken");
        return;
      }
      const s = getSession(id);
      switch (message.type) {
        case "ready":
          reply(bypass.snapshot());
          reply({ type: "view", view: s.view() });
          reply(await containersMessage());
          reply(await terminalsMessage());
          return await s.loadModels();
        case "setModel":
          return s.setModel(message.model);
        case "setEffort":
          return s.setEffort(message.effort);
        case "setLearning":
          return s.setLearning(message.enabled);
        case "refreshModels":
          return await s.loadModels(true);
        case "refreshTerminals":
          return reply(await terminalsMessage());
        case "send": {
          const hashes = parseHashes(message.text);
          let listed: { name: string }[] = [];
          if (hashes.some((token) => findShellByToken(token) === undefined)) {
            try {
              listed = await shellDocker().listLabelPrefix();
            } catch {
              listed = [];
            }
          }
          const classified = classifyMessageHashes(
            hashes,
            (token) => findShellByToken(token) !== undefined,
            listed,
          );
          if (classified.unknown.length > 0) {
            const unknown = classified.unknown;
            void vscode.window.showWarningMessage(
              unknown.length === 1
                ? `Terminal introuvable : ${unknown[0]}.`
                : `Terminaux introuvables : ${unknown.join(", ")}.`,
            );
          }
          const sections = [];
          for (const token of classified.open) {
            const shell = findShellByToken(token);
            const raw = shell === undefined ? null : await readLogTail(shell);
            if (raw === null) {
              void vscode.window.showWarningMessage(
                `La sortie de #${token} est illisible (conteneur arrêté, ou « script » absent de l'image).`,
              );
            }
            sections.push({
              token,
              ...(shell !== undefined ? { container: shell.container } : {}),
              text: raw === null ? "Sortie illisible." : readableTerminal(raw),
            });
          }
          // Aucun terminal ouvert ici : envoyer une consigne ne doit jamais créer de fenêtre.
          await s.send(message.text, withTerminalContext(message.text, sections));
          return;
        }
        case "stop":
          return s.stop();
        case "reset":
          bypass.reset();
          return s.reset();
        case "approve":
          return await s.approve(message.toolUseId, message.choice);
        case "historyOpen":
          return await s.openConversation(message.id);
        case "historyResume":
          return s.resumeConversation();
        case "historyRename":
          return s.renameConversation(message.id, message.title);
        case "historyDelete":
          return await s.deleteConversation(message.id);
        case "historyClear":
          return await s.clearHistory();
        case "watch":
          openWatch(message.toolUseId);
          return;
        case "openKillchain":
          openKillchain();
          return;
        case "openMonitor":
          openMonitor();
          return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
    }
  };

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      const media = vscode.Uri.joinPath(context.extensionUri, "media");
      view.webview.options = {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      };
      const nonce = makeNonce();
      view.webview.html = chatHtml({
        nonce,
        cspSource: view.webview.cspSource,
        scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js")).toString(),
        uiUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "ui.js")).toString(),
        styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
      });
      post = (message) => void view.webview.postMessage(message);
      view.webview.onDidReceiveMessage((raw: unknown) =>
        handleChatMessage(
          raw,
          "sidebar",
          (message) => post(message),
          () => view.visible,
        ),
      );
      view.onDidDispose(() => {
        post = () => {};
      });
    },
  };

  // Colonne des panneaux Warband : le groupe d'éditeur qui contient déjà un onglet Warband (panneau
  // webview ou terminal d'éditeur « Warband : … »), sinon le groupe actif. Jamais `Beside` : il créait
  // un groupe scindé à chaque ouverture au lieu d'ajouter un onglet.
  const warbandColumn = (): vscode.ViewColumn => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputWebview && input.viewType.includes("warband.")) {
          return group.viewColumn;
        }
        if (input instanceof vscode.TabInputTerminal && tab.label.startsWith("Warband")) {
          return group.viewColumn;
        }
      }
    }
    return vscode.ViewColumn.Active;
  };

  const openCockpit = () => {
    if (cockpitPanel) {
      cockpitPanel.reveal();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("warband.cockpit", "Cockpit", warbandColumn(), {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    cockpitPanel = panel;
    let alive = true;
    panel.onDidDispose(() => {
      alive = false;
      cockpitPanel = undefined;
      void saveWindows();
    });
    const view = panel;
    const nonce = makeNonce();
    view.webview.html = cockpitHtml({
      nonce,
      cspSource: view.webview.cspSource,
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "cockpit.js")).toString(),
      styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
    });
    // `panel.webview` lève « Webview is disposed » une fois le panneau fermé : on ne le touche plus.
    const postCockpit: (message: unknown) => void = (message) => {
      if (alive) void view.webview.postMessage(message);
    };

    const pushView = async (loading = false) => {
      if (!alive) return;
      if (loading) postCockpit({ type: "view", loading: true });
      try {
        const payload = await loadCockpitView();
        if (!alive) return;
        postCockpit(payload);
        broadcastContainers(payload.containers);
        void refreshContainerStatus();
        if (payload.projectInvalid) {
          void vscode.window.showErrorMessage(
            "Projet invalide : fichier project.json illisible ou incomplet.",
          );
        }
      } catch (error) {
        if (alive) void vscode.window.showErrorMessage(formatError(error));
      }
    };

    void pushView(true);

    view.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseCockpitMessage(raw);
      if (message === null) return;
      try {
        switch (message.type) {
          case "refresh":
            return void pushView(true);
          case "link": {
            await pushView(true);
            postCockpit(await linkContainer(message.name));
            return;
          }
          case "setPrimary": {
            await pushView(true);
            postCockpit(await setPrimary(message.name));
            void refreshContainerStatus();
            return;
          }
          case "openWorkspace": {
            const st = await linkedProjectStatus();
            if (st === null) return;
            const uri = vscode.Uri.file(st.workspace);
            try {
              const stat = await vscode.workspace.fs.stat(uri);
              if (stat.type !== vscode.FileType.Directory) {
                throw new Error("not-dir");
              }
            } catch {
              void vscode.window.showErrorMessage(`Dossier inaccessible : ${st.workspace}`);
              return;
            }
            const folders = vscode.workspace.workspaceFolders ?? [];
            const known = folders.findIndex((f) => f.uri.fsPath === uri.fsPath);
            if (known < 0) {
              vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri });
            }
            await vscode.commands.executeCommand("revealInExplorer", uri);
            return;
          }
          case "terminal": {
            // Candidats = conteneurs liés au projet actif ET en cours ; jamais mémorisé.
            const view = await loadCockpitView();
            const choices = linkedTerminalChoices(view.containers);
            if (choices.length === 0) return;
            const only = choices.length === 1 ? choices[0] : undefined;
            if (only !== undefined) {
              await openEditorShell(only.name);
              return;
            }
            const choice = await vscode.window.showQuickPick(
              choices.map((item) => ({
                label: item.short,
                description: item.primary ? "primary" : "",
                item,
              })),
              { title: "Warband : terminal du projet", ignoreFocusOut: true },
            );
            if (!choice) return;
            const result = await openEditorShell(choice.item.name);
            if (result === "skip") {
              void vscode.window.showErrorMessage("Conteneur introuvable.");
            }
            return;
          }
          case "start":
            await controlListedContainer("start", message.name);
            return void pushView(true);
          case "stop":
            await controlListedContainer("stop", message.name);
            return void pushView(true);
          case "createExegol":
            // Nom saisi tel quel : pas de projet lié, pas de nom court.
            startContainerTerminal(message.name);
            return;
          case "createKali": {
            // Pas de terminal ni de lien. Aucun délai imposé : le défaut du client s'applique.
            await createDockerClient({
              recorder: createRecorder(),
              binary: "docker",
            }).createKaliContainer({
              image: message.image,
              name: message.name,
              source: message.source,
            });
            return void pushView(true);
          }
          case "listImages":
            postCockpit({ type: "images", images: await listCockpitImages() });
            return;
          case "pickSource": {
            const picked = await vscode.window.showOpenDialog({
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: false,
            });
            const source = picked?.[0]?.fsPath;
            if (source === undefined) return;
            postCockpit({ type: "pickedSource", source });
            return;
          }
        }
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
        await pushView(true);
      }
    });

    panel.onDidChangeViewState(() => {
      if (panel.visible) void pushView(true);
    });
    void saveWindows();
  };

  const saveWindows = async () => {
    if (restoring) return;
    const entries: WindowEntry[] = [];
    for (const [id, slot] of slots) {
      if (id === SIDEBAR_CHAT) continue;
      if (slot.panel) entries.push({ kind: "chat", chatId: id });
    }
    for (const [container, terms] of editorShells) {
      for (const _term of terms) {
        if (entries.length >= WINDOW_CAP) break;
        entries.push({ kind: "terminal", container });
      }
    }
    if (!cockpitListOk) {
      for (const container of pendingTerminalRestore) {
        if (entries.length >= WINDOW_CAP) break;
        const n = entries.filter((e) => e.kind === "terminal" && e.container === container).length;
        if (n >= 4) continue;
        entries.push({ kind: "terminal", container });
      }
    }
    if (monitorPanel) entries.push({ kind: "monitor" });
    if (cockpitPanel) entries.push({ kind: "cockpit" });
    if (studioPanel) entries.push({ kind: "settings" });
    if (killchainPanel) entries.push({ kind: "killchain" });
    await context.workspaceState.update(WINDOWS_KEY, entries);
  };
  const pushMonitor = (view?: { items: unknown }) => {
    const panel = monitorPanel;
    if (!panel) return;
    const name = chatName(activeId);
    panel.title = `Monitor · ${name}`;
    void panel.webview.postMessage({ type: "title", text: name });
    const shown = view ?? slots.get(activeId)?.session?.view();
    if (shown) void panel.webview.postMessage({ type: "view", view: shown });
  };
  const setActive = (id: string) => {
    activeId = id;
    pushMonitor();
  };
  const mountChatHtml = (webview: vscode.Webview) => {
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const nonce = makeNonce();
    webview.html = chatHtml({
      nonce,
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js")).toString(),
      uiUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "ui.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
    });
  };
  const nextChatId = () => {
    let id = "";
    do {
      seq += 1;
      id = `c${seq}`;
    } while (slots.has(id));
    return id;
  };
  const openEditorChat = (existing?: string) => {
    const id = existing ?? nextChatId();
    const current = slots.get(id);
    if (current?.panel) {
      current.panel.reveal();
      setActive(id);
      return;
    }
    try {
      getSession(id);
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "warband.chatPanel",
      chatName(id),
      warbandColumn(),
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    const slot = slots.get(id);
    if (!slot) return;
    slot.panel = panel;
    panel.title = chatName(id);
    mountChatHtml(panel.webview);
    panel.onDidDispose(() => {
      slot.session?.dispose();
      slots.delete(id);
      if (activeId === id) activeId = SIDEBAR_CHAT;
      pushMonitor();
      void saveWindows();
    });
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) setActive(id);
    });
    panel.webview.onDidReceiveMessage((raw: unknown) =>
      handleChatMessage(
        raw,
        id,
        (message) => void panel.webview.postMessage(message),
        () => panel.visible,
      ),
    );
    setActive(id);
    void saveWindows();
  };
  const openWatch = (toolUseId: string) => {
    const chatId = activeId;
    const existing = watches.find(
      (watch) => watch.chatId === chatId && watch.toolUseId === toolUseId,
    );
    if (existing) {
      existing.panel.reveal();
      const view = slots.get(chatId)?.session?.view();
      if (view) void existing.panel.webview.postMessage({ type: "view", view });
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("warband.watch", "Sortie", warbandColumn(), {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    const watch = { panel, chatId, toolUseId };
    watches.push(watch);
    mountChatHtml(panel.webview);
    panel.onDidDispose(() => {
      const at = watches.indexOf(watch);
      if (at >= 0) watches.splice(at, 1);
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message?.type !== "ready") return;
      void panel.webview.postMessage({ type: "role", role: "watch", toolUseId });
      const view = slots.get(chatId)?.session?.view();
      if (view) void panel.webview.postMessage({ type: "view", view });
    });
  };

  const openMonitor = () => {
    if (monitorPanel) {
      monitorPanel.reveal();
      pushMonitor();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("warband.monitor", "Monitor", warbandColumn(), {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    monitorPanel = panel;
    mountChatHtml(panel.webview);
    panel.onDidDispose(() => {
      monitorPanel = undefined;
      void saveWindows();
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message?.type === "watch") {
        openWatch(message.toolUseId);
        return;
      }
      if (message?.type !== "ready") return;
      void panel.webview.postMessage({ type: "role", role: "monitor" });
      pushMonitor();
    });
    void saveWindows();
  };

  // Barre d'état : conteneur lié et modèle du chat actif.
  const barContainer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  const barModel = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  // Lanceur toujours visible : un clic ouvre chat, terminaux, cockpit, réglages.
  const barLauncher = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
  barLauncher.text = "$(rocket) Warband";
  barLauncher.tooltip = "Warband : chat, terminaux, cockpit, réglages (Alt+J Alt+J)";
  barLauncher.command = "warband.launcher";
  barLauncher.show();
  barContainer.command = "warband.openTerminal";
  barModel.command = "warband.focusChat";
  context.subscriptions.push(barLauncher, barContainer, barModel);
  const updateModelStatus = () => {
    const c =
      slots.get(activeId)?.session?.view().controls ??
      slots.get(SIDEBAR_CHAT)?.session?.view().controls ??
      null;
    if (c === null) {
      barModel.hide();
      return;
    }
    const known = c.models?.find((m) => m.value === c.model);
    barModel.text = `$(sparkle) ${c.model === null ? "Modèle par défaut" : (known?.label ?? c.model)}`;
    barModel.tooltip = "Modèle utilisé pour le message suivant (clic : ouvrir le chat)";
    barModel.show();
  };
  const refreshContainerStatus = async () => {
    let st: Awaited<ReturnType<typeof linkedProjectStatus>> = null;
    try {
      st = await linkedProjectStatus();
    } catch {
      st = null;
    }
    if (st === null || st.container === null) {
      barContainer.hide();
      return;
    }
    const label = shortContainerName(st.container);
    barContainer.text =
      st.state === "running" ? `$(terminal) ${label} $(circle-filled)` : `$(terminal) ${label}`;
    barContainer.tooltip =
      st.state === "running"
        ? `Conteneur lié : ${st.container} (connecté). Clic : ouvrir un terminal (Alt+J T)`
        : `Conteneur lié : ${st.container} (arrêté)`;
    barContainer.show();
  };

  /** Crée le dossier de cours s'il manque, puis le révèle dans l'explorateur système. Chemin : hôte seul. */
  const openCoursFolder = async () => {
    try {
      const root = coursRoot();
      await mkdir(root, { recursive: true });
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
    }
  };

  const pushKillchain = async () => {
    const panel = killchainPanel;
    if (!panel) return;
    let findings: unknown[] = [];
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      findings = active === null ? [] : await readFindings(defaultConfigDir(), active.id);
    } catch {
      findings = [];
    }
    if (killchainPanel !== panel) return;
    await panel.webview.postMessage({ type: "view", page: "killchain", findings });
  };
  const openKillchain = () => {
    if (killchainPanel) {
      killchainPanel.reveal(vscode.ViewColumn.One);
      void pushKillchain();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    killchainPanel = vscode.window.createWebviewPanel(
      "warband.killchain",
      "Kill chain",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
    killchainPanel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    const nonce = makeNonce();
    killchainPanel.webview.html = killchainHtml({
      nonce,
      cspSource: killchainPanel.webview.cspSource,
      scriptUri: killchainPanel.webview
        .asWebviewUri(vscode.Uri.joinPath(media, "studio.js"))
        .toString(),
      styleUri: killchainPanel.webview
        .asWebviewUri(vscode.Uri.joinPath(media, "chat.css"))
        .toString(),
    });
    killchainPanel.onDidDispose(() => {
      killchainPanel = undefined;
      void saveWindows();
    });
    killchainPanel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseStudioMessage(raw);
      if (message?.type === "refresh") await pushKillchain();
    });
    void pushKillchain();
    void saveWindows();
  };

  let studioPage: StudioPage = "project";
  const pushStudio = async () => {
    const panel = studioPanel;
    if (!panel) return;
    const cockpit = await loadCockpitView();
    let findings: unknown[] = [];
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      findings = active === null ? [] : await readFindings(defaultConfigDir(), active.id);
    } catch {
      findings = [];
    }
    // Sources de cours (lecture seule) : seulement pour l'Atlas, racine fixée par l'hôte.
    const sources = studioPage === "atlas" ? await readSources(coursRoot()) : [];
    // Fermé pendant les lectures : `panel.webview` lèverait « Webview is disposed ».
    if (studioPanel !== panel) return;
    await panel.webview.postMessage({ ...cockpit, page: studioPage, findings, sources });
  };
  const openStudio = () => {
    if (studioPanel) {
      studioPanel.reveal();
      void pushStudio();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    studioPanel = vscode.window.createWebviewPanel("warband.studio", "Réglages", warbandColumn(), {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
    });
    studioPanel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    const nonce = makeNonce();
    studioPanel.webview.html = studioHtml({
      nonce,
      cspSource: studioPanel.webview.cspSource,
      scriptUri: studioPanel.webview
        .asWebviewUri(vscode.Uri.joinPath(media, "studio.js"))
        .toString(),
      styleUri: studioPanel.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
    });
    studioPanel.onDidDispose(() => {
      studioPanel = undefined;
      void saveWindows();
    });
    studioPanel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseStudioMessage(raw);
      if (message === null) return;
      if (message.type === "open") studioPage = message.page;
      if (message.type === "openKillchain") {
        openKillchain();
        return;
      }
      if (message.type === "unlink") await unlink(defaultConfigDir());
      if (message.type === "openCours") await openCoursFolder();
      await pushStudio();
    });
    void pushStudio();
    void saveWindows();
  };

  const pickContainerTerminal = async () => {
    let view: Awaited<ReturnType<typeof loadCockpitView>>;
    try {
      view = await loadCockpitView();
      cockpitListOk = true;
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
      return;
    }
    const items = containerMentions(view.containers);
    if (items.length === 0) {
      void vscode.window.showInformationMessage("Aucun conteneur Exegol.");
      return;
    }
    const choice = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: item.name,
        description: item.state === "running" ? "en cours" : "arrêté",
        item,
      })),
      { title: "Warband : ouvrir un terminal", ignoreFocusOut: true },
    );
    if (!choice) return;
    if (choice.item.state !== "running") {
      void vscode.window.showErrorMessage(`Le conteneur ${choice.item.name} est arrêté.`);
      return;
    }
    const result = await openEditorShell(choice.item.name);
    if (result === "skip") {
      void vscode.window.showErrorMessage("Conteneur introuvable.");
    }
  };

  /**
   * Lanceur (Alt+J Alt+J, barre d'état) : toutes les fenêtres Warband en un seul menu, et un terminal par
   * conteneur démarré, sans passer par la palette de commandes.
   */
  type LauncherItem = vscode.QuickPickItem & { run?: () => unknown };
  const openLauncher = () => {
    const actions: LauncherItem[] = [
      {
        label: "$(comment) Chat latéral",
        description: "Alt+J C",
        run: () => vscode.commands.executeCommand("warband.chat.focus"),
      },
      {
        label: "$(comment-discussion) Nouveau chat",
        description: "Alt+J N",
        run: () => openEditorChat(),
      },
      { label: "$(dashboard) Cockpit", description: "Alt+J K", run: () => openCockpit() },
      { label: "$(pulse) Monitor", description: "Alt+J M", run: () => openMonitor() },
      {
        label: "$(type-hierarchy) Kill chain",
        description: "Alt+J G",
        run: () => openKillchain(),
      },
      { label: "$(settings-gear) Réglages", description: "Alt+J S", run: () => openStudio() },
    ];
    const pick = vscode.window.createQuickPick<LauncherItem>();
    pick.title = "Warband";
    pick.placeholder = "Ouvrir une fenêtre ou un terminal…";
    pick.matchOnDescription = true;
    pick.items = actions;
    pick.busy = true;
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0];
      pick.hide();
      void chosen?.run?.();
    });
    pick.onDidHide(() => pick.dispose());
    pick.show();
    void loadCockpitView()
      .then((view) => {
        cockpitListOk = true;
        const terminals: LauncherItem[] = containerMentions(view.containers).map((c) =>
          c.state === "running"
            ? {
                label: `$(terminal) ${c.name}`,
                description: "terminal · en cours",
                run: () => openEditorShell(c.name),
              }
            : { label: `$(circle-slash) ${c.name}`, description: "arrêté" },
        );
        pick.items = [
          ...actions,
          { label: "Terminaux Exegol", kind: vscode.QuickPickItemKind.Separator },
          ...(terminals.length > 0 ? terminals : [{ label: "Aucun conteneur Exegol" }]),
        ];
      })
      .catch(() => undefined)
      .finally(() => {
        pick.busy = false;
      });
  };

  /** Jeton défini ou effacé : chaque chat remplace son moteur inactif et se grise ou se dégrise, sans redémarrage. */
  const applyAuthChange = () => {
    for (const slot of slots.values()) {
      void slot.session
        ?.authChanged()
        .catch((error: unknown) => out.appendLine(formatError(error)));
    }
  };

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((term) => dropTrackedShell(term)),
    {
      dispose: () => {
        for (const slot of slots.values()) slot.session?.dispose();
      },
    },
    vscode.window.registerWebviewViewProvider("warband.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("warband.openChat", () => openEditorChat()),
    vscode.commands.registerCommand("warband.openCockpit", () => openCockpit()),
    vscode.commands.registerCommand("warband.openStudio", () => openStudio()),
    vscode.commands.registerCommand("warband.openTerminal", () => void pickContainerTerminal()),
    vscode.commands.registerCommand("warband.openMonitor", () => openMonitor()),
    vscode.commands.registerCommand("warband.openKillchain", () => openKillchain()),
    vscode.commands.registerCommand("warband.focusChat", () =>
      vscode.commands.executeCommand("warband.chat.focus"),
    ),
    vscode.commands.registerCommand("warband.launcher", () => openLauncher()),
    vscode.commands.registerCommand("warband.setToken", async () => {
      const kind = await vscode.window.showQuickPick(
        [
          { label: "Jeton d'abonnement", description: "claude setup-token", value: "subscription" },
          { label: "Clé API", description: "ANTHROPIC_API_KEY", value: "api-key" },
        ],
        { title: "Warband : type de jeton", ignoreFocusOut: true },
      );
      if (!kind) return;
      const token = await vscode.window.showInputBox({
        title: "Warband : jeton",
        prompt: "Le jeton est stocké dans le stockage sécurisé de VS Code.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() === "" ? "Le jeton est vide." : undefined),
      });
      if (token === undefined) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      await context.secrets.store(TOKEN_KIND_KEY, kind.value as TokenKind);
      applyAuthChange();
      void vscode.window.showInformationMessage("Jeton enregistré et appliqué.");
    }),
    vscode.commands.registerCommand("warband.clearToken", async () => {
      await context.secrets.delete(TOKEN_KEY);
      await context.secrets.delete(TOKEN_KIND_KEY);
      applyAuthChange();
      void vscode.window.showInformationMessage(
        "Jeton effacé : le chat reste grisé tant qu'aucun fournisseur n'est ajouté.",
      );
    }),
    // Spike E1 : forke le moteur de diagnostic (vérifie l'empreinte du binaire et affiche sa version).
    vscode.commands.registerCommand("warband.diagnostic", () => {
      const root = context.extensionPath;
      const child = fork(join(root, "engine.mjs"), [root], {
        env: { ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        ...{ windowsHide: true }, // acceptée par `fork`, absente des typings
      });
      child.stdout?.on("data", (d: Buffer) => out.append(d.toString()));
      child.stderr?.on("data", (d: Buffer) => out.append(d.toString()));
      child.on("exit", (code) => out.appendLine(`moteur terminé (code ${code})`));
      out.show();
    }),
  );

  // Bypass des approbations (ADR 0006) : état en mémoire de l'hôte, jamais persisté. Un élément de
  // barre d'état natif le signale (fond d'avertissement) ; son clic le désactive.
  const barBypass = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
  barBypass.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  barBypass.command = "warband.disableBypass";
  barBypass.tooltip = "Bypass des approbations actif : cliquer pour le désactiver";
  context.subscriptions.push(barBypass);
  let bypassTick: ReturnType<typeof setInterval> | undefined;
  const renderBypass = (push: BypassPush) => {
    if (bypassTick !== undefined) {
      clearInterval(bypassTick);
      bypassTick = undefined;
    }
    if (!push.on) {
      // Armé (demandé, pas encore effectif) : affiché sans prétendre à « actif ».
      if (push.armed) {
        barBypass.text = "BYPASS · en attente";
        barBypass.show();
      } else {
        barBypass.hide();
      }
      return;
    }
    const refreshText = () => {
      const left = bypass.remainingMs();
      barBypass.text = `BYPASS · ${left === null ? "" : formatRemaining(left)}`;
      barBypass.show();
    };
    refreshText();
    bypassTick = setInterval(refreshText, 30_000);
  };
  const bypass = createBypassHost({
    clock: {
      now: () => Date.now(),
      schedule: (fn, delayMs) => setTimeout(fn, delayMs),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    onChange: (push) => {
      post(push);
      for (const [id, slot] of slots) {
        if (id !== SIDEBAR_CHAT) void slot.panel?.webview.postMessage(push);
      }
      renderBypass(push);
    },
  });
  context.subscriptions.push(
    {
      dispose: () => {
        bypass.dispose();
        if (bypassTick !== undefined) clearInterval(bypassTick);
      },
    },
    vscode.workspace.onDidChangeWorkspaceFolders(() => bypass.reset()),
    vscode.commands.registerCommand("warband.disableBypass", () => bypass.request(false, true)),
  );

  updateModelStatus();
  void refreshContainerStatus();
  // Ancienne clé `warband.layout` ignorée : seule `warband.windows` est relue.
  void (async () => {
    restoring = true;
    const saved = parseWindows(context.workspaceState.get(WINDOWS_KEY));
    pendingTerminalRestore = [];
    for (const entry of saved) {
      if (entry.kind === "chat" && entry.chatId) openEditorChat(entry.chatId);
      else if (entry.kind === "terminal" && entry.container)
        pendingTerminalRestore.push(entry.container);
      else if (entry.kind === "monitor") openMonitor();
      else if (entry.kind === "cockpit") openCockpit();
      else if (entry.kind === "settings") openStudio();
      else if (entry.kind === "killchain") openKillchain();
    }
    try {
      const view = await loadCockpitView();
      cockpitListOk = true;
      for (const container of pendingTerminalRestore) {
        const row = view.containers.find((c) => c.name === container);
        if (row?.state === "running") await openEditorShell(container);
      }
      pendingTerminalRestore = [];
    } catch {
      cockpitListOk = false;
    }
    restoring = false;
    await saveWindows();
  })();
}

export function deactivate(): void {}
