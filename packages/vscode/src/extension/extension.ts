import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  AGENT_PROFILES,
  activeProject,
  appendFinding,
  attachEvidence,
  buildAttackFlow,
  burpToolSpecs,
  CodedError,
  coursRoot,
  createDockerClient,
  createEvidence,
  createRecorder,
  createRedactor,
  defaultConfigDir,
  type EngineEvent,
  type EvidenceSource,
  ensureWarbandKaliImage,
  listEvidence,
  lookupContainer,
  MCP_CATALOG,
  parseIntegrations,
  prepareKaliContainer,
  pullDockerImage,
  readFindings,
  readProjects,
  resolveBinary,
  shortContainerName,
  WARBAND_KALI_IMAGE,
} from "@warband/core";
import { formatError, getUiLocale, setUiLocale, t } from "@warband/messages";
import * as vscode from "vscode";
import { createBurpBackend } from "../engine/burp-client.js";
import { createIntegrationBackend } from "../engine/integration-client.js";
import { cleanText, parseWebviewMessage } from "../logic/approval.js";
import { attachmentMessage, withAttachments } from "../logic/attachments.js";
import { PRODUCT_NAME, productTitleSuffix } from "../logic/brand.js";
import { type BypassPush, createBypassHost, formatRemaining } from "../logic/bypass.js";
import { type ChatView, monitorChatView } from "../logic/chat.js";
import { capabilitySettings, providerChoices } from "../logic/chat-capabilities.js";
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
import { createEngineController } from "../logic/controller.js";
import type { Provider } from "../logic/effort.js";
import { evidenceEditorReference, evidenceTerminalAllowed } from "../logic/evidence-capture.js";
import { type ExegolCreateOptions, prepareExegolCreate } from "../logic/exegol-create.js";
import { deleteSelectedFinding } from "../logic/finding-delete.js";
import { createJournalFiles } from "../logic/historyStore.js";
import { chatHtml, cockpitHtml, killchainHtml, makeNonce, studioHtml } from "../logic/html.js";
import { matchesFingerprint } from "../logic/integrity.js";
import { killchainImage } from "../logic/killchain-image.js";
import { setSelectedPathEdge } from "../logic/killchain-path.js";
import { saveMachinePreference } from "../logic/machine-preference.js";
import { prepareMissionFolder } from "../logic/mission-folder.js";
import { missionReport, missionReportPreview } from "../logic/mission-report.js";
import { parseProviderOptions } from "../logic/models.js";
import { parseOpencodeProviders } from "../logic/opencode-providers.js";
import { PALETTES, type Palette, paletteOf } from "../logic/palette.js";
import {
  activateSelectedProject,
  createSelectedProject,
  manageSelectedProject,
  readProjectChoices,
} from "../logic/project-controls.js";
import { integrationMap, projectIntegrations } from "../logic/project-integrations.js";
import { readProjectSummary, saveProjectSummary } from "../logic/project-summary.js";
import {
  matchesActiveProjectWorkspace,
  openActiveProjectWorkspace,
} from "../logic/project-workspace.js";
import { openAiSubscriptionReady } from "../logic/provider-auth.js";
import { type ChatSession, createChatSession, type TokenChoice } from "../logic/session.js";
import { machineValue, parseConfiguredIntegrations, resolveSettings } from "../logic/settings.js";
import { readSources } from "../logic/sources.js";
import {
  type ObservedMission,
  observeMission,
  parseStudioMessage,
  type StudioMessage,
  type StudioPage,
} from "../logic/studio.js";
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
  const readMachineSetting = (key: string): unknown => {
    const info = vscode.workspace.getConfiguration("warband").inspect(key);
    return (
      context.globalState.get(`warband.pendingSetting.${key}`) ??
      info?.globalValue ??
      info?.defaultValue
    );
  };
  const writeMachineSetting = async (key: string, value: unknown): Promise<void> => {
    const config = vscode.workspace.getConfiguration("warband");
    await saveMachinePreference(value, {
      registered: config.inspect(key) !== undefined,
      update: (next) => config.update(key, next, vscode.ConfigurationTarget.Global),
      fallback: (next) => context.globalState.update(`warband.pendingSetting.${key}`, next),
    });
  };
  const currentLocale = () => (readMachineSetting("language") === "fr" ? "fr" : "en");
  setUiLocale(currentLocale());
  let runtimeProviders =
    parseProviderOptions(context.globalState.get("warband.providerCatalog")) ?? [];
  let providerCatalogStatus: "idle" | "loading" | "ready" | "unavailable" = "idle";
  let providerCatalogError: string | undefined;
  let catalogRequest: Promise<void> | undefined;
  const out = vscode.window.createOutputChannel(PRODUCT_NAME);
  context.subscriptions.push(out);

  // Défense en profondeur : `capabilities.untrustedWorkspaces` empêche déjà l'activation.
  if (!vscode.workspace.isTrusted) return;
  if (!context.globalState.get("warband.providerMenu69")) {
    const enabled = readMachineSetting("chat.providers");
    if (
      Array.isArray(enabled) &&
      enabled.length === 3 &&
      ["claude", "openai", "google"].every((id) => enabled.includes(id))
    )
      await writeMachineSetting("chat.providers", [...enabled, "opencode"]);
    await context.globalState.update("warband.providerMenu69", true);
  }

  let integrationProjectId =
    (await readProjectChoices(defaultConfigDir()).catch(() => null))?.activeId ?? null;
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
    out.appendLine(`Ouverture du dossier du projet : ${formatError(error, getUiLocale())}`);
    void vscode.window.showWarningMessage(
      t`Impossible d'ouvrir le dossier du projet ${PRODUCT_NAME} : ${formatError(error, getUiLocale())}. Sélectionnez le projet pour réessayer.`,
    );
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  const projectWorkspaceReady = async () => {
    integrationProjectId = (await readProjectChoices(defaultConfigDir())).activeId;
    if (
      folder !== undefined &&
      (await matchesActiveProjectWorkspace(defaultConfigDir(), folder.uri.fsPath))
    )
      return true;
    void vscode.window.showWarningMessage(
      t(
        "Le dossier de cette fenêtre ne correspond pas au projet actif. Utilisez la fenêtre du projet ou activez le projet correspondant dans les réglages.",
      ),
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
  const observedRuns = new Map<string, ObservedMission>();
  const injectedContexts = new Map<string, { runId: string; text: string }>();
  const observe = (id: string, event: EngineEvent | null) => {
    const next = observeMission(observedRuns.get(id), event);
    if (next) observedRuns.set(id, next);
    else observedRuns.delete(id);
    if (event === null || event.kind === "run.started") injectedContexts.delete(id);
  };
  const documents = new Map<string, string>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("warband-observed", {
      provideTextDocumentContent: (uri) =>
        documents.get(uri.toString()) ?? t("Document indisponible."),
    }),
  );
  const showObserved = async (title: string, text: string) => {
    const uri = vscode.Uri.from({
      scheme: "warband-observed",
      path: `/${title}-${randomBytes(6).toString("hex")}.txt`,
    });
    documents.set(uri.toString(), createRedactor()(text));
    if (documents.size > 32) {
      const oldest = documents.keys().next().value;
      if (oldest !== undefined) documents.delete(oldest);
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
      preview: true,
    });
  };
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
  let reportPanel: vscode.WebviewPanel | undefined;
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
    observedRuns.clear();
    reportPanel?.dispose();
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
  const localeMessage = () => ({ type: "locale", locale: getUiLocale() });
  let refreshLocaleTitles = () => {};
  let refreshReportLocale = () => {};
  let capabilityWrite: Promise<void> = Promise.resolve();
  let refreshBypassLocale = () => {};
  const broadcastLocale = () => {
    setUiLocale(currentLocale());
    const message = localeMessage();
    post(message);
    for (const slot of slots.values()) void slot.panel?.webview.postMessage(message);
    for (const panel of [monitorPanel, cockpitPanel, studioPanel, killchainPanel, reportPanel])
      void panel?.webview.postMessage(message);
    for (const watch of watches) void watch.panel.webview.postMessage(message);
    refreshLocaleTitles();
    refreshReportLocale();
  };
  const currentPalette = () =>
    paletteOf(vscode.workspace.getConfiguration("warband").get("palette"));
  const updatePalette = async (value: Palette) => {
    const config = vscode.workspace.getConfiguration("warband");
    const target =
      config.inspect("palette")?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update("palette", value, target);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("warband.language")) broadcastLocale();
      if (!event.affectsConfiguration("warband.palette")) return;
      const message = { type: "palette", value: currentPalette() };
      post(message);
      for (const slot of slots.values()) void slot.panel?.webview.postMessage(message);
      for (const panel of [monitorPanel, cockpitPanel, studioPanel, killchainPanel, reportPanel])
        void panel?.webview.postMessage(message);
      for (const watch of watches) void watch.panel.webview.postMessage(message);
    }),
  );
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
          { location: vscode.ProgressLocation.Notification, title: t`Préparation de ${name}` },
          async (progress) =>
            prepareKaliContainer(name, {
              recorder,
              onStage: (stage) => progress.report({ message: t(messages[stage]) }),
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
    return {
      capabilities: capabilitySettings(readMachineSetting),
      providerCatalog: runtimeProviders,
      ...resolveSettings((key) =>
        key === "integrations"
          ? projectIntegrations(
              machineValue(config.inspect("integrationsByProject")) ?? {},
              integrationProjectId,
            )
          : machineValue(config.inspect(key)),
      ),
    };
  };

  const acceptProviders = (providers: typeof runtimeProviders) => {
    runtimeProviders = providers;
    void context.globalState.update("warband.providerCatalog", providers);
  };
  const loadProviderCatalog = (force = false): Promise<void> => {
    if (catalogRequest) return catalogRequest;
    if (!force && providerCatalogStatus !== "idle") return Promise.resolve();
    providerCatalogStatus = "loading";
    providerCatalogError = undefined;
    catalogRequest = (async () => {
      const probe = createEngineController({
        enginePath: join(context.extensionPath, "run-engine.mjs"),
        args: [context.extensionPath],
        handlers: { onProviders: acceptProviders, onLog: (text) => out.append(text) },
      });
      try {
        await probe.models({
          cwd: folder?.uri.fsPath ?? context.extensionPath,
          provider: "opencode",
          auth: "auto",
          opencodeProviders: readSettings().opencodeProviders ?? {},
          timeoutMs: 45000,
        });
        providerCatalogStatus = "ready";
      } catch (error) {
        providerCatalogStatus = "unavailable";
        providerCatalogError = cleanText(formatError(error, getUiLocale()), 1000);
      } finally {
        probe.kill();
        catalogRequest = undefined;
        for (const slot of slots.values())
          if (slot.session) slot.session.setSelection(slot.session.view().capabilities?.selection);
        void pushStudio();
      }
    })();
    return catalogRequest;
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
    if (!CHAT_ID.test(id)) throw new Error(t("Identifiant de chat refusé."));
    if (seats(id !== SIDEBAR_CHAT) >= CHAT_CAP) throw new Error(t("Quatre chats au maximum."));
    if (!folder) throw new Error(t`Ouvrez un dossier avant de lancer ${PRODUCT_NAME}.`);
    const historyKey = `warband.history.${id}`;
    // Mode apprentissage (ADR 0010) : une clé par chat, séparée de `warband.prefs` (partagé).
    const learningKey = `warband.learning.${id}`;
    const runs = join((context.storageUri ?? context.globalStorageUri).fsPath, "runs");
    const session = createChatSession({
      cwd: folder.uri.fsPath,
      enginePath: join(context.extensionPath, "run-engine.mjs"),
      engineArgs: [context.extensionPath],
      readSettings,
      onProviders: acceptProviders,
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
        confirmDelete: async (text) => {
          const action = t("Supprimer");
          return (await vscode.window.showWarningMessage(text, { modal: true }, action)) === action;
        },
      },
      ...(typeof __SDK_VERSION__ === "string" && {
        sdkVersion: `${__SDK_VERSION__}/${typeof __OPENCODE_VERSION__ === "string" ? __OPENCODE_VERSION__ : "unknown"}/catalog-v3`,
      }),
      confirmAlways: async (text) => {
        const action = t("Toujours autoriser");
        return (await vscode.window.showWarningMessage(text, { modal: true }, action)) === action;
      },
      onView: (view) => {
        const message = { type: "view", view, chatId: id };
        const slot = slots.get(id);
        if (id === SIDEBAR_CHAT) post(message);
        else void slot?.panel?.webview.postMessage(message);
        if (id === activeId) pushMonitor(view);
        for (const watch of watches) {
          if (watch.chatId === id)
            void watch.panel.webview.postMessage({
              ...message,
              view: monitorChatView(view, watch.toolUseId),
            });
        }
        updateModelStatus();
        scheduleFindingsRefresh();
      },
      onObservedEvent: (event) => observe(id, event),
      onMissionContext: (snapshot) => {
        if (observedRuns.get(id)?.runId === snapshot.runId) injectedContexts.set(id, snapshot);
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
      name: t`${PRODUCT_NAME} : création ${options.name}`,
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
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
    if (message.type === "ready") reply(localeMessage());
    try {
      setActive(id);
      // Bypass (ADR 0006) : hôte seul, avant `getSession`. `enabled: true` refusé si la vue est cachée.
      if (message.type === "setBypass") {
        bypass.request(message.enabled, visible());
        return;
      }
      // Chat grisé sans fournisseur : ouvre la saisie du jeton (hôte seul, aucune donnée venue de la webview).
      if (message.type === "addProvider" || message.type === "openSystem") {
        studioPage = "system";
        openStudio();
        return;
      }
      const s = getSession(id);
      switch (message.type) {
        case "ready":
          reply(bypass.snapshot());
          reply({ type: "view", view: s.view(), chatId: id });
          reply(await containersMessage());
          reply(await terminalsMessage());
          return await s.loadModels();
        case "selectProvider":
          return await s.selectProvider(message.id);
        case "setSelection":
          return s.setSelection(message.selection);
        case "setProvider": {
          const entry = providerChoices(readSettings()).find((p) => p.backend === message.provider);
          if (entry) return await s.selectProvider(entry.id);
          return;
        }
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
          const hasFiles = message.attachments !== undefined;
          const generation = findingProjectGeneration;
          const validContext = () =>
            !hasFiles ||
            (vscode.workspace.isTrusted &&
              visible() &&
              !s.view().busy &&
              !s.view().readonly &&
              !s.view().noProvider &&
              message.conversation === s.view().conversation &&
              generation === findingProjectGeneration);
          const result = (accepted: boolean) => {
            if (hasFiles)
              reply({ type: "attachmentResult", requestId: message.requestId, accepted });
          };
          if (!validContext()) {
            result(false);
            return;
          }
          try {
            if (projectChanging) {
              void vscode.window.showWarningMessage(
                t("Changement de projet en cours, réessayez ensuite."),
              );
              result(false);
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
                  ? t`Terminal introuvable : ${unknown[0]}.`
                  : t`Terminaux introuvables : ${unknown.join(", ")}.`,
              );
            }
            const sections = [];
            for (const token of classified.open) {
              const shell = findShellByToken(token);
              const raw = shell === undefined ? null : await readLogTail(shell);
              if (raw === null) {
                void vscode.window.showWarningMessage(
                  t`La sortie de #${token} est illisible (conteneur arrêté, ou « script » absent de l'image).`,
                );
              }
              sections.push({
                token,
                ...(shell !== undefined ? { container: shell.container } : {}),
                text: raw === null ? t("Sortie illisible.") : readableTerminal(raw),
              });
            }
            // Aucun terminal ouvert ici : envoyer une consigne ne doit jamais créer de fenêtre.
            if (!(await projectWorkspaceReady()) || projectChanging || !validContext()) {
              result(false);
              return;
            }
            const raw = message.text.trim() ? message.text : "Analyse les fichiers joints.";
            const context = withTerminalContext(raw, sections);
            const accepted = await s.send(
              hasFiles ? attachmentMessage(message.text, message.attachments ?? []) : message.text,
              hasFiles ? withAttachments(context, message.attachments ?? []) : context,
            );
            result(accepted);
          } catch (error) {
            result(false);
            throw error;
          }
          return;
        }
        case "stop":
          return s.stop();
        case "reset":
          bypass.reset();
          return s.reset();
        case "approve":
          return await s.approve(message.toolUseId, message.choice);
        case "timelinePage":
          return await s.timelinePage(message.direction);
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
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
        locale: getUiLocale(),
        i18nUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "i18n.js")).toString(),
        palette: currentPalette(),
        nonce,
        cspSource: view.webview.cspSource,
        scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js")).toString(),
        uiUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "ui.js")).toString(),
        styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
      });
      post = (message) => void view.webview.postMessage(message);
      if (
        !context.workspaceState.get("warband.layoutOpened") &&
        vscode.window.tabGroups.all.every((group) => group.tabs.length === 0)
      ) {
        setTimeout(() => {
          if (view.visible)
            void vscode.commands
              .executeCommand("warband.openWorkspace")
              .then(undefined, (error) => out.appendLine(formatError(error, getUiLocale())));
        }, 300);
      }
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

  // Colonne des panneaux Venator Ops : le groupe d'éditeur qui contient déjà un onglet Venator Ops (panneau
  // webview ou terminal d'éditeur « Venator Ops : … »), sinon le groupe actif. Jamais `Beside` : il créait
  // un groupe scindé à chaque ouverture au lieu d'ajouter un onglet.
  const warbandColumn = (): vscode.ViewColumn => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputWebview && input.viewType.includes("warband.")) {
          return group.viewColumn;
        }
        if (input instanceof vscode.TabInputTerminal && productTitleSuffix(tab.label) !== null) {
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
    const panel = vscode.window.createWebviewPanel(
      "warband.cockpit",
      `${PRODUCT_NAME} · Cockpit`,
      warbandColumn(),
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
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
      locale: getUiLocale(),
      i18nUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "i18n.js")).toString(),
      palette: currentPalette(),
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
      postCockpit(localeMessage());
      if (loading) postCockpit({ type: "view", loading: true });
      try {
        const payload = await loadCockpitView();
        if (!alive) return;
        postCockpit(payload);
        broadcastContainers(payload.containers);
        void refreshContainerStatus();
        if (payload.projectInvalid) {
          void vscode.window.showErrorMessage(
            t("Projet invalide : fichier project.json illisible ou incomplet."),
          );
        }
      } catch (error) {
        if (alive) void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
        postCockpit({ type: "operation", busy: false, stage: completedStage ?? t("Terminé") });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        postCockpit({
          type: "operation",
          busy: false,
          stage: cancelled ? t("Opération annulée") : t("Échec de l’opération"),
          ...(!cancelled && { error: formatError(error, getUiLocale()) }),
        });
        if (!cancelled) void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
          stage: t("Paramètres invalides"),
          error: t("Vérifiez le nom, l’image, le dossier et les options de création."),
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
              void vscode.window.showErrorMessage(t`Dossier inaccessible : ${st.workspace}`);
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
              { title: t`${PRODUCT_NAME} : terminal du projet`, ignoreFocusOut: true },
            );
            if (!choice) return;
            const result = await openEditorShell(choice.item.name);
            if (result === "skip") {
              void vscode.window.showErrorMessage(t("Conteneur introuvable."));
            }
            return;
          }
          case "start":
            return await runOperation(t("Démarrage du conteneur…"), async (signal) => {
              signal.throwIfAborted();
              await controlListedContainer("start", message.name);
              signal.throwIfAborted();
              await prepareIfKali(message.name);
            });
          case "stop":
            return await runOperation(t("Arrêt du conteneur…"), async (signal) => {
              signal.throwIfAborted();
              await controlListedContainer("stop", message.name);
            });
          case "createExegol":
            return await runOperation(t("Préparation Exegol…"), async (signal) => {
              if (message.vpn && !selectedVpn)
                throw new Error(t("Choisissez une configuration VPN avec le bouton VPN."));
              if (
                (message.desktop || message.vpn) &&
                message.network !== undefined &&
                message.network !== "nat"
              )
                throw new Error(t("Le VPN et le bureau web nécessitent le réseau NAT."));
              const existing = await loadCockpitView();
              if (
                existing.containers.some(
                  (item) => item.name === message.name || item.short === message.name,
                )
              )
                throw new Error(t("Ce conteneur existe déjà. Utilisez Démarrer dans la liste."));
              if (
                vscode.window.terminals.some((terminal) =>
                  [`création ${message.name}`, `creation ${message.name}`].includes(
                    productTitleSuffix(terminal.name) ?? "",
                  ),
                )
              )
                throw new Error(t("Une création de ce nom est déjà ouverte dans un terminal."));
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
                t("Terminez la création Exegol dans le terminal, puis actualisez les conteneurs."),
              );
              return t("Création Exegol lancée — progression dans le terminal");
            });
          case "createKali":
            return await runOperation(t("Préparation de l’image Kali…"), async (signal, report) => {
              const recorder = createRecorder();
              let lastReport = 0;
              const unsubscribe = recorder.subscribe((event) => {
                if (event.kind === "process.output" && Date.now() - lastReport > 250) {
                  lastReport = Date.now();
                  report({
                    stage: t("Préparation de l’image Kali…"),
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
                          ? t("Installation des outils Kali…")
                          : t("Téléchargement de l’image…"),
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
                      throw new Error(t("Image Kali absente de la sélection courante."));
                    await pullDockerImage(image, options);
                  }
                }
                signal.throwIfAborted();
                report({ stage: t("Création et démarrage du conteneur…"), layers: [] });
                await createDockerClient({ recorder, binary: "docker" }).createKaliContainer({
                  image,
                  name: message.name,
                  source: message.source,
                  signal,
                });
                signal.throwIfAborted();
                report({ stage: t("Vérification du serveur MCP Kali…"), layers: [] });
                await prepareKaliContainer(message.name, {
                  recorder,
                  signal,
                  onStage: (stage) => report({ stage: t`Serveur MCP Kali : ${stage}` }),
                });
              } finally {
                unsubscribe();
                recorder.close();
              }
            });
          case "remove":
            return await runOperation(t("Suppression du conteneur…"), async (signal) => {
              const result = await removeListedContainer(message.name, {
                signal,
                confirm: async (info) => {
                  const action = t("Supprimer le conteneur");
                  const projects = info.projects.map((p) => p.name).join(", ") || t("aucun");
                  const choice = await vscode.window.showWarningMessage(
                    t`Supprimer ${info.name} (${info.family}) ?${info.force ? t(" Il est en cours et sera arrêté de force.") : ""} Les fichiers internes non montés seront perdus. Les images, volumes et dossiers hôtes sont conservés. Projets associés : ${projects}.`,
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
                  t`Le conteneur est supprimé, mais ses associations restent à nettoyer : ${formatError(result.error, getUiLocale())}`,
                );
              await pushStudio();
              await refreshContainerStatus();
            });
          case "pickVpn": {
            const kind = await vscode.window.showQuickPick(
              [
                { label: t("Fichier OpenVPN / WireGuard"), directory: false },
                { label: t("Dossier OpenVPN (certificats séparés)"), directory: true },
              ],
              { title: t("Configuration VPN Exegol") },
            );
            if (!kind) return;
            const directory = kind.directory;
            const picked = await vscode.window.showOpenDialog({
              canSelectFiles: !directory,
              canSelectFolders: directory,
              canSelectMany: false,
              ...(!directory && { filters: { VPN: ["ovpn", "conf"] } }),
              openLabel: t("Choisir le VPN"),
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
        void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
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
  const pushMonitor = (view?: ChatView) => {
    const panel = monitorPanel;
    if (!panel) return;
    const name = chatName(activeId);
    panel.title = `${PRODUCT_NAME} · Monitor · ${name}`;
    void panel.webview.postMessage({ type: "title", text: name });
    const shown = view ?? slots.get(activeId)?.session?.view();
    if (shown)
      void panel.webview.postMessage({
        type: "view",
        chatId: activeId,
        view: monitorChatView(shown),
      });
  };
  const setActive = (id: string) => {
    activeId = id;
    pushMonitor();
  };
  const mountChatHtml = (webview: vscode.Webview) => {
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const nonce = makeNonce();
    webview.html = chatHtml({
      locale: getUiLocale(),
      i18nUri: webview.asWebviewUri(vscode.Uri.joinPath(media, "i18n.js")).toString(),
      palette: currentPalette(),
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
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "warband.chatPanel",
      `${PRODUCT_NAME} · ${chatName(id)}`,
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
    panel.title = `${PRODUCT_NAME} · ${chatName(id)}`;
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
      if (view)
        void existing.panel.webview.postMessage({
          type: "view",
          view: monitorChatView(view, toolUseId),
          chatId,
        });
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "warband.watch",
      t`${PRODUCT_NAME} · Sortie`,
      warbandColumn(),
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
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
      void panel.webview.postMessage(localeMessage());
      void panel.webview.postMessage({ type: "role", role: "watch", toolUseId });
      const view = slots.get(chatId)?.session?.view();
      if (view)
        void panel.webview.postMessage({
          type: "view",
          view: monitorChatView(view, toolUseId),
          chatId,
        });
    });
  };

  const openMonitor = (column?: vscode.ViewColumn) => {
    if (monitorPanel) {
      monitorPanel.reveal(column);
      pushMonitor();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "warband.monitor",
      `${PRODUCT_NAME} · Monitor`,
      column ?? warbandColumn(),
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    monitorPanel = panel;
    mountChatHtml(panel.webview);
    panel.onDidDispose(() => {
      monitorPanel = undefined;
      void saveWindows();
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message?.type === "timelinePage") {
        return slots.get(activeId)?.session?.timelinePage(message.direction);
      }
      if (message?.type === "watch") {
        openWatch(message.toolUseId);
        return;
      }
      if (message?.type !== "ready") return;
      void panel.webview.postMessage(localeMessage());
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
  barLauncher.text = `$(rocket) ${PRODUCT_NAME}`;
  barLauncher.tooltip = t`${PRODUCT_NAME} : chat, terminaux, cockpit, réglages (Alt+J Alt+J)`;
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
    barModel.text = `$(sparkle) ${c.model === null ? t("Modèle par défaut") : (known?.label ?? c.model)}`;
    barModel.tooltip = t("Modèle utilisé pour le message suivant (clic : ouvrir le chat)");
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
        ? t`Conteneur lié : ${st.container} (connecté). Clic : ouvrir un terminal (Alt+J T)`
        : t`Conteneur lié : ${st.container} (arrêté)`;
    barContainer.show();
  };

  /** Crée le dossier de cours s'il manque, puis le révèle dans l'explorateur système. Chemin : hôte seul. */
  const openCoursFolder = async () => {
    try {
      const root = coursRoot();
      await mkdir(root, { recursive: true });
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
    }
  };

  const pushKillchain = async () => {
    const panel = killchainPanel;
    if (!panel) return;
    const revision = ++killchainRevision;
    let findings: unknown[] = [];
    let evidence: unknown[] = [];
    let projectId: string | null = null;
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      projectId = active?.id ?? null;
      findings = active === null ? [] : await readFindings(defaultConfigDir(), active.id);
      evidence =
        active === null
          ? []
          : (await listEvidence(defaultConfigDir(), active.id)).map(
              ({ text: _text, ...meta }) => meta,
            );
    } catch (error) {
      if (killchainPanel === panel && revision === killchainRevision) {
        killchainPayload = "";
        await panel.webview.postMessage({
          type: "findingsError",
          message: t`Actualisation du graphe impossible : ${formatError(error, getUiLocale())}`,
        });
      }
      return;
    }
    if (killchainPanel !== panel || revision !== killchainRevision) return;
    const payload = { type: "view", page: "killchain", projectId, findings, evidence };
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
      `${PRODUCT_NAME} · Kill chain`,
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
      locale: getUiLocale(),
      i18nUri: killchainPanel.webview
        .asWebviewUri(vscode.Uri.joinPath(media, "i18n.js"))
        .toString(),
      palette: currentPalette(),
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
      if (message?.type === "openEvidence") {
        await openEvidence(message.projectId, message.id);
        return;
      }
      if (message?.type === "openReport") {
        await openReport(message.projectId);
        return;
      }
      if (message?.type === "exportKillchain") {
        await exportMissionReport(message.projectId, true);
        return;
      }
      if (message?.type === "exportAttackFlow") {
        await exportMissionReport(message.projectId, false, true);
        return;
      }
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
        await panel.webview.postMessage(localeMessage());
        killchainPayload = "";
        await pushKillchain();
      }
    });
    void pushKillchain();
    void saveWindows();
  };

  let studioPage: StudioPage = "project";
  let projectChanging = false;
  let burpStatus = "";
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
    if (studioPage === "system") void loadProviderCatalog();
    // Une sonde de conteneurs en échec ne doit pas perdre l'accusé d'écriture du résumé.
    const cockpit = await loadCockpitView().catch((error: unknown) => ({
      type: "view" as const,
      containers: [],
      error: formatError(error, getUiLocale()),
    }));
    let findings: unknown[] = [];
    let evidence: unknown[] = [];
    let projectChoices: Awaited<ReturnType<typeof readProjectChoices>> = {
      activeId: null,
      projects: [],
    };
    let projectError = feedback.projectError;
    try {
      projectChoices = await readProjectChoices(defaultConfigDir());
    } catch (error) {
      projectError = t`Projets indisponibles : ${formatError(error, getUiLocale())}`;
    }
    let projectSummary: Awaited<ReturnType<typeof readProjectSummary>> = null;
    let summaryError = feedback.summaryError;
    try {
      projectSummary = await readProjectSummary(defaultConfigDir());
    } catch (error) {
      summaryError = t`Résumé indisponible : ${formatError(error, getUiLocale())}`;
    }
    try {
      const file = await readProjects(defaultConfigDir());
      const active = file === null ? null : activeProject(file);
      findings = active === null ? [] : await readFindings(defaultConfigDir(), active.id);
      evidence =
        active === null
          ? []
          : (await listEvidence(defaultConfigDir(), active.id)).map(
              ({ text: _text, ...meta }) => meta,
            );
    } catch {
      findings = [];
    }
    // Sources de cours (lecture seule) : seulement pour l'Atlas, racine fixée par l'hôte.
    const sources = studioPage === "atlas" ? await readSources(coursRoot()) : [];
    // Fermé pendant les lectures : `panel.webview` lèverait « Webview is disposed ».
    if (studioPanel !== panel) return;
    await panel.webview.postMessage(localeMessage());
    await panel.webview.postMessage({
      ...cockpit,
      page: studioPage,
      findings,
      evidence,
      sources,
      projectSummary,
      projectChoices,
      capabilities: readSettings().capabilities,
      providerCatalog: providerChoices(readSettings(), false).map(
        ({ id, label, runtimeId, connected }) => ({
          id,
          label,
          ...(runtimeId && { runtimeId }),
          ...(connected !== undefined && { connected }),
        }),
      ),
      providerCatalogStatus,
      providerCatalogError,
      skillCatalog: Object.entries(AGENT_PROFILES).map(([id, p]) => ({ id, label: p.label })),
      mcpCatalog: MCP_CATALOG,
      mcpConfigured: projectIntegrations(
        machineValue(
          vscode.workspace.getConfiguration("warband").inspect("integrationsByProject"),
        ) ?? {},
        projectChoices.activeId,
      ),
      agentProfile:
        machineValue(vscode.workspace.getConfiguration("warband").inspect("profile")) ?? "",
      burpEnabled:
        machineValue(vscode.workspace.getConfiguration("warband").inspect("burp.enabled")) === true,
      burpStatus,
      projectBusy: projectChanging || [...slots.values()].some((slot) => slot.session?.view().busy),
      ...feedback,
      ...(summaryError !== undefined && { summaryError }),
      ...(projectError !== undefined && { projectError }),
    });
  };
  const openReport = async (expectedProjectId?: string) => {
    try {
      const generation = findingProjectGeneration;
      const file = await readProjects(defaultConfigDir());
      const project = file === null ? null : activeProject(file);
      if (
        !project ||
        (expectedProjectId !== undefined && project.id !== expectedProjectId) ||
        projectChanging
      )
        throw new CodedError("project.absent");
      const findings = await readFindings(defaultConfigDir(), project.id);
      if (generation !== findingProjectGeneration || projectChanging)
        throw new CodedError("project.absent");
      reportPanel?.dispose();
      const media = vscode.Uri.joinPath(context.extensionUri, "media");
      const panel = vscode.window.createWebviewPanel(
        "warband.report",
        t`${PRODUCT_NAME} · Rapport · Brouillon`,
        warbandColumn(),
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [media],
        },
      );
      reportPanel = panel;
      panel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
      panel.onDidDispose(() => {
        if (reportPanel === panel) reportPanel = undefined;
      });
      refreshReportLocale = () => {
        if (panel !== reportPanel || generation !== findingProjectGeneration) return;
        void panel.webview.postMessage({
          type: "view",
          view: {
            items: [missionReportPreview(project, findings)],
            approvals: [],
            busy: false,
            sandbox: null,
            sandboxNetwork: null,
            controls: null,
            history: [],
            readonly: null,
            noProvider: false,
          },
        });
      };
      panel.webview.onDidReceiveMessage(async (raw: unknown) => {
        if (panel !== reportPanel || generation !== findingProjectGeneration) return;
        if (parseWebviewMessage(raw)?.type === "ready") {
          await panel.webview.postMessage(localeMessage());
          await panel.webview.postMessage({ type: "role", role: "report" });
          refreshReportLocale();
        } else {
          const message = parseStudioMessage(raw);
          if (message?.type === "exportReport" && message.projectId === project.id)
            await exportMissionReport(project.id);
        }
      });
      mountChatHtml(panel.webview);
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
    }
  };
  const exportMissionReport = async (
    expectedProjectId?: string,
    image = false,
    attackFlow = false,
  ) => {
    try {
      const file = await readProjects(defaultConfigDir());
      const project = file === null ? null : activeProject(file);
      if (!project || (expectedProjectId !== undefined && expectedProjectId !== project.id))
        throw new CodedError("project.absent");
      const generation = findingProjectGeneration;
      const destination = await vscode.window.showSaveDialog({
        title: attackFlow
          ? t("Exporter Attack Flow (étapes confirmées, identifiants et loot exclus)")
          : image
            ? t("Exporter la Kill Chain complète en image SVG")
            : t("Exporter un brouillon de rapport (identifiants et loot exclus)"),
        defaultUri: vscode.Uri.file(
          join(
            project.workspace,
            attackFlow
              ? "attack-flow-warband.json"
              : image
                ? "killchain-warband.svg"
                : "rapport-warband.md",
          ),
        ),
        filters: attackFlow
          ? { "Attack Flow JSON": ["json"] }
          : image
            ? { "Image SVG": ["svg"] }
            : { Markdown: ["md"] },
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
      if (generation !== findingProjectGeneration || projectChanging)
        throw new CodedError("project.absent");
      if (
        vscode.workspace.textDocuments.some(
          (document) => document.isDirty && document.uri.toString() === destination.toString(),
        )
      ) {
        throw new Error(
          t(
            "Ce fichier contient des modifications non enregistrées. Choisissez un autre nom de rapport.",
          ),
        );
      }
      await vscode.workspace.fs.writeFile(
        destination,
        Buffer.from(
          attackFlow
            ? JSON.stringify(buildAttackFlow(project, findings, new Date()), null, 2) + "\n"
            : image
              ? killchainImage(project, findings)
              : missionReport(project, findings, new Date()),
          "utf8",
        ),
      );
      if (image) await vscode.commands.executeCommand("vscode.open", destination);
      else await vscode.window.showTextDocument(destination);
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
    }
  };
  const openEvidence = async (projectId: string, id: string) => {
    try {
      if ((await readProjectChoices(defaultConfigDir())).activeId !== projectId) return;
      const row = (await listEvidence(defaultConfigDir(), projectId)).find(
        (entry) => entry.id === id,
      );
      if (!row || (await readProjectChoices(defaultConfigDir())).activeId !== projectId) return;
      await showObserved(
        "preuve",
        t`${row.label}\n${JSON.stringify(row.source)}\nSHA-256 du texte affiché : ${row.sha256}${row.storedSha256 ? t`\nSHA-256 original stocké : ${row.storedSha256}` : ""}${row.redactionTruncated ? t("\nTexte remasqué et tronqué.") : ""}\nCapturée : ${row.capturedAt}\n\n${row.text}`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
    }
  };
  const evidenceProjectGuard = (projectId: string, generation: number) => async () => {
    const file = await readProjects(defaultConfigDir());
    const project = file === null ? null : activeProject(file);
    if (projectChanging || generation !== findingProjectGeneration || project?.id !== projectId)
      throw new Error(t("Le projet actif a changé. Relancez l’action sur les preuves."));
    return project;
  };
  const listProjectEvidence = async () => {
    try {
      const file = await readProjects(defaultConfigDir());
      const project = file === null ? null : activeProject(file);
      if (!project) return;
      const current = evidenceProjectGuard(project.id, findingProjectGeneration);
      const rows = await listEvidence(defaultConfigDir(), project.id);
      const findings = await readFindings(defaultConfigDir(), project.id);
      const picked = await vscode.window.showQuickPick(
        rows.map((row) => ({
          label: row.label,
          description: findings.some((finding) => finding.evidenceIds?.includes(row.id))
            ? t("Rattachée")
            : t("Non rattachée"),
          detail: row.id,
          row,
        })),
        { title: t("Preuves du projet actif — lecture ou rattachement") },
      );
      if (!picked) return;
      await current();
      const action = await vscode.window.showQuickPick(
        [t("Ouvrir"), t("Rattacher à une trouvaille existante")],
        { title: picked.row.label },
      );
      if (!action) return;
      await current();
      if (action === t("Ouvrir")) {
        await openEvidence(project.id, picked.row.id);
        return;
      }
      const latest = await readFindings(defaultConfigDir(), project.id);
      const target = await vscode.window.showQuickPick(
        latest
          .filter(
            (finding) =>
              (finding.evidenceIds?.length ?? 0) < 20 &&
              !finding.evidenceIds?.includes(picked.row.id),
          )
          .map((finding) => ({ label: finding.label, id: finding.id })),
        { title: t("Rattacher la preuve à une trouvaille existante") },
      );
      if (!target) return;
      const beforeCommit = async () => {
        await current();
      };
      await beforeCommit();
      await attachEvidence(defaultConfigDir(), project.id, target.id, picked.row.id, {
        beforeCommit,
      });
      await pushKillchain();
      await pushStudio();
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
    }
  };
  const captureEvidence = async (terminal: boolean) => {
    let createdEvidence: { id: string; projectId: string } | undefined;
    let attached = false;
    try {
      if (!(await projectWorkspaceReady())) return;
      const file = await readProjects(defaultConfigDir());
      const project = file === null ? null : activeProject(file);
      if (!project) return;
      const projectId = project.id;
      const current = evidenceProjectGuard(projectId, findingProjectGeneration);
      let capturedContainer: string | undefined;
      const beforeCommit = async () => {
        const fresh = await current();
        if (
          capturedContainer !== undefined &&
          !evidenceTerminalAllowed(fresh.containers, capturedContainer)
        )
          throw new Error(t("Le terminal n’appartient plus à l’allowlist du projet actif."));
      };
      let text: string;
      let source: EvidenceSource;
      if (terminal) {
        const shells = [...editorShells.values()]
          .flat()
          .filter(
            (shell) =>
              shell.logPath !== null &&
              evidenceTerminalAllowed(project.containers, shell.container),
          );
        if (!shells.length)
          throw new Error(t("Aucun terminal capturé n’appartient à l’allowlist du projet actif."));
        const picked = await vscode.window.showQuickPick(
          shells.map((shell) => ({ label: shell.term.name, shell })),
          { title: t("Capturer la fin du journal d’un terminal du projet actif") },
        );
        if (!picked) return;
        capturedContainer = picked.shell.container;
        await beforeCommit();
        if (!(editorShells.get(capturedContainer) ?? []).includes(picked.shell))
          throw new Error(t("Ce terminal est fermé."));
        const raw = await readLogTail(picked.shell);
        await beforeCommit();
        if (raw === null) throw new Error(t("Journal du terminal indisponible."));
        text = readableTerminal(raw, undefined, getUiLocale());
        source = {
          kind: "terminal",
          reference: `terminal/${picked.shell.token ?? picked.shell.label}`,
        };
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== "file")
          throw new Error(t("Sélectionnez un extrait dans un fichier du projet actif."));
        text = editor.document.getText(editor.selection);
        const startLine = editor.selection.start.line + 1;
        const endLine = editor.selection.end.line + 1;
        const selectedFile = editor.document.uri.fsPath;
        const [root, path] = await Promise.all([
          realpath(project.workspace),
          realpath(selectedFile),
        ]);
        evidenceEditorReference(root, path);
        source = {
          kind: "editor",
          reference: evidenceEditorReference(project.workspace, selectedFile),
          startLine,
          endLine,
        };
      }
      if (!text.trim() || Buffer.byteLength(text, "utf8") > 16384)
        throw new Error(
          t("Extrait vide ou supérieur à 16 Kio. Réduisez la sélection avant de capturer."),
        );
      await beforeCommit();
      await showObserved("aperçu-preuve", `${JSON.stringify(source)}\n\n${text}`);
      const confirmation = await vscode.window.showQuickPick(
        [t("Conserver cet extrait exact"), t("Annuler")],
        {
          title: t("Aperçu multiligne ouvert en lecture seule — conserver cet extrait ?"),
          ignoreFocusOut: true,
        },
      );
      if (confirmation !== t("Conserver cet extrait exact")) return;
      const label = await vscode.window.showInputBox({
        title: t("Titre de la preuve"),
        ignoreFocusOut: true,
        validateInput: (value) =>
          !value.trim() || value.trim().length > 200
            ? t("Titre requis, 200 caractères maximum.")
            : undefined,
      });
      if (!label) return;
      await beforeCommit();
      const findings = await readFindings(defaultConfigDir(), projectId);
      const target = await vscode.window.showQuickPick(
        [
          { label: t("Nouvelle trouvaille"), id: null },
          ...findings
            .filter((row) => (row.evidenceIds?.length ?? 0) < 20)
            .map((row) => ({ label: row.label, id: row.id })),
        ],
        { title: t("Rattacher la preuve") },
      );
      if (!target) return;
      await beforeCommit();
      const evidence = await createEvidence(
        defaultConfigDir(),
        projectId,
        { label, text, source },
        { beforeCommit },
      );
      createdEvidence = { id: evidence.id, projectId };
      if (target.id === null)
        await appendFinding(
          defaultConfigDir(),
          projectId,
          { kind: "step", state: "hypothesis", label, evidenceIds: [evidence.id] },
          { beforeCommit },
        );
      else
        await attachEvidence(defaultConfigDir(), projectId, target.id, evidence.id, {
          beforeCommit,
        });
      attached = true;
      await pushKillchain();
      await pushStudio();
    } catch (error) {
      const recovery =
        createdEvidence && !attached
          ? t` La preuve ${createdEvidence.id} a été créée dans le projet ${createdEvidence.projectId}, mais n’a pas été rattachée. Activez ce projet puis utilisez « ${PRODUCT_NAME} : Lister les preuves du projet » pour la retrouver et la rattacher.`
          : "";
      void vscode.window.showErrorMessage(`${formatError(error, getUiLocale())}${recovery}`);
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
      error = cleanText(formatError(cause, getUiLocale()), 1000);
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
      await post(
        same,
        same ? undefined : t("Une suppression est déjà en cours. Réessayez ensuite."),
      );
      return;
    }
    if (projectChanging) {
      await post(false, t("Un changement de projet est en cours. Réessayez ensuite."));
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
                ? t` Les liens vers cet élément seront retirés de ${dependentCount} autre(s) élément(s).`
                : "";
            const action = t("Supprimer");
            const choice = await vscode.window.showWarningMessage(
              t`Supprimer « ${label} » de la Kill chain du projet « ${cleanText(projectName, 80)} » ?${links} Les autres éléments sont conservés.`,
              { modal: true },
              action,
            );
            return choice === action;
          },
        },
      );
      if (result.status === "deleted") {
        await pushKillchain();
        await pushStudio();
      }
    } catch (error) {
      failure = cleanText(formatError(error, getUiLocale()), 1000);
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
    studioPanel = vscode.window.createWebviewPanel(
      "warband.studio",
      t`${PRODUCT_NAME} · Réglages`,
      warbandColumn(),
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      },
    );
    studioPanel.iconPath = vscode.Uri.joinPath(media, "logo-small.svg");
    const nonce = makeNonce();
    studioPanel.webview.html = studioHtml({
      locale: getUiLocale(),
      i18nUri: studioPanel.webview.asWebviewUri(vscode.Uri.joinPath(media, "i18n.js")).toString(),
      palette: currentPalette(),
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
      if (message.type === "openWorkspace" || message.type === "prepareMission") {
        await vscode.commands.executeCommand(
          message.type === "openWorkspace" ? "warband.openWorkspace" : "warband.prepareMission",
        );
        return;
      }
      if (message.type === "setCapability") {
        capabilityWrite = capabilityWrite.then(async () => {
          try {
            const settings = readSettings();
            const config = vscode.workspace.getConfiguration("warband");
            const field =
              message.kind === "provider"
                ? "providers"
                : message.kind === "skill"
                  ? "skills"
                  : "integrations";
            const valid =
              message.kind === "provider"
                ? providerChoices(settings, false).some((p) => p.id === message.id)
                : message.kind === "skill"
                  ? Object.hasOwn(AGENT_PROFILES, message.id)
                  : message.kind === "web"
                    ? message.id === "search"
                    : message.id === "burp" || MCP_CATALOG.some((m) => m.id === message.id);
            if (!valid) return;
            if (message.kind === "web")
              await writeMachineSetting("chat.webSearch", message.enabled);
            else {
              const list = settings.capabilities?.[field] ?? [];
              await writeMachineSetting(
                `chat.${field}`,
                message.enabled
                  ? [...new Set([...list, message.id])]
                  : list.filter((id) => id !== message.id),
              );
            }
            for (const slot of slots.values())
              if (slot.session)
                slot.session.setSelection(slot.session.view().capabilities?.selection);
            await pushStudio();
          } catch (error) {
            void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
          }
        });
        await capabilityWrite;
        return;
      }
      if (message.type === "refreshProviderCatalog") {
        void loadProviderCatalog(true);
        await pushStudio();
        return;
      }
      if (message.type === "configureProvider") {
        await vscode.commands.executeCommand("warband.configureProvider", message.id);
        await pushStudio();
        return;
      }
      if (message.type === "configureMcp") {
        await vscode.commands.executeCommand("warband.configureIntegrations", message.id);
        return;
      }
      if (message.type === "openCatalog") {
        await vscode.commands.executeCommand("warband.configureIntegrations");
        return;
      }
      if (message.type === "chooseProfile") {
        await vscode.commands.executeCommand("warband.chooseProfile");
        return;
      }
      if (message.type === "configureBurp" || message.type === "testBurp") {
        await vscode.commands.executeCommand(
          message.type === "configureBurp" ? "warband.configureBurp" : "warband.testBurp",
        );
        return;
      }
      if (message.type === "setLocale") {
        try {
          await writeMachineSetting("language", message.locale);
          broadcastLocale();
        } catch (error) {
          await panel.webview.postMessage(localeMessage());
          void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
        }
        return;
      }
      if (message.type === "setPalette") {
        try {
          await updatePalette(message.palette);
          await panel.webview.postMessage({ type: "palette", value: currentPalette() });
        } catch {
          await panel.webview.postMessage({ type: "palette", value: currentPalette() });
          await panel.webview.postMessage({ type: "paletteError" });
        }
        return;
      }
      if (message.type === "openReport") {
        await openReport(message.projectId);
        return;
      }
      if (message.type === "exportKillchain") {
        await exportMissionReport(message.projectId, true);
        return;
      }
      if (message.type === "exportAttackFlow") {
        await exportMissionReport(message.projectId, false, true);
        return;
      }
      if (message.type === "exportReport") {
        await exportMissionReport(message.projectId);
        return;
      }
      if (message.type === "setPathEdge") {
        await setPathFromPanel(panel, message);
        return;
      }
      if (message.type === "openEvidence") {
        await openEvidence(message.projectId, message.id);
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
      if (
        message.type === "renameProject" ||
        message.type === "deleteProject" ||
        message.type === "unlink"
      ) {
        const chatsBusy = () => [...slots.values()].some((slot) => slot.session?.view().busy);
        if (projectChanging || chatsBusy()) {
          await pushStudio({
            projectError: t("Arrêtez les tours en cours avant de modifier un projet."),
          });
          return;
        }
        projectChanging = true;
        let projectError: string | undefined;
        const generation = findingProjectGeneration;
        try {
          const projectId =
            message.type === "unlink"
              ? (await readProjectChoices(defaultConfigDir())).activeId
              : message.projectId;
          if (projectId) {
            const changed = await manageSelectedProject(
              defaultConfigDir(),
              projectId,
              message.type === "renameProject" ? "rename" : "remove",
              {
                busy: chatsBusy,
                isCurrent: () =>
                  studioPanel === panel &&
                  panel.visible &&
                  generation === findingProjectGeneration &&
                  vscode.workspace.isTrusted,
                rename: async (name) =>
                  vscode.window.showInputBox({
                    title: t`Renommer le projet ${PRODUCT_NAME}`,
                    value: name,
                    prompt: t(
                      "Le dossier, les conversations et les conteneurs gardent leur identité.",
                    ),
                    validateInput: (value) =>
                      !value.trim() || value.trim().length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)
                        ? t("Saisissez un nom de 1 à 80 caractères, sans caractères de contrôle.")
                        : undefined,
                  }),
                confirmRemove: async (name) => {
                  const action = t("Retirer le projet");
                  return (
                    (await vscode.window.showWarningMessage(
                      t`Retirer le projet « ${cleanText(name, 80)} » de ${PRODUCT_NAME} ?`,
                      {
                        modal: true,
                        detail: t(
                          "Le dossier, les conteneurs, les journaux, les trouvailles et les notes restent sur le disque. Aucun autre projet ne sera activé automatiquement.",
                        ),
                      },
                      action,
                    )) === action
                  );
                },
              },
            );
            if (changed) {
              cancelFindingDeletions();
              await Promise.all(
                [...slots.values()].map((slot) => slot.session?.refreshHistoryProjects()),
              );
              scheduleFindingsRefresh();
            }
          }
        } catch (error) {
          projectError = formatError(error, getUiLocale());
        } finally {
          projectChanging = false;
        }
        await pushStudio({ ...(projectError !== undefined ? { projectError } : {}) });
        if (cockpitPanel) await cockpitPanel.webview.postMessage(await loadCockpitView());
        return;
      }
      if (message.type === "activateProject" || message.type === "createProject") {
        const chatsBusy = () => [...slots.values()].some((slot) => slot.session?.view().busy);
        if (projectChanging || chatsBusy()) {
          await pushStudio({
            projectError: t("Arrêtez les tours en cours avant de changer de projet."),
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
              openLabel: t("Choisir le dossier du projet"),
              ...(folder !== undefined && { defaultUri: folder.uri }),
            });
            if (chosen?.[0] !== undefined) {
              if (chatsBusy())
                throw new Error(t("Arrêtez les tours en cours avant de créer le projet."));
              projectCreated = await createSelectedProject(
                defaultConfigDir(),
                message.name,
                chosen[0].fsPath,
              );
              await prepareMissionFolder(chosen[0].fsPath);
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
          projectError = formatError(error, getUiLocale());
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
            summaryError: t`Résumé non enregistré : ${formatError(error, getUiLocale())}`,
          });
        }
        return;
      }

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
      void vscode.window.showErrorMessage(formatError(error, getUiLocale()));
      return;
    }
    const items = containerMentions(view.containers);
    if (items.length === 0) {
      void vscode.window.showInformationMessage(t("Aucun conteneur Exegol."));
      return;
    }
    const choice = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: item.name,
        description: item.state === "running" ? t("en cours") : t("arrêté"),
        item,
      })),
      { title: t`${PRODUCT_NAME} : ouvrir un terminal`, ignoreFocusOut: true },
    );
    if (!choice) return;
    if (choice.item.state !== "running") {
      void vscode.window.showErrorMessage(t`Le conteneur ${choice.item.name} est arrêté.`);
      return;
    }
    const result = await openEditorShell(choice.item.name);
    if (result === "skip") {
      void vscode.window.showErrorMessage(t("Conteneur introuvable."));
    }
  };

  /**
   * Lanceur (Alt+J Alt+J, barre d'état) : toutes les fenêtres Venator Ops en un seul menu, et un terminal par
   * conteneur démarré, sans passer par la palette de commandes.
   */
  type LauncherItem = vscode.QuickPickItem & { run?: () => unknown };
  refreshLocaleTitles = () => {
    if (studioPanel) studioPanel.title = t`${PRODUCT_NAME} · Réglages`;
    if (reportPanel) reportPanel.title = t`${PRODUCT_NAME} · Rapport · Brouillon`;
    for (const watch of watches) watch.panel.title = t`${PRODUCT_NAME} · Sortie`;
    barLauncher.tooltip = t`${PRODUCT_NAME} : chat, terminaux, cockpit, réglages (Alt+J Alt+J)`;
    refreshBypassLocale();
    pushMonitor();
    updateModelStatus();
    void refreshContainerStatus();
  };

  const openLauncher = () => {
    const actions: LauncherItem[] = [
      {
        label: t("$(comment) Chat latéral"),
        description: "Alt+J C",
        run: () => vscode.commands.executeCommand("warband.chat.focus"),
      },
      {
        label: t("$(comment-discussion) Nouveau chat"),
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
      { label: t("$(settings-gear) Réglages"), description: "Alt+J S", run: () => openStudio() },
    ];
    const pick = vscode.window.createQuickPick<LauncherItem>();
    pick.title = PRODUCT_NAME;
    pick.placeholder = t("Ouvrir une fenêtre ou un terminal…");
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
                description: t("terminal · en cours"),
                run: () => openEditorShell(c.name),
              }
            : { label: `$(circle-slash) ${c.name}`, description: t("arrêté") },
        );
        pick.items = [
          ...actions,
          { label: t("Terminaux Exegol"), kind: vscode.QuickPickItemKind.Separator },
          ...(terminals.length > 0 ? terminals : [{ label: t("Aucun conteneur Exegol") }]),
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
        .catch((error: unknown) => out.appendLine(formatError(error, getUiLocale())));
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
    vscode.commands.registerCommand("warband.listProjectEvidence", () => listProjectEvidence()),
    vscode.commands.registerCommand("warband.captureEditorEvidence", () => captureEvidence(false)),
    vscode.commands.registerCommand("warband.captureTerminalEvidence", () => captureEvidence(true)),
    vscode.commands.registerCommand("warband.missionContext", async () => {
      const run = slots.get(activeId)?.session?.view().readonly
        ? undefined
        : observedRuns.get(activeId);
      if (!run) {
        void vscode.window.showInformationMessage(
          t("Aucune observation du run courant disponible."),
        );
        return;
      }
      await showObserved(
        "contexte-mission",
        JSON.stringify(
          {
            avertissement: t(
              "Le paquet au dernier tour ci-dessous est le contexte structuré effectivement ajouté à la consigne, déjà masqué. Les observations reçues depuis peuvent être plus récentes. Aucun compteur de tokens n’est mesuré ici.",
            ),
            limites: t(
              "Objectif limité à 8192 caractères ; 12 derniers résultats, 2048 caractères par aperçu. Aucun ancien journal ni autre projet n’est relu.",
            ),
            paquetAuDernierTour:
              injectedContexts.get(activeId)?.runId === run.runId
                ? JSON.parse(injectedContexts.get(activeId)?.text ?? "null")
                : null,
            configurationActuelle: {
              statut: t("Disponible à la consultation ; ne représente pas le prompt complet"),
              profil:
                machineValue(vscode.workspace.getConfiguration("warband").inspect("profile")) ?? "",
              projet: (await readProjectChoices(defaultConfigDir())).activeId,
              intégrations: projectIntegrations(
                machineValue(
                  vscode.workspace.getConfiguration("warband").inspect("integrationsByProject"),
                ) ?? {},
                (await readProjectChoices(defaultConfigDir())).activeId,
              ).map((c) => c.id),
            },
            ...run,
          },
          null,
          2,
        ),
      );
    }),
    vscode.commands.registerCommand("warband.openChat", () => openEditorChat()),
    vscode.commands.registerCommand("warband.openCockpit", () => openCockpit()),
    vscode.commands.registerCommand("warband.openWorkspace", async () => {
      if (await openActiveProjectWorkspace(defaultConfigDir(), projectWorkspaceHost, "selection"))
        return;
      await vscode.commands.executeCommand("vscode.setEditorLayout", {
        orientation: 1,
        groups: [{ size: 0.58 }, { size: 0.42 }],
      });
      openKillchain();
      openMonitor(vscode.ViewColumn.Two);
      await vscode.commands.executeCommand("warband.chat.focus");
      await context.workspaceState.update("warband.layoutOpened", true);
    }),
    vscode.commands.registerCommand("warband.prepareMission", async () => {
      try {
        if (!(await projectWorkspaceReady())) return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        await prepareMissionFolder(root);
        const choices = await readProjectChoices(defaultConfigDir());
        const current = choices.projects.find((p) => p.id === choices.activeId);
        const rows = await shellDocker().listLabelPrefix();
        const linked =
          (await readProjects(defaultConfigDir()))?.projects.find((p) => p.id === current?.id)
            ?.containers ?? [];
        const mappings = rows
          .filter((row) => linked.includes(row.name))
          .map((row) => `${row.name} : ${row.workspace ?? t("montage absent")} → /workspace`);
        await vscode.window.showInformationMessage(
          t`Dossier de mission : ${root}. ${mappings.join(" ; ") || t("Aucun montage lié vérifié : créez ou associez un conteneur avant de travailler.")}`,
        );
        await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
      } catch (error) {
        await vscode.window.showErrorMessage(formatError(error, getUiLocale()));
      }
    }),
    vscode.commands.registerCommand("warband.chooseProfile", () => {
      studioPage = "system";
      openStudio();
    }),
    vscode.commands.registerCommand(
      "warband.configureIntegrations",
      async (requestedId?: unknown) => {
        const config = vscode.workspace.getConfiguration("warband");
        const projectId = (await readProjectChoices(defaultConfigDir())).activeId;
        if (!projectId) {
          await vscode.window.showWarningMessage(
            t("Choisissez un projet avant de configurer ses services MCP."),
          );
          return;
        }
        const readMap = () =>
          integrationMap(machineValue(config.inspect("integrationsByProject")) ?? {});
        let parsed: ReturnType<typeof integrationMap>[string] = [];
        try {
          parsed = readMap()[projectId] ?? [];
        } catch (error) {
          await vscode.window.showErrorMessage(formatError(error, getUiLocale()));
          return;
        }
        const save = async (next: unknown) => {
          if ((await readProjectChoices(defaultConfigDir())).activeId !== projectId)
            throw Error(t("Le projet a changé pendant la configuration."));
          await config.update(
            "integrationsByProject",
            { ...readMap(), [projectId]: next },
            vscode.ConfigurationTarget.Global,
          );
        };
        if (!parsed) {
          await vscode.window.showErrorMessage(
            t(
              "Configuration des intégrations invalide. Corrigez le réglage utilisateur warband.integrationsByProject.",
            ),
          );
          return;
        }
        const chosen =
          typeof requestedId === "string" && MCP_CATALOG.some((e) => e.id === requestedId)
            ? { id: requestedId }
            : await vscode.window.showQuickPick(
                MCP_CATALOG.map((e) => ({
                  label: e.label,
                  description: `${e.profile} · ${parsed.some((p) => p.id === e.id) ? t("configuré") : t("non configuré")}`,
                  detail: e.description,
                  id: e.id,
                })),
                { title: t("Catalogue MCP — services externes locaux") },
              );
        if (!chosen) return;
        const entry = MCP_CATALOG.find((e) => e.id === chosen.id);
        if (!entry) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: t("Configurer le service local"), value: "configure" },
            { label: t("Tester le catalogue réel"), value: "test" },
            { label: t("Supprimer la configuration"), value: "remove" },
            { label: t("Voir le dépôt source"), value: "source" },
          ],
          { title: entry.label },
        );
        if (!action) return;
        if (action.value === "source") {
          await vscode.env.openExternal(vscode.Uri.parse(entry.source));
          return;
        }
        try {
          const existing = parsed.find((e) => e.id === entry.id);
          if (action.value === "remove") {
            await save(parsed.filter((e) => e.id !== entry.id));
          } else if (action.value === "test") {
            if (!existing)
              throw Error(
                t`Configurer le service avant le test. ${PRODUCT_NAME} n’installe ni ne démarre automatiquement le programme externe.`,
              );
            const result = await createIntegrationBackend(existing).list({});
            const count = (result as { tools?: unknown[] }).tools?.length ?? 0;
            await vscode.window.showInformationMessage(
              t`${entry.label} : ${count} outils annoncés. Aucun outil distant exécuté.`,
            );
          } else {
            const port = await vscode.window.showInputBox({
              title: t`${entry.label} — port local 127.0.0.1`,
              value: String(existing?.port ?? 9877),
              validateInput: (v) =>
                !/^\d{1,5}$/.test(v) || Number(v) < 1 || Number(v) > 65535
                  ? t("Port entre 1 et 65535")
                  : undefined,
            });
            if (port === undefined) return;
            const transport = await vscode.window.showQuickPick(["http", "sse"], {
              title: t("Transport du service déjà démarré"),
            });
            if (!transport) return;
            const path = await vscode.window.showInputBox({
              title: t("Chemin MCP local"),
              value: existing?.path ?? (transport === "http" ? "/mcp" : "/sse"),
              validateInput: (v) =>
                !/^\/[a-zA-Z0-9_/-]{0,120}$/.test(v) || v.includes("..") || v.startsWith("//")
                  ? t("Chemin local simple requis, sans URL ni paramètre")
                  : undefined,
            });
            if (path === undefined) return;
            const next = parseConfiguredIntegrations([
              ...parsed.filter((e) => e.id !== entry.id),
              { id: entry.id, port: Number(port), transport, path },
            ]);
            if (!next)
              throw Error(t("Configuration invalide : identifiants et ports distincts requis."));
            await save(next);
          }
        } catch (error) {
          await vscode.window.showErrorMessage(formatError(error, getUiLocale()));
        }
        await pushStudio();
      },
    ),
    vscode.commands.registerCommand("warband.openStudio", () => openStudio()),
    vscode.commands.registerCommand("warband.openTerminal", () => void pickContainerTerminal()),
    vscode.commands.registerCommand("warband.openMonitor", () => openMonitor()),
    vscode.commands.registerCommand("warband.openKillchain", () => openKillchain()),
    vscode.commands.registerCommand("warband.configureBurp", async () => {
      if ([...slots.values()].some((slot) => slot.session?.view().busy)) {
        await vscode.window.showWarningMessage(
          t("Arrêtez les tours en cours avant de configurer Burp."),
        );
        return;
      }
      const config = vscode.workspace.getConfiguration("warband");
      const enabled = machineValue(config.inspect("burp.enabled")) === true;
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: t("Activer ou configurer la connexion locale"),
            value: "enable",
            description: t("Extension MCP officielle requise dans Burp Suite"),
          },
          {
            label: t("Désactiver la connexion"),
            value: "disable",
            description: enabled
              ? t("Connexion actuellement activée")
              : t("Connexion déjà désactivée"),
          },
        ],
        { title: "Burp Suite MCP" },
      );
      if (!choice) return;
      try {
        if (choice.value === "disable") {
          await config.update("burp.enabled", false, vscode.ConfigurationTarget.Global);
          burpStatus = t("Connexion Burp désactivée.");
        } else {
          const port = await vscode.window.showInputBox({
            title: t("Port MCP Burp sur 127.0.0.1"),
            value: String(machineValue(config.inspect("burp.port")) ?? 9876),
            prompt: t`Port affiché dans l’onglet MCP de Burp. ${PRODUCT_NAME} ne lance pas Burp ni Java.`,
            validateInput: (value) =>
              !/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535
                ? t("Port entier entre 1 et 65535 requis.")
                : undefined,
          });
          if (port === undefined) return;
          const transport = await vscode.window.showQuickPick(
            [
              { label: t("SSE — serveur officiel"), value: "sse", description: "/sse" },
              {
                label: "Streamable HTTP",
                value: "http",
                description: t("/mcp, si proposé par votre serveur"),
              },
            ],
            { title: t("Transport MCP Burp") },
          );
          if (!transport) return;
          if ([...slots.values()].some((slot) => slot.session?.view().busy))
            throw new Error(t("Un tour a démarré. Arrêtez-le avant de modifier cette connexion."));
          await config.update("burp.enabled", false, vscode.ConfigurationTarget.Global);
          await config.update("burp.port", Number(port), vscode.ConfigurationTarget.Global);
          await config.update("burp.transport", transport.value, vscode.ConfigurationTarget.Global);
          await config.update("burp.enabled", true, vscode.ConfigurationTarget.Global);
          burpStatus = t(
            "Connexion configurée. Testez-la, puis envoyez une nouvelle consigne. Les tours suivants utilisent ces réglages.",
          );
        }
      } catch (error) {
        burpStatus = formatError(error, getUiLocale());
        await vscode.window.showErrorMessage(burpStatus);
      }
      if (!studioPanel && burpStatus) await vscode.window.showInformationMessage(burpStatus);
      await pushStudio();
    }),
    vscode.commands.registerCommand("warband.testBurp", async () => {
      try {
        const config = readSettings().burp;
        if (!config) {
          burpStatus = t("Connexion Burp désactivée : configurez-la avant le test.");
          await vscode.window.showInformationMessage(burpStatus);
        } else {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: t("Connexion au MCP Burp local…"),
              cancellable: true,
            },
            async (_, token) => {
              const abort = new AbortController();
              const subscription = token.onCancellationRequested(() => abort.abort());
              try {
                const list = burpToolSpecs(config, createBurpBackend(config)).find(
                  (tool) => tool.name === "list_tools",
                );
                if (!list) return;
                const result = JSON.parse(
                  await list.run(
                    {},
                    { parentId: null, correlation: undefined, signal: abort.signal },
                  ),
                );
                burpStatus = t`MCP Burp joignable : ${result.tools.length} outils dans cette page de catalogue. Aucun outil Burp exécuté, aucun appel au modèle.`;
                await vscode.window.showInformationMessage(burpStatus);
              } finally {
                subscription.dispose();
              }
            },
          );
        }
      } catch (error) {
        burpStatus = formatError(error, getUiLocale());
        await vscode.window.showErrorMessage(burpStatus);
      }
      await pushStudio();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("warband.chat") ||
        event.affectsConfiguration("warband.opencodeProviders")
      ) {
        for (const slot of slots.values())
          if (slot.session) slot.session.setSelection(slot.session.view().capabilities?.selection);
        void pushStudio();
      }
      if (event.affectsConfiguration("warband.integrationsByProject")) {
        for (const slot of slots.values()) if (slot.session?.view().busy) slot.session.stop();
        void pushStudio();
      }
      if (!event.affectsConfiguration("warband.burp")) return;
      if (
        machineValue(vscode.workspace.getConfiguration("warband").inspect("burp.enabled")) !== true
      )
        for (const slot of slots.values()) if (slot.session?.view().busy) slot.session.stop();
      burpStatus = t("Réglages modifiés. Les tours suivants utilisent la nouvelle connexion.");
      void pushStudio();
    }),
    vscode.commands.registerCommand("warband.choosePalette", async () => {
      const selected = await vscode.window.showQuickPick(
        PALETTES.map(([value, label, detail]) => ({ value, label, detail })),
        { title: t`Palette ${PRODUCT_NAME}` },
      );
      if (selected) await updatePalette(selected.value);
    }),
    vscode.commands.registerCommand("warband.exportKillchain", () =>
      exportMissionReport(undefined, true),
    ),
    vscode.commands.registerCommand("warband.previewReport", () => openReport()),
    vscode.commands.registerCommand("warband.exportReport", () => exportMissionReport()),
    vscode.commands.registerCommand("warband.exportAttackFlow", () =>
      exportMissionReport(undefined, false, true),
    ),
    vscode.commands.registerCommand("warband.focusChat", () =>
      vscode.commands.executeCommand("warband.chat.focus"),
    ),
    vscode.commands.registerCommand("warband.launcher", () => openLauncher()),
    vscode.commands.registerCommand("warband.configureProvider", async (requestedId?: unknown) => {
      if (typeof requestedId !== "string") return;
      if (
        providerChoices(readSettings(), false).some(
          (p) => p.id === requestedId && !p.id.startsWith("venator-"),
        )
      ) {
        await vscode.commands.executeCommand("warband.setToken", requestedId);
        return;
      }
      const existing = readSettings().opencodeProviders ?? {};
      if (requestedId !== "add" && !Object.hasOwn(existing, requestedId)) return;
      const kind =
        requestedId === "add"
          ? await vscode.window.showQuickPick(
              [
                { label: "Ollama", value: "ollama" },
                { label: t("Endpoint compatible OpenAI"), value: "compatible" },
              ],
              { title: t("Ajouter un fournisseur") },
            )
          : { value: "compatible" };
      if (!kind) return;
      const prior = existing[requestedId];
      const name = await vscode.window.showInputBox({
        title: t("Nom du fournisseur"),
        value: prior?.name ?? (kind.value === "ollama" ? "Ollama" : ""),
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim() && value.length <= 128 && !/[\p{Cc}]/u.test(value)
            ? undefined
            : t("Nom requis (128 caractères maximum)."),
      });
      if (name === undefined) return;
      const baseURL = await vscode.window.showInputBox({
        title: t("URL de l’API compatible OpenAI"),
        value:
          prior?.options.baseURL ?? (kind.value === "ollama" ? "http://127.0.0.1:11434/v1" : ""),
        ignoreFocusOut: true,
      });
      if (baseURL === undefined) return;
      const modelIds = await vscode.window.showInputBox({
        title: t("Identifiants des modèles, séparés par des virgules"),
        value: Object.keys(prior?.models ?? {}).join(", "),
        ignoreFocusOut: true,
      });
      if (modelIds === undefined) return;
      const id = prior
        ? requestedId
        : `venator-${name
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "-")
            .slice(0, 40)}`;
      if (!prior && Object.hasOwn(existing, id)) {
        void vscode.window.showErrorMessage(t("Ce nom de fournisseur existe déjà."));
        return;
      }
      const candidate = {
        ...existing,
        [id]: {
          name,
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL },
          models: Object.fromEntries(
            modelIds
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)
              .map((m) => [m, { name: m, tool_call: true }]),
          ),
        },
      };
      const parsed = parseOpencodeProviders(candidate);
      if (!parsed) {
        void vscode.window.showErrorMessage(
          t(
            "URL ou modèles invalides. Utilisez une URL HTTP(S) sans secret ni paramètre et au moins un modèle.",
          ),
        );
        return;
      }
      await vscode.workspace
        .getConfiguration("warband")
        .update("opencodeProviders", parsed, vscode.ConfigurationTarget.Global);
      const auth = await vscode.window.showQuickPick(
        [
          { label: t("Sans clé (local)"), value: false },
          { label: t("Configurer une clé API"), value: true },
        ],
        { title: t("Authentification du fournisseur") },
      );
      if (auth?.value) await vscode.commands.executeCommand("warband.setToken", id);
      await pushStudio();
    }),
    vscode.commands.registerCommand("warband.setToken", async (requestedId?: unknown) => {
      const entry =
        typeof requestedId === "string"
          ? providerChoices(readSettings(), false).find((p) => p.id === requestedId)
          : undefined;
      if (requestedId !== undefined && !entry) return;
      const provider = entry?.backend ?? slots.get(activeId)?.session?.getProvider() ?? "claude";
      if (provider !== "claude") {
        let kind: "subscription" | "api-key" | "auto" = "auto";
        if (provider === "openai") {
          const picked = await vscode.window.showQuickPick(
            [
              {
                label: t("Abonnement ChatGPT"),
                description: t("Connexion OAuth Codex via OpenCode"),
                value: "subscription" as const,
              },
              {
                label: t("Clé API OpenAI"),
                description: t("Stockage sécurisé de VS Code"),
                value: "api-key" as const,
              },
            ],
            { title: t("Connexion OpenAI"), ignoreFocusOut: true },
          );
          if (!picked) return;
          kind = picked.value;
          if (kind === "api-key") {
            const value = await vscode.window.showInputBox({
              title: t("Clé API OpenAI"),
              password: true,
              ignoreFocusOut: true,
              validateInput: (text) => (text.trim() ? undefined : t("La clé est vide.")),
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
        const providers = provider === "opencode" ? readSettings().opencodeProviders : undefined;
        const configHome = await mkdtemp(join(tmpdir(), "venator-opencode-login-"));
        let term: vscode.Terminal;
        try {
          term = vscode.window.createTerminal({
            name:
              provider === "openai"
                ? t`${PRODUCT_NAME} : connexion ChatGPT`
                : `${PRODUCT_NAME} : ${entry?.label ?? "AI"}`,
            shellPath: binary,
            shellArgs: [
              "auth",
              "login",
              ...(provider === "openai"
                ? ["--provider", "openai"]
                : entry?.runtimeId
                  ? ["--provider", entry.runtimeId]
                  : []),
            ],
            env: {
              OPENCODE_DISABLE_PROJECT_CONFIG: "1",
              OPENCODE_PURE: "1",
              OPENCODE_DISABLE_AUTOUPDATE: "1",
              OPENCODE_DISABLE_SHARE: "1",
              XDG_CONFIG_HOME: configHome,
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                plugin: [],
                share: "disabled",
                ...(providers && { provider: providers }),
              }),
              OPENCODE_CONFIG: null,
              OPENCODE_CONFIG_DIR: null,
              OPENCODE_AUTH_CONTENT: null,
              OPENAI_API_KEY: null,
            },
          });
        } catch (error) {
          await rm(configHome, { recursive: true, force: true });
          throw error;
        }
        const subscription = vscode.window.onDidCloseTerminal((closed) => {
          if (closed !== term) return;
          void rm(configHome, { recursive: true, force: true });
          subscription.dispose();
          applyAuthChange();
          void loadProviderCatalog(true);
        });
        context.subscriptions.push(subscription);
        term.show();
        applyAuthChange();
        void vscode.window.showInformationMessage(
          t(
            "Terminez la connexion dans le terminal, puis fermez-le ou actualisez la liste des modèles.",
          ),
        );
        return;
      }

      const kind = await vscode.window.showQuickPick(
        [
          {
            label: t("Jeton d'abonnement"),
            description: "claude setup-token",
            value: "subscription",
          },
          { label: t("Clé API"), description: "ANTHROPIC_API_KEY", value: "api-key" },
        ],
        { title: t`${PRODUCT_NAME} : type de jeton`, ignoreFocusOut: true },
      );
      if (!kind) return;
      const token = await vscode.window.showInputBox({
        title: t`${PRODUCT_NAME} : jeton`,
        prompt: t("Le jeton est stocké dans le stockage sécurisé de VS Code."),
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() === "" ? t("Le jeton est vide.") : undefined),
      });
      if (token === undefined) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      await context.secrets.store(TOKEN_KIND_KEY, kind.value as TokenKind);
      applyAuthChange();
      void vscode.window.showInformationMessage(t("Jeton enregistré et appliqué."));
    }),
    vscode.commands.registerCommand("warband.clearToken", async () => {
      const provider = slots.get(activeId)?.session?.getProvider() ?? "claude";
      if (provider === "openai") {
        await context.secrets.delete(OPENAI_TOKEN_KEY);
        await context.globalState.update(OPENAI_AUTH_MODE_KEY, undefined);
        applyAuthChange();
        void vscode.window.showInformationMessage(
          t`Connexion OpenAI désactivée dans ${PRODUCT_NAME}. Le cache OAuth d’OpenCode est conservé.`,
        );
        return;
      }
      if (provider === "opencode") {
        void vscode.window.showInformationMessage(
          t("La connexion OpenCode se gère dans son terminal avec opencode auth logout."),
        );
        return;
      }

      await context.secrets.delete(TOKEN_KEY);
      await context.secrets.delete(TOKEN_KIND_KEY);
      applyAuthChange();
      void vscode.window.showInformationMessage(
        t("Jeton effacé : le chat reste grisé tant qu'aucun fournisseur n'est ajouté."),
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
  barBypass.tooltip = t("Bypass des approbations actif : cliquer pour le désactiver");
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
        barBypass.text = t("BYPASS · en attente");
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
  refreshBypassLocale = () => {
    barBypass.tooltip = t("Bypass des approbations actif : cliquer pour le désactiver");
    renderBypass(bypass.snapshot());
  };
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
