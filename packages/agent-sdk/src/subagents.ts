import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import {
  SUBAGENT_AGENT_TOOL,
  SUBAGENT_DESCRIPTION,
  SUBAGENT_PROMPT,
  SUBAGENT_TASK_TOOL,
  SUBAGENT_TYPE,
} from "@warband/core";

/**
 * Sous-agents proposés par l'agent et validés par l'utilisateur (ADR 0054), côté Claude Agent SDK.
 * Le moteur définit lui-même l'unique agent `redwidow` : l'option `agents` est verrouillée (jamais
 * surchargeable) et n'est posée que si le mode « Sous-agents » est actif pour la course.
 */

/**
 * Noms de l'outil de lancement d'un sous-agent : `Agent` dans les SDK récents, `Task` avant (le binaire
 * reconnaît les deux). Les deux sont exposés en mode actif ; la gate applique la même règle aux deux.
 */
export const SUBAGENT_LAUNCH_TOOLS: readonly string[] = [SUBAGENT_AGENT_TOOL, SUBAGENT_TASK_TOOL];

/** Outils d'orchestration réservés à l'agent principal : un sous-agent n'y a pas accès. */
export const SUBAGENT_ORCHESTRATION_TOOLS: readonly string[] = ["mcp__desk__propose_subagents"];

/**
 * Option `agents` du mode actif : le seul agent `redwidow`, au modèle de l'agent principal. `tools` reprend
 * les outils de l'agent principal sans l'outil de lancement ni l'orchestration (pas d'imbrication) ;
 * `disallowedTools` répète ces exclusions et celles du shell, au cas où le SDK ne fusionnerait pas la
 * liste de l'agent principal avec celle du sous-agent.
 */
export function subagentDefinitions(
  tools: readonly string[],
  disallowedTools: readonly string[],
): Record<string, AgentDefinition> {
  const excluded = new Set<string>([...SUBAGENT_LAUNCH_TOOLS, ...SUBAGENT_ORCHESTRATION_TOOLS]);
  return {
    [SUBAGENT_TYPE]: {
      description: SUBAGENT_DESCRIPTION,
      prompt: SUBAGENT_PROMPT,
      tools: tools.filter((name) => !excluded.has(name)),
      disallowedTools: [...new Set([...disallowedTools, ...excluded])],
      model: "inherit",
      // Premier plan : l'agent principal attend le résultat (synthèse) et la gate libère la place à la fin du Task.
      background: false,
    },
  };
}
