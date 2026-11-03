// Compilation déterministe du même catalogue pour les webviews, sans ressource distante.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// Fichier temporaire : le wrapper natif de Biome n’hérite pas d’un pipe stdin imbriqué.
const temporary = await mkdtemp(join(tmpdir(), "venator-i18n-"));
let text;
try {
  const input = join(temporary, "i18n.js");
  await writeFile(input, result.outputFiles[0].text, "utf8");
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("node_modules/@biomejs/biome/bin/biome", root)),
      "format",
      "--write",
      "--config-path",
      fileURLToPath(new URL("biome.json", root)),
      input,
    ],
    { cwd: fileURLToPath(root), timeout: 15000, stdio: ["ignore", "pipe", "pipe"] },
  );
  text = await readFile(input, "utf8");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8").catch(() => "")) !== text) {
    console.error("Catalogue webview désynchronisé : node scripts/sync-ui-i18n.mjs");
    process.exitCode = 1;
  }
} else await writeFile(output, text, "utf8");
