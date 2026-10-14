import { type Reason, reason, ValidationError } from "../reason.js";
import {
  checkPathAccess,
  defaultPlatform,
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  extractPaths,
  findGlobHazard,
  type PathPlatform,
} from "./paths.js";
import { isInterpreterArgv, matchCommand, parseShell, programName } from "./shell.js";

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
  reason: Reason;
  /** Index de la règle déterminante, `null` si défaut ou analyse. */
  rule: number | null;
}

const STRICTNESS: Record<RuleDecision, number> = { allow: 0, ask: 1, deny: 2 };
const PRECEDENCE: readonly RuleDecision[] = ["deny", "ask", "allow"];

export const BASH_TOOL = "Bash";
export const POWERSHELL_TOOL = "PowerShell";
/** Outil d'exécution du bac à sable (toolset `sandbox`, ADR 0003). */
export const SANDBOX_EXEC_TOOL = "mcp__sandbox__exec";
/** Préfixe de tous les outils du bac à sable : jamais de mémorisation par nom seul. */
export const SANDBOX_TOOL_PREFIX = "mcp__sandbox__";

/**
 * Outils de shell dont la ligne de commande ne peut pas être analysée de façon sûre (PowerShell :
 * grammaire trop riche, pas d'analyseur). Comparés sans casse. Au mieux `ask`, jamais mémorisable.
 */
const UNANALYZABLE_SHELL_TOOLS = new Set(["powershell", "pwsh"]);

/** `true` pour un outil de shell sans analyseur (`PowerShell`, `pwsh`), quelle que soit la casse. */
export function isUnanalyzableShellTool(tool: string): boolean {
  return UNANALYZABLE_SHELL_TOOLS.has(tool.toLowerCase());
}

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

function describe(rule: PolicyRule, index: number): Reason {
  if (rule.reason !== undefined) return reason("policy.rule.custom", { text: rule.reason });
  const target = rule.command ? `${rule.tool}(${rule.command})` : rule.tool;
  return reason("policy.rule", { index, decision: rule.decision, target });
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
    return {
      decision: notAuto,
      reason: reason("bash.unparseable", undefined, parsed.error),
      rule: null,
    };
  }
  const { segments, hazards } = parsed.value;
  if (segments.length === 0) {
    return { decision: notAuto, reason: reason("bash.empty"), rule: null };
  }

  const verdicts = segments.map(
    (argv) =>
      firstMatch(
        policy.rules,
        (r) =>
          toolMatches(r, BASH_TOOL) &&
          (r.command === undefined || matchCommand(r.command, argv, r.decision === "deny")),
      ) ?? {
        decision: policy.default,
        reason: reason("bash.noRule", { command: argv.join(" ") }),
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
        reason: reason("docker.hostAccess", { flag: hazard }),
        rule: null,
      };
    }
  }

  if (hazards.size > 0) {
    return {
      decision: notAuto,
      reason: reason("bash.hazard", { hazards: [...hazards].join(",") }),
      rule: null,
    };
  }

  return verdicts.reduce((acc, v) => (STRICTNESS[v.decision] > STRICTNESS[acc.decision] ? v : acc));
}

/**
 * Verdict d'un shell non analysable : une règle `deny` visant l'outil s'applique toujours, avec ou
 * sans motif `command:` (on ne peut pas analyser la commande : l'outil entier est refusé, au mieux) ;
 * casse ignorée sur le nom d'outil. Sinon `ask` au mieux, jamais `allow` (même par une règle `*`).
 */
function evaluateUnanalyzable(policy: Policy, tool: string): PolicyVerdict {
  const lower = tool.toLowerCase();
  const denied = policy.rules.findIndex(
    (r) => r.decision === "deny" && (toolMatches(r, tool) || r.tool.toLowerCase() === lower),
  );
  if (denied !== -1) {
    return {
      decision: "deny",
      reason: describe(policy.rules[denied] as PolicyRule, denied),
      rule: denied,
    };
  }
  return {
    decision: stricter("ask", policy.default),
    reason: reason("shell.unanalyzable", { tool }),
    rule: null,
  };
}

/**
 * `argv` et `cwd` validés d'un appel `mcp__sandbox__exec`, ou `null` (entrée invalide : refus).
 * `cwd` absent → `/work`. Source unique pour la politique et la clé de session de la gate.
 */
export function sandboxExecInput(
  input: Record<string, unknown>,
): { argv: string[]; cwd: string } | null {
  const { argv, cwd = "/work" } = input;
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 256) return null;
  if (!argv.every((a) => typeof a === "string" && !a.includes("\0"))) return null;
  if (argv[0] === "" || typeof cwd !== "string" || cwd.includes("\0")) return null;
  return { argv: argv as string[], cwd };
}

/**
 * Verdict de `mcp__sandbox__exec` : les motifs `command` s'appliquent à l'argv (pas à un shell).
 * `deny` : motif comparé aussi au basename de `argv[0]`. Interpréteur ou enveloppe : un `allow` à
 * joker ne s'applique pas (seul un motif sans joker identique à l'argv complet autorise), au mieux
 * `ask` (`sandbox.interpreter`).
 */
function evaluateSandboxExec(policy: Policy, input: Record<string, unknown>): PolicyVerdict {
  const parsed = sandboxExecInput(input);
  if (parsed === null) {
    return {
      decision: "deny",
      reason: reason("sandbox.invalidArgument", {
        field: "argv",
        reason: Array.isArray(input.argv) ? "format" : "notStrings",
      }),
      rule: null,
    };
  }
  const { argv } = parsed;
  const interpreter = isInterpreterArgv(argv);
  const hit = firstMatch(policy.rules, (r) => {
    if (!toolMatches(r, SANDBOX_EXEC_TOOL)) return false;
    if (r.command === undefined) return !(interpreter && r.decision === "allow");
    if (r.decision === "deny") return matchCommand(r.command, argv, true);
    if (!matchCommand(r.command, argv)) return false;
    // allow d'un interpréteur : seulement un motif exact, sans aucun joker.
    return !(interpreter && r.decision === "allow" && r.command.includes("*"));
  });
  if (hit) return hit;
  if (interpreter) {
    return {
      decision: stricter("ask", policy.default),
      reason: reason("sandbox.interpreter", { program: programName(argv[0]) }),
      rule: null,
    };
  }
  return {
    decision: policy.default,
    reason: reason("policy.default", { tool: SANDBOX_EXEC_TOOL }),
    rule: null,
  };
}

/** Verdict POSIX d'un Bash dont la commande n'est peut-être pas une chaîne (refus pour l'analyse). */
function evaluatePolicyBash(policy: Policy, command: unknown): PolicyVerdict {
  if (typeof command !== "string") {
    return {
      decision: stricter("ask", policy.default),
      reason: reason("bash.missingCommand"),
      rule: null,
    };
  }
  return evaluateBash(policy, command);
}

/** Contexte d'évaluation des outils qui touchent au système de fichiers. */
export interface PolicyContext {
  /** Répertoire de travail ; sert à résoudre les chemins relatifs. */
  cwd: string;
  /** Racines autorisées (défaut : `[cwd]`). Hors de ces racines, un `allow` est rétrogradé en `ask`. */
  roots?: readonly string[];
  /** Répertoire personnel (défaut : `USERPROFILE`/`HOME`, puis `os.homedir()`), pour les chemins sensibles. */
  home?: string;
  /** Résolution des liens symboliques (défaut : `realpathSync.native`) ; lève (`ENOENT`) si le chemin n'existe pas. */
  realpath?: (path: string) => string;
  /** `lstat` (défaut : `lstatSync`) : détecte les liens symboliques pendants. Voir `PathOptions.lstat`. */
  lstat?: (path: string) => unknown;
  /** `readlink` (défaut : `readlinkSync`) : cible d'un lien symbolique pendant. */
  readlink?: (path: string) => string;
  /** Saveur des chemins (défaut : dérivée de `process.platform`). Fixée par le code seulement, jamais par la politique. */
  platform?: PathPlatform;
  /**
   * `true` : l'outil `Bash` est confirmé POSIX (Git Bash). Sous la plateforme `win32` (celle du
   * contexte), le défaut est fail-closed : `Bash` est un shell non analysable (bash d'OpenCode : cmd
   * ou PowerShell) sauf déclaration explicite `true`. Hors win32, le défaut est POSIX. Fixé par le
   * code appelant seulement, jamais par l'entrée de l'outil ni par la politique.
   */
  posixShell?: boolean;
  /** Environnement pour `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `ProgramData` (défaut : `process.env`). */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Verdict des garde-fous de chemin, ou `null` si rien à signaler. */
function checkPaths(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext,
): PolicyVerdict | null {
  const hazard = findGlobHazard(tool, input, ctx.platform);
  if (hazard !== null) {
    // La base statique du motif ne dit pas ce qu'il atteint (`{..,x}`, `C:*`…) : refus, jamais mémorisable.
    return {
      decision: "deny",
      reason: reason("path.unsupported", { path: hazard, form: "unresolvable" }),
      rule: null,
    };
  }
  const candidates = extractPaths(tool, input, ctx.platform);
  if (candidates.length === 0) return null;
  const finding = checkPathAccess(candidates, ctx);
  if (finding === null) return null;
  switch (finding.kind) {
    case "sensitive":
      return {
        decision: "deny",
        reason: reason("path.sensitive", { path: finding.path }),
        rule: null,
      };
    case "unsupported":
      return {
        decision: "deny",
        reason: reason("path.unsupported", { path: finding.path, form: finding.form }),
        rule: null,
      };
    case "outside":
      return {
        decision: stricter("ask", policy.default),
        reason: reason("path.outside", { path: finding.path }),
        rule: null,
      };
  }
}

/**
 * Un appel qui porte `externalDirectories` (répertoires externes déclarés par l'adaptateur) ne
 * peut jamais être autorisé automatiquement : on plafonne à `ask`. Un `deny` reste `deny`.
 */
function capExternal(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  verdict: PolicyVerdict,
): PolicyVerdict {
  if (verdict.decision !== "allow" || !(EXTERNAL_PATTERNS_FIELD in input)) return verdict;
  return {
    decision: stricter("ask", policy.default),
    reason: reason("policy.default", { tool }),
    rule: null,
  };
}

export function evaluatePolicy(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext = { cwd: process.cwd() },
): PolicyVerdict {
  return capExternal(policy, tool, input, evaluateUncapped(policy, tool, input, ctx));
}

function evaluateUncapped(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext,
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
  if (tool === EXTERNAL_DIRECTORY_TOOL) {
    // Accès hors de l'espace de travail : jamais d'`allow` automatique, quelle que soit la règle.
    const rule = firstMatch(policy.rules, (r) => r.command === undefined && toolMatches(r, tool));
    if (rule?.decision === "deny") return rule;
    return {
      decision: stricter("ask", policy.default),
      reason: reason("policy.default", { tool }),
      rule: null,
    };
  }
  if (tool === SANDBOX_EXEC_TOOL) return evaluateSandboxExec(policy, input);
  if (isUnanalyzableShellTool(tool)) return evaluateUnanalyzable(policy, tool);
  if (tool === BASH_TOOL) {
    if (!(ctx.posixShell ?? (ctx.platform ?? defaultPlatform()) !== "win32")) {
      // Shell non confirmé POSIX : l'analyse POSIX ne vaut rien pour autoriser, seulement pour refuser.
      const command = input.command;
      const analysed = evaluatePolicyBash(policy, command);
      if (analysed.decision === "deny") return analysed;
      return evaluateUnanalyzable(policy, tool);
    }
    const command = input.command;
    if (typeof command !== "string") {
      return {
        decision: stricter("ask", policy.default),
        reason: reason("bash.missingCommand"),
        rule: null,
      };
    }
    return evaluateBash(policy, command);
  }
  return (
    firstMatch(policy.rules, (r) => r.command === undefined && toolMatches(r, tool)) ?? {
      decision: policy.default,
      reason: reason("policy.default", { tool }),
      rule: null,
    }
  );
}

const DECISIONS = new Set<string>(["allow", "ask", "deny"]);

/**
 * Valide une politique issue d'un fichier JSON. Lève une `ValidationError` (codes `policy.invalid.*`).
 * Note : une règle `allow` sur l'outil `external_directory` est valide mais sans effet (ignorée par
 * `evaluatePolicy`, qui ne l'autorise jamais automatiquement) ; aucun mécanisme d'avertissement de
 * chargement n'existe pour une politique valide, donc elle est acceptée silencieusement.
 */
export function parsePolicy(raw: unknown): Policy {
  if (typeof raw !== "object" || raw === null) throw new ValidationError("policy.invalid.object");
  const obj = raw as Record<string, unknown>;
  const def = obj.default ?? "ask";
  if (typeof def !== "string" || !DECISIONS.has(def)) {
    throw new ValidationError("policy.invalid.default", { value: String(def) });
  }
  if (!Array.isArray(obj.rules)) throw new ValidationError("policy.invalid.rules");

  const rules = (obj.rules as unknown[]).map((r, index): PolicyRule => {
    const field = (name: string): never => {
      throw new ValidationError("policy.invalid.ruleField", { index, field: name });
    };
    if (typeof r !== "object" || r === null) {
      throw new ValidationError("policy.invalid.ruleObject", { index });
    }
    const { tool, command, decision, reason: text } = r as Record<string, unknown>;
    if (typeof tool !== "string" || tool === "") field("tool");
    if (typeof decision !== "string" || !DECISIONS.has(decision)) field("decision");
    if (command !== undefined && typeof command !== "string") field("command");
    if (text !== undefined && typeof text !== "string") field("reason");
    return {
      tool: tool as string,
      decision: decision as RuleDecision,
      ...(command !== undefined && { command: command as string }),
      ...(text !== undefined && { reason: text as string }),
    };
  });

  return { default: def as RuleDecision, rules };
}
