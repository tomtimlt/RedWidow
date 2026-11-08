import { KALI_EXECUTE_TOOL } from "../kali/tool-specs.js";
import { missingProgramFlags } from "../program/flags.js";
import {
  HTTP_REQUEST_TOOL,
  hostInScope,
  isProgramShellTool,
  programTargets,
} from "../program/scope.js";
import type { ProgramStatus } from "../program/store.js";
import { type Reason, reason, ValidationError } from "../reason.js";
import { TASK_START_TOOLS } from "../tasks/tools.js";
import { isReferenceUrl, READ_URL_TOOL, SEARCH_WEB_TOOL, webArgumentGuard } from "../web/guard.js";
import {
  checkPathAccess,
  defaultPlatform,
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  extractPaths,
  findGlobHazard,
  mentionsEngagementFile,
  mentionsProgramFile,
  type PathPlatform,
} from "./paths.js";
import { matchCommand, parseShell, programName } from "./shell.js";

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
    { tool: "mcp__desk__load_skill", decision: "allow" },
    // Lecture du run courant et annotation en mémoire : aucune exécution ni persistance.
    { tool: "mcp__desk__mission_context", decision: "allow" },
    { tool: "mcp__desk__record_decision", decision: "allow" },
    // Annotation structurée avec références du run, sans exécution ni chemin choisi par le modèle.
    { tool: "mcp__desk__record_test", decision: "allow" },
    // Matrice de couverture : annotation en mémoire du run, mêmes garanties que record_test.
    { tool: "mcp__desk__record_coverage", decision: "allow" },
    // Écrit un brouillon de fiche programme (fichier du projet) : jamais en allow, toujours demandé.
    { tool: "mcp__desk__program_draft", decision: "ask" },
    // Recherche web : destination unique et fixe ; la garde d'arguments (ADR 0039) reste appliquée.
    { tool: SEARCH_WEB_TOOL, decision: "allow" },
    { tool: "mcp__burp__list_tools", decision: "allow" },
    { tool: "mcp__docker__ps", decision: "allow" },
    { tool: "mcp__docker__images", decision: "allow" },
    { tool: "mcp__docker__logs", decision: "allow" },
    { tool: "mcp__docker__inspect", decision: "allow" },
    {
      tool: "mcp__docker__rm",
      decision: "deny",
      reason: "suppression de conteneur : à faire à la main",
    },
    // Annotation réversible de liens déjà existants, bornée au projet par le toolset.
    { tool: "mcp__exegol__mark_path", decision: "allow" },
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
/** Rend le statut de la fiche programme du projet actif (lecture synchrone, ADR 0040). */
export type ProgramProvider = () => ProgramStatus;

export interface PolicyContext {
  /** Fiche programme du projet actif ; absent → aucun effet de périmètre. Fixé par le code appelant. */
  program?: ProgramProvider;
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
  const shellText =
    typeof input.command === "string"
      ? input.command
      : Array.isArray(input.argv)
        ? input.argv.map(String).join(" ")
        : "";
  if (shellText !== "" && mentionsProgramFile(shellText)) {
    return {
      decision: "deny",
      reason: reason("path.sensitive", { path: "program.json" }),
      rule: null,
    };
  }
  if (shellText !== "" && mentionsEngagementFile(shellText)) {
    return {
      decision: "deny",
      reason: reason("path.sensitive", { path: "engagement.json" }),
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
  const base = evaluateUncapped(policy, tool, input, ctx);
  return capExternal(policy, tool, input, evaluateProgram(tool, input, base, ctx));
}

/** Motifs d'un `ask` « souple » (défaut ou règle) : seuls ceux-là cèdent la place au périmètre. */
const SOFT_ASK = new Set(["policy.default", "policy.rule", "policy.rule.custom"]);

/** Statut de la fiche ; un fournisseur qui lève est traité comme une fiche illisible (fail-closed). */
function programStatus(provider: ProgramProvider): ProgramStatus {
  try {
    return provider();
  } catch {
    return { state: "unreadable" };
  }
}

/**
 * Périmètre du programme (ADR 0040), après `evaluateUncapped` (donc après `evaluateWeb`). Ne
 * transforme jamais un `deny`, ni un `ask` de garde (`web.query_sensitive`, chemins…) : ceux-là
 * restent non mémorisables. N'agit que sur les hôtes visibles (`read_url`, `http_request`, champ
 * `target` des outils Kali) et seulement si la fiche est approuvée à son empreinte courante.
 * Fiche illisible → `ask` non mémorisable. Hors périmètre → `ask` mémorisable par hôte seulement.
 * Commande shell dans le périmètre sans les drapeaux attendus → `ask` `program.flag_missing`,
 * mémorisable par binaire seulement.
 */
function evaluateProgram(
  tool: string,
  input: Record<string, unknown>,
  base: PolicyVerdict,
  ctx: PolicyContext,
): PolicyVerdict {
  if (ctx.program === undefined || base.decision === "deny") return base;
  // `execute_command`, `task_start` et `exec` sont toujours « shell non analysable » : ask non
  // mémorisable, que le périmètre précise sans l'affaiblir (la gate ne mémorise jamais leurs hôtes).
  const unanalyzable = base.reason.code === "shell.unanalyzable" && isProgramShellTool(tool);
  if (base.decision === "ask" && !SOFT_ASK.has(base.reason.code) && !unanalyzable) return base;
  const targets = programTargets(tool, input);
  if (targets === null || (targets.hosts.length === 0 && !targets.unresolved)) return base;
  const { hosts } = targets;
  const status = programStatus(ctx.program);
  if (status.state === "unreadable") {
    return { decision: "ask", reason: reason("program.unreadable", { part: "sheet" }), rule: null };
  }
  const sheet = status.state === "approved" ? status.applied : undefined;
  if (sheet === undefined) return base;
  const outside = hosts.filter((host) => !hostInScope(sheet, host));
  if (outside.length > 0) {
    return {
      decision: "ask",
      reason: reason("program.out_of_scope", { tool, host: outside.join(", ") }),
      rule: null,
    };
  }
  if (targets.unresolved) {
    // Outil réseau connu dont l'hôte n'est pas extractible : jamais mémorisable (ADR 0040).
    return {
      decision: "ask",
      reason: reason("program.host_unresolved", { tool }),
      rule: null,
    };
  }
  // Commande shell vers des hôtes du périmètre : User-Agent et débit de la fiche attendus (lot 7).
  const missing = missingProgramFlags(sheet, targets.calls ?? []);
  if (missing.length > 0) {
    return {
      decision: "ask",
      reason: reason("program.flag_missing", {
        binary: missing.map((m) => m.binary).join(", "),
        flag: missing.map((m) => m.flag).join(" ; "),
      }),
      rule: null,
    };
  }
  if (
    (tool === READ_URL_TOOL || tool === HTTP_REQUEST_TOOL) &&
    base.decision === "ask" &&
    base.rule === null
  ) {
    return {
      decision: "allow",
      reason: reason("program.in_scope", { tool, host: hosts.join(", ") }),
      rule: null,
    };
  }
  return base;
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
  if (
    /^mcp__(?:burp|playwright|filesystem|markitdown|reptor|serena|semgrep|trivy|bloodhound|ghidra|wiremcp)__call_tool$/.test(
      tool,
    )
  ) {
    // Le schéma Burp n’est pas analysé par la politique : une règle globale allow ne suffit pas.
    const denied = policy.rules.findIndex(
      (rule) => rule.decision === "deny" && toolMatches(rule, tool),
    );
    return denied >= 0
      ? {
          decision: "deny",
          reason: describe(policy.rules[denied] as PolicyRule, denied),
          rule: denied,
        }
      : {
          decision: stricter("ask", policy.default),
          reason: reason("policy.default", { tool }),
          rule: null,
        };
  }
  if (isUnanalyzableShellTool(tool)) return evaluateUnanalyzable(policy, tool);
  if (TASK_START_TOOLS.has(tool)) {
    const argv = Array.isArray(input.argv) ? input.argv : [];
    const command = argv.map((arg) => `'${String(arg).replace(/'/g, "'\\''")}'`).join(" ");
    const legacy = tool.startsWith("mcp__kali__") ? KALI_EXECUTE_TOOL : "mcp__exegol__exec";
    const inherited = evaluateUncapped(policy, legacy, { ...input, command }, ctx);
    if (inherited.decision === "deny") return inherited;
    const analysed = evaluateBash(policy, command);
    if (analysed.decision === "deny") return analysed;
    return evaluateUnanalyzable(policy, tool);
  }
  if (tool === KALI_EXECUTE_TOOL) {
    // Shell du conteneur : l'analyse POSIX refuse, elle n'autorise jamais, quelle que soit la plateforme.
    const command = input.command;
    if (typeof command === "string") {
      const analysed = evaluateBash(policy, command);
      if (analysed.decision === "deny") return analysed;
    }
    return evaluateUnanalyzable(policy, tool);
  }
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
  const base = firstMatch(policy.rules, (r) => r.command === undefined && toolMatches(r, tool)) ?? {
    decision: policy.default,
    reason: reason("policy.default", { tool }),
    rule: null,
  };
  return tool === SEARCH_WEB_TOOL || tool === READ_URL_TOOL
    ? evaluateWeb(policy, tool, input, base)
    : base;
}

/**
 * Outils web (ADR 0039). Un `deny` reste prioritaire. Un argument sensible (secret, valeur masquée,
 * IP privée) repasse en `ask` non mémorisable (`web.query_sensitive`), même vers un hôte de
 * référence. Sinon `read_url` vers une source de référence en HTTPS remplace le seul « ask » par
 * défaut (aucune règle) : une règle `ask` explicite de la politique est respectée.
 */
function evaluateWeb(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
  base: PolicyVerdict,
): PolicyVerdict {
  if (base.decision === "deny") return base;
  const finding = webArgumentGuard(tool, input);
  if (finding !== null) {
    return {
      decision: stricter("ask", policy.default),
      reason: reason("web.query_sensitive", { tool, finding }),
      rule: null,
    };
  }
  if (
    tool === READ_URL_TOOL &&
    base.decision === "ask" &&
    base.rule === null &&
    isReferenceUrl(input.url)
  ) {
    return {
      decision: "allow",
      reason: reason("web.reference_source", { host: new URL(String(input.url)).hostname }),
      rule: null,
    };
  }
  return base;
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
    // Joker : seulement `*` seul comme jeton entier (ADR 0003) ; sinon `rm -rf /work/*` serait un littéral trompeur.
    if (
      typeof command === "string" &&
      command.split(/\s+/).some((t) => t.includes("*") && t !== "*")
    ) {
      throw new ValidationError("policy.invalid.commandWildcard", { index });
    }
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
