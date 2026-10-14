import { fork } from "node:child_process";
import { join } from "node:path";
import * as vscode from "vscode";

/** Spike : la commande « john : diagnostic » forke le moteur, qui vérifie le binaire et affiche sa version. */
export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("john-studio");
  context.subscriptions.push(
    out,
    vscode.commands.registerCommand("john.diagnostic", () => {
      const root = context.extensionPath;
      const child = fork(join(root, "engine.mjs"), [root], {
        // Environnement minimal : le moteur n'a besoin que du mode « Node » d'Electron.
        env: { ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      child.stdout?.on("data", (d: Buffer) => out.append(d.toString()));
      child.stderr?.on("data", (d: Buffer) => out.append(d.toString()));
      child.on("exit", (code) => out.appendLine(`moteur terminé (code ${code})`));
      out.show();
    }),
  );
}

export function deactivate(): void {}
