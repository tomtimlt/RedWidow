import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunner,
  type Asker,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type Policy,
  type Recorder,
  type RunInput,
  type RunSummary,
} from "@john-studio/core";
import type {
  ClientInit,
  OpencodeApi,
  OpencodeEvent,
  PermissionResponse,
  PromptBody,
} from "../src/index.js";

/** Faux binaire docker : journalise son argv (un appel par ligne, `|` entre arguments). */
export async function fakeDocker(): Promise<{ bin: string; calls: () => Promise<string[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "john-fake-docker-"));
  const bin = join(dir, "docker");
  const log = join(dir, "calls.log");
  await writeFile(
    bin,
    `#!/bin/sh
printf '%s|' "$@" >> "${log}"; echo >> "${log}"
case "$1" in
  ps) echo '{"ID":"1","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":""}';;
  run) echo cid123;;
esac
`,
  );
  await chmod(bin, 0o755);
  return {
    bin,
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

/** Pilote d'un tour : le script reçoit ces commandes et joue le rôle d'OpenCode. */
export interface Stage {
  init: ClientInit;
  emit(type: string, properties: Record<string, unknown>): void;
  /** Émet une demande de permission et attend la réponse du moteur. */
  ask(properties: Record<string, unknown>): Promise<PermissionResponse>;
  idle(): void;
}

export interface FakeOptions {
  /** Configuration effective renvoyée par `getConfig` (défaut : celle imposée par le moteur). */
  effective?: (forced: Record<string, unknown>) => Record<string, unknown>;
  hasSession?: boolean;
}

export interface FakeOpencode {
  createClient: (init: ClientInit) => OpencodeApi;
  prompts: { sessionId: string; body: PromptBody }[];
  replies: { id: string; response: PermissionResponse }[];
  aborts: string[];
  init: () => ClientInit;
  closed: () => boolean;
}

export const SESSION = "ses_1";
let counter = 0;
export const uid = (prefix: string) => `${prefix}_${++counter}`;

/**
 * Faux client OpenCode : chaque `prompt` déclenche le script du tour
 * correspondant (dans l'ordre). Le flux d'événements est une file mémoire.
 */
export function fakeOpencode(
  turns: ((stage: Stage, body: PromptBody) => Promise<void> | void)[],
  options: FakeOptions = {},
): FakeOpencode {
  const queue: OpencodeEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let initial: ClientInit | undefined;
  let closed = false;
  const waiting = new Map<string, (r: PermissionResponse) => void>();
  const state: FakeOpencode = {
    prompts: [],
    replies: [],
    aborts: [],
    init: () => initial as ClientInit,
    closed: () => closed,
    createClient: (init) => {
      initial = init;
      let turnIndex = 0;
      const push = (type: string, properties: Record<string, unknown>) => {
        queue.push({ type, properties });
        wake?.();
      };
      const stage: Stage = {
        init,
        emit: push,
        ask: (properties) =>
          new Promise<PermissionResponse>((resolve) => {
            waiting.set(String(properties.id), resolve);
            push("permission.asked", properties);
          }),
        idle: () => push("session.idle", { sessionID: SESSION }),
      };
      init.signal.addEventListener("abort", () => {
        ended = true;
        wake?.();
      });
      return {
        getConfig: async () =>
          options.effective ? options.effective(init.config) : { ...init.config, model: "fake/m" },
        subscribe: async () => ({
          [Symbol.asyncIterator]: () => ({
            async next(): Promise<IteratorResult<OpencodeEvent>> {
              while (queue.length === 0 && !ended) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = null;
              }
              const event = queue.shift();
              return event ? { done: false, value: event } : { done: true, value: undefined };
            },
          }),
        }),
        createSession: async () => SESSION,
        hasSession: async () => options.hasSession ?? true,
        prompt: async (sessionId, body) => {
          state.prompts.push({ sessionId, body });
          const script = turns[turnIndex++];
          if (script) void Promise.resolve(script(stage, body));
        },
        abort: async (sessionId) => {
          state.aborts.push(sessionId);
        },
        messageParts: async () => [],
        reply: async ({ id }, response) => {
          state.replies.push({ id, response });
          waiting.get(id)?.(response);
          return 200;
        },
        close: () => {
          closed = true;
        },
      };
    },
  };
  return state;
}

export interface Harness {
  events: EngineEvent[];
  recorder: Recorder;
  run(runner: AgentRunner, input?: Partial<RunInput>, signal?: AbortSignal): Promise<RunSummary>;
}

export function harness(
  options: { policy?: Policy; ask?: Asker; recorder?: Recorder; workspace?: string } = {},
) {
  const recorder = options.recorder ?? createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const cwd = options.workspace ?? process.cwd();
  const gate = createApprovalGate({
    policy: options.policy ?? DEFAULT_POLICY,
    recorder,
    workspace: { cwd },
    ...(options.ask && { ask: options.ask }),
  });
  return {
    events,
    recorder,
    cwd,
    run: (runner: AgentRunner, input: Partial<RunInput> = {}, signal?: AbortSignal) =>
      runner.run(
        { prompt: "go", cwd, model: "fake/m", ...input },
        { recorder, gate, ...(signal && { signal }) },
      ),
  };
}

/** Parties d'un appel d'outil telles que les émet OpenCode. */
export const toolPart = (
  callID: string,
  tool: string,
  state: Record<string, unknown>,
  messageID = "msg_a",
) => ({
  id: `prt_${callID}`,
  sessionID: SESSION,
  messageID,
  type: "tool",
  callID,
  tool,
  state,
});

export const assistantMessage = (id = "msg_a", extra: Record<string, unknown> = {}) => ({
  info: { id, sessionID: SESSION, role: "assistant", cost: 0, ...extra },
});

export const userMessage = (id: string) => ({
  info: { id, sessionID: SESSION, role: "user" },
});

export const permission = (
  id: string,
  perm: string,
  callID: string,
  extra: Record<string, unknown> = {},
  messageID = "msg_a",
) => ({
  id,
  sessionID: SESSION,
  permission: perm,
  patterns: ["x"],
  metadata: {},
  always: ["*"],
  tool: { messageID, callID },
  ...extra,
});
