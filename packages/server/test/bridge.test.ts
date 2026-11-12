import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PendingApproval } from "@warband/core";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "@warband/vscode/logic/controller";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { createBridge } from "../src/bridge/channel.js";
import { buildChatDeps, tokenKindKey, tokenSecretKey } from "../src/bridge/deps.js";
import { MissionHub } from "../src/bridge/hub.js";
import { openStorage, type ServerStorage } from "../src/storage/index.js";

const KEY = "k".repeat(40);
const TOKEN = "sk-ant-valeur-secrete-de-test";

/** Contrôleur factice : le test joue le moteur. */
function fakeController(options: EngineControllerOptions) {
  const f = {
    options,
    started: false,
    prompts: [] as unknown[][],
    answers: [] as unknown[][],
    kills: 0,
    get handlers(): EngineHandlers {
      return options.handlers ?? {};
    },
  };
  const ctl: EngineController = {
    start: async () => {
      f.started = true;
    },
    models: async () => [],
    prompt: (...a) => void f.prompts.push(a),
    answer: (...a) => void f.answers.push(a),
    abort: () => undefined,
    dispose: () => undefined,
    kill: () => void f.kills++,
    bypass: () => 1,
    exited: Promise.resolve(),
  };
  return { f, ctl };
}

/** Socket factice : un `EventEmitter` avec la partie de l'API de `ws` que le pont utilise. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: { view: string; frame: string; msg: Record<string, any> }[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  say(view: string, frame: string, msg: unknown) {
    this.emit("message", Buffer.from(JSON.stringify({ v: 1, view, frame, msg })), false);
  }
  raw(text: string) {
    this.emit("message", Buffer.from(text), false);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  of(view: string, type: string) {
    return this.sent.filter((e) => e.view === view && e.msg.type === type);
  }
}

const approval = (id: string): PendingApproval =>
  ({
    toolUseId: id,
    tool: "Bash",
    input: { command: "ls" },
    verdict: { decision: "ask", reason: { code: "bash.noRule" }, rule: null },
  }) as unknown as PendingApproval;

let dir: string;
let storage: ServerStorage;
let hub: MissionHub;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rw-bridge-"));
  storage = await openStorage(dir, { REDWIDOW_SECRET_KEY: KEY });
  await storage.secrets.set(tokenSecretKey("claude"), TOKEN);
  storage.state.set(tokenKindKey("claude"), "api-key");
});
afterEach(async () => {
  hub?.dispose();
  await storage.state.flush();
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const engines: ReturnType<typeof fakeController>["f"][] = [];
  hub = new MissionHub({
    storage,
    createController: (options) => {
      const { f, ctl } = fakeController(options);
      engines.push(f);
      return ctl;
    },
  });
  const bridge = createBridge(hub);
  const connect = () => {
    const s = new FakeSocket();
    bridge.onConnection(s as unknown as WebSocket, "session");
    return s;
  };
  /** Le moteur de la conversation (hors sondage des modèles, qui n'appelle jamais `start`). */
  const engine = () => engines.find((e) => e.started);
  return { bridge, connect, engine };
}

/** Un chat prêt avec un message envoyé : le moteur de la session existe. */
async function chatWithEngine(t: ReturnType<typeof setup>, frame = "f1") {
  const chat = t.connect();
  chat.say("chat", frame, { type: "ready" });
  chat.say("chat", frame, { type: "send", text: "bonjour" });
  await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
  return chat;
}

describe("pont moteur : sessions de chat", () => {
  it("un message send du socket arrive au contrôleur (prompt)", async () => {
    const t = setup();
    await chatWithEngine(t);
    expect(t.engine()?.prompts[0]?.[0]).toBe("bonjour");
    // Le jeton vient du coffre ; il n'apparaît dans aucun message sortant.
    expect(t.engine()?.options.auth).toEqual({ name: "ANTHROPIC_API_KEY", value: TOKEN });
  });

  it("événement approval du moteur : diffusé en shell/approvals", async () => {
    const t = setup();
    const shell = t.connect();
    shell.say("shell", "shell", { type: "ready" });
    await chatWithEngine(t);
    t.engine()?.handlers.onApproval?.(approval("a"));
    await vi.waitFor(() => {
      const last = shell.of("shell", "approvals").at(-1);
      expect(last?.msg.items).toEqual([
        {
          frame: "f1",
          toolUseId: "a",
          tool: "Bash",
          summary: "ls",
          canRemember: true,
          confirming: false,
        },
      ]);
    });
  });

  it("approve : controller.answer avec la bonne décision", async () => {
    const t = setup();
    const shell = t.connect();
    shell.say("shell", "shell", { type: "ready" });
    await chatWithEngine(t);
    t.engine()?.handlers.onApproval?.(approval("a"));
    t.engine()?.handlers.onApproval?.(approval("b"));
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "once" });
    shell.say("shell", "f1", { type: "approve", toolUseId: "b", choice: "deny" });
    await vi.waitFor(() =>
      expect(t.engine()?.answers).toEqual([
        ["a", "allow", undefined],
        ["b", "deny", undefined],
      ]),
    );
    await vi.waitFor(() => expect(shell.of("shell", "approvals").at(-1)?.msg.items).toEqual([]));
  });

  it("socket fermé : la demande reste en attente, un nouveau socket la reçoit, rien n'est répondu", async () => {
    const t = setup();
    const chat = await chatWithEngine(t);
    const shell = t.connect();
    shell.say("shell", "shell", { type: "ready" });
    t.engine()?.handlers.onApproval?.(approval("a"));
    chat.close();
    shell.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(t.engine()?.answers).toEqual([]);
    const fresh = t.connect();
    fresh.say("shell", "shell", { type: "ready" });
    await vi.waitFor(() =>
      expect(fresh.of("shell", "approvals").at(-1)?.msg.items).toMatchObject([
        { frame: "f1", toolUseId: "a" },
      ]),
    );
    expect(t.engine()?.answers).toEqual([]);
    expect(t.engine()?.kills).toBe(0);
  });

  it("message invalide, vue inconnue, cadre non annoncé : ignorés, comptés, jamais transmis", async () => {
    const t = setup();
    const s = t.connect();
    s.raw("{pas du json");
    s.say("terminal", "f1", { type: "ready" });
    s.say("chat", "../f1", { type: "ready" });
    s.say("chat", "f1", { type: "send", text: "avant ready" });
    s.say("chat", "f1", { type: "ready" });
    s.say("chat", "f1", { type: "send" });
    s.say("chat", "f1", { type: "send", text: 42 });
    s.say("chat", "f1", { type: "inconnu" });
    s.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "once" });
    s.say("shell", "shell", { type: "approve", toolUseId: "a", choice: "tout" });
    s.emit("message", Buffer.from("binaire"), true);
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(10));
    expect(t.bridge.stats().accepted).toBe(1);
    expect(t.engine()).toBeUndefined();
  });

  it("deux sockets sur le même cadre reçoivent les mêmes messages", async () => {
    const t = setup();
    const a = await chatWithEngine(t);
    const b = t.connect();
    b.say("chat", "f1", { type: "ready" });
    await vi.waitFor(() => expect(b.of("chat", "view")).not.toHaveLength(0));
    t.engine()?.handlers.onApproval?.(approval("x"));
    await vi.waitFor(() => expect(b.of("chat", "view").at(-1)?.msg.view.approvals).toHaveLength(1));
    expect(b.of("chat", "view").at(-1)).toEqual(a.of("chat", "view").at(-1));
    // Un autre cadre n'est pas diffusé ici.
    const other = t.connect();
    other.say("chat", "f2", { type: "ready" });
    await vi.waitFor(() => expect(other.of("chat", "view")).not.toHaveLength(0));
    expect(other.of("chat", "view").at(-1)?.msg.view.approvals).toEqual([]);
  });

  it("« Toujours » : question posée à la coquille, jamais de true implicite", async () => {
    const t = setup();
    const shell = t.connect();
    shell.say("shell", "shell", { type: "ready" });
    await chatWithEngine(t);
    t.engine()?.handlers.onApproval?.(approval("a"));
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "always" });
    await vi.waitFor(() => expect(shell.of("shell", "confirm")).toHaveLength(1));
    const id = shell.of("shell", "confirm")[0]?.msg.id as string;
    // Une réponse inconnue est ignorée ; sans réponse, rien n'est répondu au moteur.
    shell.say("shell", "shell", { type: "confirmResult", id: "inconnu", accepted: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.engine()?.answers).toEqual([]);
    // Un nouveau socket reçoit la question encore ouverte.
    const fresh = t.connect();
    fresh.say("shell", "shell", { type: "ready" });
    await vi.waitFor(() => expect(fresh.of("shell", "confirm")).toHaveLength(1));
    fresh.say("shell", "shell", { type: "confirmResult", id, accepted: true });
    await vi.waitFor(() => expect(t.engine()?.answers).toEqual([["a", "allow", "always"]]));
  });

  it("aucune approbation sans message humain : l'arrêt du hub refuse la question en attente", async () => {
    const t = setup();
    const shell = t.connect();
    shell.say("shell", "shell", { type: "ready" });
    await chatWithEngine(t);
    t.engine()?.handlers.onApproval?.(approval("a"));
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "always" });
    await vi.waitFor(() => expect(shell.of("shell", "confirm")).toHaveLength(1));
    const engine = t.engine();
    hub.dispose();
    await new Promise((r) => setTimeout(r, 30));
    expect(engine?.answers).toEqual([]);
    expect(engine?.kills).toBeGreaterThan(0);
  });

  it("arrêt du hub : les moteurs sont arrêtés et les sockets n'agissent plus", async () => {
    const t = setup();
    const chat = await chatWithEngine(t);
    const engine = t.engine();
    hub.dispose();
    expect(engine?.kills).toBe(1);
    chat.say("chat", "f1", { type: "send", text: "après l'arrêt" });
    await new Promise((r) => setTimeout(r, 30));
    expect(engine?.prompts).toHaveLength(1);
  });
});

describe("dépendances de session", () => {
  it("préfixe prefs., index d'historique et réglages par défaut dans l'état", async () => {
    const deps = buildChatDeps({
      storage,
      frame: "f1",
      cwd: dir,
      enginePath: "x",
      engineArgs: [],
      ask: async () => false,
      onView: () => undefined,
    });
    deps.store?.set("warband.prefs", { a: 1 });
    expect(storage.state.get("prefs.warband.prefs")).toEqual({ a: 1 });
    expect(deps.store?.get("warband.prefs")).toEqual({ a: 1 });
    deps.history?.index.set("k", [1]);
    expect(storage.state.get("history.index")).toEqual([1]);
    expect(deps.history?.index.get("autre")).toEqual([1]);
    expect(deps.readSettings().capabilities?.providers).toEqual(["claude", "openai", "opencode"]);
    storage.state.set("settings", { maxTurns: 7, profile: "red-team" });
    expect(deps.readSettings()).toMatchObject({ maxTurns: 7, profile: "red-team" });
    storage.state.set("settings", { maxTurns: -1 });
    expect(() => deps.readSettings()).toThrow();
    expect(deps.history?.files.dir).toBe(join(dir, "runs"));
  });

  it("jeton : coffre + type dans l'état ; sans jeton, rien", async () => {
    const deps = buildChatDeps({
      storage,
      frame: "f1",
      cwd: dir,
      enginePath: "x",
      engineArgs: [],
      ask: async () => false,
      onView: () => undefined,
    });
    expect(await deps.getToken("claude")).toEqual({
      auth: { name: "ANTHROPIC_API_KEY", value: TOKEN },
      mode: "api-key",
    });
    storage.state.set(tokenKindKey("claude"), "subscription");
    expect(await deps.getToken("claude")).toEqual({
      auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: TOKEN },
      mode: "subscription",
    });
    expect(await deps.getToken("openai")).toBeUndefined();
    expect(await deps.getToken("opencode")).toEqual({ mode: "auto" });
    await storage.secrets.delete(tokenSecretKey("claude"));
    expect(await deps.getToken("claude")).toBeUndefined();
  });
});

describe("environnement du moteur", () => {
  it("passe par safeEnv : ni REDWIDOW_SECRET_KEY ni REDWIDOW_PASSWORD_HASH chez l'enfant", async () => {
    vi.stubEnv("REDWIDOW_SECRET_KEY", "cle-maitre-qui-ne-doit-pas-fuir");
    vi.stubEnv("REDWIDOW_PASSWORD_HASH", "scrypt$hash-qui-ne-doit-pas-fuir");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "autre-secret");
    try {
      // Vrai contrôleur, vrai `fork` : le moteur est un script qui écrit son environnement puis sort.
      const script = join(dir, "engine.mjs");
      await writeFile(
        script,
        `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] + "/env.json", JSON.stringify(process.env));`,
      );
      hub = new MissionHub({ storage, enginePath: script, binRoot: dir });
      const bridge = createBridge(hub);
      const s = new FakeSocket();
      bridge.onConnection(s as unknown as WebSocket, "session");
      s.say("chat", "f1", { type: "ready" });
      s.say("chat", "f1", { type: "send", text: "bonjour" });
      let env: Record<string, string> = {};
      await vi.waitFor(async () => {
        env = JSON.parse(await readFile(join(dir, "env.json"), "utf8"));
      });
      expect(Object.keys(env).filter((k) => k.startsWith("REDWIDOW_"))).toEqual([]);
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      // Seule variable d'authentification admise : celle du jeton du coffre.
      expect(env.ANTHROPIC_API_KEY).toBe(TOKEN);
      expect(JSON.stringify(env)).not.toContain("ne-doit-pas-fuir");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
