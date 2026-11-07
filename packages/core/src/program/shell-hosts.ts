/**
 * Extraction « au mieux » des cibles réseau d'une commande shell ou d'un argv (ADR 0040, lot 4).
 * Couvre curl, wget, httpx, nmap, sqlmap, ffuf, nuclei, gobuster, y compris dans une commande
 * chaînée (`;`, `&&`, `||`, `|`) ou un `sh -c '…'`. Ne résout rien : une cible issue d'une variable,
 * d'une substitution, d'un glob ou d'un fichier de liste est signalée `unresolved`.
 */

import { parseShell, programName } from "../approval/shell.js";

/** Un appel d'outil réseau connu : binaire normalisé (alias résolu) et arguments bruts. */
export interface NetworkCall {
  binary: string;
  args: string[];
}

export interface NetworkTargets {
  /** Cibles textuelles brutes (URL, hôte, CIDR) ; à passer à `hostOfTarget`. */
  targets: string[];
  /** Appels d'outils réseau qui visent une cible (ou une cible non extractible), pour les drapeaux attendus. */
  calls: NetworkCall[];
  /** Un outil réseau connu est appelé sans cible extractible (variable, `-iL fichier`, stdin…). */
  unresolved: boolean;
}

interface ToolSpec {
  /** Options (nom exact, avec leurs tirets) dont la valeur suivante n'est pas une cible. */
  valued: ReadonlySet<string>;
  /** Options dont la valeur est une cible. */
  targetFlags: ReadonlySet<string>;
  /** Options dont la valeur est une liste ou un fichier : cible non extractible. */
  listFlags: ReadonlySet<string>;
  /** Arguments positionnels = cibles. */
  positional: boolean;
  /** Une grappe `-sSo fichier` consomme une valeur si sa dernière lettre est une option à valeur. */
  cluster: boolean;
}

const set = (...names: string[]): ReadonlySet<string> => new Set(names);

const SPECS: Readonly<Record<string, ToolSpec>> = {
  curl: {
    valued: set(
      "-H",
      "--header",
      "-d",
      "--data",
      "--data-raw",
      "--data-binary",
      "--data-urlencode",
      "--data-ascii",
      "--json",
      "-o",
      "--output",
      "-X",
      "--request",
      "-A",
      "--user-agent",
      "-e",
      "--referer",
      "-u",
      "--user",
      "-b",
      "--cookie",
      "-c",
      "--cookie-jar",
      "-F",
      "--form",
      "-m",
      "--max-time",
      "--connect-timeout",
      "--resolve",
      "--connect-to",
      "-w",
      "--write-out",
      "-T",
      "--upload-file",
      "--cacert",
      "--capath",
      "--cert",
      "-E",
      "--key",
      "-x",
      "--proxy",
      "-r",
      "--range",
      "--retry",
      "--retry-delay",
      "--retry-max-time",
      "--limit-rate",
      "-y",
      "-Y",
      "-z",
      "--proxy-user",
      "-U",
      "--oauth2-bearer",
      "--interface",
      "--max-redirs",
      "-C",
      "--continue-at",
      "-D",
      "--dump-header",
      "--dns-servers",
      "--unix-socket",
    ),
    targetFlags: set("--url"),
    listFlags: set("-K", "--config"),
    positional: true,
    cluster: true,
  },
  wget: {
    valued: set(
      "-O",
      "--output-document",
      "-o",
      "--output-file",
      "-a",
      "--append-output",
      "-e",
      "--execute",
      "-U",
      "--user-agent",
      "-P",
      "--directory-prefix",
      "-T",
      "--timeout",
      "-t",
      "--tries",
      "-w",
      "--wait",
      "--header",
      "--post-data",
      "--post-file",
      "--user",
      "--password",
      "--http-user",
      "--http-password",
      "--load-cookies",
      "--save-cookies",
      "--referer",
      "-Q",
      "--quota",
      "-l",
      "--level",
      "-D",
      "--domains",
      "-I",
      "--include-directories",
      "-X",
      "--exclude-directories",
      "-R",
      "--reject",
      "-A",
      "--accept",
      "--limit-rate",
      "--bind-address",
      "--ca-certificate",
      "--certificate",
      "--private-key",
      "-B",
      "--base",
      "--method",
      "--body-data",
      "--body-file",
    ),
    targetFlags: set(),
    listFlags: set("-i", "--input-file"),
    positional: true,
    cluster: true,
  },
  httpx: {
    valued: set(),
    targetFlags: set("-u", "-target"),
    listFlags: set("-l", "-list", "-request"),
    positional: false,
    cluster: false,
  },
  nuclei: {
    valued: set(),
    targetFlags: set("-u", "-target"),
    listFlags: set("-l", "-list", "-uf"),
    positional: false,
    cluster: false,
  },
  ffuf: {
    valued: set(),
    targetFlags: set("-u"),
    listFlags: set("-request"),
    positional: false,
    cluster: false,
  },
  gobuster: {
    valued: set(),
    targetFlags: set("-u", "--url", "-d", "--domain"),
    listFlags: set(),
    positional: false,
    cluster: false,
  },
  sqlmap: {
    valued: set(),
    // `-d` : chaîne de connexion directe (`mysql://u:p@hôte:port/base`).
    targetFlags: set("-u", "--url", "-d"),
    listFlags: set("-m", "-r", "-l"),
    positional: false,
    cluster: false,
  },
  nmap: {
    valued: set(
      "-p",
      "--top-ports",
      "-oN",
      "-oX",
      "-oG",
      "-oA",
      "-oS",
      "--exclude",
      "--excludefile",
      "-e",
      "-S",
      "-g",
      "--source-port",
      "--script",
      "--script-args",
      "--script-args-file",
      "--script-timeout",
      "--scan-delay",
      "--max-scan-delay",
      "--max-retries",
      "--host-timeout",
      "--min-rate",
      "--max-rate",
      "--min-parallelism",
      "--max-parallelism",
      "--min-hostgroup",
      "--max-hostgroup",
      "--min-rtt-timeout",
      "--max-rtt-timeout",
      "--initial-rtt-timeout",
      "--data-length",
      "--data",
      "--data-string",
      "--ttl",
      "--datadir",
      "--dns-servers",
      "--proxies",
      "-D",
      "-b",
      "--version-intensity",
      "--mtu",
      "--ip-options",
      "--spoof-mac",
      "--stylesheet",
      "--resume",
      "--servicedb",
      "--versiondb",
      "--max-os-tries",
      "--scanflags",
      "--traceroute-timeout",
    ),
    targetFlags: set(),
    listFlags: set("-iL", "-iR"),
    positional: true,
    cluster: false,
  },
};

const ALIASES: Readonly<Record<string, string>> = { "httpx-toolkit": "httpx" };

const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ash", "ksh"]);
/** Préfixes inoffensifs : le programme réel est le mot suivant. */
const PREFIXES = new Set([
  "sudo",
  "time",
  "nohup",
  "command",
  "exec",
  "nice",
  "proxychains",
  "proxychains4",
]);
const SUDO_VALUED = new Set(["-u", "-g", "-h", "-p", "-C", "-r", "-t", "-U", "-D"]);
const INFO_FLAGS = new Set(["-h", "--help", "-help", "-V", "--version", "-version", "-hh"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_DEPTH = 3;

/**
 * Jeton non résolu par une analyse statique : variable ou substitution (`$`, `` ` ``) n'importe où,
 * `~` initial, glob ou accolade dans la partie hôte seulement (`?` et `[` sont courants dans le
 * chemin ou la requête d'une URL, et les guillemets sont déjà retirés par le parseur).
 */
const dynamic = (token: string): boolean => {
  if (/[$`]/.test(token) || token.startsWith("~")) return true;
  const authority = token.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0] ?? "";
  return /[*?[{]/.test(authority);
};

interface Ctx {
  out: NetworkTargets;
  /** Argv direct (pas de shell) : aucun jeton n'est « dynamique ». */
  literal: boolean;
}

function scanArgs(binary: string, spec: ToolSpec, args: readonly string[], ctx: Ctx): void {
  const found: string[] = [];
  let unresolved = false;
  const take = (value: string | undefined) => {
    if (value === undefined || value === "") return;
    if (!ctx.literal && dynamic(value)) unresolved = true;
    else found.push(value);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      if (spec.positional) for (const rest of args.slice(i + 1)) take(rest);
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      if (spec.positional) take(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const value = (): string | undefined => {
      if (inline !== undefined) return inline;
      i++;
      return args[i];
    };
    if (spec.targetFlags.has(name)) {
      take(value());
    } else if (spec.listFlags.has(name)) {
      unresolved = true;
      value();
    } else if (spec.valued.has(name)) {
      value();
    } else if (
      spec.cluster &&
      /^-[A-Za-z]{2,}$/.test(arg) &&
      spec.valued.has(`-${arg.slice(-1)}`)
    ) {
      i++;
    }
  }
  // `--help` / `--version` seuls n'atteignent aucun hôte.
  if (args.length > 0 && args.every((a) => INFO_FLAGS.has(a))) return;
  ctx.out.targets.push(...found);
  ctx.out.calls.push({ binary, args: [...args] });
  // Aucune cible trouvée (stdin, argument absent) : à traiter comme non extractible.
  if (unresolved || found.length === 0) ctx.out.unresolved = true;
}

/** Un segment simple : saute affectations et préfixes, puis traite l'outil ou un `sh -c`. */
function scanSegment(words: readonly string[], ctx: Ctx, depth: number): void {
  let i = 0;
  while (i < words.length) {
    const word = words[i] as string;
    if (ASSIGNMENT.test(word)) {
      i++;
      continue;
    }
    const prefix = programName(word);
    if (!PREFIXES.has(prefix)) break;
    i++;
    if (prefix === "sudo") {
      while (i < words.length && (words[i] as string).startsWith("-")) {
        i += SUDO_VALUED.has(words[i] as string) ? 2 : 1;
      }
    }
  }
  const rest = words.slice(i);
  const name = programName(rest[0]);
  if (SHELLS.has(name)) {
    if (depth >= MAX_DEPTH) return;
    const c = rest.findIndex((w, k) => k > 0 && /^-[A-Za-z]*c$/.test(w));
    const script = c === -1 ? undefined : rest[c + 1];
    if (script !== undefined) scanScript(script, ctx, depth + 1);
    return;
  }
  const binary = ALIASES[name] ?? name;
  const spec = SPECS[binary];
  if (spec !== undefined) scanArgs(binary, spec, rest.slice(1), ctx);
}

function scanScript(command: string, ctx: Ctx, depth: number): void {
  const parsed = parseShell(command);
  if (!parsed.ok) return;
  for (const segment of parsed.value.segments) scanSegment(segment, ctx, depth);
}

/** Cibles réseau d'une ligne de commande shell (Bash, `execute_command`). */
export function shellNetworkTargets(command: string): NetworkTargets {
  const ctx: Ctx = { out: { targets: [], calls: [], unresolved: false }, literal: false };
  scanScript(command, ctx, 0);
  return ctx.out;
}

/** Cibles réseau d'un argv direct (`task_start`, `exec`) : aucune expansion shell. */
export function argvNetworkTargets(argv: readonly string[]): NetworkTargets {
  const ctx: Ctx = { out: { targets: [], calls: [], unresolved: false }, literal: true };
  scanSegment(argv, ctx, 0);
  return ctx.out;
}
