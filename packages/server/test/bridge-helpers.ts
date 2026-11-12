import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PendingApproval } from "@warband/core";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "@warband/vscode/logic/controller";
import { afterEach, beforeEach } from "vitest";
import type { WebSocket } from "ws";
import { createBridge } from "../src/bridge/channel.js";
import { tokenKindKey, tokenSecretKey } from "../src/bridge/deps.js";
import type { ProjectHalts } from "../src/bridge/halt.js";
import { type HubOptions, MissionHub } from "../src/bridge/hub.js";
import type { ViewBackends } from "../src/bridge/views.js";
import { openStorage, type ServerStorage } from "../src/storage/index.js";

export const KEY = "k".repeat(40);
export const TOKEN = "sk-ant-valeur-secrete-de-test";

/** Contrôleur factice : le test joue le moteur. */
export function fakeController(options: EngineControllerOptions) {
  const f = {
    options,
    started: false,
    startParams: undefined as Record<string, unknown> | undefined,
    prompts: [] as unknown[][],
    answers: [] as unknown[][],
    get handlers(): EngineHandlers {
      return options.handlers ?? {};
    },
  };
  const ctl: EngineController = {
    start: async (params) => {
      f.started = true;
      f.startParams = params as unknown as Record<string, unknown>;
    },
    models: async () => [],
    prompt: (...a) => void f.prompts.push(a),
    answer: (...a) => void f.answers.push(a),
    abort: () => undefined,
    dispose: () => undefined,
    kill: () => undefined,
    bypass: () => 1,
    exited: Promise.resolve(),
  };
  return { f, ctl };
}

export type Msg = Record<string, unknown>;

/** Socket factice : un `EventEmitter` avec la partie de l'API de `ws` que le pont utilise. */
export class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: { view: string; frame: string; msg: Msg }[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  say(view: string, frame: string, msg: unknown) {
    this.emit("message", Buffer.from(JSON.stringify({ v: 1, view, frame, msg })), false);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  of(view: string, type: string) {
    return this.sent.filter((e) => e.view === view && e.msg.type === type);
  }
}

export const approval = (id: string): PendingApproval =>
  ({
    toolUseId: id,
    tool: "Bash",
    input: { command: "ls" },
    verdict: { decision: "ask", reason: { code: "bash.noRule" }, rule: null },
  }) as unknown as PendingApproval;

/** Arrêts par projet factices : un ensemble en mémoire. */
export function fakeProjectHalts(ids: string[] = ["p1", "p2"]) {
  const halted = new Set<string>();
  const halts: ProjectHalts = {
    ids: async () => ids,
    isHalted: (id) => halted.has(id),
    set: async (id) => void halted.add(id),
    clear: async (id) => void halted.delete(id),
  };
  return { halts, halted };
}

export interface Ctx {
  dir: string;
  storage: ServerStorage;
  hub?: MissionHub;
}

/** Dossier de données et coffre temporaires, avec un jeton Claude, nettoyés après chaque test. */
export function useStorage(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(async () => {
    ctx.dir = await mkdtemp(join(tmpdir(), "rw-bridge-"));
    ctx.storage = await openStorage(ctx.dir, { REDWIDOW_SECRET_KEY: KEY });
    await ctx.storage.secrets.set(tokenSecretKey("claude"), TOKEN);
    ctx.storage.state.set(tokenKindKey("claude"), "api-key");
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.storage.state.flush();
    await rm(ctx.dir, { recursive: true, force: true });
  });
  return ctx;
}

export function setup(ctx: Ctx, extra: Partial<HubOptions> = {}) {
  const engines: ReturnType<typeof fakeController>["f"][] = [];
  const { halts, halted } = fakeProjectHalts();
  const audit: Msg[] = [];
  const hub = new MissionHub({
    storage: ctx.storage,
    configDir: join(ctx.dir, "config"),
    projectHalts: halts,
    audit: (e) => void audit.push(e),
    createController: (options) => {
      const { f, ctl } = fakeController(options);
      engines.push(f);
      return ctl;
    },
    ...extra,
  });
  ctx.hub = hub;
  const bridge = createBridge(hub);
  const connect = () => {
    const s = new FakeSocket();
    bridge.onConnection(s as unknown as WebSocket, "session");
    return s;
  };
  const engine = () => engines.find((e) => e.started);
  return { bridge, connect, engine, audit, halted, hub };
}

/** Coquille connectée et annoncée. */
export function shellOf(t: ReturnType<typeof setup>) {
  const s = t.connect();
  s.say("shell", "shell", { type: "ready" });
  return s;
}

export const emptyBackends = (over: Partial<ViewBackends> = {}): ViewBackends => ({
  activeProjectId: async () => null,
  program: () => {
    throw new Error("inattendu");
  },
  engagement: () => {
    throw new Error("inattendu");
  },
  cockpit: {
    load: async () => ({ type: "view" }) as never,
    link: async () => ({ type: "view" }) as never,
    setPrimary: async () => ({ type: "view" }) as never,
    control: async () => undefined,
  },
  ...over,
});
