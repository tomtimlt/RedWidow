import {
  type CanUseTool,
  createSdkMcpServer,
  type HookCallback,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalGate, ApprovalOutcome } from "../approval/gate.js";
import { BASH_TOOL } from "../approval/policy.js";
import { createDockerClient } from "../docker/client.js";
import {
  type AnyMcpTool,
  createDockerTools,
  DOCKER_SERVER_INSTRUCTIONS,
  DOCKER_SERVER_NAME,
  DOCKER_TOOL_PREFIX,
} from "../docker/tools.js";
import type { EventOf } from "../events.js";
import type { Recorder } from "../recorder.js";
import { ToolCallRegistry } from "./correlation.js";

/** Signature minimale de `query` du SDK, injectable pour les tests. */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/** Serveur MCP in-process exposé à l'agent (`mcp__<name>__<outil>`). */
export interface Toolset {
  name: string;
  tools: AnyMcpTool[];
  instructions?: string;
}

export interface RunAgentOptions {
  prompt: string;
  recorder: Recorder;
  gate: ApprovalGate;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  /** Outils MCP docker structurés (activés par défaut) ; `false` pour les désactiver. */
  docker?: false | { binary?: string };
  /** Serveurs MCP in-process supplémentaires. Ils reçoivent leurs `process.*` via leur propre logique. */
  toolsets?: Toolset[];
  /**
   * Outils natifs du SDK exposés à l'agent (liste blanche : `tools` du SDK).
   * Défaut : lectures seules. `Bash` s'ajoute via `bash`, pas ici.
   */
  builtinTools?: string[];
  /** Expose l'outil natif `Bash` (désactivé par défaut : préférer les outils MCP docker). */
  bash?: boolean;
  /** Hooks SDK supplémentaires, exécutés après la garde `PreToolUse` du moteur. */
  hooks?: Options["hooks"];
  /**
   * Options SDK supplémentaires. Celles qui touchent aux permissions
   * (`canUseTool`, `permissionMode`, `allowedTools`, `tools`, `hooks`…) sont
   * pilotées par le moteur et ne peuvent pas être surchargées.
   */
  sdkOptions?: Omit<
    Options,
    | "canUseTool"
    | "cwd"
    | "abortController"
    | "permissionMode"
    | "allowDangerouslySkipPermissions"
    | "allowedTools"
    | "tools"
    | "hooks"
    | "settingSources"
    | "strictMcpConfig"
    | "permissionPromptToolName"
    | "permissionPrompts"
  >;
  query?: QueryFn;
}

export interface RunSummary {
  status: "success" | "error";
  turns: number;
  costUsd: number;
  result: string | null;
}

/** Outils natifs exposés par défaut : lecture seule. */
export const DEFAULT_BUILTIN_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

/** Une approbation interactive peut attendre longtemps : le hook ne doit pas expirer avant l'humain. */
const HOOK_TIMEOUT_S = 24 * 60 * 60;

const SUMMARY_MAX = 200;

function summarize(content: unknown): string {
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((b) =>
        typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text"
          ? String((b as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ");
  } else {
    text = "";
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    : [];
}

/**
 * Boucle d'agent : pilote `query` du SDK, route chaque demande d'outil vers
 * la couche d'approbation et traduit le flux SDK en événements moteur.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunSummary> {
  const { prompt, recorder, gate, cwd = process.cwd() } = options;
  const query = options.query ?? (sdkQuery as QueryFn);
  const abort = new AbortController();
  const onAbort = () => abort.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const root = recorder.emit({ kind: "run.started", prompt, cwd });
  const requested = new Map<string, EventOf<"tool.requested">>();
  const registry = new ToolCallRegistry();

  /** Parent causal d'un message : l'outil Task du sous-agent émetteur, sinon la racine. */
  const parentOf = (message: SDKMessage): string => {
    const taskId = "parent_tool_use_id" in message ? message.parent_tool_use_id : null;
    return (taskId ? requested.get(taskId)?.id : undefined) ?? root.id;
  };
  const agentOf = (message: SDKMessage): string | undefined =>
    ("parent_tool_use_id" in message ? message.parent_tool_use_id : null) ?? undefined;

  const ensureRequested = (
    toolUseId: string,
    tool: string,
    input: Record<string, unknown>,
    parentId: string = root.id,
    agentToolUseId?: string,
  ) => {
    let event = requested.get(toolUseId);
    if (!event) {
      event = recorder.emit(
        {
          kind: "tool.requested",
          toolUseId,
          tool,
          input,
          ...(agentToolUseId && { agentToolUseId }),
        },
        parentId,
      ) as EventOf<"tool.requested">;
      requested.set(toolUseId, event);
    }
    return event;
  };

  /**
   * Décisions d'approbation par `tool_use_id`. Le hook PreToolUse fait autorité :
   * il voit chaque appel, y compris ceux que le SDK auto-approuve sans appeler
   * `canUseTool` (lectures dans le cwd, etc.).
   */
  const decisions = new Map<string, Promise<ApprovalOutcome>>();

  const decide = (
    toolUseId: string,
    tool: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> => {
    let decision = decisions.get(toolUseId);
    if (!decision) {
      const parent = ensureRequested(toolUseId, tool, input);
      decision = gate.decide({ toolUseId, tool, input }, signal, parent.id).then((outcome) => {
        if (outcome.decision === "allow") {
          registry.register(tool, input, { toolUseId, eventId: parent.id });
        }
        return outcome;
      });
      decisions.set(toolUseId, decision);
    }
    return decision;
  };

  const preToolUse: HookCallback = async (input, _toolUseId, { signal }) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput =
      typeof input.tool_input === "object" && input.tool_input !== null
        ? (input.tool_input as Record<string, unknown>)
        : {};
    const outcome = await decide(input.tool_use_id, input.tool_name, toolInput, signal);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: outcome.decision,
        permissionDecisionReason:
          outcome.decision === "allow"
            ? outcome.reason
            : `Refusé par john-studio : ${outcome.reason}`,
      },
    };
  };

  /** Filet de sécurité : ne tranche jamais seul, relaie la décision du hook. */
  const canUseTool: CanUseTool = async (tool, input, { toolUseID }) => {
    const decision = decisions.get(toolUseID);
    if (!decision) {
      recorder.emit(
        {
          kind: "error",
          message: `canUseTool appelé sans décision PreToolUse (${tool}, ${toolUseID}) : refusé`,
        },
        root.id,
      );
      return { behavior: "deny", message: "Refusé par john-studio : appel non routé par la garde" };
    }
    const outcome = await decision;
    if (outcome.decision !== "allow") {
      return { behavior: "deny", message: `Refusé par john-studio : ${outcome.reason}` };
    }
    return { behavior: "allow", updatedInput: input };
  };

  const toolsets: Toolset[] = [...(options.toolsets ?? [])];
  if (options.docker !== false) {
    const docker = createDockerClient({
      recorder,
      ...(options.docker?.binary && { binary: options.docker.binary }),
    });
    toolsets.push({
      name: DOCKER_SERVER_NAME,
      instructions: DOCKER_SERVER_INSTRUCTIONS,
      tools: createDockerTools(
        docker,
        (name, args) => registry.claim(`${DOCKER_TOOL_PREFIX}${name}`, args)?.eventId ?? root.id,
      ),
    });
  }
  const mcpServers: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const set of toolsets) {
    mcpServers[set.name] = createSdkMcpServer({
      name: set.name,
      tools: set.tools,
      ...(set.instructions && { instructions: set.instructions }),
    });
  }

  const builtinTools = [...new Set([...(options.builtinTools ?? DEFAULT_BUILTIN_TOOLS)])].filter(
    (name) => name !== "Bash",
  );
  if (options.bash === true) builtinTools.push("Bash");

  const sdkOptions: Options = {
    ...options.sdkOptions,
    mcpServers: { ...options.sdkOptions?.mcpServers, ...mcpServers },
    cwd,
    // Garde : tout passe par PreToolUse ; rien n'est pré-approuvé côté SDK.
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: "default",
    allowedTools: [],
    tools: builtinTools,
    disallowedTools: [
      ...(options.sdkOptions?.disallowedTools ?? []),
      ...(options.bash === true ? [] : [BASH_TOOL]),
    ],
    hooks: {
      ...options.hooks,
      PreToolUse: [
        { hooks: [preToolUse], timeout: HOOK_TIMEOUT_S },
        ...(options.hooks?.PreToolUse ?? []),
      ],
    },
    canUseTool,
    abortController: abort,
    ...(options.model !== undefined && { model: options.model }),
    ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
  };

  let summary: RunSummary = { status: "error", turns: 0, costUsd: 0, result: null };

  try {
    for await (const message of query({ prompt, options: sdkOptions })) {
      const parentId = parentOf(message);
      const agentToolUseId = agentOf(message);

      if (message.type === "assistant") {
        for (const block of blocks(message.message.content)) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            recorder.emit({ kind: "agent.text", text: block.text }, parentId);
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            const input =
              typeof block.input === "object" && block.input !== null
                ? (block.input as Record<string, unknown>)
                : {};
            ensureRequested(block.id, String(block.name), input, parentId, agentToolUseId);
          }
        }
      } else if (message.type === "user") {
        for (const block of blocks(message.message.content)) {
          if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
          recorder.emit(
            {
              kind: "tool.result",
              toolUseId: block.tool_use_id,
              isError: block.is_error === true,
              summary: summarize(block.content),
            },
            requested.get(block.tool_use_id)?.id ?? parentId,
          );
        }
      } else if (message.type === "result") {
        summary = {
          status: message.subtype === "success" && !message.is_error ? "success" : "error",
          turns: message.num_turns,
          costUsd: message.total_cost_usd,
          result: message.subtype === "success" ? message.result : null,
        };
      }
    }
  } catch (err) {
    recorder.emit(
      { kind: "error", message: err instanceof Error ? err.message : String(err) },
      root.id,
    );
    summary = { ...summary, status: "error" };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  recorder.emit({ kind: "run.finished", ...summary }, root.id);
  return summary;
}
