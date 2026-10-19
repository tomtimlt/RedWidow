#!/usr/bin/env node
// Met le poste à jour d'un coup : git pull, pnpm install, build, empaquetage du .vsix, installation.
// Usage : node scripts/update.mjs [--check] [--no-install] [--dry-run] [--target=win32-x64]
//   --check       lance aussi `pnpm check` avant l'empaquetage
//   --no-install  construit le .vsix sans l'installer dans VS Code
//   --dry-run     affiche les étapes sans rien exécuter
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const flags = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--target=")));
const known = new Set(["--check", "--no-install", "--dry-run"]);
const unknown = [...flags].filter((f) => !known.has(f));
if (unknown.length > 0) {
  console.error(`update : option inconnue « ${unknown[0]} »`);
  process.exit(2);
}
const target = process.argv.find((a) => a.startsWith("--target="))?.slice(9) ?? "win32-x64";
const dryRun = flags.has("--dry-run");

const root = fileURLToPath(new URL("..", import.meta.url));
const vscodeDir = join(root, "packages", "vscode");

// `shell: true` sous Windows : pnpm et code sont des `.cmd`. Arguments fixes, jamais externes.
const shell = process.platform === "win32";

function run(label, command, args, cwd = root) {
  console.log(`\n▶ ${label} : ${command} ${args.join(" ")}`);
  if (dryRun) return;
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell });
  if (result.status !== 0) {
    console.error(`\n✖ Échec à l'étape « ${label} » (code ${result.status ?? "?"}).`);
    process.exit(result.status ?? 1);
  }
}

function newestVsix() {
  const files = readdirSync(vscodeDir)
    .filter((f) => f.endsWith(`-${target}.vsix`))
    .map((f) => ({ f, t: statSync(join(vscodeDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? join(vscodeDir, files[0].f) : null;
}

run("Récupération", "git", ["pull", "--ff-only"]);
run("Dépendances", "pnpm", ["install", "--frozen-lockfile"]);
run("Build", "pnpm", ["build"]);
if (flags.has("--check")) run("Vérification", "pnpm", ["check"]);
run("Empaquetage", "pnpm", ["--filter", "@warband/vscode", "package", target]);

if (flags.has("--no-install")) {
  console.log("\n✔ Terminé (installation sautée).");
  process.exit(0);
}

const vsix = dryRun ? join(vscodeDir, `warband-<version>-${target}.vsix`) : newestVsix();
if (vsix === null) {
  console.error(`\n✖ Aucun .vsix ${target} trouvé dans ${vscodeDir}.`);
  process.exit(1);
}
run("Installation", "code", ["--install-extension", vsix, "--force"]);
console.log(
  "\n✔ Terminé. Recharge la fenêtre VS Code (Ctrl+Maj+P → « Developer: Reload Window »).",
);
