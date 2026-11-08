/**
 * Sûreté des chemins des outils fichiers, pour Linux, macOS et Windows natif.
 *
 * Toute la logique de chemins vit ici (extraction, `~`, résolution,
 * canonicalisation, comparaison, chemins sensibles) et dépend d'une
 * « plateforme » injectée : on n'utilise jamais le module `path` global, mais
 * `path.posix` ou `path.win32` selon la plateforme, ce qui rend les trois
 * saveurs testables sur n'importe quel système avec un faux `realpath`.
 *
 * Fail-closed : une forme de chemin qu'on ne sait pas analyser (Windows) ou
 * qu'on ne peut pas résoudre donne un refus, jamais un accès.
 */

import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type PathPlatform = "posix" | "darwin" | "win32";

/** Formes de chemin refusées car non analysables de façon fiable. */
export type UnsupportedForm =
  | "unc"
  | "device"
  | "ads"
  | "drive-relative"
  | "trailing-dot-space"
  | "reserved-name"
  | "env-var"
  | "short-name"
  | "unresolvable";

/** Options d'analyse des chemins (sous-ensemble de `PolicyContext`). */
export interface PathOptions {
  cwd: string;
  roots?: readonly string[] | undefined;
  home?: string | undefined;
  /** Défaut : dérivé de `process.platform`. Uniquement injecté par le code, jamais par la politique ni le modèle. */
  platform?: PathPlatform | undefined;
  /** Défaut : `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Défaut : `realpathSync.native` ; lève avec `code: "ENOENT"` si le chemin n'existe pas. */
  realpath?: ((path: string) => string) | undefined;
  /**
   * Défaut : `lstatSync` ; lève (`ENOENT`) si l'entrée n'existe pas. Sert à reconnaître un lien
   * symbolique pendant. Si `realpath` est injecté sans `lstat`, aucune entrée n'est supposée exister
   * (les tests décrivent alors un système de fichiers entièrement fictif).
   */
  lstat?: ((path: string) => unknown) | undefined;
  /** Défaut : `readlinkSync` (mêmes règles d'injection que `lstat`). */
  readlink?: ((path: string) => string) | undefined;
}

/** Constat d'un garde-fou de chemin. */
export type PathFinding =
  | { kind: "sensitive"; path: string }
  | { kind: "outside"; path: string }
  | { kind: "unsupported"; path: string; form: UnsupportedForm };

/** Outils fichiers → champs de l'entrée qui portent un chemin. */
export const PATH_FIELDS: Record<string, readonly string[]> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Grep: ["path"],
  Glob: ["path"],
};

/**
 * Champ d'entrée (tableau de motifs glob) par lequel un adaptateur signale les
 * répertoires externes touchés par un appel d'outil quelconque : leurs bases
 * statiques passent par les mêmes contrôles que les autres chemins.
 */
export const EXTERNAL_PATTERNS_FIELD = "externalDirectories";

/** Permission OpenCode d'accès hors de l'espace de travail : ses motifs (`patterns`) sont des chemins. */
export const EXTERNAL_DIRECTORY_TOOL = "external_directory";

/** Plateforme du processus courant. */
export function defaultPlatform(): PathPlatform {
  return process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "posix";
}

class PathUnsupportedError extends Error {
  constructor(readonly form: UnsupportedForm) {
    super(form);
  }
}

const SENSITIVE_HOME_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker/config.json",
  ".netrc",
  ".git-credentials",
  ".config/gh",
  ".config/warband",
  // Identifiants des fournisseurs de modèles d'OpenCode (auth.json) et sa configuration (clés en clair possibles).
  ".local/share/opencode",
  ".config/opencode",
  ".npmrc",
  // Identifiants (`.credentials.json`) et e-mail du compte de l'agent Claude.
  ".claude",
  ".claude.json",
];
const SENSITIVE_POSIX_ABSOLUTE = ["/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/sudoers.d"];

/** Windows, relatifs au répertoire personnel. */
const SENSITIVE_WIN_HOME = [
  "NTUSER.DAT",
  "AppData\\Roaming\\Microsoft\\Credentials",
  "AppData\\Local\\Microsoft\\Credentials",
  "AppData\\Roaming\\Microsoft\\Protect",
  "AppData\\Roaming\\Microsoft\\Crypto",
  "AppData\\Local\\Microsoft\\Vault",
  "AppData\\Roaming\\gcloud",
  "AppData\\Roaming\\GitHub CLI",
  "AppData\\Roaming\\warband",
  "AppData\\Local\\Google\\Chrome\\User Data",
  "AppData\\Local\\Microsoft\\Edge\\User Data",
  "AppData\\Roaming\\Mozilla\\Firefox\\Profiles",
];
/** Mêmes sous-chemins sous `%APPDATA%` (itinérant) et `%LOCALAPPDATA%` s'ils diffèrent du répertoire personnel. */
const SENSITIVE_WIN_ROAMING = [
  "Microsoft\\Credentials",
  "Microsoft\\Protect",
  "Microsoft\\Crypto",
  "gcloud",
  "GitHub CLI",
  "warband",
  "Mozilla\\Firefox\\Profiles",
];
const SENSITIVE_WIN_LOCAL = [
  "Microsoft\\Credentials",
  "Microsoft\\Vault",
  "Google\\Chrome\\User Data",
  "Microsoft\\Edge\\User Data",
];
const SENSITIVE_WIN_SYSTEMROOT = ["System32\\config", "NTDS", "repair"];
const SENSITIVE_WIN_PROGRAMDATA = ["ssh", "Microsoft\\Crypto"];

/** Noms de périphériques réservés (avec ou sans extension, casse ignorée). */
const RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³])$/i;

type Env = Readonly<Record<string, string | undefined>>;

/** Variable d'environnement ; sous Windows la casse du nom est ignorée. */
function envGet(env: Env, name: string, caseless: boolean): string | undefined {
  const direct = env[name];
  if (direct) return direct;
  if (!caseless) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower && env[key]) return env[key];
  }
  return undefined;
}

/** Forme non analysable d'un segment Windows, hors segments `.` et `..`. */
function segmentForm(seg: string): UnsupportedForm | null {
  if (seg === "" || seg === "." || seg === "..") return null;
  if (seg.includes(":")) return "ads";
  if (/%[^%]+%/.test(seg)) return "env-var";
  if (seg.endsWith(".") || seg.endsWith(" ")) return "trailing-dot-space";
  const stem = (seg.split(".")[0] ?? "").trimEnd();
  if (RESERVED_NAME.test(stem)) return "reserved-name";
  return null;
}

/** Forme refusée d'un chemin brut sous Windows, ou `null`. */
export function windowsRawForm(raw: string): UnsupportedForm | null {
  const norm = raw.replace(/\//g, "\\");
  if (norm.startsWith("\\\\")) return /^\\\\[?.](?:\\|$)/.test(norm) ? "device" : "unc";
  let rest = norm;
  if (/^[A-Za-z]:/.test(norm)) {
    rest = norm.slice(2);
    if (rest === "" || !rest.startsWith("\\")) return "drive-relative";
  }
  if (rest.includes(":")) return "ads";
  if (/%[^%\\]+%/.test(rest)) return "env-var";
  for (const seg of rest.split("\\")) {
    const form = segmentForm(seg);
    if (form !== null) return form;
  }
  return null;
}

/** Préfixe statique d'un motif glob (jusqu'au premier segment contenant un métacaractère). */
export function globBase(pattern: string): string {
  const out: string[] = [];
  for (const part of pattern.split(/[\\/]/)) {
    if (/[*?[\]{}]/.test(part)) break;
    out.push(part);
  }
  // `\\serveur\partage\*` : garder le double séparateur de tête (UNC), qu'un `join` réduirait à un seul.
  if (/^[\\/]{2}/.test(pattern)) return `//${out.slice(2).join("/")}`;
  const base = out.join("/");
  if (/^[A-Za-z]:$/.test(base) && /^[\\/]/.test(pattern.slice(2))) return `${base}/`;
  return base || (/^[\\/]/.test(pattern) ? "/" : ".");
}

/**
 * Motif glob dont la base statique ne reflète pas ce qu'il peut atteindre, ou `null`.
 * Un segment à métacaractère qui contient `..` (`{..,x}`), un `..` qui suit un segment à
 * métacaractère (étoile, barre, `..`) ou, sous Windows, `:` / `%` dans un segment à métacaractère
 * (`C:*`, `{C:,D:}\*`) : refusé (fail-closed), la base ne protégerait rien.
 */
export function globHazard(pattern: string, platform: PathPlatform = defaultPlatform()): boolean {
  let meta = false;
  for (const seg of pattern.split(/[\\/]/)) {
    const isMeta = /[*?[\]{}]/.test(seg);
    if (isMeta && (seg.includes("..") || (platform === "win32" && /[:%]/.test(seg)))) return true;
    if (meta && seg === "..") return true;
    meta ||= isMeta;
  }
  return false;
}

/** Premier motif glob dangereux (`globHazard`) d'un appel d'outil, ou `null`. */
export function findGlobHazard(
  tool: string,
  input: Record<string, unknown>,
  platform: PathPlatform = defaultPlatform(),
): string | null {
  const patterns: unknown[] = [];
  if (tool === "Glob") patterns.push(input.pattern);
  const external = input[EXTERNAL_PATTERNS_FIELD];
  if (Array.isArray(external)) patterns.push(...external);
  if (tool === EXTERNAL_DIRECTORY_TOOL && Array.isArray(input.patterns)) {
    patterns.push(...input.patterns);
  }
  for (const pattern of patterns) {
    if (typeof pattern === "string" && globHazard(pattern, platform)) return pattern;
  }
  return null;
}

/** Chemins à contrôler pour un appel d'outil. */
export function extractPaths(
  tool: string,
  input: Record<string, unknown>,
  platform: PathPlatform = defaultPlatform(),
): string[] {
  const flavor = platform === "win32" ? win32 : posix;
  const paths: string[] = [];
  for (const field of PATH_FIELDS[tool] ?? []) {
    const value = input[field];
    if (typeof value === "string" && value !== "") paths.push(value);
  }
  if (tool === "Glob" && typeof input.pattern === "string") {
    const pattern = input.pattern;
    if (
      flavor.isAbsolute(pattern) ||
      pattern.split(/[\\/]/).includes("..") ||
      pattern.startsWith("~") ||
      (platform === "win32" && /[:%]/.test(pattern))
    ) {
      const base = globBase(pattern);
      // Un motif relatif se résout contre `path` (et non contre le répertoire de travail).
      const dir = input.path;
      const relative = !flavor.isAbsolute(base) && !base.startsWith("~");
      paths.push(typeof dir === "string" && dir !== "" && relative ? flavor.join(dir, base) : base);
    }
  }
  const external = input[EXTERNAL_PATTERNS_FIELD];
  const patterns = [
    ...(Array.isArray(external) ? external : []),
    ...(tool === EXTERNAL_DIRECTORY_TOOL && Array.isArray(input.patterns) ? input.patterns : []),
  ];
  for (const pattern of patterns) {
    if (typeof pattern === "string" && pattern !== "") paths.push(globBase(pattern));
  }
  if (tool === EXTERNAL_DIRECTORY_TOOL) {
    // Métadonnées d'OpenCode : répertoire et fichier visés.
    for (const field of ["filepath", "parentDir"]) {
      const value = input[field];
      if (typeof value === "string" && value !== "") paths.push(value);
    }
  }
  return paths;
}

interface Flavor {
  platform: PathPlatform;
  path: typeof posix;
  /** Comparaison insensible à la casse (Windows et macOS). */
  fold: (p: string) => string;
  env: Env;
  home: string;
  realpath: (p: string) => string;
  lstat: (p: string) => unknown;
  readlink: (p: string) => string;
}

function makeFlavor(opts: PathOptions): Flavor {
  const platform = opts.platform ?? defaultPlatform();
  const env = opts.env ?? process.env;
  const win = platform === "win32";
  const home =
    opts.home ?? (win ? envGet(env, "USERPROFILE", true) : envGet(env, "HOME", false)) ?? homedir();
  return {
    platform,
    path: win ? win32 : posix,
    // macOS : comparaison toujours insensible à la casse (volumes APFS/HFS+ par défaut) ; un volume
    // sensible à la casse donne alors des faux positifs (refus ou ask), jamais un accès (best effort).
    fold: platform === "posix" ? (p) => p : (p) => p.toLowerCase(),
    env,
    home,
    realpath: opts.realpath ?? ((p) => realpathSync.native(p)),
    lstat:
      opts.lstat ??
      (opts.realpath === undefined
        ? (p) => lstatSync(p)
        : () => {
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          }),
    readlink:
      opts.readlink ??
      (opts.realpath === undefined
        ? (p) => readlinkSync(p)
        : () => {
            throw Object.assign(new Error("EINVAL"), { code: "EINVAL" });
          }),
  };
}

/** `~`, `~/` (et `~\` sous Windows) → répertoire personnel. */
function expandHome(path: string, f: Flavor): string {
  if (path === "~") return f.home;
  if (path.startsWith("~/") || (f.platform === "win32" && path.startsWith("~\\"))) {
    return f.path.join(f.home, path.slice(2));
  }
  return path;
}

/** Dépouille un résultat de `realpath` Windows de son préfixe `\\?\` ; refuse un résultat UNC. */
function cleanRealpath(result: string, f: Flavor): string {
  if (f.platform !== "win32") return result;
  if (/^\\\\\?\\UNC\\/i.test(result)) throw new PathUnsupportedError("unc");
  if (/^\\\\\?\\[A-Za-z]:/.test(result)) return result.slice(4);
  if (result.startsWith("\\\\") || result.startsWith("//")) {
    throw new PathUnsupportedError(/^\\\\[?.]/.test(result) ? "device" : "unc");
  }
  return result;
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/** Nombre maximal de liens symboliques pendants suivis pour un même chemin. */
const MAX_DANGLING_HOPS = 16;

function isMissing(err: unknown): boolean {
  const code = errorCode(err);
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Chemin absolu sans lien symbolique. Pour un fichier qui n'existe pas encore,
 * résout le plus proche ancêtre existant (seulement sur ENOENT/ENOTDIR, sur toutes
 * les plateformes) puis réattache la fin du chemin, qui est contrôlée (Windows :
 * formes douteuses et noms courts 8.3, la partie résolue étant déjà normalisée).
 * Un composant qui existe pour `lstat` mais que `realpath` ne résout pas est un lien
 * symbolique pendant : sa cible est lue et résolue à son tour (profondeur bornée), pour
 * que le chemin final passe par tous les contrôles.
 * Lève `PathUnsupportedError` si le chemin ne peut pas être résolu de façon sûre.
 */
function canonical(path: string, f: Flavor, hops = 0): string {
  const full = f.path.resolve(path);
  const tail: string[] = [];
  let current = full;
  for (;;) {
    try {
      const resolved = cleanRealpath(f.realpath(current), f);
      if (f.platform === "win32") checkTail(tail);
      return f.path.join(resolved, ...tail);
    } catch (err) {
      if (err instanceof PathUnsupportedError) throw err;
      if (!isMissing(err)) throw new PathUnsupportedError("unresolvable");
    }
    // `current` est introuvable pour realpath : inexistant, ou lien symbolique pendant ?
    try {
      f.lstat(current);
    } catch (err) {
      if (!isMissing(err)) throw new PathUnsupportedError("unresolvable");
      const parent = f.path.dirname(current);
      if (parent === current) {
        if (f.platform === "win32") checkTail(tail);
        return full;
      }
      tail.unshift(f.path.basename(current));
      current = parent;
      continue;
    }
    if (hops >= MAX_DANGLING_HOPS) throw new PathUnsupportedError("unresolvable");
    let target: string;
    try {
      target = cleanRealpath(f.readlink(current), f);
    } catch (err) {
      if (err instanceof PathUnsupportedError) throw err;
      throw new PathUnsupportedError("unresolvable");
    }
    return canonical(
      f.path.join(f.path.resolve(f.path.dirname(current), target), ...tail),
      f,
      hops + 1,
    );
  }
}

/** Partie non résolue (Windows) : formes douteuses et noms courts 8.3. */
function checkTail(tail: readonly string[]): void {
  for (const seg of tail) {
    const form = segmentForm(seg);
    if (form !== null) throw new PathUnsupportedError(form);
    if (/~\d/.test(seg)) throw new PathUnsupportedError("short-name");
  }
}

/**
 * Fiche programme d'un projet et son approbation (`…/projects/<uuid>/program.json`,
 * `program.approval.json`), fiche d'engagement, approbation et arrêt d'urgence (ADR 0041 :
 * `engagement.json`, `engagement.approval.json`, `engagement-halt.json`), plan de campagne et démontage
 * (`campaign.json`, `campaign.approval.json`, `campaign.steps.json`, `teardown.json`), temporaires compris. Sensibles où qu'ils soient : le dossier de
 * configuration peut être redirigé, et seul un humain (CLI) doit pouvoir les écrire.
 */
const PROGRAM_FILE =
  /(?:^|[\\/])projects[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/](?:program(?:\.approval)?|engagement(?:\.approval|-halt)?|campaign(?:\.approval|\.steps)?|teardown)\.json(?:\.[^\\/]*)?$/i;

/** Texte de commande shell : fiche programme nommée par chemin de projet, ou approbation nommée seule. */
const PROGRAM_SHELL =
  /projects[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/]program|program\.approval\.json/i;

/**
 * Vrai si une commande shell désigne littéralement un fichier de fiche programme. Au mieux
 * (le shell n'est pas évalué : variables, `cd` puis nom relatif échappent) ; la défense de
 * fond est que seule la CLI écrit la fiche et que l'empreinte invalide toute modification.
 */
export function mentionsProgramFile(commandText: string): boolean {
  return PROGRAM_SHELL.test(commandText);
}

function isInside(root: string, path: string, f: Flavor): boolean {
  const rel = f.path.relative(f.fold(root), f.fold(path));
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${f.path.sep}`) && !f.path.isAbsolute(rel);
}

/** Chemins sensibles absolus (non résolus) pour la plateforme. */
function sensitivePaths(f: Flavor): string[] {
  const j = f.path.join;
  const list = SENSITIVE_HOME_PATHS.map((p) => j(f.home, p));
  if (f.platform !== "win32") {
    const xdg = envGet(f.env, "XDG_CONFIG_HOME", false);
    if (xdg) list.push(j(xdg, "warband"));
    return [...list, ...SENSITIVE_POSIX_ABSOLUTE];
  }
  list.push(...SENSITIVE_WIN_HOME.map((p) => j(f.home, p)));
  const roaming = envGet(f.env, "APPDATA", true);
  if (roaming) list.push(...SENSITIVE_WIN_ROAMING.map((p) => j(roaming, p)));
  const local = envGet(f.env, "LOCALAPPDATA", true);
  if (local) list.push(...SENSITIVE_WIN_LOCAL.map((p) => j(local, p)));
  const systemRoots = ["C:\\Windows", envGet(f.env, "SystemRoot", true)];
  for (const root of systemRoots) {
    if (root) list.push(...SENSITIVE_WIN_SYSTEMROOT.map((p) => j(root, p)));
  }
  const programData = ["C:\\ProgramData", envGet(f.env, "ProgramData", true)];
  for (const root of programData) {
    if (root) list.push(...SENSITIVE_WIN_PROGRAMDATA.map((p) => j(root, p)));
  }
  return list;
}

/**
 * Contrôle les chemins candidats. Retourne le premier constat bloquant
 * (chemin sensible ou non analysable) ; à défaut le premier chemin hors des
 * racines autorisées ; `null` si tout est dans l'espace de travail.
 */
export function checkPathAccess(
  candidates: readonly string[],
  opts: PathOptions,
): PathFinding | null {
  const f = makeFlavor(opts);

  const roots: string[] = [];
  for (const root of opts.roots ?? [opts.cwd]) {
    try {
      roots.push(canonical(f.path.resolve(opts.cwd, root), f));
    } catch {
      // Racine non résolvable : on l'écarte (tout accès sera au moins soumis à approbation).
    }
  }

  const sensitive = sensitivePaths(f).flatMap((p) => {
    const forms = [f.path.resolve(p)];
    try {
      forms.push(canonical(p, f));
    } catch {
      // Seule la forme lexicale est exploitable.
    }
    return forms;
  });

  let outside: string | null = null;
  for (const candidate of candidates) {
    if (f.platform === "win32") {
      const form = windowsRawForm(candidate);
      if (form !== null) return { kind: "unsupported", path: candidate, form };
    }
    const absolute = f.path.resolve(opts.cwd, expandHome(candidate, f));
    let real: string;
    try {
      real = canonical(absolute, f);
    } catch (err) {
      if (err instanceof PathUnsupportedError) {
        return { kind: "unsupported", path: candidate, form: err.form };
      }
      throw err;
    }
    for (const path of [absolute, real]) {
      if (sensitive.some((s) => isInside(s, path, f)) || PROGRAM_FILE.test(path))
        return { kind: "sensitive", path: candidate };
    }
    if (!roots.some((root) => isInside(root, real, f))) outside ??= candidate;
  }
  return outside === null ? null : { kind: "outside", path: outside };
}

/**
 * Formes d'un chemin sensible qui existe, ou pourquoi on ne peut pas s'en servir.
 * Un chemin absent est ignoré. Un échec autre que l'absence refuse le montage.
 */
function existingSensitive(path: string, f: Flavor): readonly string[] | "missing" | "unsupported" {
  try {
    f.realpath(path);
  } catch (err) {
    // Windows peut refuser realpath sur un secret protégé alors que ses
    // métadonnées et son parent restent accessibles. Sa position suffit au
    // contrôle du montage ; aucune lecture du contenu n'est nécessaire.
    if (f.platform === "win32" && ["EACCES", "EPERM"].includes(errorCode(err) ?? "")) {
      try {
        const stat = f.lstat(path);
        if (
          typeof stat !== "object" ||
          stat === null ||
          !("isSymbolicLink" in stat) ||
          typeof stat.isSymbolicLink !== "function" ||
          stat.isSymbolicLink() !== false
        )
          return "unsupported";
        const parent = f.path.dirname(path);
        if (parent === path) return "unsupported";
        return [f.path.resolve(path), f.path.join(canonical(parent, f), f.path.basename(path))];
      } catch {
        return "unsupported";
      }
    }
    if (!isMissing(err)) return "unsupported";
    try {
      f.lstat(path);
    } catch (statErr) {
      if (isMissing(statErr)) return "missing";
      return "unsupported";
    }
  }
  try {
    return [f.path.resolve(path), canonical(path, f)];
  } catch (err) {
    if (err instanceof PathUnsupportedError) return "unsupported";
    throw err;
  }
}

/**
 * Indique si monter `directory` exposerait un chemin sensible.
 * `sensitive` si le dossier est dans un secret, ou si un secret qui existe est dans le dossier.
 * Un secret absent est ignoré ; un secret impossible à résoudre donne `unsupported`.
 * Pas `checkPathAccess` : un dossier hors de l'espace de travail de l'agent reste montable.
 * Le chemin n'est pas renvoyé.
 */
export function mountExposesSensitive(
  directory: string,
  opts: PathOptions = { cwd: process.cwd() },
): "sensitive" | "unsupported" | null {
  const f = makeFlavor(opts);
  let real: string;
  try {
    real = canonical(f.path.resolve(opts.cwd, expandHome(directory, f)), f);
  } catch (err) {
    if (err instanceof PathUnsupportedError) return "unsupported";
    throw err;
  }
  for (const path of sensitivePaths(f)) {
    const forms = existingSensitive(path, f);
    if (forms === "unsupported") return "unsupported";
    if (forms === "missing") continue;
    for (const form of forms) {
      if (isInside(form, real, f) || isInside(real, form, f)) return "sensitive";
    }
  }
  return null;
}

/** Texte de commande shell : fichiers d'engagement nommés par chemin de projet, ou approbation / arrêt nommés seuls. */
const ENGAGEMENT_SHELL =
  /projects[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/](?:engagement|campaign|teardown)|(?:engagement|campaign)\.approval\.json|engagement-halt\.json|campaign\.steps\.json/i;

/** Comme `mentionsProgramFile`, pour la fiche d'engagement, son approbation et l'arrêt d'urgence (ADR 0041). */
export function mentionsEngagementFile(commandText: string): boolean {
  return ENGAGEMENT_SHELL.test(commandText);
}
