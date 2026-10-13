import {
  type CanUseTool,
  type Options,
  type SDKMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalGate } from "../approval/gate.js";
import type { EventOf } from "../events.js";
import type { Recorder } from "../recorder.js";

/** Signature minimale de `query` du SDK, injectable pour les tests. */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface RunAgentOptions {
  prompt: string;
  recorder: Recorder;
  gate: ApprovalGate;
  cwd?: string;
  model?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  /** Options SDK supplémentaires ; `canUseTool` et `cwd` restent pilotés par le moteur. */
  sdkOptions?: Omit<Options, "canUseTool" | "cwd" | "abortController">;
  query?: QueryFn;
}

export interface RunSummary {
  status: "success" | "error";
  turns: number;
  costUsd: number;
  result: string | null;
}

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

  const ensureRequested = (toolUseId: string, tool: string, input: Record<string, unknown>) => {
    let event = requested.get(toolUseId);
    if (!event) {
      event = recorder.emit(
        { kind: "tool.requested", toolUseId, tool, input },
        root.id,
      ) as EventOf<"tool.requested">;
      requested.set(toolUseId, event);
    }
    return event;
  };

  const canUseTool: CanUseTool = async (tool, input, { signal, toolUseID }) => {
    const parent = ensureRequested(toolUseID, tool, input);
    const outcome = await gate.decide({ toolUseId: toolUseID, tool, input }, signal, parent.id);
    return outcome.decision === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: `Refusé par john-studio : ${outcome.reason}` };
  };

  const sdkOptions: Options = {
    settingSources: [],
    permissionMode: "default",
    ...options.sdkOptions,
    cwd,
    canUseTool,
    abortController: abort,
    ...(options.model !== undefined && { model: options.model }),
    ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
  };

  let summary: RunSummary = { status: "error", turns: 0, costUsd: 0, result: null };

  try {
    for await (const message of query({ prompt, options: sdkOptions })) {
      // Les messages de sous-agents (parent_tool_use_id) sont ignorés pour l'instant.
      if ("parent_tool_use_id" in message && message.parent_tool_use_id) continue;

      if (message.type === "assistant") {
        for (const block of blocks(message.message.content)) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            recorder.emit({ kind: "agent.text", text: block.text }, root.id);
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            const input =
              typeof block.input === "object" && block.input !== null
                ? (block.input as Record<string, unknown>)
                : {};
            ensureRequested(block.id, String(block.name), input);
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
            requested.get(block.tool_use_id)?.id ?? root.id,
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
