// Compilation déterministe du même catalogue pour les webviews, sans ressource distante.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("packages/vscode/package.json", root));
const { build } = require("esbuild");
const output = new URL("packages/vscode/media/i18n.js", root);
const result = await build({
  entryPoints: [fileURLToPath(new URL("packages/vscode/src/webview/i18n.ts", root))],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome122",
  write: false,
  charset: "utf8",
});
// Le fichier généré doit rester identique après le formatage du dépôt.
const text = execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("node_modules/@biomejs/biome/bin/biome", root)),
    "format",
    "--stdin-file-path",
    fileURLToPath(output),
  ],
  { cwd: fileURLToPath(root), input: result.outputFiles[0].text, encoding: "utf8" },
);
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8").catch(() => "")) !== text) {
    console.error("Catalogue webview désynchronisé : node scripts/sync-ui-i18n.mjs");
    process.exitCode = 1;
  }
} else await writeFile(output, text, "utf8");
