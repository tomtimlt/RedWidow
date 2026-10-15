import { fork } from "node:child_process";
import { join } from "node:path";
import { formatError } from "@john-studio/messages";
import * as vscode from "vscode";
import { parseWebviewMessage } from "../logic/approval.js";
import { chatHtml, makeNonce } from "../logic/html.js";
import { type ChatSession, createChatSession, type TokenChoice } from "../logic/session.js";
import { machineValue, resolveSettings } from "../logic/settings.js";

const TOKEN_KEY = "john.token";
const TOKEN_KIND_KEY = "john.tokenKind";
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
      ...(typeof __SDK_VERSION__ === "string" && { sdkVersion: __SDK_VERSION__ }),
      confirmAlways: async (text) =>
        (await vscode.window.showWarningMessage(text, { modal: true }, "Toujours autoriser")) ===
        "Toujours autoriser",
      onView: (view) => post({ type: "view", view }),
      onLog: (text) => out.append(text),
    });
    return session;
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
        styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css")).toString(),
      });
      post = (message) => void view.webview.postMessage(message);
      view.webview.onDidReceiveMessage(async (raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (message === null) return;
        try {
          const s = getSession();
          switch (message.type) {
            case "ready":
              post({ type: "view", view: s.view() });
              return await s.loadModels();
            case "setModel":
              return s.setModel(message.model);
            case "setEffort":
              return s.setEffort(message.effort);
            case "refreshModels":
              return await s.loadModels(true);
            case "send":
              return await s.send(message.text);
            case "stop":
              return s.stop();
            case "reset":
              return s.reset();
            case "approve":
              return await s.approve(message.toolUseId, message.choice);
          }
        } catch (error) {
          void vscode.window.showErrorMessage(formatError(error));
        }
      });
      view.onDidDispose(() => {
        post = () => {};
      });
    },
  };

  context.subscriptions.push(
    { dispose: () => session?.dispose() },
    vscode.window.registerWebviewViewProvider("john.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("john.openChat", () =>
      vscode.commands.executeCommand("john.chat.focus"),
    ),
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
}

export function deactivate(): void {}
