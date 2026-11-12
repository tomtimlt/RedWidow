// Bundle du moteur pour l'hôte web (ADR 0052, point 1). Le moteur refuse de lancer un agent dont
// l'empreinte n'est pas embarquée (`__CLAUDE_SHA256__`, `__OPENCODE_SHA256__`, fail-closed) : le build
// `tsc` ne peut donc pas servir tel quel. Ce script bundle avec esbuild exactement comme
// `packages/vscode/scripts/package-vsix.mjs` (mêmes options et mêmes `define`), sans le modifier.
// Usage : node scripts/bundle-engine.mjs [cible]   (linux-x64, win32-x64, darwin-arm64, darwin-x64 ; défaut : plateforme courante)
// Sortie : packages/server/engine/{run-engine.mjs,bin/}. Ensuite :
//   REDWIDOW_ENGINE=<sortie>/run-engine.mjs  REDWIDOW_BIN_ROOT=<sortie>
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const vscodeDir = join(serverDir, "..", "vscode");
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (!["linux-x64", "win32-x64", "darwin-arm64", "darwin-x64"].includes(target)) {
  throw new Error(`Cible non prise en charge : ${target}`);
}
// esbuild est une dépendance de développement du paquet vscode : on la résout depuis lui.
const { build } = await import(
  pathToFileURL(createRequire(join(vscodeDir, "package.json")).resolve("esbuild")).href
);
const outDir = join(serverDir, "engine");

const opencodeVersion = "1.19.0";
const opencodeExeName = target === "win32-x64" ? "opencode.exe" : "opencode";
const opencodePackage = {
  "win32-x64": "opencode-windows-x64-baseline",
  "linux-x64": "opencode-linux-x64-baseline",
  "darwin-arm64": "opencode-darwin-arm64",
  "darwin-x64": "opencode-darwin-x64-baseline",
}[target];
const opencodeDir = dirname(
  createRequire(join(vscodeDir, "package.json")).resolve(`${opencodePackage}/package.json`),
);
const opencodeExe = join(opencodeDir, "bin", opencodeExeName);
if (
  JSON.parse(readFileSync(join(opencodeDir, "package.json"), "utf8")).version !== opencodeVersion
) {
  throw new Error(`Version inattendue du paquet ${opencodePackage}`);
}
const opencodeSha = createHash("sha256").update(readFileSync(opencodeExe)).digest("hex");
const opencodeDefines = {
  __OPENCODE_SHA256__: JSON.stringify(opencodeSha),
  __OPENCODE_VERSION__: JSON.stringify(opencodeVersion),
};
const exeName = target.startsWith("win32") ? "claude.exe" : "claude";
const sdkDir = realpathSync(
  join(vscodeDir, "..", "agent-sdk", "node_modules", "@anthropic-ai", "claude-agent-sdk"),
);
const nativeExe = join(dirname(sdkDir), `claude-agent-sdk-${target}`, exeName);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "bin"), { recursive: true });

// Moteur de production : l'empreinte du binaire est embarquée par `define`, pas lue sur disque.
await build({
  entryPoints: [join(vscodeDir, "src/engine/main.ts")],
  outfile: join(outDir, "run-engine.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  define: {
    ...opencodeDefines,
    __CLAUDE_SHA256__: JSON.stringify(
      createHash("sha256").update(readFileSync(nativeExe)).digest("hex"),
    ),
  },
  logLevel: "warning",
});
copyFileSync(nativeExe, join(outDir, "bin", exeName));
copyFileSync(opencodeExe, join(outDir, "bin", opencodeExeName));
if (target !== "win32-x64") {
  chmodSync(join(outDir, "bin", opencodeExeName), 0o755);
  chmodSync(join(outDir, "bin", exeName), 0o755);
}
writeFileSync(join(outDir, "bin", "opencode.sha256"), `${opencodeSha}\n`);
console.log(
  `Moteur prêt : REDWIDOW_ENGINE=${join(outDir, "run-engine.mjs")} REDWIDOW_BIN_ROOT=${outDir}`,
);
