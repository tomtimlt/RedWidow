import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Recorder } from "@john-studio/core";

/** Définition d'outil MCP quelconque (le schéma zod varie d'un outil à l'autre). */
// biome-ignore lint/suspicious/noExplicitAny: le SDK type `tools` avec `SdkMcpToolDefinition<any>[]`.
export type AnyMcpTool = SdkMcpToolDefinition<any>;

/** Contexte fourni à un toolset à chaque run. */
export interface ToolContext {
  recorder: Recorder;
  /**
   * Id de l'événement `tool.requested` à utiliser comme parent des `process.*`
   * d'un appel (nom complet `mcp__<serveur>__<outil>`), ou `null` pour aucun.
   * `extra` est le second argument transmis au handler MCP par le SDK.
   */
  resolveParent(toolName: string, args: unknown, extra?: unknown): string | null;
}

/**
 * Serveur MCP in-process exposé à l'agent (`mcp__<name>__<outil>`), construit
 * à chaque run pour être branché sur son recorder.
 */
export interface Toolset {
  name: string;
  instructions?: string;
  create(ctx: ToolContext): AnyMcpTool[];
}
