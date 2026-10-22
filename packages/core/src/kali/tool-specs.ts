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
  "Le champ container est le conteneur dédié du projet, ou un nom que l'utilisateur a cité avec @. " +
  "Tu ne crées, n'arrêtes ni ne publies de conteneur.";

const containerField = z.string().min(1).describe("Nom du conteneur dédié ou cité par @");
const required = (description: string) => z.string().min(1).describe(description);
const optional = () => z.string().optional();
/** Chaîne d'arguments. `server.py` la passe à `shlex.split` : le JSON la porte telle quelle. */
const shlexField = () => z.string().optional().describe("Chaîne d'arguments");

/** Champs découpés par le serveur. Le corps HTTP les laisse en chaînes. */
const SHLEX_FIELDS = new Set(["scan_type", "additional_args"]);

interface KaliToolDef {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  /** Clés du corps, celles de `client.py`. `container` n'y figure pas. John : `format`. */
  keys: readonly string[];
  input: z.ZodRawShape;
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
  },
  {
    name: "dirb_scan",
    description: "Dirb vers url. wordlist et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/dirb",
    keys: ["url", "wordlist", "additional_args"],
    input: { url: required("URL cible"), wordlist: optional(), additional_args: shlexField() },
  },
  {
    name: "nikto_scan",
    description: "Nikto vers target. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/nikto",
    keys: ["target", "additional_args"],
    input: { target: required("Hôte, adresse ou URL"), additional_args: shlexField() },
  },
  {
    name: "sqlmap_scan",
    description: "sqlmap vers url. data et additional_args sont optionnels.",
    method: "POST",
    path: "/api/tools/sqlmap",
    keys: ["url", "data", "additional_args"],
    input: { url: required("URL cible"), data: optional(), additional_args: shlexField() },
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
  },
  {
    name: "wpscan_analyze",
    description: "WPScan vers url. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/wpscan",
    keys: ["url", "additional_args"],
    input: { url: required("URL cible"), additional_args: shlexField() },
  },
  {
    name: "enum4linux_scan",
    description: "enum4linux vers target. additional_args est optionnel.",
    method: "POST",
    path: "/api/tools/enum4linux",
    keys: ["target", "additional_args"],
    input: { target: required("Hôte ou adresse"), additional_args: shlexField() },
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
 * Corps HTTP : clé absente ou chaîne vide omise. `container` n'est jamais envoyé.
 * `scan_type` et `additional_args` restent des chaînes : le serveur les découpe.
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
        const container = resolveKaliContainer(targets.current(), String(args.container), rows);
        const row = rows.find((r) => r.name === container);
        if (row === undefined || row.state !== "running") {
          throw new CodedError("project.notRunning", { name: container });
        }
        const lines = await api.call(
          container,
          {
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
