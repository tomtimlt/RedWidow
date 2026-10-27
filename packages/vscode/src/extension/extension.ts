import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  activeProject,
  CodedError,
  coursRoot,
  createDockerClient,
  createRecorder,
  defaultConfigDir,
  ensureWarbandKaliImage,
  lookupContainer,
  prepareKaliContainer,
  pullDockerImage,
  readFindings,
  readProjects,
  resolveBinary,
  shortContainerName,
  unlink,
  WARBAND_KALI_IMAGE,
} from "@warband/core";
import { formatError } from "@warband/messages";
import * as vscode from "vscode";
import { cleanText, parseWebviewMessage } from "../logic/approval.js";
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
import { removeListedContainer } from "../logic/container-remove.js";
import type { Provider } from "../logic/effort.js";
import { type ExegolCreateOptions, prepareExegolCreate } from "../logic/exegol-create.js";
import { deleteSelectedFinding } from "../logic/finding-delete.js";
import { createJournalFiles } from "../logic/historyStore.js";
import { chatHtml, cockpitHtml, killchainHtml, makeNonce, studioHtml } from "../logic/html.js";
import { matchesFingerprint } from "../logic/integrity.js";
import { setSelectedPathEdge } from "../logic/killchain-path.js";
import { missionReport } from "../logic/mission-report.js";
import {
  activateSelectedProject,
  createSelectedProject,
  readProjectChoices,
} from "../logic/project-controls.js";
import { readProjectSummary, saveProjectSummary } from "../logic/project-summary.js";
import {
  matchesActiveProjectWorkspace,
  openActiveProjectWorkspace,
} from "../logic/project-workspace.js";
import { openAiSubscriptionReady } from "../logic/provider-auth.js";
import { type ChatSession, createChatSession, type TokenChoice } from "../logic/session.js";
import { machineValue, resolveSettings } from "../logic/settings.js";
import { readSources } from "../logic/sources.js";
import { parseStudioMessage, type StudioMessage, type StudioPage } from "../logic/studio.js";
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
const OPENAI_TOKEN_KEY = "warband.openai.apiKey";
const OPENAI_AUTH_MODE_KEY = "warband.openai.authMode";
const WINDOWS_KEY = "warband.windows";
// Version du SDK embarquée par le paquetage (clé du cache des modèles) ; absente en développement.
declare const __SDK_VERSION__: string | undefined;
declare const __OPENCODE_SHA256__: string | undefined;
declare const __OPENCODE_VERSION__: string | undefined;
type TokenKind = "subscription" | "api-key";

/** Couche fine : seule autorisée à importer `vscode` (test de frontière). Toute la logique est dans `src/logic`. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel("warband");
  context.subscriptions.push(out);

  // Défense en profondeur : `capabilities.untrustedWorkspaces` empêche déjà l'activation.
  if (!vscode.workspace.isTrusted) return;

  const projectWorkspaceHost = {
    folders: () => vscode.workspace.workspaceFolders?.map((entry) => entry.uri.fsPath) ?? [],
    hasUnsavedDocuments: () =>
      vscode.workspace.textDocuments.some((document) => document.isDirty) ||
      vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.isDirty)),
    attempted: () => context.globalState.get<string>("warband.workspaceOpenAttempt"),
    rememberAttempt: (path: string | undefined) =>
      context.globalState.update("warband.workspaceOpenAttempt", path),
    openFolder: async (path: string, newWindow: boolean) => {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), {
        forceNewWindow: newWindow,
        forceReuseWindow: !newWindow,
      });
    },
  };
  try {
    if (vscode.workspace.workspaceFolders?.length) {
      await projectWorkspaceHost.rememberAttempt(undefined);
    } else {
      await openActiveProjectWorkspace(defaultConfigDir(), projectWorkspaceHost, "startup");
    }
  } catch (error) {
    out.appendLine(`Ouverture du dossier du projet : ${formatError(error)}`);
    void vscode.window.showWarningMessage(
      `Impossible d'ouvrir le dossier du projet Warband : ${formatError(error)}. Sélectionnez le projet pour réessayer.`,
    );
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  const projectWorkspaceReady = async () => {
    if (
      folder !== undefined &&
      (await matchesActiveProjectWorkspace(defaultConfigDir(), folder.uri.fsPath))
    )
      return true;
    void vscode.window.showWarningMessage(
      "Le dossier de cette fenêtre ne correspond pas au projet actif. Utilisez la fenêtre du projet ou activez le projet correspondant dans les réglages.",
    );
    return false;
  };
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
  let killchainRevision = 0;
  let killchainPayload = "";
  let findingProjectGeneration = 0;
  const findingDeletions = new Map<
    vscode.WebviewPanel,
    {
      abort: AbortController;
      projectId: string;
      id: string;
    }
  >();
  const cancelFindingDeletions = () => {
    findingProjectGeneration++;
    for (const pending of findingDeletions.values()) pending.abort.abort();
  };
  let findingsTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFindingsRefresh = () => {
    if (killchainPanel === undefined || findingsTimer !== undefined) return;
    findingsTimer = setTimeout(() => {
      findingsTimer = undefined;
      void pushKillchain();
    }, 150);
  };
  context.subscriptions.push({
    dispose: () => {
      cancelFindingDeletions();
      if (findingsTimer !== undefined) clearTimeout(findingsTimer);
      killchainRevision++;
    },
  });
  let seq = 1;
  let restoring = false;
  const kaliPreparations = new Map<string, Promise<void>>();
  const prepareIfKali = async (name: string): Promise<void> => {
    const existing = kaliPreparations.get(name);
    if (existing !== undefined) return existing;
    const job = (async () => {
      const recorder = createRecorder();
      const rows = await createDockerClient({ recorder }).listLabelPrefix();
      if (rows.find((row) => row.name === name)?.family !== "kali") return;
      recorder.subscribe((event) => out.appendLine(JSON.stringify(event)));
      const messages = {
        checking: "Vérification du serveur Kali…",
        installing: "Installation du serveur Kali et de ses dépendances…",
        starting: "Démarrage et vérification du serveur Kali…",
        ready: "Serveur Kali prêt.",
      };
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Préparation de ${name}` },
          async (progress) =>
            prepareKaliContainer(name, {
              recorder,
              onStage: (stage) => progress.report({ message: messages[stage] }),
            }),
        );
      } catch (error) {
        out.show(true);
        throw error;
      }
    })();
    kaliPreparations.set(name, job);
    try {
      await job;
    } finally {
      kaliPreparations.delete(name);
    }
  };

  const openCodeBinary = async () => {
    const binary = join(
      context.extensionPath,
      "bin",
      process.platform === "win32" ? "opencode.exe" : "opencode",
    );
    const expected = typeof __OPENCODE_SHA256__ === "string" ? __OPENCODE_SHA256__ : "";
    if (!(await matchesFingerprint(binary, expected)))
      throw new CodedError("extension.binaryMismatch");
    return binary;
  };
  const getToken = async (provider: Provider = "claude"): Promise<TokenChoice | undefined> => {
    if (provider !== "claude") {
      try {
        await openCodeBinary();
      } catch {
        return undefined;
      }
      if (provider === "opencode") return { mode: "auto" };
      const kind = context.globalState.get<string>(OPENAI_AUTH_MODE_KEY);
      if (kind === "subscription")
        return (await openAiSubscriptionReady()) ? { mode: "subscription" } : undefined;
      if (kind === "api-key") {
        const value = await context.secrets.get(OPENAI_TOKEN_KEY);
        return value ? { auth: { name: "OPENAI_API_KEY", value }, mode: "api-key" } : undefined;
      }
      return undefined;
    }
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
      readHistoryProjects: async () => {
        const file = await readProjects(defaultConfigDir());
        return file ?? { activeId: null, projects: [] };
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
      ...(typeof __SDK_VERSION__ === "string" && {
        sdkVersion: `${__SDK_VERSION__}/${typeof __OPENCODE_VERSION__ === "string" ? __OPENCODE_VERSION__ : "unknown"}/catalog-v2`,
      }),
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
        scheduleFindingsRefresh();
      },
      onLog: (text) => out.append(text),
    });
    const slot = slots.get(id) ?? {};
    slot.session = session;
    slots.set(id, slot);
    return session;
  };

  /** La CLI Exegol reste interactive pour sa licence, le VPN et le shell. */
  const startContainerTerminal = async (options: ExegolCreateOptions, signal: AbortSignal) => {
    const launch = await prepareExegolCreate(options);
    signal.throwIfAborted();
    const term = vscode.window.createTerminal({
      name: `Warband : création ${options.name}`,
      shellPath: launch.shellPath,
      shellArgs: [...launch.shellArgs],
    });
    term.show();
    return term;
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
        case "setProvider":
          return await s.setProvider(message.provider);
        case "setModel":
          return s.setModel(message.model);
        case "setEffort":
          return s.setEffort(message.effort);
        case "setVariant":
          return s.setVariant(message.variant);
        case "setLearning":
          return s.setLearning(message.enabled);
        case "refreshModels":
          return await s.authChanged();
        case "refreshTerminals":
          return reply(await terminalsMessage());
        case "send": {
          if (projectChanging) {
            void vscode.window.showWarningMessage(
              "Changement de projet en cours, réessayez ensuite.",
            );
            return;
          }
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
          if (!(await projectWorkspaceReady()) || projectChanging) return;
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
        case "historyRefresh":
          return await s.refreshHistoryProjects();
        case "historyOpen":
          return await s.openConversation(message.id);
        case "historyResume":
          if (projectChanging) return;
          if (!(await projectWorkspaceReady()) || projectChanging) return;
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
    let operationAbort: AbortController | null = null;
    let selectedVpn: string | undefined;
    panel.onDidDispose(() => {
      operationAbort?.abort();
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

    const runOperation = async (
      stage: string,
      work: (signal: AbortSignal, report: (message: unknown) => void) => Promise<void | string>,
    ) => {
      if (operationAbort) return;
      const controller = new AbortController();
      operationAbort = controller;
      let lastReportAt = 0;
      let lastStage: unknown;
      const report = (fields: unknown) => {
        const data = fields as { stage?: unknown };
        const now = Date.now();
        if (data.stage === lastStage && now - lastReportAt < 120) return;
        lastStage = data.stage;
        lastReportAt = now;
        postCockpit({ type: "operation", busy: true, ...(fields as object) });
      };
      report({ stage });
      try {
        const completedStage = await work(controller.signal, report);
        postCockpit({ type: "operation", busy: false, stage: completedStage ?? "Terminé" });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        postCockpit({
          type: "operation",
          busy: false,
          stage: cancelled ? "Opération annulée" : "Échec de l’opération",
          ...(!cancelled && { error: formatError(error) }),
        });
        if (!cancelled) void vscode.window.showErrorMessage(formatError(error));
      } finally {
        if (operationAbort === controller) operationAbort = null;
        await pushView();
      }
    };

    void pushView(true);

    view.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseCockpitMessage(raw);
      if (message === null) {
        postCockpit({
          type: "operation",
          busy: false,
          stage: "Paramètres invalides",
          error: "Vérifiez le nom, l’image, le dossier et les options de création.",
        });
        return;
      }
      if (message.type === "cancelOperation") {
        operationAbort?.abort();
        return;
      }
      if (operationAbort && message.type !== "refresh") return;

      try {
        switch (message.type) {
          case "refresh":
            return void pushView(true);
          case "link": {
            await pushView(true);
            await prepareIfKali(message.name);
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
            return await runOperation("Démarrage du conteneur…", async (signal) => {
              signal.throwIfAborted();
              await controlListedContainer("start", message.name);
              signal.throwIfAborted();
              await prepareIfKali(message.name);
            });
          case "stop":
            return await runOperation("Arrêt du conteneur…", async (signal) => {
              signal.throwIfAborted();
              await controlListedContainer("stop", message.name);
            });
          case "createExegol":
            return await runOperation("Préparation Exegol…", async (signal) => {
              if (message.vpn && !selectedVpn)
                throw new Error("Choisissez une configuration VPN avec le bouton VPN.");
              if (
                (message.desktop || message.vpn) &&
                message.network !== undefined &&
                message.network !== "nat"
              )
                throw new Error("Le VPN et le bureau web nécessitent le réseau NAT.");
              const existing = await loadCockpitView();
              if (
                existing.containers.some(
                  (item) => item.name === message.name || item.short === message.name,
                )
              )
                throw new Error("Ce conteneur existe déjà. Utilisez Démarrer dans la liste.");
              if (
                vscode.window.terminals.some(
                  (terminal) => terminal.name === `Warband : création ${message.name}`,
                )
              )
                throw new Error("Une création de ce nom est déjà ouverte dans un terminal.");
              signal.throwIfAborted();
              await startContainerTerminal(
                {
                  name: message.name,
                  ...(message.image && { image: message.image }),
                  ...(message.source && { workspacePath: message.source }),
                  ...(message.vpn && selectedVpn && { vpnPath: selectedVpn }),
                  ...(message.desktop !== undefined && { desktop: message.desktop }),
                  ...(message.desktopPort !== undefined && { desktopPort: message.desktopPort }),
                  network: message.network ?? "nat",
                  gui: false,
                  exegolResources: message.shareResources ?? true,
                  myResources: message.shareMyResources ?? true,
                },
                signal,
              );
              signal.throwIfAborted();
              void vscode.window.showInformationMessage(
                "Terminez la création Exegol dans le terminal, puis actualisez les conteneurs.",
              );
              return "Création Exegol lancée — progression dans le terminal";
            });
          case "createKali":
            return await runOperation("Préparation de l’image Kali…", async (signal, report) => {
              const recorder = createRecorder();
              let lastReport = 0;
              const unsubscribe = recorder.subscribe((event) => {
                if (event.kind === "process.output" && Date.now() - lastReport > 250) {
                  lastReport = Date.now();
                  report({
                    stage: "Préparation de l’image Kali…",
                    message: event.line.slice(-512),
                  });
                }
              });
              try {
                const options = {
                  recorder,
                  signal,
                  onProgress: (progress: import("@warband/core").DockerImageProgress) =>
                    report({
                      stage:
                        progress.stage === "build"
                          ? "Installation des outils Kali…"
                          : "Téléchargement de l’image…",
                      message: progress.status,
                      layers: progress.layers,
                    }),
                };
                const image =
                  message.image === WARBAND_KALI_IMAGE
                    ? await ensureWarbandKaliImage(options)
                    : message.image;
                if (message.image !== WARBAND_KALI_IMAGE) {
                  const images = await listCockpitImages();
                  // Les deux références proposées ne prouvent pas leur présence locale.
                  const local = await createDockerClient({ recorder, binary: "docker" }).images();
                  if (
                    !local.some(
                      (item) => `${item.repository}:${item.tag}` === image || item.id === image,
                    )
                  ) {
                    if (!images.includes(image))
                      throw new Error("Image Kali absente de la sélection courante.");
                    await pullDockerImage(image, options);
                  }
                }
                signal.throwIfAborted();
                report({ stage: "Création et démarrage du conteneur…", layers: [] });
                await createDockerClient({ recorder, binary: "docker" }).createKaliContainer({
                  image,
                  name: message.name,
                  source: message.source,
                  signal,
                });
                signal.throwIfAborted();
                report({ stage: "Vérification du serveur MCP Kali…", layers: [] });
                await prepareKaliContainer(message.name, {
                  recorder,
                  signal,
                  onStage: (stage) => report({ stage: `Serveur MCP Kali : ${stage}` }),
                });
              } finally {
                unsubscribe();
                recorder.close();
              }
            });
          case "remove":
            return await runOperation("Suppression du conteneur…", async (signal) => {
              const result = await removeListedContainer(message.name, {
                signal,
                confirm: async (info) => {
                  const action = "Supprimer le conteneur";
                  const projects = info.projects.map((p) => p.name).join(", ") || "aucun";
                  const choice = await vscode.window.showWarningMessage(
                    `Supprimer ${info.name} (${info.family}) ?${info.force ? " Il est en cours et sera arrêté de force." : ""} Les fichiers internes non montés seront perdus. Les images, volumes et dossiers hôtes sont conservés. Projets associés : ${projects}.`,
                    { modal: true },
                    action,
                  );
                  return choice === action && !signal.aborted;
                },
              });
              if (result.status === "cancelled") {
                signal.throwIfAborted();
                return;
              }
              for (const shell of editorShells.get(message.name) ?? []) shell.term.dispose();
              editorShells.delete(message.name);
              if (result.status === "partial")
                throw new Error(
                  `Le conteneur est supprimé, mais ses associations restent à nettoyer : ${formatError(result.error)}`,
                );
              await pushStudio();
              await refreshContainerStatus();
            });
          case "pickVpn": {
            const kind = await vscode.window.showQuickPick(
              ["Fichier OpenVPN / WireGuard", "Dossier OpenVPN (certificats séparés)"],
              { title: "Configuration VPN Exegol" },
            );
            if (!kind) return;
            const directory = kind.startsWith("Dossier");
            const picked = await vscode.window.showOpenDialog({
              canSelectFiles: !directory,
              canSelectFolders: directory,
              canSelectMany: false,
              ...(!directory && { filters: { VPN: ["ovpn", "conf"] } }),
              openLabel: "Choisir le VPN",
            });
            if (!picked?.[0]) return;
            selectedVpn = picked[0].fsPath;
            postCockpit({ type: "pickedVpn", label: basename(selectedVpn) });
            return;
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
    const revision = ++killchainRevision;
    let findings: unknown[] = [];
    let projectId: string | null = null;
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      projectId = active?.id ?? null;
      findings = active === null ? [] : await readFindings(defaultConfigDir(), active.id);
    } catch (error) {
      if (killchainPanel === panel && revision === killchainRevision) {
        killchainPayload = "";
        await panel.webview.postMessage({
          type: "findingsError",
          message: `Actualisation du graphe impossible : ${formatError(error)}`,
        });
      }
      return;
    }
    if (killchainPanel !== panel || revision !== killchainRevision) return;
    const payload = { type: "view", page: "killchain", projectId, findings };
    const fingerprint = JSON.stringify(payload);
    if (killchainPayload === fingerprint) return;
    killchainPayload = fingerprint;
    await panel.webview.postMessage(payload);
  };
  const findingsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(defaultConfigDir()),
      "{project.json,projects/*/findings.json}",
    ),
  );
  const onFindingsChanged = (uri: vscode.Uri) => {
    if (basename(uri.fsPath) === "project.json") cancelFindingDeletions();
    scheduleFindingsRefresh();
  };
  context.subscriptions.push(
    findingsWatcher,
    findingsWatcher.onDidChange(onFindingsChanged),
    findingsWatcher.onDidCreate(onFindingsChanged),
    findingsWatcher.onDidDelete(onFindingsChanged),
  );
  const openKillchain = () => {
    if (killchainPanel) {
      killchainPanel.reveal(vscode.ViewColumn.One);
      void pushKillchain();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    killchainPayload = "";
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
    const panel = killchainPanel;
    killchainPanel.onDidDispose(() => {
      findingDeletions.get(panel)?.abort.abort();
      killchainPanel = undefined;
      killchainRevision++;
      killchainPayload = "";
      void saveWindows();
    });
    killchainPanel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseStudioMessage(raw);
      if (message?.type === "exportReport") {
        await exportMissionReport(message.projectId);
        return;
      }
      if (message?.type === "setPathEdge") {
        await setPathFromPanel(panel, message);
        return;
      }
      if (message?.type === "deleteFinding") {
        await deleteFindingFromPanel(panel, message);
        return;
      }
      if (message?.type === "refresh") {
        killchainPayload = "";
        await pushKillchain();
      }
    });
    void pushKillchain();
    void saveWindows();
  };

  let studioPage: StudioPage = "project";
  let projectChanging = false;
  const pushStudio = async (
    feedback: {
      summarySaved?: string;
      summaryFailed?: string;
      summaryError?: string;
      projectError?: string;
      projectCreated?: string;
    } = {},
  ) => {
    const panel = studioPanel;
    if (!panel) return;
    // Une sonde de conteneurs en échec ne doit pas perdre l'accusé d'écriture du résumé.
    const cockpit = await loadCockpitView().catch((error: unknown) => ({
      type: "view" as const,
      containers: [],
      error: formatError(error),
    }));
    let findings: unknown[] = [];
    let projectChoices: Awaited<ReturnType<typeof readProjectChoices>> = {
      activeId: null,
      projects: [],
    };
    let projectError = feedback.projectError;
    try {
      projectChoices = await readProjectChoices(defaultConfigDir());
    } catch (error) {
      projectError = `Projets indisponibles : ${formatError(error)}`;
    }
    let projectSummary: Awaited<ReturnType<typeof readProjectSummary>> = null;
    let summaryError = feedback.summaryError;
    try {
      projectSummary = await readProjectSummary(defaultConfigDir());
    } catch (error) {
      summaryError = `Résumé indisponible : ${formatError(error)}`;
    }
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
    await panel.webview.postMessage({
      ...cockpit,
      page: studioPage,
      findings,
      sources,
      projectSummary,
      projectChoices,
      projectBusy: projectChanging || [...slots.values()].some((slot) => slot.session?.view().busy),
      ...feedback,
      ...(summaryError !== undefined && { summaryError }),
      ...(projectError !== undefined && { projectError }),
    });
  };
  const exportMissionReport = async (expectedProjectId?: string) => {
    try {
      const file = await readProjects(defaultConfigDir());
      const project = file === null ? null : activeProject(file);
      if (!project || (expectedProjectId !== undefined && expectedProjectId !== project.id))
        throw new CodedError("project.absent");
      const generation = findingProjectGeneration;
      const destination = await vscode.window.showSaveDialog({
        title: "Exporter un brouillon de rapport (identifiants et loot exclus)",
        defaultUri: vscode.Uri.file(join(project.workspace, "rapport-warband.md")),
        filters: { Markdown: ["md"] },
      });
      if (!destination) return;
      const current = await readProjects(defaultConfigDir());
      if (
        generation !== findingProjectGeneration ||
        current === null ||
        activeProject(current)?.id !== project.id
      )
        throw new CodedError("project.absent");
      const findings = await readFindings(defaultConfigDir(), project.id);
      if (
        vscode.workspace.textDocuments.some(
          (document) => document.isDirty && document.uri.toString() === destination.toString(),
        )
      ) {
        throw new Error(
          "Ce fichier contient des modifications non enregistrées. Choisissez un autre nom de rapport.",
        );
      }
      await vscode.workspace.fs.writeFile(
        destination,
        Buffer.from(missionReport(project, findings, new Date()), "utf8"),
      );
      await vscode.window.showTextDocument(destination);
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
    }
  };
  const setPathFromPanel = async (
    panel: vscode.WebviewPanel,
    message: Extract<StudioMessage, { type: "setPathEdge" }>,
  ) => {
    const generation = findingProjectGeneration;
    const alive = () => panel === killchainPanel || panel === studioPanel;
    let error: string | undefined;
    try {
      await setSelectedPathEdge(
        defaultConfigDir(),
        message.projectId,
        message.from,
        message.to,
        message.retained,
        () => alive() && !projectChanging && generation === findingProjectGeneration,
      );
      await pushKillchain();
      await pushStudio();
    } catch (cause) {
      error = cleanText(formatError(cause), 1000);
    } finally {
      if (alive())
        await panel.webview.postMessage({
          type: "pathEdgeState",
          projectId: message.projectId,
          from: message.from,
          to: message.to,
          ...(error !== undefined && { error }),
        });
    }
  };
  const deleteFindingFromPanel = async (
    panel: vscode.WebviewPanel,
    message: Extract<StudioMessage, { type: "deleteFinding" }>,
  ) => {
    const abort = new AbortController();
    const generation = findingProjectGeneration;
    const alive = () => panel === killchainPanel || panel === studioPanel;
    const post = async (busy: boolean, error?: string) => {
      if (!alive()) return;
      await panel.webview.postMessage({
        type: "findingDeleteState",
        projectId: message.projectId,
        id: message.id,
        busy,
        ...(error !== undefined && { error }),
      });
    };
    const existing = findingDeletions.get(panel);
    if (existing) {
      const same = existing.projectId === message.projectId && existing.id === message.id;
      await post(same, same ? undefined : "Une suppression est déjà en cours. Réessayez ensuite.");
      return;
    }
    if (projectChanging) {
      await post(false, "Un changement de projet est en cours. Réessayez ensuite.");
      return;
    }
    findingDeletions.set(panel, { abort, projectId: message.projectId, id: message.id });
    let failure: string | undefined;
    try {
      await post(true);
      const result = await deleteSelectedFinding(
        defaultConfigDir(),
        message.projectId,
        message.id,
        {
          signal: abort.signal,
          isCurrent: () => alive() && !projectChanging && findingProjectGeneration === generation,
          confirm: async ({ projectName, finding, dependentCount }) => {
            const label = cleanText(finding.label, 200);
            const links =
              dependentCount > 0
                ? ` Les liens vers cet élément seront retirés de ${dependentCount} autre(s) élément(s).`
                : "";
            const choice = await vscode.window.showWarningMessage(
              `Supprimer « ${label} » de la Kill chain du projet « ${cleanText(projectName, 80)} » ?${links} Les autres éléments sont conservés.`,
              { modal: true },
              "Supprimer",
            );
            return choice === "Supprimer";
          },
        },
      );
      if (result.status === "deleted") {
        await pushKillchain();
        await pushStudio();
      }
    } catch (error) {
      failure = cleanText(formatError(error), 1000);
    } finally {
      findingDeletions.delete(panel);
      await post(false, failure);
    }
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
    const panel = studioPanel;
    studioPanel.onDidDispose(() => {
      findingDeletions.get(panel)?.abort.abort();
      studioPanel = undefined;
      void saveWindows();
    });
    studioPanel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseStudioMessage(raw);
      if (message === null) return;
      if (message.type === "exportReport") {
        await exportMissionReport(message.projectId);
        return;
      }
      if (message.type === "setPathEdge") {
        await setPathFromPanel(panel, message);
        return;
      }
      if (message.type === "deleteFinding") {
        await deleteFindingFromPanel(panel, message);
        return;
      }
      if (message.type === "open") studioPage = message.page;
      if (message.type === "openCockpit") {
        openCockpit();
        return;
      }
      if (message.type === "openKillchain") {
        openKillchain();
        return;
      }
      if (message.type === "activateProject" || message.type === "createProject") {
        const chatsBusy = () => [...slots.values()].some((slot) => slot.session?.view().busy);
        if (projectChanging || chatsBusy()) {
          await pushStudio({
            projectError: "Arrêtez les tours en cours avant de changer de projet.",
          });
          return;
        }
        cancelFindingDeletions();
        projectChanging = true;
        let projectCreated: string | undefined;
        let projectError: string | undefined;
        let projectSelected = false;
        try {
          if (message.type === "activateProject") {
            await activateSelectedProject(defaultConfigDir(), message.projectId);
            projectSelected = true;
          } else {
            const chosen = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: "Choisir le dossier du projet",
              ...(folder !== undefined && { defaultUri: folder.uri }),
            });
            if (chosen?.[0] !== undefined) {
              if (chatsBusy())
                throw new Error("Arrêtez les tours en cours avant de créer le projet.");
              projectCreated = await createSelectedProject(
                defaultConfigDir(),
                message.name,
                chosen[0].fsPath,
              );
              projectSelected = true;
            }
          }
          if (projectSelected) {
            await Promise.all(
              [...slots.values()].map((slot) => slot.session?.refreshHistoryProjects()),
            );
            await openActiveProjectWorkspace(defaultConfigDir(), projectWorkspaceHost, "selection");
          }
        } catch (error) {
          projectError = formatError(error);
        } finally {
          projectChanging = false;
        }
        await pushStudio({
          ...(projectCreated !== undefined && { projectCreated }),
          ...(projectError !== undefined && { projectError }),
        });
        if (cockpitPanel !== undefined) {
          const view = await loadCockpitView();
          await cockpitPanel.webview.postMessage(view);
          broadcastContainers(view.containers);
        }
        return;
      }
      if (message.type === "saveSummary") {
        try {
          await saveProjectSummary(defaultConfigDir(), message.projectId, message.text);
          await pushStudio({ summarySaved: message.projectId });
        } catch (error) {
          await pushStudio({
            summaryFailed: message.projectId,
            summaryError: `Résumé non enregistré : ${formatError(error)}`,
          });
        }
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
    vscode.commands.registerCommand("warband.exportReport", () => exportMissionReport()),
    vscode.commands.registerCommand("warband.focusChat", () =>
      vscode.commands.executeCommand("warband.chat.focus"),
    ),
    vscode.commands.registerCommand("warband.launcher", () => openLauncher()),
    vscode.commands.registerCommand("warband.setToken", async () => {
      const provider = slots.get(activeId)?.session?.getProvider() ?? "claude";
      if (provider !== "claude") {
        let kind: "subscription" | "api-key" | "auto" = "auto";
        if (provider === "openai") {
          const picked = await vscode.window.showQuickPick(
            [
              {
                label: "Abonnement ChatGPT",
                description: "Connexion OAuth Codex via OpenCode",
                value: "subscription" as const,
              },
              {
                label: "Clé API OpenAI",
                description: "Stockage sécurisé de VS Code",
                value: "api-key" as const,
              },
            ],
            { title: "Connexion OpenAI", ignoreFocusOut: true },
          );
          if (!picked) return;
          kind = picked.value;
          if (kind === "api-key") {
            const value = await vscode.window.showInputBox({
              title: "Clé API OpenAI",
              password: true,
              ignoreFocusOut: true,
              validateInput: (text) => (text.trim() ? undefined : "La clé est vide."),
            });
            if (value === undefined) return;
            await context.secrets.store(OPENAI_TOKEN_KEY, value.trim());
            await context.globalState.update(OPENAI_AUTH_MODE_KEY, kind);
            applyAuthChange();
            return;
          }
          await context.globalState.update(OPENAI_AUTH_MODE_KEY, kind);
        }
        const binary = await openCodeBinary();
        const term = vscode.window.createTerminal({
          name:
            provider === "openai" ? "Warband : connexion ChatGPT" : "Warband : connexion OpenCode",
          shellPath: binary,
          shellArgs: ["auth", "login", ...(provider === "openai" ? ["--provider", "openai"] : [])],
          env: {
            OPENCODE_DISABLE_PROJECT_CONFIG: "1",
            OPENCODE_PURE: "1",
            OPENCODE_DISABLE_AUTOUPDATE: "1",
            OPENCODE_DISABLE_SHARE: "1",
            OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [], share: "disabled" }),
            OPENCODE_CONFIG: null,
            OPENCODE_CONFIG_DIR: null,
            OPENCODE_AUTH_CONTENT: null,
            OPENAI_API_KEY: null,
          },
        });
        const subscription = vscode.window.onDidCloseTerminal((closed) => {
          if (closed !== term) return;
          subscription.dispose();
          applyAuthChange();
        });
        context.subscriptions.push(subscription);
        term.show();
        applyAuthChange();
        void vscode.window.showInformationMessage(
          "Terminez la connexion dans le terminal, puis fermez-le ou actualisez la liste des modèles.",
        );
        return;
      }

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
      const provider = slots.get(activeId)?.session?.getProvider() ?? "claude";
      if (provider === "openai") {
        await context.secrets.delete(OPENAI_TOKEN_KEY);
        await context.globalState.update(OPENAI_AUTH_MODE_KEY, undefined);
        applyAuthChange();
        void vscode.window.showInformationMessage(
          "Connexion OpenAI désactivée dans Warband. Le cache OAuth d’OpenCode est conservé.",
        );
        return;
      }
      if (provider === "opencode") {
        void vscode.window.showInformationMessage(
          "La connexion OpenCode se gère dans son terminal avec opencode auth logout.",
        );
        return;
      }

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
