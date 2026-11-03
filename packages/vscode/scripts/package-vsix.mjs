// Empaquetage de l'extension (ADR 0004, E1/E3/E4) : bundle esbuild du moteur et de l'extension, copie du binaire
// natif du SDK pour UNE cible, empreinte SHA-256, puis `vsce package --target`.
// Usage : node scripts/package-vsix.mjs [cible]   (défaut : win32-x64). Ne publie rien.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
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
const repository = join(pkgDir, "..", "..");
const stage = join(pkgDir, ".vsix-stage", target);
if (!["linux-x64", "win32-x64"].includes(target)) {
  throw new Error(`Cible non prise en charge : ${target}`);
}
// Les exports workspace pointent vers dist : compiler avant tout bundle garantit
// que le VSIX contient les sources courantes, même après un packaging local direct.
const tscManifest = createRequire(join(repository, "package.json")).resolve(
  "typescript/package.json",
);
const tsc = join(dirname(tscManifest), JSON.parse(readFileSync(tscManifest, "utf8")).bin.tsc);
execFileSync(process.execPath, [tsc, "-b"], { cwd: repository, stdio: "inherit" });
execFileSync(process.execPath, [join(repository, "scripts", "sync-ui-i18n.mjs")], {
  cwd: repository,
  stdio: "inherit",
});
const opencodeVersion = "1.19.0";
const opencodeExeName = target === "win32-x64" ? "opencode.exe" : "opencode";
const opencodePackage = `opencode-${target === "win32-x64" ? "windows" : "linux"}-x64-baseline`;
const opencodeDir = dirname(
  createRequire(import.meta.url).resolve(`${opencodePackage}/package.json`),
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
// Moteur de production (E2) : l'empreinte du binaire est embarquée par `define`, pas lue sur disque.
await build({
  entryPoints: [join(pkgDir, "src/engine/main.ts")],
  outfile: join(stage, "run-engine.mjs"),
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
await build({
  entryPoints: [join(pkgDir, "src/extension/extension.ts")],
  outfile: join(stage, "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  define: {
    ...opencodeDefines,
    __SDK_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version,
    ),
  },
  logLevel: "warning",
});

copyFileSync(nativeExe, join(stage, "bin", exeName));
copyFileSync(opencodeExe, join(stage, "bin", opencodeExeName));
if (target === "linux-x64") chmodSync(join(stage, "bin", opencodeExeName), 0o755);
writeFileSync(join(stage, "bin", "opencode.sha256"), `${opencodeSha}\n`);
mkdirSync(join(stage, "third-party"), { recursive: true });
copyFileSync(
  join(pkgDir, "third-party", "opencode-LICENSE"),
  join(stage, "third-party", "opencode-LICENSE"),
);
for (const license of ["attack-flow-LICENSE", "stix-LICENSE"])
  copyFileSync(join(pkgDir, "third-party", license), join(stage, "third-party", license));
// Licences des dépendances du lecteur web et de leurs dépendances embarquées.
const webLicenses = new Set();
function copyWebLicenses(name, fromRequire) {
  let directory = dirname(fromRequire.resolve(name));
  while (
    !existsSync(join(directory, "package.json")) ||
    JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name !== name
  ) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Manifeste introuvable pour ${name}`);
    directory = parent;
  }
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const key = `${metadata.name}-${metadata.version}`.replaceAll("/", "-");
  if (webLicenses.has(key)) return;
  webLicenses.add(key);
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt"].find((file) =>
    existsSync(join(directory, file)),
  );
  if (!license) throw new Error(`Licence introuvable pour ${name}`);
  copyFileSync(join(directory, license), join(stage, "third-party", `${key}-LICENSE`));
  const childRequire = createRequire(join(directory, "package.json"));
  for (const child of Object.keys(metadata.dependencies ?? {}))
    copyWebLicenses(child, childRequire);
}
const coreRequire = createRequire(join(pkgDir, "..", "core", "package.json"));
copyWebLicenses("htmlparser2", coreRequire);
copyWebLicenses("undici", coreRequire);
// Les distributions natives peuvent fournir leur licence à côté du manifeste.
for (const license of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
  if (existsSync(join(opencodeDir, license))) {
    mkdirSync(join(stage, "third-party"), { recursive: true });
    copyFileSync(join(opencodeDir, license), join(stage, "third-party", `opencode-${license}`));
    break;
  }
}
const sha = createHash("sha256").update(readFileSync(nativeExe)).digest("hex");
writeFileSync(join(stage, "bin", "claude.sha256"), `${sha}\n`);

cpSync(join(pkgDir, "media"), join(stage, "media"), { recursive: true });
const manifest = JSON.parse(readFileSync(join(pkgDir, "extension.manifest.json"), "utf8"));
writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2));
copyFileSync(join(pkgDir, "EXTENSION_README.md"), join(stage, "README.md"));
for (const file of ["package.nls.json", "package.nls.fr.json", "package.nls.en.json"])
  copyFileSync(join(pkgDir, file), join(stage, file));

const out = join(pkgDir, `warband-${manifest.version}-${target}.vsix`);
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
console.log(
  `OpenCode ${opencodeVersion} ; binaire ${mib(statSync(opencodeExe).size)} Mio ; sha256 ${opencodeSha}`,
);
console.log(`vsix ${out} : ${mib(statSync(out).size)} Mio`);
