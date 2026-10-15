import type { EngineEvent, ModelOption, PendingApproval } from "@john-studio/core";
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
  const starts: StartParams[] = [];
  let modelList: ModelOption[] = [];
  let modelError = false;
  const ctl: EngineController = {
    start: async (p) => {
      started = p;
      starts.push(p);
    },
    models: async () => {
      if (modelError) throw new Error("sondage");
      return modelList;
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
    starts,
    setModels: (l: ModelOption[]) => {
      modelList = l;
    },
    failModels: () => {
      modelError = true;
    },
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

function setup(
  over: {
    confirm?: boolean;
    token?: boolean;
    settings?: object;
    store?: { get(k: string): unknown; set(k: string, v: unknown): unknown };
  } = {},
) {
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
    sdkVersion: "1.0.0",
    ...(over.store && { store: over.store }),
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
      settings: {
        model: "m",
        maxTurns: 3,
      },
    });
    await t.session.send("bonjour");
    expect(t.f.started).toEqual({
      cwd: "/w",
      auth: "subscription",
      model: "m",
      maxTurns: 3,
    });
    expect(JSON.stringify(t.f.started)).not.toContain("sk-secret");
    expect(t.f.options.auth).toEqual({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-secret" });
    expect(t.f.calls).toEqual([["prompt", "bonjour"]]);
    expect(t.view().busy).toBe(true);
    expect(t.view().sandbox).toBeNull();
    // Pas de second message pendant un tour.
    await t.session.send("encore");
    expect(t.f.calls).toHaveLength(1);
    t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
    expect(t.view().busy).toBe(false);
  });

  it("sandbox.started (journal) : en-tête réseau ; autre valeur : éteint", async () => {
    const t = setup();
    await t.session.send("go");
    t.f.handlers.onEvent?.(
      ev({
        kind: "sandbox.started",
        containerId: "c",
        image: "alpine:3.20",
        imageDigest: null,
        network: "bridge",
        limits: {},
      }),
    );
    expect(t.view().sandboxNetwork).toBe("bridge");
    t.f.handlers.onEvent?.(
      ev({
        kind: "sandbox.started",
        containerId: "c",
        image: "alpine:3.20",
        imageDigest: null,
        network: "host",
        limits: {},
      }),
    );
    expect(t.view().sandboxNetwork).toBe("bridge");
  });

  it("réglages invalides : erreur affichée, pas de moteur", async () => {
    const f = fake();
    let view!: ChatView;
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e",
      engineArgs: [],
      readSettings: () => {
        throw Object.assign(new Error("x"), { code: "sandbox.invalidArgument" });
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

describe("modèle et effort (F2/F3)", () => {
  const mk = (): ModelOption => ({
    value: "a",
    displayName: "A",
    supportedEffortLevels: ["low", "high"],
  });
  const memStore = () => {
    const m = new Map<string, unknown>();
    return { m, get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v) };
  };

  it("sondage : liste exposée et mise en cache", async () => {
    const store = memStore();
    const { f, session, view } = setup({ store });
    f.setModels([mk()]);
    await session.loadModels();
    expect(view().controls?.models?.map((m) => m.value)).toEqual(["a"]);
    expect(store.m.get("john.models")).toMatchObject({ sdk: "1.0.0" });
  });

  it("sondage en échec : repli en saisie libre", async () => {
    const { f, session, view } = setup();
    f.failModels();
    await session.loadModels();
    expect(view().controls?.models).toBeNull();
    expect(view().controls?.modelsStatus).toBe("unavailable");
  });

  it("choix hostile refusé, préférences inchangées", async () => {
    const { f, session, view } = setup();
    f.setModels([mk()]);
    await session.loadModels();
    session.setModel("pas-dans-la-liste");
    expect(view().controls?.model).toBeNull();
    expect(view().items.at(-1)).toMatchObject({ kind: "notice", level: "error" });
    session.setEffort("ultra");
    expect(view().controls?.effort).toBeNull();
  });

  it("effort non supporté ramené avec avis", async () => {
    const { f, session, view } = setup();
    f.setModels([mk()]);
    await session.loadModels();
    session.setModel("a");
    session.setEffort("max");
    expect(view().controls?.effort).toBe("high");
    expect(view().items.at(-1)).toMatchObject({ kind: "notice" });
  });

  it("transmis au démarrage, puis reprise par resume si le choix change", async () => {
    const { f, session } = setup();
    f.setModels([mk()]);
    await session.loadModels();
    session.setModel("a");
    session.setEffort("low");
    await session.send("un");
    expect(f.starts[0]).toMatchObject({ model: "a", effort: "low" });
    f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1" }));
    f.handlers.onEnded?.({ sessionId: "S1" } as never);
    session.setEffort("high");
    await session.send("deux");
    expect(f.starts[1]).toMatchObject({ model: "a", effort: "high", resume: "S1" });
  });

  it("changement ignoré pendant un tour", async () => {
    const { f, session, view } = setup();
    f.setModels([mk()]);
    await session.loadModels();
    await session.send("un");
    session.setEffort("low");
    expect(view().controls?.effort).toBeNull();
  });
});

describe("effort par défaut et Ultracode", () => {
  it("Auto : aucun effort transmis tant que le curseur n'est pas touché", async () => {
    const t = setup();
    await t.session.send("un");
    expect(t.f.started).not.toHaveProperty("effort");
    expect(t.view().controls?.effortLabel).toBe("Auto");
  });

  it("revenir à Auto (null) retire l'effort au message suivant", async () => {
    const { f, session } = setup();
    session.setEffort("low");
    await session.send("un");
    expect(f.starts[0]).toMatchObject({ effort: "low" });
    f.handlers.onEnded?.({ sessionId: "S1" } as never);
    session.setEffort(null);
    await session.send("deux");
    expect(f.starts[1]).not.toHaveProperty("effort");
  });

  it("Ultracode : effort max + plafonds des réglages john.ultracode.* (jamais 'ultracode' transmis)", async () => {
    const t = setup({
      settings: { maxTurns: 5, ultracode: { maxTurns: 120, maxBudgetUsd: 7 } },
    });
    t.session.setEffort("ultracode");
    await t.session.send("un");
    expect(t.f.started).toMatchObject({ effort: "max", maxTurns: 120, maxBudgetUsd: 7 });
    expect(JSON.stringify(t.f.started)).not.toContain("ultracode");
    expect(t.view().controls?.effort).toBe("ultracode");
  });

  it("Ultracode refusé si le modèle ne supporte pas max", async () => {
    const { f, session, view } = setup();
    f.setModels([{ value: "a", displayName: "A", supportedEffortLevels: ["low", "high"] }]);
    await session.loadModels();
    session.setModel("a");
    session.setEffort("ultracode");
    expect(view().controls?.effort).toBeNull();
    expect(view().items.at(-1)).toMatchObject({ kind: "notice", level: "error" });
  });
});

describe("historique (F4)", () => {
  const RUN1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const jline = (payload: Record<string, unknown>, n: number) =>
    JSON.stringify({
      v: 1,
      id: `e${n}`,
      seq: n,
      ts: "2026-10-15T10:00:00.000Z",
      runId: RUN1,
      parentId: null,
      ...payload,
    });
  function withHistory() {
    const stored = new Map<string, unknown>();
    const written = new Map<string, string>();
    const removed: string[] = [];
    const t = setup();
    const confirmDelete = vi.fn(async () => true);
    const f = t.f;
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: [],
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: (v) => {
        t.view = () => v;
      },
      createController: f.create,
      history: {
        index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
        files: {
          dir: "/h",
          read: async (id) => written.get(id) ?? null,
          size: async (id) => written.get(id)?.length ?? 0,
          remove: async (ids) => void removed.push(...ids),
          removeAll: async () => void written.clear(),
        },
        confirmDelete,
      },
    });
    return { f, session, stored, written, removed, confirmDelete, view: () => session.view() };
  }

  it("enregistre la conversation (titre = 1re consigne), journalDir transmis, ouverture en lecture seule", async () => {
    const h = withHistory();
    await h.session.send("Première consigne de la conversation");
    expect(h.f.started).toMatchObject({ journalDir: "/h" });
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1", model: "m" }));
    h.f.handlers.onEvent?.(
      ev({ kind: "tool.requested", toolUseId: "t", tool: "Read", input: { file_path: "a" } }),
    );
    h.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const entry = h.view().history[0];
    expect(entry).toMatchObject({
      title: "Première consigne de la conversation",
      tools: 1,
      model: "m",
    });

    h.written.set(
      RUN1,
      [
        jline({ kind: "user.message", text: "Première consigne" }, 0),
        jline({ kind: "agent.text", text: "Réponse" }, 1),
        jline(
          {
            kind: "approval.requested",
            toolUseId: "t",
            tool: "Bash",
            input: { command: "ls" },
            verdict: { code: "bash.noRule" },
          },
          2,
        ),
        "{corrompu",
      ].join("\n"),
    );
    h.f.handlers.onExit?.({ code: 0 } as never);
    await h.session.openConversation(entry?.id);
    const v = h.view();
    expect(v.readonly).toMatchObject({ invalid: 1, canResume: true });
    expect(v.approvals).toEqual([]);
    expect(v.items.map((i) => i.kind)).toEqual(["user", "agent"]);
    // Lecture seule : l'envoi est ignoré.
    const before = h.f.calls.length;
    await h.session.send("ne part pas");
    expect(h.f.calls).toHaveLength(before);
    // Reprise : resume de la session, sous la politique actuelle (nouveau moteur).
    h.session.resumeConversation();
    expect(h.view().readonly).toBeNull();
    await h.session.send("suite");
    expect(h.f.starts.at(-1)).toMatchObject({ resume: "S1" });
  });

  it("identifiants hostiles ignorés ; renommer nettoie ; supprimer et tout effacer", async () => {
    const h = withHistory();
    await h.session.send("une");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const id = h.view().history[0]?.id as string;
    await h.session.openConversation("../etc/passwd");
    expect(h.view().readonly).toBeNull();
    h.session.renameConversation(id, "Nouveau‮ titre");
    expect(h.view().history[0]?.title).toBe("Nouveau titre");
    h.session.renameConversation(id, "   ");
    expect(h.view().history[0]?.title).toBe("Nouveau titre");
    await h.session.deleteConversation("pas-un-id");
    expect(h.confirmDelete).not.toHaveBeenCalled();
    await h.session.deleteConversation(id);
    expect(h.removed).toEqual([RUN1]);
    expect(h.view().history).toEqual([]);
    await h.session.clearHistory();
    expect(h.confirmDelete).toHaveBeenCalledTimes(2);
  });
});
