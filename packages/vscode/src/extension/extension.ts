import { fork } from "node:child_process";
import { join } from "node:path";
import {
  CodedError,
  defaultConfigDir,
  parseMentions,
  parseSlashStart,
  readFindings,
  readProject,
  resolveBinary,
  unlink,
} from "@john-studio/core";
import { formatError } from "@john-studio/messages";
import * as vscode from "vscode";
import {
  LAYOUT_LABELS,
  type Layout,
  nextLayout,
  parseWebviewMessage,
  readLayout,
} from "../logic/approval.js";
import { type BypassPush, createBypassHost, formatRemaining } from "../logic/bypass.js";
import {
  linkContainer,
  linkedProjectStatus,
  loadCockpitView,
  parseCockpitMessage,
  terminalLaunch,
} from "../logic/cockpit.js";
import { createJournalFiles } from "../logic/historyStore.js";
import { chatHtml, cockpitHtml, makeNonce, studioHtml, terminalHtml } from "../logic/html.js";
import { type ChatSession, createChatSession, type TokenChoice } from "../logic/session.js";
import { machineValue, resolveSettings } from "../logic/settings.js";
import { parseStudioMessage, type StudioPage } from "../logic/studio.js";
import { parseTerminalMessage } from "../logic/terminal.js";

const TOKEN_KEY = "john.token";
const TOKEN_KIND_KEY = "john.tokenKind";
// Disposition de la fenêtre, mémorisée par espace de travail (`workspaceState`, pas un réglage).
const LAYOUT_KEY = "john.layout";
// Version du SDK embarquée par le paquetage (clé du cache des modèles) ; absente en développement.
declare const __SDK_VERSION__: string | undefined;
type TokenKind = "subscription" | "api-key";

/** Couche fine : seule autorisée à importer `vscode` (test de frontière). Toute la logique est dans `src/logic`. */
export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("john-studio");
  context.subscriptions.push(out);

  // Défense en profondeur : `capabilities.untrustedWorkspaces` empêche déjà l'activation.
  if (!vscode.workspace.isTrusted) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  let session: ChatSession | undefined;
  let post: (message: unknown) => void = () => {};
  // Disposition (lot P4) : `editor` = chat dans la Side Bar ; `chat`/`monitor` = panneau `john.stage`.
  // Une seule surface rend la conversation : en `chat`/`monitor`, la Side Bar est « ouverte dans l'éditeur ».
  let layout: Layout = readLayout(context.workspaceState.get(LAYOUT_KEY));
  let stagePanel: vscode.WebviewPanel | undefined;
  type Surface = "sidebar" | "stage";
  const surfaceMessage = (surface: Surface) => ({
    type: "surface",
    layout,
    active: surface === "sidebar" ? layout === "editor" : layout !== "editor",
  });

  const getToken = async (): Promise<TokenChoice | undefined> => {
    const value = await context.secrets.get(TOKEN_KEY);
    if (!value) return undefined;
    return (await context.secrets.get(TOKEN_KIND_KEY)) === "api-key"
      ? { auth: { name: "ANTHROPIC_API_KEY", value }, mode: "api-key" }
      : { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value }, mode: "subscription" };
  };

  // Réglages sensibles : valeur utilisateur/machine ou défaut, jamais celle de l'espace de travail.
  const readSettings = () => {
    const config = vscode.workspace.getConfiguration("john");
    return resolveSettings((key) => machineValue(config.inspect(key)));
  };

  const getSession = (): ChatSession => {
    if (session) return session;
    if (!folder) throw new Error("Ouvrez un dossier avant de lancer John.");
    session = createChatSession({
      cwd: folder.uri.fsPath,
      enginePath: join(context.extensionPath, "run-engine.mjs"),
      engineArgs: [context.extensionPath],
      readSettings,
      getToken,
      store: {
        get: (key: string) => context.globalState.get(key),
        set: (key: string, value: unknown) => context.globalState.update(key, value),
      },
      // Journaux hors du dépôt : stockage de l'extension (par espace de travail), jamais `.john-studio/runs`.
      history: {
        index: {
          get: (key: string) => context.workspaceState.get(key),
          set: (key: string, value: unknown) => context.workspaceState.update(key, value),
        },
        files: createJournalFiles(
          join((context.storageUri ?? context.globalStorageUri).fsPath, "runs"),
        ),
        confirmDelete: async (text) =>
          (await vscode.window.showWarningMessage(text, { modal: true }, "Supprimer")) ===
          "Supprimer",
      },
      ...(typeof __SDK_VERSION__ === "string" && { sdkVersion: __SDK_VERSION__ }),
      confirmAlways: async (text) =>
        (await vscode.window.showWarningMessage(text, { modal: true }, "Toujours autoriser")) ===
        "Toujours autoriser",
      onView: (view) => {
        post({ type: "view", view });
        void stagePanel?.webview.postMessage({ type: "view", view });
        // Le terminal latéral reçoit la même vue (aucun message vers le moteur).
        void terminalPanel?.webview.postMessage({ type: "view", view });
        updateModelStatus();
      },
      onLog: (text) => out.append(text),
    });
    return session;
  };

  /**
   * Lance `exegol start <nom>` dans un terminal VS Code (chemin de `/start`, réutilisé par le terminal
   * latéral). Un terminal de même nom est seulement montré.
   */
  const startContainerTerminal = (slash: string) => {
    const exegol = resolveBinary("exegol");
    if (exegol === null) {
      void vscode.window.showErrorMessage(
        formatError(new CodedError("process.notFound", { binary: "exegol" })),
      );
      return;
    }
    const title = `John : start ${slash}`;
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

  /**
   * Ouvre un shell dans le conteneur lié, s'il tourne (chemin du cockpit, partagé avec le terminal
   * latéral). Un terminal de même nom est seulement montré.
   */
  const openLinkedShell = async () => {
    const st = await linkedProjectStatus();
    if (st === null || st.state !== "running") return;
    const { shellPath, shellArgs } = terminalLaunch(st.container);
    const title = `John : ${st.container}`;
    const existing = vscode.window.terminals.find((t) => t.name === title);
    if (existing) {
      existing.show();
      return;
    }
    const term = vscode.window.createTerminal({
      name: title,
      shellPath,
      shellArgs: [...shellArgs],
    });
    term.show();
  };

  /**
   * Messages de la webview de chat, venue de la Side Bar ou du panneau `john.stage` : même
   * traitement. `reply` répond à la surface émettrice (état initial au `ready`).
   */
  const handleChatMessage = async (
    raw: unknown,
    surface: Surface,
    reply: (message: unknown) => void,
    visible: () => boolean,
  ) => {
    const message = parseWebviewMessage(raw);
    if (message === null) return;
    try {
      // La disposition ne dépend pas de la session : traitée avant `getSession`.
      if (message.type === "setLayout") return await setLayout(message.layout);
      // Bypass (ADR 0006) : hôte seul, avant `getSession`. `enabled: true` refusé si la vue est cachée.
      if (message.type === "setBypass") {
        bypass.request(message.enabled, visible());
        return;
      }
      const s = getSession();
      switch (message.type) {
        case "ready":
          reply(surfaceMessage(surface));
          reply(bypass.snapshot());
          reply({ type: "view", view: s.view() });
          return await s.loadModels();
        case "setModel":
          return s.setModel(message.model);
        case "setEffort":
          return s.setEffort(message.effort);
        case "refreshModels":
          return await s.loadModels(true);
        case "send": {
          const slash = parseSlashStart(message.text);
          if (slash !== null) {
            startContainerTerminal(slash);
            return;
          }
          const mentions = parseMentions(message.text);
          let dedicatedName: string | null = null;
          try {
            dedicatedName = (await readProject(defaultConfigDir()))?.container ?? null;
          } catch {
            dedicatedName = null;
          }
          if (mentions.length === 0 && dedicatedName === null) {
            void vscode.window.showErrorMessage(
              "Lance un conteneur avec /start <nom>, ou cite-le avec @nom.",
            );
            return;
          }
          const workName = mentions[0] ?? dedicatedName;
          await s.send(message.text);
          if (workName) showExecTerminal(workName);
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

  const cockpitProvider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      const media = vscode.Uri.joinPath(context.extensionUri, "media");
      view.webview.options = {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [media],
      };
      const nonce = makeNonce();
      view.webview.html = cockpitHtml({
        nonce,
        cspSource: view.webview.cspSource,
        scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "cockpit.js")).toString(),
        styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
      });
      const postCockpit: (message: unknown) => void = (message) =>
        void view.webview.postMessage(message);

      const pushView = async (loading = false) => {
        if (loading) postCockpit({ type: "view", loading: true });
        try {
          const payload = await loadCockpitView();
          postCockpit(payload);
          void refreshContainerStatus();
          if (payload.projectInvalid) {
            void vscode.window.showErrorMessage(
              "Projet invalide : fichier project.json illisible ou incomplet.",
            );
          }
        } catch (error) {
          void vscode.window.showErrorMessage(formatError(error));
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
              await openLinkedShell();
              return;
            }
          }
        } catch (error) {
          void vscode.window.showErrorMessage(formatError(error));
          await pushView(true);
        }
      });

      view.onDidChangeVisibility(() => {
        if (view.visible) void pushView(true);
      });
    },
  };

  const showExecTerminal = (name: string) => {
    try {
      const { shellPath, shellArgs } = terminalLaunch(name);
      const title = `John : ${name}`;
      const existing = vscode.window.terminals.find((t) => t.name === title);
      if (existing) {
        existing.show();
        return;
      }
      const term = vscode.window.createTerminal({
        name: title,
        shellPath,
        shellArgs: [...shellArgs],
        location: vscode.TerminalLocation.Editor,
      });
      term.show();
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
    }
  };

  /** Panneau `john.stage` (chat ou Monitor, `ViewColumn.One`) : singleton, patron du panneau des réglages. */
  const openStage = () => {
    if (stagePanel) {
      stagePanel.reveal(vscode.ViewColumn.One);
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("john.stage", "John", vscode.ViewColumn.One, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
    });
    stagePanel = panel;
    const nonce = makeNonce();
    panel.webview.html = chatHtml({
      nonce,
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js")).toString(),
      uiUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "ui.js")).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
    });
    panel.onDidDispose(() => {
      stagePanel = undefined;
      // Fermer le panneau ramène à `editor` : la Side Bar redevient la surface active.
      if (layout !== "editor") void setLayout("editor");
    });
    panel.webview.onDidReceiveMessage((raw: unknown) =>
      handleChatMessage(
        raw,
        "stage",
        (message) => void panel.webview.postMessage(message),
        () => panel.visible,
      ),
    );
  };

  /** Envoie à chaque surface son mode (`active` : elle seule rend la conversation). */
  const postSurfaces = () => {
    post(surfaceMessage("sidebar"));
    void stagePanel?.webview.postMessage(surfaceMessage("stage"));
  };

  /** Change et mémorise la disposition ; `editor` ferme le panneau `john.stage`. */
  const setLayout = async (next: Layout) => {
    layout = next;
    await context.workspaceState.update(LAYOUT_KEY, next);
    if (next === "editor") stagePanel?.dispose();
    else openStage();
    postSurfaces();
    updateLayoutStatus();
  };

  // Barre d'état : conteneur lié (nom seul, « connecté » si le cockpit l'établit), disposition
  // (clic = disposition suivante), modèle courant. Pas de mode, de contexte ni de bypass (pas de donnée).
  const barContainer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  const barLayout = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  const barModel = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  barLayout.command = "john.cycleLayout";
  barLayout.tooltip = "Disposition de John : cliquer pour passer à la suivante";
  context.subscriptions.push(barContainer, barLayout, barModel);
  const updateLayoutStatus = () => {
    barLayout.text = `John : ${LAYOUT_LABELS[layout]}`;
    barLayout.show();
  };
  const updateModelStatus = () => {
    const c = session?.view().controls ?? null;
    if (c === null) {
      barModel.hide();
      return;
    }
    const known = c.models?.find((m) => m.value === c.model);
    barModel.text = `Modèle : ${c.model === null ? "par défaut" : (known?.label ?? c.model)}`;
    barModel.tooltip = "Modèle utilisé pour le message suivant";
    barModel.show();
  };
  const refreshContainerStatus = async () => {
    let st: Awaited<ReturnType<typeof linkedProjectStatus>> = null;
    try {
      st = await linkedProjectStatus();
    } catch {
      st = null;
    }
    if (st === null) {
      barContainer.hide();
      return;
    }
    barContainer.text =
      st.state === "running" ? `Exegol : ${st.container} · connecté` : `Exegol : ${st.container}`;
    barContainer.tooltip = `Conteneur lié : ${st.container}`;
    barContainer.show();
  };

  let studioPanel: vscode.WebviewPanel | undefined;
  let studioPage: StudioPage = "project";
  const pushStudio = async () => {
    if (!studioPanel) return;
    const cockpit = await loadCockpitView();
    let findings: unknown[] = [];
    try {
      findings = await readFindings(defaultConfigDir());
    } catch {
      findings = [];
    }
    await studioPanel.webview.postMessage({ ...cockpit, page: studioPage, findings });
  };
  const openStudio = () => {
    if (studioPanel) {
      studioPanel.reveal(vscode.ViewColumn.Beside);
      void pushStudio();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    studioPanel = vscode.window.createWebviewPanel(
      "john.studio",
      "Réglages",
      vscode.ViewColumn.Beside,
      { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] },
    );
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
    });
    studioPanel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseStudioMessage(raw);
      if (message === null) return;
      if (message.type === "open") studioPage = message.page;
      if (message.type === "unlink") await unlink(defaultConfigDir());
      await pushStudio();
    });
    void pushStudio();
  };

  // Terminal latéral (panneau éditeur singleton, comme les réglages) : onglet agent = vue du chat ;
  // onglet shell désactivé, son bouton ouvre le shell du conteneur lié (comme le cockpit).
  let terminalPanel: vscode.WebviewPanel | undefined;
  let terminalContainer: string | null = null;
  const pushTerminal = async () => {
    const panel = terminalPanel;
    if (!panel) return;
    await panel.webview.postMessage({ type: "context", container: terminalContainer });
    if (session) await panel.webview.postMessage({ type: "view", view: session.view() });
  };
  const openTerminal = async () => {
    if (terminalPanel) {
      terminalPanel.reveal(vscode.ViewColumn.Beside);
      await pushTerminal();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "john.terminal",
      "Terminal",
      vscode.ViewColumn.Beside,
      { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] },
    );
    terminalPanel = panel;
    const nonce = makeNonce();
    panel.webview.html = terminalHtml({
      nonce,
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "terminal.js")).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "terminal.css")).toString(),
    });
    panel.onDidDispose(() => {
      terminalPanel = undefined;
    });
    panel.webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = parseTerminalMessage(raw);
      if (message === null) return;
      try {
        // Ouverture du shell : même chemin que le bouton « Terminal » du cockpit.
        await openLinkedShell();
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    });
    try {
      const st = await linkedProjectStatus();
      terminalContainer = st?.container ?? null;
    } catch {
      terminalContainer = null;
    }
    await pushTerminal();
  };

  context.subscriptions.push(
    { dispose: () => session?.dispose() },
    vscode.window.registerWebviewViewProvider("john.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("john.cockpit", cockpitProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("john.openChat", () =>
      vscode.commands.executeCommand("john.chat.focus"),
    ),
    vscode.commands.registerCommand("john.openCockpit", () =>
      vscode.commands.executeCommand("john.cockpit.focus"),
    ),
    vscode.commands.registerCommand("john.openStudio", () => openStudio()),
    vscode.commands.registerCommand("john.openTerminal", () => openTerminal()),
    vscode.commands.registerCommand("john.cycleLayout", () => setLayout(nextLayout(layout))),
    vscode.commands.registerCommand("john.setToken", async () => {
      const kind = await vscode.window.showQuickPick(
        [
          { label: "Jeton d'abonnement", description: "claude setup-token", value: "subscription" },
          { label: "Clé API", description: "ANTHROPIC_API_KEY", value: "api-key" },
        ],
        { title: "John : type de jeton", ignoreFocusOut: true },
      );
      if (!kind) return;
      const token = await vscode.window.showInputBox({
        title: "John : jeton",
        prompt: "Le jeton est stocké dans le stockage sécurisé de VS Code.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() === "" ? "Le jeton est vide." : undefined),
      });
      if (token === undefined) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      await context.secrets.store(TOKEN_KIND_KEY, kind.value as TokenKind);
      void vscode.window.showInformationMessage(
        "Jeton enregistré. Il sera utilisé au prochain démarrage du moteur.",
      );
    }),
    vscode.commands.registerCommand("john.clearToken", async () => {
      await context.secrets.delete(TOKEN_KEY);
      await context.secrets.delete(TOKEN_KIND_KEY);
      void vscode.window.showInformationMessage("Jeton effacé.");
    }),
    // Spike E1 : forke le moteur de diagnostic (vérifie l'empreinte du binaire et affiche sa version).
    vscode.commands.registerCommand("john.diagnostic", () => {
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
  barBypass.command = "john.disableBypass";
  barBypass.tooltip = "Bypass des approbations actif : cliquer pour le désactiver";
  context.subscriptions.push(barBypass);
  let bypassTick: ReturnType<typeof setInterval> | undefined;
  const renderBypass = (push: BypassPush) => {
    if (bypassTick !== undefined) {
      clearInterval(bypassTick);
      bypassTick = undefined;
    }
    if (!push.on) {
      barBypass.hide();
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
      void stagePanel?.webview.postMessage(push);
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
    vscode.commands.registerCommand("john.disableBypass", () => bypass.request(false, true)),
  );

  updateLayoutStatus();
  updateModelStatus();
  void refreshContainerStatus();
  // Disposition mémorisée (`chat`/`monitor`) : le panneau de conversation est rouvert.
  if (layout !== "editor") openStage();
}

export function deactivate(): void {}
