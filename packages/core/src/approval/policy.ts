import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { matchCommand, parseShell, programName, type ShellHazard } from "./shell.js";

export type RuleDecision = "allow" | "ask" | "deny";

export interface PolicyRule {
  /** Nom d'outil SDK, `*` accepté (ex. "Read", "mcp__docker__*"). */
  tool: string;
  /** Motif de commande pour l'outil Bash (voir `matchCommand`). */
  command?: string;
  decision: RuleDecision;
  reason?: string;
}

export interface Policy {
  default: RuleDecision;
  rules: PolicyRule[];
}

export interface PolicyVerdict {
  decision: RuleDecision;
  reason: string;
  /** Index de la règle déterminante, `null` si défaut ou analyse. */
  rule: number | null;
}

const STRICTNESS: Record<RuleDecision, number> = { allow: 0, ask: 1, deny: 2 };
const PRECEDENCE: readonly RuleDecision[] = ["deny", "ask", "allow"];

export const BASH_TOOL = "Bash";

export const DEFAULT_POLICY: Policy = {
  default: "ask",
  rules: [
    { tool: "Read", decision: "allow" },
    { tool: "Glob", decision: "allow" },
    { tool: "Grep", decision: "allow" },
    { tool: BASH_TOOL, command: "docker ps *", decision: "allow" },
    { tool: BASH_TOOL, command: "docker images *", decision: "allow" },
    { tool: BASH_TOOL, command: "docker logs *", decision: "allow" },
    { tool: BASH_TOOL, command: "docker inspect *", decision: "allow" },
    { tool: BASH_TOOL, command: "docker version *", decision: "allow" },
    { tool: BASH_TOOL, command: "docker system prune *", decision: "deny" },
    { tool: BASH_TOOL, command: "docker volume rm *", decision: "deny" },
    { tool: BASH_TOOL, command: "rm *", decision: "deny" },
    { tool: BASH_TOOL, command: "sudo *", decision: "deny" },
    { tool: "mcp__docker__ps", decision: "allow" },
    { tool: "mcp__docker__images", decision: "allow" },
    { tool: "mcp__docker__logs", decision: "allow" },
    { tool: "mcp__docker__inspect", decision: "allow" },
    {
      tool: "mcp__docker__rm",
      decision: "deny",
      reason: "suppression de conteneur : à faire à la main",
    },
  ],
};

function stricter(a: RuleDecision, b: RuleDecision): RuleDecision {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function toolMatches(rule: PolicyRule, tool: string): boolean {
  return rule.tool === tool || (rule.tool.includes("*") && globToRegExp(rule.tool).test(tool));
}

function describe(rule: PolicyRule, index: number): string {
  const target = rule.command ? `${rule.tool}(${rule.command})` : rule.tool;
  return rule.reason ?? `règle #${index} ${rule.decision} ${target}`;
}

/** Première règle d'une décision donnée qui correspond, par ordre de précédence. */
function firstMatch(
  rules: readonly PolicyRule[],
  test: (rule: PolicyRule) => boolean,
): PolicyVerdict | null {
  for (const decision of PRECEDENCE) {
    const index = rules.findIndex((r) => r.decision === decision && test(r));
    if (index !== -1) {
      return { decision, reason: describe(rules[index] as PolicyRule, index), rule: index };
    }
  }
  return null;
}

const HAZARD_LABEL: Record<ShellHazard, string> = {
  substitution: "substitution de commande",
  expansion: "expansion non résolue statiquement",
  redirect: "redirection",
  assignment: "affectation de variable en préfixe",
  background: "exécution en arrière-plan",
  indirection: "exécute une autre commande (bash -c, env, xargs, find -exec…)",
};

const CONTAINER_ENGINES = new Set(["docker", "podman"]);
const RUN_SUBCOMMANDS = new Set(["run", "create"]);
/** Options qui donnent au conteneur un accès à l'hôte. Valeur `host` pour les espaces de noms. */
const HOST_ACCESS_FLAGS = new Set([
  "--volume",
  "--mount",
  "--privileged",
  "--cap-add",
  "--device",
  "--security-opt",
  "--volumes-from",
]);
const HOST_NAMESPACE_FLAGS = new Set(["--pid", "--network", "--net", "--ipc", "--uts", "--userns"]);

/**
 * Motif dangereux d'un `docker run|create` (volumes, mode privilégié, espaces
 * de noms de l'hôte…), ou `null`. Analyse volontairement large : un faux
 * positif refuse, un faux négatif donnerait l'hôte à l'agent.
 */
export function dockerRunHazard(argv: readonly string[]): string | null {
  if (!CONTAINER_ENGINES.has(programName(argv[0]))) return null;
  const rest = argv.slice(1);
  const sub = rest[0] === "container" ? rest[1] : rest[0];
  if (sub === undefined || !RUN_SUBCOMMANDS.has(sub)) return null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("-") || arg === "-") continue;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      if (HOST_ACCESS_FLAGS.has(flag)) return flag;
      if (HOST_NAMESPACE_FLAGS.has(flag)) {
        const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
        if (value === "host" || value?.startsWith("container:")) return `${flag} ${value}`;
      }
    } else if (/^-[A-Za-z]*v/.test(arg)) {
      return "-v"; // -v, -v/:/host, -itv…
    }
  }
  return null;
}

function evaluateBash(policy: Policy, command: string): PolicyVerdict {
  const notAuto = stricter("ask", policy.default);

  const parsed = parseShell(command);
  if (!parsed.ok) {
    return { decision: notAuto, reason: `commande non analysable : ${parsed.error}`, rule: null };
  }
  const { segments, hazards } = parsed.value;
  if (segments.length === 0) {
    return { decision: notAuto, reason: "commande vide", rule: null };
  }

  const verdicts = segments.map(
    (argv) =>
      firstMatch(
        policy.rules,
        (r) =>
          toolMatches(r, BASH_TOOL) && (r.command === undefined || matchCommand(r.command, argv)),
      ) ?? {
        decision: policy.default,
        reason: `aucune règle pour « ${argv.join(" ")} »`,
        rule: null,
      },
  );

  const denied = verdicts.find((v) => v.decision === "deny");
  if (denied) return denied;

  for (const argv of segments) {
    const hazard = dockerRunHazard(argv);
    if (hazard) {
      return {
        decision: "deny",
        reason: `conteneur avec accès à l'hôte (${hazard}) : à faire à la main`,
        rule: null,
      };
    }
  }

  if (hazards.size > 0) {
    const labels = [...hazards].map((h) => HAZARD_LABEL[h]).join(", ");
    return { decision: notAuto, reason: `non approuvable automatiquement : ${labels}`, rule: null };
  }

  return verdicts.reduce((acc, v) => (STRICTNESS[v.decision] > STRICTNESS[acc.decision] ? v : acc));
}

/** Contexte d'évaluation des outils qui touchent au système de fichiers. */
export interface PolicyContext {
  /** Répertoire de travail ; sert à résoudre les chemins relatifs. */
  cwd: string;
  /** Racines autorisées (défaut : `[cwd]`). Hors de ces racines, un `allow` est rétrogradé en `ask`. */
  roots?: readonly string[];
  /** Répertoire personnel (défaut : `os.homedir()`), pour les chemins sensibles. */
  home?: string;
  /** Résolution des liens symboliques (défaut : `realpathSync.native`) ; lève si le chemin n'existe pas. */
  realpath?: (path: string) => string;
}

/** Chemins qu'aucun outil ne doit lire ni écrire, relatifs au répertoire personnel. */
const SENSITIVE_HOME_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker/config.json",
  ".netrc",
  ".git-credentials",
  ".config/gh",
  ".config/john-studio",
  ".npmrc",
];
const SENSITIVE_ABSOLUTE_PATHS = ["/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/sudoers.d"];

/** Outils fichiers → champs de l'entrée qui portent un chemin. */
const PATH_FIELDS: Record<string, readonly string[]> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Grep: ["path"],
  Glob: ["path"],
};

/** Résout les liens symboliques d'un chemin ; doit lever si le chemin n'existe pas. */
function defaultRealpath(path: string): string {
  return realpathSync.native(path);
}

/**
 * Chemin absolu sans lien symbolique. Pour un fichier qui n'existe pas encore,
 * résout le plus proche ancêtre existant puis réattache la fin du chemin.
 */
function canonical(path: string, realpath: (p: string) => string): string {
  const full = resolve(path);
  const tail: string[] = [];
  let current = full;
  for (;;) {
    try {
      return join(realpath(current), ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return full;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Préfixe statique d'un motif glob (jusqu'au premier segment contenant un métacaractère). */
function globBase(pattern: string): string {
  const out: string[] = [];
  for (const part of pattern.split(/[\\/]/)) {
    if (/[*?[\]{}]/.test(part)) break;
    out.push(part);
  }
  return out.join("/") || (pattern.startsWith("/") ? "/" : ".");
}

function extractPaths(tool: string, input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const field of PATH_FIELDS[tool] ?? []) {
    const value = input[field];
    if (typeof value === "string" && value !== "") paths.push(value);
  }
  if (tool === "Glob" && typeof input.pattern === "string") {
    const pattern = input.pattern;
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..") || pattern.startsWith("~")) {
      paths.push(globBase(pattern));
    }
  }
  return paths;
}

function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** Verdict des garde-fous de chemin, ou `null` si rien à signaler. */
function checkPaths(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext,
): PolicyVerdict | null {
  const candidates = extractPaths(tool, input);
  if (candidates.length === 0) return null;
  const realpath = ctx.realpath ?? defaultRealpath;
  const home = ctx.home ?? homedir();
  const roots = (ctx.roots ?? [ctx.cwd]).map((r) => canonical(r, realpath));
  const sensitive = [
    ...SENSITIVE_HOME_PATHS.map((p) => join(home, p)),
    ...SENSITIVE_ABSOLUTE_PATHS,
  ].flatMap((p) => [resolve(p), canonical(p, realpath)]);

  let outside: string | null = null;
  for (const candidate of candidates) {
    const expanded = expandHome(candidate, home);
    const absolute = isAbsolute(expanded) ? expanded : resolve(ctx.cwd, expanded);
    for (const path of [resolve(absolute), canonical(absolute, realpath)]) {
      if (sensitive.some((s) => isInside(s, path))) {
        return { decision: "deny", reason: `chemin sensible : ${candidate}`, rule: null };
      }
    }
    if (!roots.some((root) => isInside(root, canonical(absolute, realpath)))) {
      outside ??= candidate;
    }
  }
  if (outside !== null) {
    return {
      decision: stricter("ask", policy.default),
      reason: `chemin hors de l'espace de travail : ${outside}`,
      rule: null,
    };
  }
  return null;
}

export function evaluatePolicy(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext = { cwd: process.cwd() },
): PolicyVerdict {
  const pathVerdict = checkPaths(policy, tool, input, ctx);
  if (pathVerdict) {
    // Un chemin sensible ou extérieur l'emporte sur toute règle `allow` ; un `deny` de règle reste un deny.
    const rule =
      pathVerdict.decision === "deny"
        ? null
        : firstMatch(policy.rules, (r) => r.command === undefined && toolMatches(r, tool));
    if (rule?.decision === "deny") return rule;
    return pathVerdict;
  }
  if (tool === BASH_TOOL) {
    const command = input.command;
    if (typeof command !== "string") {
      return { decision: stricter("ask", policy.default), reason: "commande absente", rule: null };
    }
    return evaluateBash(policy, command);
  }
  return (
    firstMatch(policy.rules, (r) => r.command === undefined && toolMatches(r, tool)) ?? {
      decision: policy.default,
      reason: `aucune règle pour l'outil ${tool}`,
      rule: null,
    }
  );
}

const DECISIONS = new Set<string>(["allow", "ask", "deny"]);

/** Valide une politique issue d'un fichier JSON. Lève une erreur explicite. */
export function parsePolicy(raw: unknown): Policy {
  const fail = (msg: string): never => {
    throw new Error(`politique invalide : ${msg}`);
  };
  if (typeof raw !== "object" || raw === null) fail("objet attendu");
  const obj = raw as Record<string, unknown>;
  const def = obj.default ?? "ask";
  if (typeof def !== "string" || !DECISIONS.has(def)) fail(`default « ${String(def)} »`);
  if (!Array.isArray(obj.rules)) fail("rules doit être un tableau");

  const rules = (obj.rules as unknown[]).map((r, i): PolicyRule => {
    if (typeof r !== "object" || r === null) return fail(`rules[${i}] objet attendu`);
    const { tool, command, decision, reason } = r as Record<string, unknown>;
    if (typeof tool !== "string" || tool === "") fail(`rules[${i}].tool`);
    if (typeof decision !== "string" || !DECISIONS.has(decision)) fail(`rules[${i}].decision`);
    if (command !== undefined && typeof command !== "string") fail(`rules[${i}].command`);
    if (reason !== undefined && typeof reason !== "string") fail(`rules[${i}].reason`);
    return {
      tool: tool as string,
      decision: decision as RuleDecision,
      ...(command !== undefined && { command: command as string }),
      ...(reason !== undefined && { reason: reason as string }),
    };
  });

  return { default: def as RuleDecision, rules };
}
