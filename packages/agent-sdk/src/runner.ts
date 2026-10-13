import {
  type CanUseTool,
  createSdkMcpServer,
  type HookCallback,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentRunner,
  type ApprovalOutcome,
  BASH_TOOL,
  capOutput,
  DEFAULT_MAX_RESULT_BYTES,
  type EventOf,
  errorInfo,
  type RunContext,
  type RunInput,
  type RunSummary,
  reason,
  type TaskUsage,
} from "@john-studio/core";
import { formatReason } from "@john-studio/messages";
import { ToolCallRegistry, toolUseIdFromExtra } from "./correlation.js";
import type { ResolvedCall, Toolset } from "./toolset.js";

/** Signature minimale de `query` du SDK, injectable pour les tests. */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface SdkRunnerOptions {
  /** Serveurs MCP in-process (ex. `dockerToolset()`), construits à chaque run. */
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
  /** Plafond (octets UTF-8) du texte complet d'un `tool.result` (défaut : 64 Kio). */
  maxResultBytes?: number;
  query?: QueryFn;
}

/** Outils natifs exposés par défaut : lecture seule. */
export const DEFAULT_BUILTIN_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

/** Préfixe des refus renvoyés au modèle ; le motif suit, libellé en français par `@john-studio/messages`. */
const REFUSAL_PREFIX = "Refusé par john-studio : ";

/** Une approbation interactive peut attendre longtemps : le hook ne doit pas expirer avant l'humain. */
const HOOK_TIMEOUT_S = 24 * 60 * 60;

/** Texte complet d'un contenu `tool_result` (blocs texte seulement). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text"
        ? String((b as { text?: unknown }).text ?? "")
        : "",
    )
    .filter((t) => t !== "")
    .join("\n");
}

const toUsage = (u: {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
}): TaskUsage => ({
  totalTokens: u.total_tokens,
  toolUses: u.tool_uses,
  durationMs: u.duration_ms,
});

function blocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    : [];
}

/**
 * Adaptateur du Claude Agent SDK : pilote `query`, route chaque demande d'outil
 * vers la couche d'approbation et traduit le flux SDK en événements moteur.
 * Registre de corrélation et serveurs MCP sont reconstruits à chaque `run()`.
 */
export function createSdkRunner(options: SdkRunnerOptions = {}): AgentRunner {
  return { run: (input, ctx) => runWithSdk(options, input, ctx) };
}

async function runWithSdk(
  options: SdkRunnerOptions,
  input: RunInput,
  { recorder, gate, signal }: RunContext,
): Promise<RunSummary> {
  const { prompt, cwd } = input;
  const query = options.query ?? (sdkQuery as QueryFn);
  const abort = new AbortController();
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const root = recorder.emit({ kind: "run.started", prompt, cwd });
  const requested = new Map<string, EventOf<"tool.requested">>();
  const registry = new ToolCallRegistry();
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  /** Messages SDK non traduits, par `type/subtype`. */
  const unhandled: Record<string, number> = {};
  /** `agent_id` d'un sous-agent → `tool_use_id` de l'outil Task qui l'a lancé (via `task_started`). */
  const taskToolUse = new Map<string, string>();

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
    agentId?: string,
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
          ...(agentId && { agentId }),
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
    agentId?: string,
  ): Promise<ApprovalOutcome> => {
    let decision = decisions.get(toolUseId);
    if (!decision) {
      // Le hook peut devancer le message assistant du sous-agent : on rattache
      // à l'outil Task quand `task_started` l'a appris, sinon à la racine.
      const taskToolUseId = agentId ? taskToolUse.get(agentId) : undefined;
      const taskEvent = taskToolUseId ? requested.get(taskToolUseId) : undefined;
      const parent = ensureRequested(
        toolUseId,
        tool,
        input,
        taskEvent?.id ?? root.id,
        taskEvent ? taskToolUseId : undefined,
        agentId,
      );
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
    const outcome = await decide(
      input.tool_use_id,
      input.tool_name,
      toolInput,
      signal,
      input.agent_id,
    );
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: outcome.decision,
        permissionDecisionReason:
          outcome.decision === "allow"
            ? formatReason(outcome.reason)
            : `${REFUSAL_PREFIX}${formatReason(outcome.reason)}`,
      },
    };
  };

  /** Filet de sécurité : ne tranche jamais seul, relaie la décision du hook. */
  const canUseTool: CanUseTool = async (tool, input, { toolUseID }) => {
    const decision = decisions.get(toolUseID);
    if (!decision) {
      const unrouted = reason("guard.unrouted", { tool, toolUseId: toolUseID });
      recorder.emit({ kind: "error", ...unrouted }, root.id);
      return { behavior: "deny", message: `${REFUSAL_PREFIX}${formatReason(unrouted)}` };
    }
    const outcome = await decision;
    if (outcome.decision !== "allow") {
      return { behavior: "deny", message: `${REFUSAL_PREFIX}${formatReason(outcome.reason)}` };
    }
    return { behavior: "allow", updatedInput: input };
  };

  /**
   * Corrélation d'un appel MCP : exacte si le SDK transmet l'id d'appel dans
   * `extra._meta`, sinon inférée (outil + arguments), sinon rattachée à la racine.
   */
  const resolveCall = (toolName: string, args: unknown, extra?: unknown): ResolvedCall => {
    const id = toolUseIdFromExtra(extra);
    if (id !== undefined) {
      const exact = registry.claimById(id)?.eventId ?? requested.get(id)?.id;
      if (exact !== undefined) return { parentId: exact, correlation: "exact" };
    }
    const inferred = registry.claim(toolName, args);
    if (inferred) return { parentId: inferred.eventId, correlation: "inferred" };
    return { parentId: root.id, correlation: "none" };
  };

  const mcpServers: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const set of options.toolsets ?? []) {
    mcpServers[set.name] = createSdkMcpServer({
      name: set.name,
      tools: set.create({
        recorder,
        resolveCall,
        resolveParent: (toolName, args, extra) => resolveCall(toolName, args, extra).parentId,
      }),
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
    ...(input.model !== undefined && { model: input.model }),
    ...(input.maxTurns !== undefined && { maxTurns: input.maxTurns }),
  };

  let summary: RunSummary = {
    status: "error",
    turns: 0,
    costUsd: 0,
    result: null,
    unhandledMessages: unhandled,
  };

  const countUnhandled = (message: SDKMessage) => {
    const subtype = "subtype" in message ? `/${String(message.subtype)}` : "";
    const key = `${message.type}${subtype}`;
    unhandled[key] = (unhandled[key] ?? 0) + 1;
  };

  /** Traduit les messages `system/*` connus ; compte les autres. */
  const translateSystem = (message: Extract<SDKMessage, { type: "system" }>) => {
    switch (message.subtype) {
      case "init":
        recorder.emit(
          {
            kind: "session.started",
            sessionId: message.session_id,
            model: message.model,
            tools: [...message.tools],
          },
          root.id,
        );
        return;
      case "api_retry":
        recorder.emit(
          {
            kind: "api.retry",
            attempt: message.attempt,
            maxRetries: message.max_retries,
            delayMs: message.retry_delay_ms,
            errorStatus: message.error_status,
            error: message.error,
          },
          root.id,
        );
        return;
      case "permission_denied":
        recorder.emit(
          {
            kind: "permission.denied",
            toolUseId: message.tool_use_id,
            tool: message.tool_name,
            ...(message.decision_reason_type !== undefined && {
              reasonType: message.decision_reason_type,
            }),
            message: message.message,
          },
          requested.get(message.tool_use_id)?.id ?? root.id,
        );
        return;
      case "task_started":
        if (message.tool_use_id) taskToolUse.set(message.task_id, message.tool_use_id);
        recorder.emit(
          {
            kind: "task.updated",
            taskId: message.task_id,
            ...(message.tool_use_id && { toolUseId: message.tool_use_id }),
            phase: "started",
            description: message.description,
          },
          (message.tool_use_id && requested.get(message.tool_use_id)?.id) || root.id,
        );
        return;
      case "task_progress": {
        const toolUseId = message.tool_use_id ?? taskToolUse.get(message.task_id);
        recorder.emit(
          {
            kind: "task.updated",
            taskId: message.task_id,
            ...(toolUseId && { toolUseId }),
            phase: "progress",
            description: message.description,
            ...(message.summary !== undefined && { summary: message.summary }),
            usage: toUsage(message.usage),
          },
          (toolUseId && requested.get(toolUseId)?.id) || root.id,
        );
        return;
      }
      case "task_updated": {
        const toolUseId = taskToolUse.get(message.task_id);
        const { status, description, error } = message.patch;
        recorder.emit(
          {
            kind: "task.updated",
            taskId: message.task_id,
            ...(toolUseId && { toolUseId }),
            phase: "updated",
            ...(status !== undefined && { status }),
            ...(description !== undefined && { description }),
            ...(error !== undefined && { summary: error }),
          },
          (toolUseId && requested.get(toolUseId)?.id) || root.id,
        );
        return;
      }
      case "task_notification": {
        const toolUseId = message.tool_use_id ?? taskToolUse.get(message.task_id);
        recorder.emit(
          {
            kind: "task.updated",
            taskId: message.task_id,
            ...(toolUseId && { toolUseId }),
            phase: "finished",
            status: message.status,
            summary: message.summary,
            ...(message.usage && { usage: toUsage(message.usage) }),
          },
          (toolUseId && requested.get(toolUseId)?.id) || root.id,
        );
        return;
      }
      default:
        countUnhandled(message);
    }
  };

  try {
    for await (const message of query({ prompt, options: sdkOptions })) {
      const parentId = parentOf(message);
      const agentToolUseId = agentOf(message);

      if (message.type === "assistant") {
        for (const block of blocks(message.message.content)) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            recorder.emit({ kind: "agent.text", text: block.text }, parentId);
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            if (block.thinking.trim()) {
              recorder.emit(
                { kind: "agent.thinking", text: block.thinking, redacted: false },
                parentId,
              );
            }
          } else if (block.type === "redacted_thinking") {
            recorder.emit({ kind: "agent.thinking", text: "", redacted: true }, parentId);
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
              ...capOutput(contentText(block.content), maxResultBytes),
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
          unhandledMessages: unhandled,
        };
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info;
        recorder.emit(
          {
            kind: "rate.limited",
            status: info.status,
            ...(info.resetsAt !== undefined && { resetsAt: info.resetsAt }),
            ...(info.rateLimitType !== undefined && { limitType: info.rateLimitType }),
            ...(info.utilization !== undefined && { utilization: info.utilization }),
          },
          root.id,
        );
      } else if (message.type === "system") {
        translateSystem(message);
      } else {
        countUnhandled(message);
      }
    }
  } catch (err) {
    recorder.emit({ kind: "error", ...errorInfo(err) }, root.id);
    summary = { ...summary, status: "error" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  recorder.emit({ kind: "run.finished", ...summary }, root.id);
  return summary;
}
