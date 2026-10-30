// Livraison locale sans GitHub : contrôles, VSIX, empreintes et sources exactes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  readFileSync(join(root, "packages/vscode/extension.manifest.json")),
).version;
const output = resolve(process.argv[2] ?? join(root, "..", "work", `warband-release-${version}`));
const pnpm = process.env.npm_execpath;
if (!pnpm?.includes("pnpm")) throw new Error("Lancer avec pnpm release:local [dossier].");
mkdirSync(output, { recursive: true });
const run = (...args) =>
  execFileSync(process.execPath, [pnpm, ...args], { cwd: root, stdio: "inherit" });
run("check");
run("build");
for (const target of ["linux-x64", "win32-x64"]) {
  run("--filter", "@warband/vscode", "package", target);
  const name = `warband-${version}-${target}.vsix`;
  const file = join(output, name);
  copyFileSync(join(root, "packages/vscode", name), file);
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(`${file}.sha256`, `${sha256}  ${name}\n`);
}
// Les fichiers non suivis appartiennent aussi aux sources compilées de la branche locale.
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
);
execFileSync(
  "tar",
  ["-czf", join(output, `warband-${version}-sources.tar.gz`), "--null", "-T", "-"],
  { cwd: root, input: paths },
);
copyFileSync(join(root, "docs", `livraison-${version}.md`), join(output, "LIRE-MOI.md"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
writeFileSync(
  join(output, "provenance.json"),
  `${JSON.stringify({ version, branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), baseCommit: head, sources: `warband-${version}-sources.tar.gz`, builtAt: new Date().toISOString(), node: process.version, pnpm: JSON.parse(readFileSync(join(dirname(pnpm), "..", "package.json"))).version }, null, 2)}\n`,
);
console.log(`Livraison locale prête : ${output}`);
