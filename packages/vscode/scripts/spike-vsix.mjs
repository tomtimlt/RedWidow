// Spike E1 (ADR 0004) : bundle esbuild du moteur et de l'extension, copie du binaire
// natif du SDK pour UNE cible, empreinte SHA-256, puis `vsce package --target`.
// Usage : node scripts/spike-vsix.mjs [cible]   (défaut : win32-x64). Ne publie rien.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const target = process.argv[2] ?? "win32-x64";
const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const stage = join(pkgDir, ".vsix-stage");
const exeName = target.startsWith("win32") ? "claude.exe" : "claude";

// Binaire natif : paquet optionnel de la cible, résolu depuis le paquet agent-sdk.
// (le SDK n'exporte pas son package.json : on part du lien pnpm, les paquets optionnels sont ses voisins)
const sdkDir = realpathSync(
  join(pkgDir, "..", "agent-sdk", "node_modules", "@anthropic-ai", "claude-agent-sdk"),
);
const nativeExe = join(dirname(sdkDir), `claude-agent-sdk-${target}`, exeName);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "bin"), { recursive: true });

// Moteur : ESM (le SDK utilise import.meta) ; `require` fourni pour les dépendances CJS embarquées.
await build({
  entryPoints: [join(pkgDir, "src/engine/diagnostic.ts")],
  outfile: join(stage, "engine.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
await build({
  entryPoints: [join(pkgDir, "src/extension/extension.ts")],
  outfile: join(stage, "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  logLevel: "warning",
});

copyFileSync(nativeExe, join(stage, "bin", exeName));
const sha = createHash("sha256").update(readFileSync(nativeExe)).digest("hex");
writeFileSync(join(stage, "bin", "claude.sha256"), `${sha}\n`);

writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "john-studio-spike",
      displayName: "john-studio (spike)",
      description: "Spike d'empaquetage (ADR 0004, E1).",
      version: "0.0.1",
      publisher: "john-studio",
      engines: { vscode: "^1.90.0" },
      main: "./extension.cjs",
      extensionKind: ["workspace"],
      activationEvents: ["onCommand:john.diagnostic"],
      capabilities: { untrustedWorkspaces: { supported: false }, virtualWorkspaces: false },
      contributes: { commands: [{ command: "john.diagnostic", title: "john : diagnostic" }] },
    },
    null,
    2,
  ),
);
writeFileSync(join(stage, "README.md"), "Spike d'empaquetage john-studio. Ne pas diffuser.\n");

const out = join(pkgDir, `john-studio-spike-${target}.vsix`);
const vsce = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
execFileSync(
  process.execPath,
  [
    vsce,
    "package",
    "--target",
    target,
    "--no-dependencies",
    "--allow-missing-repository",
    "--skip-license",
    "--out",
    out,
  ],
  { cwd: stage, stdio: "inherit" },
);

const mib = (n) => (n / 1048576).toFixed(1);
console.log(`cible ${target} ; binaire ${mib(statSync(nativeExe).size)} Mio ; sha256 ${sha}`);
console.log(`vsix ${out} : ${mib(statSync(out).size)} Mio`);
