import { writeFileSync } from "node:fs";
import { createSdkRunner, type QueryFn } from "@john-studio/agent-sdk";
import { processChannel } from "../../src/engine/channel.js";
import { runEngine } from "../../src/engine/engine.js";
import { PROTOCOL_VERSION } from "../../src/logic/protocol.js";

/**
 * Moteur de test : même assemblage que `main.ts`, mais le SDK est remplacé par un `QueryFn`
 * factice piloté par le texte de la première consigne (`env`, `tool allow`, `tool deny`,
 * `hang <fichier>`). Empaqueté par esbuild puis forké par les tests.
 */
type Options = Parameters<QueryFn>[0]["options"];
type Msg = ReturnType<QueryFn> extends AsyncIterable<infer M> ? M : never;

const assistant = (text: string) =>
  ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text }] },
  }) as unknown as Msg;

/** Reproduit l'enchaînement du SDK pour un outil : hook PreToolUse, puis `canUseTool`. */
async function callTool(
  options: Options,
  tool: string,
  input: Record<string, unknown>,
  id: string,
) {
  const signal = new AbortController().signal;
  for (const matcher of options.hooks?.PreToolUse ?? []) {
    for (const hook of matcher.hooks) {
      const out = (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: input,
          tool_use_id: id,
          session_id: "s",
          transcript_path: "",
          cwd: "/",
        } as never,
        id,
        { signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string } };
      if (out.hookSpecificOutput?.permissionDecision === "deny") return "deny";
    }
  }
  const result = await options.canUseTool?.(tool, input, {
    signal,
    toolUseID: id,
    requestId: `req-${id}`,
  } as never);
  return result?.behavior ?? "deny";
}

const query: QueryFn = async function* ({ prompt, options }) {
  let first = "";
  if (typeof prompt === "string") first = prompt;
  else {
    for await (const m of prompt) {
      first = String(m.message.content);
      break;
    }
  }
  const [command = "", arg = ""] = first.split(" ").filter(Boolean);
  const tool = first.split(" ").slice(0, 2).join(" ");
  if (command === "env") {
    yield assistant(`ENV ${Object.keys(process.env).sort().join(",")}`);
    yield assistant(`TOKEN ${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""}`);
  } else if (tool === "tool allow" || tool === "tool deny") {
    const behavior = await callTool(
      options,
      "Write",
      { file_path: "a.txt", note: `jeton=${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""}` },
      "toolu_1",
    );
    yield assistant(`DECISION ${behavior}`);
  } else if (command === "hang") {
    const signal = options.abortController?.signal;
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    writeFileSync(arg, "annulé");
    return;
  } else {
    yield assistant(`ECHO ${first}`);
  }
  yield {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0.01,
    result: "fini",
  } as unknown as Msg;
};

const channel = processChannel();
const done = runEngine({
  channel,
  createRunner: () => createSdkRunner({ query }),
  disconnectGraceMs: 3000,
});
void channel.send({ v: PROTOCOL_VERSION, type: "ready" });
process.exit(await done);
