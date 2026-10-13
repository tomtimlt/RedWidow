import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type RunInput,
  type RunSummary,
} from "@john-studio/core";
import { formatError } from "@john-studio/messages";
import { describe, expect, it } from "vitest";
import { createSdkRunner, type QueryFn } from "../src/index.js";

const result = (extra: Record<string, unknown> = {}) =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0.01,
    result: "fini",
    session_id: "sess-1",
    ...extra,
  }) as unknown as SDKMessage;
const init = (extra: Record<string, unknown> = {}) =>
  ({
    type: "system",
    subtype: "init",
    session_id: "sess-1",
    model: "m",
    tools: [],
    apiKeySource: "none",
    ...extra,
  }) as unknown as SDKMessage;

const FAKE_ENV = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  ANTHROPIC_API_KEY: "sk-ant-secret-key-value",
  ANTHROPIC_AUTH_TOKEN: "tok",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_USE_VERTEX: "1",
  CLAUDE_CODE_USE_FOUNDRY: "1",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token-value",
} satisfies NodeJS.ProcessEnv;

/** Lance un run avec un faux `QueryFn` ; `stream` fabrique le flux (éventuellement un faux `Query`). */
async function run(
  input: Partial<RunInput>,
  stream: (params: { prompt: unknown; options: Options }) => AsyncIterable<SDKMessage>,
  processEnv: NodeJS.ProcessEnv = FAKE_ENV,
) {
  const recorder = createRecorder({ runId: "r", redact: false });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder });
  const seen: { options?: Options; prompt?: unknown; calls: number } = { calls: 0 };
  const query: QueryFn = (params) => {
    seen.options = params.options;
    seen.prompt = params.prompt;
    seen.calls++;
    return stream(params);
  };
  const runner = createSdkRunner({ query, processEnv });
  let summary: RunSummary | undefined;
  let error: unknown;
  try {
    summary = await runner.run({ prompt: "p", cwd: "/w", ...input }, { recorder, gate });
  } catch (err) {
    error = err;
  }
  return { events, summary, seen, error };
}

const simple = () =>
  (async function* () {
    yield init();
    yield result();
  })();

describe("authentification", () => {
  it("auto : n'altère pas l'environnement (aucune option env)", async () => {
    const { seen } = await run({}, simple);
    expect(seen.options).not.toHaveProperty("env");
    const explicit = await run({ auth: "auto" }, simple);
    expect(explicit.seen.options).not.toHaveProperty("env");
  });

  it("subscription : retire clés et fournisseurs cloud, garde PATH, HOME et le jeton OAuth", async () => {
    const { seen } = await run({ auth: "subscription" }, simple);
    expect(seen.options?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token-value",
    });
    // L'environnement du processus courant n'est pas modifié.
    expect(FAKE_ENV.ANTHROPIC_API_KEY).toBe("sk-ant-secret-key-value");
  });

  it("subscription : ne laisse pas sdkOptions.env réintroduire une clé", async () => {
    const recorder = createRecorder({ redact: false });
    const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder });
    let options: Options | undefined;
    const runner = createSdkRunner({
      processEnv: FAKE_ENV,
      query: (params) => {
        options = params.options;
        return simple();
      },
      // Contournement du typage : le moteur doit tout de même l'écarter.
      sdkOptions: { env: { ANTHROPIC_API_KEY: "x" } } as never,
    });
    await runner.run({ prompt: "p", cwd: "/w", auth: "subscription" }, { recorder, gate });
    expect(options?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    await runner.run({ prompt: "p", cwd: "/w" }, { recorder, gate });
    expect(options).not.toHaveProperty("env");
  });

  it("api-key sans clé : erreur codée avant tout lancement, sans événement", async () => {
    const { seen, events, error } = await run({ auth: "api-key" }, simple, { PATH: "/usr/bin" });
    expect(error).toMatchObject({ code: "auth.missingApiKey" });
    expect(formatError(error)).toContain("ANTHROPIC_API_KEY");
    expect(seen.calls).toBe(0);
    expect(events).toEqual([]);
  });

  it("api-key avec clé : lance sans toucher à l'environnement", async () => {
    const { seen, summary } = await run({ auth: "api-key" }, simple);
    expect(summary?.status).toBe("success");
    expect(seen.options).not.toHaveProperty("env");
  });

  it("session.started consigne apiKeySource", async () => {
    const { events } = await run({}, simple);
    expect(events.find((e) => e.kind === "session.started")).toMatchObject({
      auth: { apiKeySource: "none" },
    });
  });

  it("accountInfo() complète par auth.info, sans jamais journaliser l'e-mail", async () => {
    const { events } = await run({}, () => {
      const generator = simple();
      return Object.assign(generator, {
        accountInfo: async () => ({
          email: "personne@example.com",
          organization: "Org Secrète",
          subscriptionType: "max",
          tokenSource: "claude.ai",
          apiKeySource: "none",
          apiProvider: "firstParty",
        }),
      });
    });
    const info = events.find((e) => e.kind === "auth.info");
    expect(info).toMatchObject({
      subscriptionType: "max",
      tokenSource: "claude.ai",
      apiKeySource: "none",
      apiProvider: "firstParty",
    });
    const json = JSON.stringify(events);
    expect(json).not.toContain("personne@example.com");
    expect(json).not.toContain("Org Secrète");
    expect(events.map((e) => e.kind).indexOf("auth.info")).toBeLessThan(
      events.map((e) => e.kind).indexOf("run.finished"),
    );
  });

  it("un échec d'accountInfo() n'est ni bloquant ni consigné", async () => {
    const { events, summary } = await run({}, () =>
      Object.assign(simple(), {
        accountInfo: async () => {
          throw new Error("indisponible");
        },
      }),
    );
    expect(summary?.status).toBe("success");
    expect(events.some((e) => e.kind === "auth.info" || e.kind === "error")).toBe(false);
  });

  it("traduit auth_status sans journaliser la sortie", async () => {
    const { events } = await run({}, () =>
      (async function* () {
        yield init();
        yield {
          type: "auth_status",
          isAuthenticating: true,
          output: ["Ouvrez https://example.com/oauth?code=abc"],
          uuid: "u",
          session_id: "sess-1",
        } as unknown as SDKMessage;
        yield {
          type: "auth_status",
          isAuthenticating: false,
          output: [],
          error: "échec",
          uuid: "u",
          session_id: "sess-1",
        } as unknown as SDKMessage;
        yield result();
      })(),
    );
    const statuses = events.filter((e) => e.kind === "auth.status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ isAuthenticating: true });
    expect(statuses[0]).not.toHaveProperty("error");
    expect(statuses[1]).toMatchObject({ isAuthenticating: false, error: "échec" });
    expect(JSON.stringify(events)).not.toContain("oauth?code");
  });

  it.each([
    ["authentication_failed", "auth.failed", "/login"],
    ["oauth_org_not_allowed", "auth.orgNotAllowed", "/login"],
  ])("traduit l'erreur d'assistant %s en erreur %s", async (sdkError, code, hint) => {
    const { events, summary } = await run({}, () =>
      (async function* () {
        yield init();
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          error: sdkError,
          message: { content: [] },
        } as unknown as SDKMessage;
        yield result({ subtype: "error_during_execution", is_error: true });
      })(),
    );
    const error = events.find((e) => e.kind === "error");
    expect(error).toMatchObject({ code });
    expect(formatError(error)).toContain(hint);
    expect(formatError(events.find((e) => e.kind === "error"))).toContain("ANTHROPIC_API_KEY");
    expect(summary?.status).toBe("error");
  });

  it("ignore les autres erreurs d'assistant (pas d'événement d'authentification)", async () => {
    const { events } = await run({}, () =>
      (async function* () {
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          error: "rate_limit",
          message: { content: [] },
        } as unknown as SDKMessage;
        yield result();
      })(),
    );
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });
});

describe("sessions", () => {
  it("convertit un flux de textes en SDKUserMessage et émet un turn.finished par result", async () => {
    async function* prompts() {
      yield "premier";
      yield "second";
    }
    let received: SDKUserMessage[] = [];
    const { events, summary, seen } = await run({ prompt: prompts() }, ({ prompt }) =>
      (async function* () {
        yield init();
        const turns: number[] = [];
        for await (const message of prompt as AsyncIterable<SDKUserMessage>) {
          received = [...received, message];
          turns.push(turns.length + 1);
          yield result({ num_turns: turns.length, total_cost_usd: turns.length * 0.01 });
        }
      })(),
    );
    expect(typeof seen.prompt).not.toBe("string");
    expect(received).toEqual([
      { type: "user", message: { role: "user", content: "premier" }, parent_tool_use_id: null },
      { type: "user", message: { role: "user", content: "second" }, parent_tool_use_id: null },
    ]);
    const turns = events.filter((e) => e.kind === "turn.finished");
    expect(turns).toMatchObject([
      { turns: 1, costUsd: 0.01, status: "success", result: "fini" },
      { turns: 2, costUsd: 0.02, status: "success", result: "fini" },
    ]);
    expect(events.find((e) => e.kind === "run.started")).toMatchObject({ prompt: "" });
    expect(summary).toMatchObject({ status: "success", turns: 2, sessionId: "sess-1" });
    expect(events.at(-1)).toMatchObject({ kind: "run.finished", turns: 2, sessionId: "sess-1" });
  });

  it("un prompt texte reste passé tel quel", async () => {
    const { seen } = await run({ prompt: "bonjour" }, simple);
    expect(seen.prompt).toBe("bonjour");
  });

  it("passe resume, sessionId, maxBudgetUsd et systemPrompt (preset claude_code)", async () => {
    const { seen, summary } = await run(
      { resume: "old-session", sessionId: "new-id", maxBudgetUsd: 1.5, systemPrompt: "Sois bref." },
      () =>
        (async function* () {
          yield result({ session_id: undefined });
        })(),
    );
    expect(seen.options).toMatchObject({
      resume: "old-session",
      sessionId: "new-id",
      maxBudgetUsd: 1.5,
      systemPrompt: { type: "preset", preset: "claude_code", append: "Sois bref." },
    });
    expect(summary?.sessionId).toBe("new-id");
  });

  it("sans option de session, rien n'est posé", async () => {
    const { seen } = await run({}, simple);
    for (const key of ["resume", "sessionId", "maxBudgetUsd", "systemPrompt"]) {
      expect(seen.options).not.toHaveProperty(key);
    }
  });

  it("les options de session ne desserrent pas les options verrouillées", async () => {
    const { seen } = await run(
      { resume: "r", sessionId: "s", maxBudgetUsd: 1, systemPrompt: "x", auth: "subscription" },
      simple,
    );
    expect(seen.options).toMatchObject({
      permissionMode: "default",
      allowedTools: [],
      settingSources: [],
      strictMcpConfig: true,
      cwd: "/w",
    });
    expect(seen.options?.canUseTool).toBeTypeOf("function");
    expect(seen.options?.hooks?.PreToolUse).toHaveLength(1);
  });
});
