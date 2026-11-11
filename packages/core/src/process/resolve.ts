import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";
import { CodedError } from "../reason.js";

export interface ResolveBinaryOptions {
  /** Plateforme simulée (défaut : `process.platform`). */
  platform?: NodeJS.Platform;
  /** Environnement où lire `PATH` (défaut : `process.env`) ; sous win32, clé sans casse. */
  env?: NodeJS.ProcessEnv;
  /** Test d'existence d'un fichier exécutable (défaut : fichier + bit X sous POSIX, fichier sous win32). */
  isFile?: (path: string) => boolean;
}

const defaultIsFile = (platform: NodeJS.Platform) => (path: string) => {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Shims npm sondés : `<dir>\node_modules\<paquet>\bin\<nom>.exe` à côté de `<dir>\<nom>.cmd`. */
const SHIM_PACKAGES: Readonly<Record<string, string>> = { opencode: "opencode-ai" };

/**
 * Chemin absolu d'un binaire exécutable, ou `null` s'il est introuvable.
 *
 * - `PATH` : les entrées vides ou relatives sont ignorées (toutes plateformes) ;
 *   un nom nu n'est donc jamais résolu dans le répertoire courant.
 * - win32 : toujours un chemin absolu ; seule l'extension `.exe` est exécutable
 *   (`PATHEXT` n'est pas utilisé). Un shim `.cmd`/`.bat` n'est jamais renvoyé :
 *   on sonde l'`.exe` du paquet npm voisin, sinon `binary.shimUnsupported`.
 */
export function resolveBinary(name: string, opts: ResolveBinaryOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const isFile = opts.isFile ?? defaultIsFile(platform);
  if (name === "" || name.includes("\0")) return null;
  return platform === "win32"
    ? resolveWindows(name, env, isFile)
    : resolvePosix(name, env, isFile, platform);
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const p = platform === "win32" ? win32 : posix;
  let raw: string | undefined;
  if (platform === "win32") {
    for (const [key, value] of Object.entries(env)) {
      if (key.toUpperCase() === "PATH" && value !== undefined) {
        raw = value;
        break;
      }
    }
  } else raw = env.PATH;
  return (raw ?? "")
    .split(p.delimiter)
    .map((entry) => (platform === "win32" ? entry.replace(/^"(.*)"$/, "$1") : entry))
    .filter((entry) => entry !== "" && p.isAbsolute(entry));
}

/**
 * macOS : VS Code lancé depuis le Dock n'hérite pas toujours du PATH du shell. Après le PATH, on sonde
 * les emplacements d'installation habituels de Docker Desktop et de Homebrew (dossiers système fixes).
 */
const DARWIN_FALLBACK_DIRS = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Applications/Docker.app/Contents/Resources/bin",
];

function resolvePosix(
  name: string,
  env: NodeJS.ProcessEnv,
  isFile: (path: string) => boolean,
  platform: NodeJS.Platform = "linux",
): string | null {
  if (name.includes("/") || posix.isAbsolute(name)) return isFile(name) ? name : null;
  const dirs = pathEntries(env, "linux");
  if (platform === "darwin") {
    const home = env.HOME;
    if (home && posix.isAbsolute(home)) dirs.push(posix.join(home, ".docker", "bin"));
    dirs.push(...DARWIN_FALLBACK_DIRS);
  }
  for (const dir of dirs) {
    const candidate = posix.join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function resolveWindows(
  name: string,
  env: NodeJS.ProcessEnv,
  isFile: (path: string) => boolean,
): string | null {
  const hasSeparator = name.includes("/") || name.includes("\\");
  if (hasSeparator || win32.isAbsolute(name)) {
    // Jamais de chemin relatif : il pourrait désigner un fichier de l'espace de travail.
    return win32.isAbsolute(name) ? withExtension(name, isFile) : null;
  }
  for (const dir of pathEntries(env, "win32")) {
    const found = withExtension(win32.join(dir, name), isFile);
    if (found !== null) return found;
  }
  return null;
}

/** Applique la règle d'extension à un chemin absolu : `.exe` seul, shim sondé, sinon `null`. */
function withExtension(path: string, isFile: (path: string) => boolean): string | null {
  const ext = win32.extname(path).toLowerCase();
  if (ext === ".exe") return isFile(path) ? path : null;
  if (ext === ".cmd" || ext === ".bat") return isFile(path) ? probeShim(path, isFile) : null;
  // Sans extension reconnue : `<nom>.exe`, puis un shim voisin éventuel.
  if (isFile(`${path}.exe`)) return `${path}.exe`;
  if (ext !== "") return null;
  for (const shim of [`${path}.cmd`, `${path}.bat`]) {
    if (isFile(shim)) return probeShim(shim, isFile);
  }
  return null;
}

function probeShim(shim: string, isFile: (path: string) => boolean): string {
  const base = win32.basename(shim, win32.extname(shim));
  const pkg = SHIM_PACKAGES[base.toLowerCase()];
  if (pkg !== undefined) {
    const exe = win32.join(win32.dirname(shim), "node_modules", pkg, "bin", `${base}.exe`);
    if (isFile(exe)) return exe;
  }
  throw new CodedError("binary.shimUnsupported", { binary: base, shim });
}
