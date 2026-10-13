import { matchCommand, parseShell, type ShellHazard } from "./shell.js";

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
};

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

  if (hazards.size > 0) {
    const labels = [...hazards].map((h) => HAZARD_LABEL[h]).join(", ");
    return { decision: notAuto, reason: `non approuvable automatiquement : ${labels}`, rule: null };
  }

  return verdicts.reduce((acc, v) => (STRICTNESS[v.decision] > STRICTNESS[acc.decision] ? v : acc));
}

export function evaluatePolicy(
  policy: Policy,
  tool: string,
  input: Record<string, unknown>,
): PolicyVerdict {
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
