import { z } from "zod";
import type { CallOptions, DockerClient } from "../docker/client.js";
import type { DockerToolContext, DockerToolSpec } from "../docker/tool-specs.js";
import { formatLines } from "../docker/tool-specs.js";
import { type ExegolTargets, resolveKaliContainer } from "../exegol/targets.js";
import { CodedError, ValidationError } from "../reason.js";
import { KALI_EXEC_TIMEOUT_MS, type KaliApi } from "./api.js";

export const KALI_SERVER_NAME = "kali";
export const KALI_TOOL_PREFIX = "mcp__kali__";
export const KALI_EXECUTE_TOOL = `${KALI_TOOL_PREFIX}execute_command`;
export const KALI_SERVER_INSTRUCTIONS =
  "Tu appelles l'API du conteneur Kali déjà lancé, répertoire /workspace. " +
  "Le champ container est le conteneur dédié du projet, un nom cité avec @, ou le conteneur désigné par # " +
  "(nom complet, nom court, ou shell de ce conteneur). " +
  "Tu ne crées, n'arrêtes ni ne publies de conteneur.";

const containerField = z
  .string()
  .min(1)
  .describe("Nom du conteneur dédié, cité par @, ou désigné par #");
const required = (description: string) => z.string().min(1).describe(description);
const optional = () => z.string().optional();
/** Chaîne d'arguments, découpée comme `shlex.split` avant d'entrer dans la commande. */
const shlexField = () => z.string().optional().describe("Chaîne d'arguments");

/** Champs découpés par le serveur. `execute_command` ne les utilise pas. */
const SHLEX_FIELDS = new Set(["scan_type", "additional_args"]);

/** Caractères laissés nus par `shlex.quote` (ASCII). */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

const GOBUSTER_MODES = new Set(["dir", "dns", "fuzz", "vhost"]);
const WORDLIST_DIRB = "/usr/share/wordlists/dirb/common.txt";
const WORDLIST_ROCKYOU = "/usr/share/wordlists/rockyou.txt";
const MSF_RESOURCE = "/tmp/mks_msf_resource.rc";

interface KaliToolDef {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  /** Clés du corps, celles de `client.py`. `container` n'y figure pas. John : `format`. */
  keys: readonly string[];
  input: z.ZodRawShape;
  /**
   * Commande reçue par `CommandExecutor` via `/api/command`.
   * Absent : le corps reste les clés de `client.py` (`server_health`, `execute_command`).
   */
  command?: (args: Record<string, unknown>) => string;
}

/**
 * Un seul `#` en tête, après le trim que la résolution refera.
 * Le texte du chat et `resolveExegolContainer` ne passent pas ici.
 */
function containerToken(value: string): string {
  const name = value.trim();
  return name.startsWith("#") ? name.slice(1) : name;
}

function textField(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError("docker.invalidArgument", { field: key, reason: "notString" });
  }
  return value === "" ? undefined : value;
}

function mustText(args: Record<string, unknown>, key: string): string {
  const value = textField(args, key);
  if (value === undefined) {
    throw new ValidationError("docker.invalidArgument", { field: key, reason: "missing" });
  }
  return value;
}

/**
 * Découpe POSIX de `shlex.split` (sans commentaires). Guillemet ouvert ou
 * barre oblique en fin de chaîne : l'argument ne part pas.
 */
function splitShlex(value: string, field: string): string[] {
  const fail = (reason: string): never => {
    throw new ValidationError("docker.invalidArgument", { field, reason });
  };
  const out: string[] = [];
  let buf = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = null;
      else buf += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\") {
        const next = value[i + 1];
        if (next === undefined) fail("trailingBackslash");
        buf += next === "\\" || next === '"' ? next : `\\${next}`;
        i += 1;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === "\\") {
      const next = value[i + 1];
      if (next === undefined) fail("trailingBackslash");
      buf += next;
      started = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (started) {
        out.push(buf);
        buf = "";
        started = false;
      }
      continue;
    }
    buf += ch;
    started = true;
  }
  if (quote !== null) fail("unclosedQuote");
  if (started) out.push(buf);
  return out;
}

/** Quote comme `shlex.quote`, pour que `/bin/sh -c` retrouve le même argv. */
function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

function extraTokens(args: Record<string, unknown>, key: string): string[] {
  const value = textField(args, key);
  return value === undefined ? [] : splitShlex(value, key);
}

/**
 * Le paquet d'avant le 20 octobre 2026 construit une liste (`shlex.split` sur
 * `scan_type` et `additional_args`) et la passe à `CommandExecutor`, qui n'accepte
 * qu'une chaîne. `/api/command` est le seul champ qui arrive tel quel. L'argv est
 * celui que la route aurait construit, défauts compris.
 */
function nmapCommand(args: Record<string, unknown>): string {
  const target = mustText(args, "target");
  const scan = textField(args, "scan_type") ?? "-sCV";
  const ports = textField(args, "ports");
  const extra = textField(args, "additional_args") ?? "-T4 -Pn";
  const argv = ["nmap", ...splitShlex(scan, "scan_type")];
  if (ports !== undefined) argv.push("-p", ports);
  argv.push(...splitShlex(extra, "additional_args"), target);
  return shellJoin(argv);
}

function gobusterCommand(args: Record<string, unknown>): string {
  const url = mustText(args, "url");
  const mode = textField(args, "mode") ?? "dir";
  if (!GOBUSTER_MODES.has(mode)) {
    throw new ValidationError("docker.invalidArgument", { field: "mode", reason: "invalid" });
  }
  const wordlist = textField(args, "wordlist") ?? WORDLIST_DIRB;
  return shellJoin([
    "gobuster",
    mode,
    "-u",
    url,
    "-w",
    wordlist,
    ...extraTokens(args, "additional_args"),
  ]);
}

function dirbCommand(args: Record<string, unknown>): string {
  return shellJoin([
    "dirb",
    mustText(args, "url"),
    textField(args, "wordlist") ?? WORDLIST_DIRB,
    ...extraTokens(args, "additional_args"),
  ]);
}

function niktoCommand(args: Record<string, unknown>): string {
  return shellJoin([
    "nikto",
    "-h",
    mustText(args, "target"),
    ...extraTokens(args, "additional_args"),
  ]);
}

function sqlmapCommand(args: Record<string, unknown>): string {
  const argv = ["sqlmap", "-u", mustText(args, "url"), "--batch"];
  const data = textField(args, "data");
  if (data !== undefined) argv.push("--data", data);
  argv.push(...extraTokens(args, "additional_args"));
  return shellJoin(argv);
}

function metasploitCommand(args: Record<string, unknown>): string {
  const module = mustText(args, "module");
  if (!/^[a-zA-Z0-9/_-]+$/.test(module)) {
    throw new ValidationError("docker.invalidArgument", { field: "module", reason: "invalid" });
  }
  const options = args.options;
  const lines = [`use ${module}`];
  if (options !== undefined) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new ValidationError("docker.invalidArgument", {
        field: "options",
        reason: "notObject",
      });
    }
    for (const [key, value] of Object.entries(options)) {
      if (!/^[a-zA-Z0-9_]+$/.test(key) || typeof value !== "string") {
        throw new ValidationError("docker.invalidArgument", {
          field: "options",
          reason: "invalid",
        });
      }
      lines.push(`set ${key} ${value}`);
    }
  }
  lines.push("exploit");
  const script = `${lines.join("\n")}\n`;
  return `printf %s ${shellQuote(script)} > ${MSF_RESOURCE} && msfconsole -q -r ${MSF_RESOURCE}`;
}

function hydraCommand(args: Record<string, unknown>): string {
  const target = mustText(args, "target");
  const service = mustText(args, "service");
  const username = textField(args, "username");
  const usernameFile = textField(args, "username_file");
  const password = textField(args, "password");
  const passwordFile = textField(args, "password_file");
  if (username === undefined && usernameFile === undefined) {
    throw new ValidationError("docker.invalidArgument", { field: "username", reason: "missing" });
  }
  if (password === undefined && passwordFile === undefined) {
    throw new ValidationError("docker.invalidArgument", { field: "password", reason: "missing" });
  }
  const argv = ["hydra", "-t", "4"];
  if (username !== undefined) argv.push("-l", username);
  else if (usernameFile !== undefined) argv.push("-L", usernameFile);
  if (password !== undefined) argv.push("-p", password);
  else if (passwordFile !== undefined) argv.push("-P", passwordFile);
  argv.push(target, service, ...extraTokens(args, "additional_args"));
  return shellJoin(argv);
}

function johnCommand(args: Record<string, unknown>): string {
  const hashFile = mustText(args, "hash_file");
  const argv = ["john"];
  const format = textField(args, "format");
  if (format !== undefined) argv.push(`--format=${format}`);
  argv.push(`--wordlist=${textField(args, "wordlist") ?? WORDLIST_ROCKYOU}`);
  argv.push(...extraTokens(args, "additional_args"), hashFile);
  return shellJoin(argv);
}

function wpscanCommand(args: Record<string, unknown>): string {
  return shellJoin([
    "wpscan",
    "--url",
    mustText(args, "url"),
    ...extraTokens(args, "additional_args"),
  ]);
}

function enum4linuxCommand(args: Record<string, unknown>): string {
  const extra = textField(args, "additional_args") ?? "-a";
  return shellJoin([
    "enum4linux",
    ...splitShlex(extra, "additional_args"),
    mustText(args, "target"),
  ]);
}

const TOOLS: readonly KaliToolDef[] = [
  {
    name: "nmap_scan",
    description:
      "Scan nmap. target est requis ; scan_type, ports et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/nmap",
    keys: ["target", "scan_type", "ports", "additional_args"],
    input: {
      target: required("Hôte ou adresse"),
      scan_type: shlexField(),
      ports: optional(),
      additional_args: shlexField(),
    },
    command: nmapCommand,
  },
  {
    name: "gobuster_scan",
    description: "Gobuster vers url. mode, wordlist et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/gobuster",
    keys: ["url", "mode", "wordlist", "additional_args"],
    input: {
      url: required("URL cible"),
      mode: optional(),
      wordlist: optional(),
      additional_args: shlexField(),
    },
    command: gobusterCommand,
  },
  {
    name: "dirb_scan",
    description: "Dirb vers url. wordlist et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/dirb",
    keys: ["url", "wordlist", "additional_args"],
    input: { url: required("URL cible"), wordlist: optional(), additional_args: shlexField() },
    command: dirbCommand,
  },
  {
    name: "nikto_scan",
    description: "Nikto vers target. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/nikto",
    keys: ["target", "additional_args"],
    input: { target: required("Hôte, adresse ou URL"), additional_args: shlexField() },
    command: niktoCommand,
  },
  {
    name: "sqlmap_scan",
    description: "sqlmap vers url. data et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/sqlmap",
    keys: ["url", "data", "additional_args"],
    input: { url: required("URL cible"), data: optional(), additional_args: shlexField() },
    command: sqlmapCommand,
  },
  {
    name: "metasploit_run",
    description: "Module Metasploit. options, objet de chaînes, est optionnel.",
    method: "POST",
    path: "/api/tools/metasploit",
    keys: ["module", "options"],
    input: {
      module: required("Chemin du module"),
      options: z.record(z.string(), z.string()).optional(),
    },
    command: metasploitCommand,
  },
  {
    name: "hydra_attack",
    description:
      "Hydra vers target et service. Identifiants, fichiers et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/hydra",
    keys: [
      "target",
      "service",
      "username",
      "username_file",
      "password",
      "password_file",
      "additional_args",
    ],
    input: {
      target: required("Hôte ou adresse"),
      service: required("Service"),
      username: optional(),
      username_file: optional(),
      password: optional(),
      password_file: optional(),
      additional_args: shlexField(),
    },
    command: hydraCommand,
  },
  {
    name: "john_crack",
    description:
      "John the Ripper sur hash_file. wordlist, format et additional_args sont optionnels. Le corps envoie format.",
    method: "POST",
    path: "/api/tools/john",
    keys: ["hash_file", "wordlist", "format", "additional_args"],
    input: {
      hash_file: required("Fichier de condensats"),
      wordlist: optional(),
      format: optional(),
      additional_args: shlexField(),
    },
    command: johnCommand,
  },
  {
    name: "wpscan_analyze",
    description: "WPScan vers url. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/wpscan",
    keys: ["url", "additional_args"],
    input: { url: required("URL cible"), additional_args: shlexField() },
    command: wpscanCommand,
  },
  {
    name: "enum4linux_scan",
    description: "enum4linux vers target. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/enum4linux",
    keys: ["target", "additional_args"],
    input: { target: required("Hôte ou adresse"), additional_args: shlexField() },
    command: enum4linuxCommand,
  },
  {
    name: "server_health",
    description: "État du serveur Kali dans le conteneur.",
    method: "GET",
    path: "/health",
    keys: [],
    input: {},
  },
  {
    name: "execute_command",
    description:
      "Commande shell dans le conteneur Kali. La gate la traite comme un shell non analysable.",
    method: "POST",
    path: "/api/command",
    keys: ["command"],
    input: { command: required("Commande shell") },
  },
];

function spec(def: {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: Record<string, unknown>, call: CallOptions): Promise<string>;
}): DockerToolSpec {
  const schema = z.object(def.input);
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    run: async (args, ctx) => def.run(schema.parse(args) as Record<string, unknown>, callOf(ctx)),
  };
}

function callOf(ctx: DockerToolContext): CallOptions {
  return {
    parentId: ctx.parentId,
    timeoutMs: KALI_EXEC_TIMEOUT_MS,
    ...(ctx.correlation && { correlation: ctx.correlation }),
    ...(ctx.signal && { signal: ctx.signal }),
  };
}

/**
 * Corps HTTP de `execute_command` : clé absente ou chaîne vide omise.
 * `container` n'est jamais envoyé. Un tableau ne part pas.
 */
function httpBody(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "container") continue;
    const value = args[key];
    if (value === undefined) continue;
    if (typeof value === "string") {
      if (value === "") continue;
      body[key] = value;
      continue;
    }
    if (SHLEX_FIELDS.has(key)) {
      throw new ValidationError("docker.invalidArgument", { field: key, reason: "notString" });
    }
    body[key] = value;
  }
  return body;
}

/** Les douze outils de `client.py`. Le conteneur est résolu sur la liste Kali, pas choisi librement. */
export function kaliToolSpecs(
  docker: Pick<DockerClient, "listLabelPrefix">,
  api: KaliApi,
  targets: ExegolTargets,
): DockerToolSpec[] {
  return TOOLS.map((tool) =>
    spec({
      name: tool.name,
      description: tool.description,
      input: { container: containerField, ...tool.input },
      async run(args, call) {
        const rows = await docker.listLabelPrefix(call);
        const container = resolveKaliContainer(
          targets.current(),
          containerToken(String(args.container)),
          rows,
        );
        const row = rows.find((r) => r.name === container);
        if (row === undefined || row.state !== "running") {
          throw new CodedError("project.notRunning", { name: container });
        }
        const lines = await api.call(
          container,
          tool.command
            ? { method: "POST", path: "/api/command", body: { command: tool.command(args) } }
            : {
                method: tool.method,
                path: tool.path,
                ...(tool.method === "POST" && { body: httpBody(args, tool.keys) }),
              },
          call,
        );
        return formatLines(lines);
      },
    }),
  );
}
