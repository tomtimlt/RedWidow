import type { EngineEvent, PendingApproval } from "@john-studio/core";
import { describe, expect, it, vi } from "vitest";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";

const ev = (e: Record<string, unknown>) => e as unknown as EngineEvent;

/** Contrôleur factice : le test joue le moteur. */
function fake() {
  const calls: unknown[][] = [];
  let handlers: EngineHandlers = {};
  let options!: EngineControllerOptions;
  let started: StartParams | undefined;
  const ctl: EngineController = {
    start: async (p) => {
      started = p;
    },
    prompt: (t) => void calls.push(["prompt", t]),
    answer: (...a) => void calls.push(["answer", ...a]),
    abort: () => void calls.push(["abort"]),
    dispose: () => void calls.push(["dispose"]),
    kill: () => void calls.push(["kill"]),
    exited: Promise.resolve(),
  };
  return {
    calls,
    create: (o: EngineControllerOptions) => {
      options = o;
      handlers = o.handlers ?? {};
      return ctl;
    },
    get handlers() {
      return handlers;
    },
    get options() {
      return options;
    },
    get started() {
      return started;
    },
  };
}

function setup(over: { confirm?: boolean; token?: boolean; settings?: object } = {}) {
  const f = fake();
  let view!: ChatView;
  const confirmAlways = vi.fn(async () => over.confirm ?? false);
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: [],
    readSettings: () => over.settings ?? {},
    getToken: async () =>
      over.token
        ? { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-secret" }, mode: "subscription" }
        : undefined,
    confirmAlways,
    onView: (v) => {
      view = v;
    },
    createController: f.create,
  });
  return { f, session, confirmAlways, view: () => view };
}

const approval = (id: string, code = "bash.noRule"): PendingApproval =>
  ({
    toolUseId: id,
    tool: "Bash",
    input: { command: "ls" },
    verdict: { decision: "ask", reason: { code }, rule: null },
  }) as unknown as PendingApproval;

describe("session de chat", () => {
  it("démarre le moteur au premier message, transmet réglages et jeton (jamais dans start)", async () => {
    const t = setup({
      token: true,
      settings: { model: "m", maxTurns: 3, sandbox: { image: "alpine:3.20", timeoutSec: 60 } },
    });
    await t.session.send("bonjour");
    expect(t.f.started).toEqual({
      cwd: "/w",
      auth: "subscription",
      model: "m",
      maxTurns: 3,
      sandbox: { image: "alpine:3.20", timeoutSec: 60 },
    });
    expect(JSON.stringify(t.f.started)).not.toContain("sk-secret");
    expect(t.f.options.auth).toEqual({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-secret" });
    expect(t.f.calls).toEqual([["prompt", "bonjour"]]);
    expect(t.view().busy).toBe(true);
    expect(t.view().sandbox).toBe("alpine:3.20");
    // Pas de second message pendant un tour.
    await t.session.send("encore");
    expect(t.f.calls).toHaveLength(1);
    t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
    expect(t.view().busy).toBe(false);
  });

  it("réglages invalides : erreur affichée, pas de moteur", async () => {
    const f = fake();
    let view!: ChatView;
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e",
      engineArgs: [],
      readSettings: () => {
        throw Object.assign(new Error("x"), { code: "sandbox.imageUnsupported" });
      },
      getToken: async () => undefined,
      confirmAlways: async () => true,
      onView: (v) => {
        view = v;
      },
      createController: f.create,
    });
    await session.send("hi");
    expect(view.busy).toBe(false);
    expect(view.items.at(-1)).toMatchObject({ kind: "notice", level: "error" });
    expect(f.calls).toEqual([]);
  });

  it("carte d'approbation : une fois et refuser relayés à la gate", async () => {
    const t = setup();
    await t.session.send("x");
    t.f.handlers.onApproval?.(approval("a"));
    t.f.handlers.onApproval?.(approval("b"));
    expect(t.view().approvals.map((c) => c.toolUseId)).toEqual(["a", "b"]);
    await t.session.approve("a", "once");
    await t.session.approve("b", "deny");
    expect(t.f.calls.slice(1)).toEqual([
      ["answer", "a", "allow", undefined],
      ["answer", "b", "deny", undefined],
    ]);
    expect(t.view().approvals).toEqual([]);
    // Réponse à une carte inconnue : sans effet.
    await t.session.approve("zzz", "once");
    expect(t.f.calls).toHaveLength(3);
  });

  it("« Toujours » exige la confirmation modale native", async () => {
    const refused = setup({ confirm: false });
    await refused.session.send("x");
    refused.f.handlers.onApproval?.(approval("a"));
    await refused.session.approve("a", "always");
    expect(refused.confirmAlways).toHaveBeenCalledOnce();
    expect(refused.f.calls.some((c) => c[0] === "answer")).toBe(false);
    expect(refused.view().approvals).toHaveLength(1);

    const accepted = setup({ confirm: true });
    await accepted.session.send("x");
    accepted.f.handlers.onApproval?.(approval("a"));
    await accepted.session.approve("a", "always");
    expect(accepted.f.calls).toContainEqual(["answer", "a", "allow", "always"]);
  });

  it("« Toujours » jamais pour un verdict non mémorisable, même demandé par la webview", async () => {
    const t = setup({ confirm: true });
    await t.session.send("x");
    t.f.handlers.onApproval?.(approval("a", "path.sensitive"));
    await t.session.approve("a", "always");
    expect(t.confirmAlways).not.toHaveBeenCalled();
    expect(t.f.calls.some((c) => c[0] === "answer")).toBe(false);
  });

  it("stop annule, fin du moteur libère l'état, le message suivant reprend la session", async () => {
    const t = setup();
    await t.session.send("x");
    t.f.handlers.onEnded?.({
      status: "success",
      turns: 1,
      costUsd: 0,
      result: null,
      sessionId: "S1",
    });
    t.session.stop();
    expect(t.f.calls).toContainEqual(["abort"]);
    t.f.handlers.onExit?.({ code: 0, signal: null });
    expect(t.view().busy).toBe(false);
    await t.session.send("suite");
    expect(t.f.started?.resume).toBe("S1");
  });

  it("l'état du chat ne contient que du texte neutralisé", async () => {
    const t = setup();
    await t.session.send("x");
    t.f.handlers.onEvent?.(
      ev({ kind: "agent.text", text: "<img src=x onerror=alert(1)>\x1b[2K‮ok" }),
    );
    const last = t.view().items.at(-1);
    expect(last).toMatchObject({ kind: "agent", text: "<img src=x onerror=alert(1)>ok" });
    t.f.handlers.onLog?.("x");
  });

  it("outil : requête, résultat plafonné, refus affiché", async () => {
    const t = setup();
    await t.session.send("x");
    t.f.handlers.onEvent?.(
      ev({ kind: "tool.requested", toolUseId: "u", tool: "Bash", input: { command: "ls" } }),
    );
    t.f.handlers.onEvent?.(
      ev({
        kind: "tool.result",
        toolUseId: "u",
        isError: false,
        output: "y".repeat(5000),
        truncated: false,
        bytes: 5000,
      }),
    );
    const tool = t.view().items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ status: "ok", truncated: true });
    expect(tool?.kind === "tool" && tool.output?.length).toBeLessThanOrEqual(2001);
  });
});
