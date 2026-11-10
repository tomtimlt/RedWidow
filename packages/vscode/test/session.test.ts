import type {
  BypassState,
  EngineEvent,
  ModelOption,
  PendingApproval,
  ProviderOption,
} from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { createBypassHost } from "../src/logic/bypass.js";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import { ModelProbeError } from "../src/logic/model-load-error.js";
import { programDraftPrompt, programDraftSettings } from "../src/logic/program-controls.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession, MODEL_LOAD_TIMEOUT_MS } from "../src/logic/session.js";

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
    models: async (params) => {
      calls.push(["models", params]);
      if (modelError) throw new Error("sondage");
      return modelList;
    },
    prompt: (t, research, images) =>
      void calls.push(
        images
          ? ["prompt", t, research, images]
          : research === undefined
            ? ["prompt", t]
            : ["prompt", t, research],
      ),
    answer: (...a) => void calls.push(["answer", ...a]),
    abort: () => void calls.push(["abort"]),
    dispose: () => void calls.push(["dispose"]),
    kill: () => void calls.push(["kill"]),
    bypass: (state) => {
      calls.push(["bypass", state]);
      return calls.filter((c) => c[0] === "bypass").length;
    },
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
      return { ...ctl };
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
    observe?: (event: EngineEvent | null) => void;
    providers?: (catalog: ProviderOption[]) => void;
    confirm?: boolean;
    token?: boolean;
    settings?: object;
    getTestAccounts?: import("../src/logic/session.js").ChatSessionDeps["getTestAccounts"];
    store?: { get(k: string): unknown; set(k: string, v: unknown): unknown };
    learningKey?: string;
    prefsKey?: string;
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
    ...(over.getTestAccounts && { getTestAccounts: over.getTestAccounts }),
    ...(over.providers && { onProviders: over.providers }),
    ...(over.observe && { onObservedEvent: over.observe }),
    onView: (v) => {
      view = v;
    },
    createController: f.create,
    sdkVersion: "1.0.0",
    ...(over.store && { store: over.store }),
    ...(over.learningKey !== undefined && { learningKey: over.learningKey }),
    ...(over.prefsKey !== undefined && { prefsKey: over.prefsKey }),
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
  it("regroupe le flux de sortie mais affiche immédiatement une approbation ou un résultat", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.session.send("test");
      t.f.handlers.onEvent?.(
        ev({
          id: "req",
          kind: "tool.requested",
          toolUseId: "t",
          tool: "mcp__exegol__exec",
          input: {},
        }),
      );
      t.f.handlers.onEvent?.(
        ev({ id: "proc", parentId: "req", kind: "process.started", argv: [], pid: 1 }),
      );
      const initial = t.view();
      for (let i = 0; i < 30; i++)
        t.f.handlers.onEvent?.(
          ev({ kind: "process.output", parentId: "proc", stream: "stdout", line: `ligne ${i}` }),
        );
      expect(t.view()).toBe(initial);
      await vi.advanceTimersByTimeAsync(100);
      expect(t.view()).not.toBe(initial);
      expect(t.view().items.at(-1)).toMatchObject({ output: expect.stringContaining("ligne 29") });
      t.f.handlers.onApproval?.(approval("a"));
      expect(t.view().approvals).toHaveLength(1);
      t.f.handlers.onEvent?.(
        ev({ kind: "tool.result", toolUseId: "t", output: "terminé", isError: false }),
      );
      expect(t.view().items.at(-1)).toMatchObject({ output: "terminé", status: "ok" });
      t.session.dispose();
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      vi.useRealTimers();
    }
  });

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
      profile: "out-of-box",
      auth: "subscription",
      provider: "claude",
      model: "m",
      supervision: "standard",
      maxTurns: 3,
    });
    expect(JSON.stringify(t.f.started)).not.toContain("sk-secret");
    expect(t.f.options.auth).toEqual({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "sk-secret" });
    expect(t.f.calls).toEqual([["prompt", "bonjour"]]);
    expect(t.view().busy).toBe(true);
    expect(t.view().sandbox).toBeNull();
    // Un message pendant un tour est transmis au moteur déjà actif.
    const startedAt = t.view().turnStartedAt;
    expect(await t.session.send("encore")).toBe(true);
    expect(t.f.calls).toEqual([
      ["prompt", "bonjour"],
      ["prompt", "encore"],
    ]);
    expect(t.view().turnStartedAt).toBe(startedAt);
    t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
    expect(t.view().busy).toBe(false);
  });

  it("n’accepte une recherche explicite que si les outils Web sont sélectionnés", async () => {
    const settings = {
      capabilities: { providers: ["claude"], skills: [], integrations: [], webSearch: true },
    };
    const t = setup({ settings });
    expect(await t.session.send("cherche", "cherche", true)).toBe(false);
    expect(t.f.calls).toEqual([]);
    t.session.setSelection({ profile: null, integrations: [], burp: false, webSearch: true });
    expect(await t.session.send("cherche", "cherche", true)).toBe(true);
    expect(t.f.calls).toContainEqual(["prompt", "cherche", true]);
    t.session.dispose();
  });

  it("acquitte uniquement un prompt transmis et garde les fichiers hors de la bulle", async () => {
    const t = setup();
    expect(await t.session.send(" ")).toBe(false);
    const display = "Analyse les fichiers joints.\n\nPièces jointes :\n• preuve.log";
    const prompt = `${display}\nContenu de preuve.log : état confirmé`;
    expect(await t.session.send(display, prompt)).toBe(true);
    expect(t.f.calls).toEqual([["prompt", prompt]]);
    expect(
      t
        .view()
        .items.filter((item) => item.kind === "user")
        .map((item) => item.text),
    ).toEqual([display]);
    expect(await t.session.send(display, prompt)).toBe(true);
    expect(t.f.calls.filter((call) => call[0] === "prompt")).toHaveLength(2);
    t.session.stop();
  });

  it("reconstruit le moteur quand la connexion Burp change, sans changer la conversation", async () => {
    const settings: { burp?: { port: number; transport: "sse" } } = {};
    const t = setup({ settings });
    await t.session.send("premier");
    const conversation = t.view().conversation;
    expect(t.f.started).not.toHaveProperty("burp");
    t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
    settings.burp = { port: 9876, transport: "sse" };
    await t.session.send("deuxième");
    expect(t.f.started?.burp).toEqual(settings.burp);
    expect(t.view().conversation).toBe(conversation);
    t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
    delete settings.burp;
    await t.session.send("troisième");
    expect(t.f.started).not.toHaveProperty("burp");
    expect(t.view().conversation).toBe(conversation);
    t.session.stop();
  });

  it("la bulle garde la consigne, le moteur reçoit la sortie citée", async () => {
    const t = setup();
    const cited = "vois #htb1\n\n<<<sortie-terminal>>>\n80/tcp";
    await t.session.send("vois #htb1", cited);
    expect(t.f.calls).toEqual([["prompt", cited]]);
    expect(
      t
        .view()
        .items.filter((item) => item.kind === "user")
        .map((item) => item.text),
    ).toEqual(["vois #htb1"]);
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

  it.each(["annulée", "en erreur"])(
    "confirmation native %s : carte restaurée sans autorisation",
    async (outcome) => {
      const t = setup();
      let finish!: (value: boolean) => void;
      let fail!: (error: Error) => void;
      const modal = new Promise<boolean>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      t.confirmAlways.mockReturnValueOnce(modal);
      await t.session.send("x");
      t.f.handlers.onApproval?.(approval("a"));
      const pending = t.session.approve("a", "always");
      expect(t.view().approvals[0]?.confirming).toBe(true);
      await t.session.approve("a", "once");
      expect(t.f.calls.some((c) => c[0] === "answer")).toBe(false);
      if (outcome === "annulée") {
        finish(false);
        await pending;
      } else {
        fail(new Error("dialogue indisponible"));
        await expect(pending).rejects.toThrow("dialogue indisponible");
      }
      expect(t.view().approvals[0]?.confirming).toBe(false);
      expect(t.f.calls.some((c) => c[0] === "answer")).toBe(false);
      await t.session.approve("a", "once");
      expect(t.f.calls.filter((c) => c[0] === "answer")).toEqual([
        ["answer", "a", "allow", undefined],
      ]);
    },
  );

  it("une confirmation périmée ne répond pas à une nouvelle carte de même identifiant", async () => {
    const t = setup();
    let finish!: (value: boolean) => void;
    t.confirmAlways.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    await t.session.send("ancienne");
    t.f.handlers.onApproval?.(approval("a"));
    const pending = t.session.approve("a", "always");
    t.session.reset();
    await t.session.send("nouvelle");
    t.f.handlers.onApproval?.(approval("a"));
    finish(true);
    await pending;
    expect(t.f.calls.some((c) => c[0] === "answer")).toBe(false);
    expect(t.view().approvals).toHaveLength(1);
    expect(t.view().approvals[0]?.confirming).toBeUndefined();
  });

  it("« Toujours » jamais pour un verdict non mémorisable, même demandé par la webview", async () => {
    const t = setup({ confirm: true });
    await t.session.send("x");
    t.f.handlers.onApproval?.(approval("a", "path.sensitive"));
    await t.session.approve("a", "always");
    expect(t.confirmAlways).not.toHaveBeenCalled();
    expect(t.f.calls.some((c) => c[0] === "answer")).toBe(false);
  });

  it("reset ou stop volontaire : pas de « Operation aborted », une erreur réseau reste", async () => {
    const failure = (message: string) => ev({ kind: "error", code: "error.unknown", message });
    const texts = (items: readonly object[]) =>
      items.flatMap((item) => ("text" in item && typeof item.text === "string" ? [item.text] : []));

    const reset = setup();
    await reset.session.send("bonjour");
    reset.session.reset();
    reset.f.handlers.onEvent?.(failure("Operation aborted"));
    reset.f.handlers.onError?.({ code: "error.unknown", message: "The operation was aborted" });
    expect(texts(reset.view().items).join("\n")).not.toMatch(/operation aborted/i);
    expect(reset.view().items).toEqual([]);

    const stopped = setup();
    await stopped.session.send("bonjour");
    stopped.session.stop();
    stopped.f.handlers.onEvent?.(failure("AbortError: Operation aborted"));
    stopped.f.handlers.onError?.({ code: "error.unknown", message: "annulé par l'utilisateur" });
    const afterStop = texts(stopped.view().items);
    expect(afterStop.join("\n")).not.toMatch(/operation aborted|annulé par l'utilisateur/i);
    expect(afterStop).toContain("Arrêt demandé.");
    stopped.f.handlers.onEvent?.(failure("ECONNRESET"));
    expect(
      stopped.view().items.some((item) => item.kind === "notice" && item.text === "ECONNRESET"),
    ).toBe(true);

    const live = setup();
    await live.session.send("bonjour");
    live.f.handlers.onEvent?.(failure("ECONNRESET"));
    expect(
      live.view().items.some((item) => item.kind === "notice" && item.text === "ECONNRESET"),
    ).toBe(true);
    live.f.handlers.onError?.({ code: "error.unknown", message: "Operation aborted" });
    expect(texts(live.view().items).join("\n")).toContain("Operation aborted");
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

  it("Stop attend la sortie du moteur, force son arrêt et marque les outils sans résultat", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.session.send("x");
      t.f.handlers.onEvent?.(
        ev({
          id: "req",
          runId: "r",
          kind: "tool.requested",
          toolUseId: "t",
          tool: "Bash",
          input: {},
        }),
      );
      t.session.stop();
      t.f.handlers.onEvent?.(ev({ kind: "turn.finished" }));
      expect(t.view().busy).toBe(true);
      t.f.handlers.onEnded?.({ status: "error", turns: 0, costUsd: 0, result: null });
      expect(await t.session.send("trop tôt")).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(t.f.calls).toContainEqual(["kill"]);
      expect(t.view().busy).toBe(true);
      t.f.handlers.onExit?.({ code: null, signal: "SIGKILL" });
      expect(t.view().busy).toBe(false);
      expect(t.view().items.find((item) => item.kind === "tool")).toMatchObject({
        status: "interrupted",
      });
      expect(JSON.stringify(t.view().items)).toContain("tâches détachées");
      expect(await t.session.send("suite")).toBe(true);
      t.session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("une sortie inattendue laisse les outils sans résultat dans un état inconnu", async () => {
    const t = setup();
    await t.session.send("x");
    t.f.handlers.onEvent?.(
      ev({
        id: "req",
        runId: "r",
        kind: "tool.requested",
        toolUseId: "t",
        tool: "Bash",
        input: {},
      }),
    );
    t.f.handlers.onExit?.({
      code: 1,
      signal: null,
      stderrTail: `diagnostic\n${"x".repeat(60_000)}fin`,
    });
    expect(JSON.stringify(t.view().items)).toContain("fin");
    expect(JSON.stringify(t.view().items)).toContain("diagnostic");
    expect(t.view().items.find((item) => item.kind === "tool")).toMatchObject({
      status: "interrupted",
    });
    expect(JSON.stringify(t.view().items)).toContain("tâches détachées");
    t.session.dispose();
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
    expect(store.m.get("warband.models")).toMatchObject({ sdk: "1.0.0" });
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

  it("recharge les comptes au prochain message sans changer de conversation", async () => {
    const accounts: import("@warband/core").TestAccount[] = [];
    const { f, session } = setup({ getTestAccounts: async () => [...accounts] });
    await session.send("un");
    f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1" }));
    f.handlers.onEnded?.({ sessionId: "S1" } as never);
    accounts.push({
      label: "A",
      host: "",
      identifier: "test@example.com",
      secret: "xy",
      kind: "password",
    });
    session.testAccountsChanged();
    await session.send("deux");
    expect(f.starts[1]).toMatchObject({ resume: "S1", testAccounts: accounts });
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

describe("variantes de raisonnement", () => {
  it("utilise uniquement les variantes runtime, les réinitialise avec le modèle et les omet en Auto", async () => {
    const t = setup();
    t.f.setModels([
      { value: "a", displayName: "A", reasoningVariants: ["deep-custom", "fast-custom"] },
      { value: "b", displayName: "B", reasoningVariants: ["other"] },
    ]);
    await t.session.setProvider("opencode");
    t.session.setModel("a");
    t.session.setVariant("high");
    expect(t.session.view().controls?.variant).toBeNull();
    t.session.setVariant("deep-custom");
    await t.session.send("premier");
    expect(t.f.started).toMatchObject({ variant: "deep-custom" });
    expect(t.f.started).not.toHaveProperty("effort");
    t.session.setVariant("fast-custom");
    expect(t.session.view().controls?.variant).toBe("deep-custom");
    t.f.handlers.onEnded?.({} as never);
    t.session.setModel("b");
    expect(t.session.view().controls?.variant).toBeNull();
    await t.session.send("autre modèle");
    expect(t.f.started).not.toHaveProperty("variant");
    t.f.handlers.onEnded?.({} as never);
    t.session.setVariant("other");
    t.session.setVariant(null);
    await t.session.send("auto");
    expect(t.f.started).not.toHaveProperty("variant");
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

  it("Ultracode : effort max + plafonds des réglages warband.ultracode.* (jamais 'ultracode' transmis)", async () => {
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
  function withHistory(
    key = "warband.history",
    readHistoryProjects?: () => Promise<import("../src/logic/history.js").HistoryProjects>,
  ) {
    const stored = new Map<string, unknown>();
    const written = new Map<string, string>();
    let readBarrier: Promise<void> | undefined;
    const removed: string[] = [];
    const t = setup();
    const confirmDelete = vi.fn(async () => true);
    const f = t.f;
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: [],
      ...(readHistoryProjects && { readHistoryProjects }),
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: (v) => {
        t.view = () => v;
      },
      createController: f.create,
      history: {
        key,
        index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
        files: {
          dir: "/h",
          read: async (id) => {
            await readBarrier;
            return written.get(id) ?? null;
          },
          size: async (id) => written.get(id)?.length ?? 0,
          remove: async (ids) => void removed.push(...ids),
          removeAll: async () => void written.clear(),
        },
        confirmDelete,
      },
    });
    return {
      f,
      session,
      stored,
      written,
      removed,
      confirmDelete,
      holdReads: (barrier: Promise<void>) => {
        readBarrier = barrier;
      },
      view: () => session.view(),
    };
  }

  it.each(["reset", "stop", "dispose"] as const)(
    "%s invalide un envoi en attente de lecture des projets",
    async (action) => {
      let resolve!: (value: import("../src/logic/history.js").HistoryProjects) => void;
      const projects = new Promise<import("../src/logic/history.js").HistoryProjects>((done) => {
        resolve = done;
      });
      const h = withHistory("warband.history", () => projects);
      const sending = h.session.send("ne doit pas partir");
      h.session[action]();
      resolve({ activeId: null, projects: [] });
      await sending;
      expect(h.f.starts).toEqual([]);
      expect(h.f.calls).toEqual([]);
      expect(h.view().history).toEqual([]);
      expect(h.view().items).toEqual([]);
    },
  );

  it("reset invalide une ouverture et une reprise en attente sans restaurer la conversation", async () => {
    type Projects = import("../src/logic/history.js").HistoryProjects;
    let pending: Promise<Projects> | undefined;
    const h = withHistory(
      "warband.history",
      () => pending ?? Promise.resolve({ activeId: null, projects: [] }),
    );
    await h.session.send("conversation");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const id = h.view().history[0]?.id;
    let resolve!: (value: Projects) => void;
    pending = new Promise<Projects>((done) => {
      resolve = done;
    });
    const opening = h.session.openConversation(id);
    h.session.reset();
    resolve({ activeId: null, projects: [] });
    await opening;
    expect(h.view().readonly).toBeNull();
    expect(h.view().items).toEqual([]);
    pending = undefined;
    await h.session.openConversation(id);
    expect(h.view().readonly).not.toBeNull();
    pending = new Promise<Projects>((done) => {
      resolve = done;
    });
    const resuming = h.session.resumeConversation();
    h.session.reset();
    resolve({ activeId: null, projects: [] });
    await resuming;
    expect(h.view().readonly).toBeNull();
    expect(h.view().items).toEqual([]);
    const starts = h.f.starts.length;
    pending = undefined;
    await h.session.send("conversation neuve");
    expect(h.f.starts.length).toBe(starts + 1);
    expect(h.f.started?.resume).toBeUndefined();
  });

  it("classe une fois par projet et bloque les changements de cible entre tours et à la reprise", async () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let activeId = a;
    let name = "Alpha";
    const h = withHistory("warband.history", async () => ({
      activeId,
      projects: [
        { id: a, name },
        { id: b, name: "Beta" },
      ],
    }));
    await h.session.send("première");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const id = h.view().history[0]?.id;
    expect(h.stored.get("warband.history")).toMatchObject([{ projectId: a }]);
    activeId = b;
    const calls = h.f.calls.length;
    await h.session.send("ne doit pas partir");
    expect(h.f.calls).toHaveLength(calls);
    expect(h.view().busy).toBe(false);
    expect(h.stored.get("warband.history")).toMatchObject([{ projectId: a }]);
    await h.session.openConversation(id);
    await h.session.resumeConversation();
    expect(h.view().readonly).not.toBeNull();
    activeId = a;
    name = "Alpha renommé";
    await h.session.refreshHistoryProjects();
    expect(h.view().history[0]?.projectLabel).toBe(name);
    await h.session.resumeConversation();
    expect(h.view().readonly).toBeNull();
    expect(h.stored.get("warband.history")).toMatchObject([{ projectId: a }]);
  });

  it("sans projet puis projet actif : refuse de réattribuer la conversation ; lecture en erreur bloque aussi", async () => {
    let activeId: string | null = null;
    let broken = false;
    const h = withHistory("warband.history", async () => {
      if (broken) throw new Error("lecture");
      return { activeId, projects: [] };
    });
    await h.session.send("sans projet");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const calls = h.f.calls.length;
    activeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await h.session.send("bloqué");
    expect(h.f.calls).toHaveLength(calls);
    activeId = null;
    broken = true;
    await h.session.send("lecture ratée");
    expect(h.f.calls).toHaveLength(calls);
    expect(h.view().busy).toBe(false);
    expect(h.stored.get("warband.history")).toMatchObject([{ title: "sans projet" }]);
    expect(
      (h.stored.get("warband.history") as { projectId?: string }[])[0]?.projectId,
    ).toBeUndefined();
  });

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
    await h.session.resumeConversation();
    expect(h.view().readonly).toBeNull();
    await h.session.send("suite");
    expect(h.f.starts.at(-1)).toMatchObject({ resume: "S1" });
  });

  it("reprend avec le fournisseur et le modèle de la conversation", async () => {
    const h = withHistory();
    await h.session.setProvider("openai");
    h.session.setModel("modele-openai");
    await h.session.send("première");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "OPENAI-S" }));
    h.f.handlers.onEnded?.({ sessionId: "OPENAI-S" } as never);
    const id = h.view().history[0]?.id;
    expect(h.view().history[0]?.provider).toBe("OpenAI");
    h.session.reset();
    await h.session.setProvider("claude");
    await h.session.openConversation(id);
    await h.session.resumeConversation();
    expect(h.session.getProvider()).toBe("openai");
    await h.session.send("suite");
    expect(h.f.started).toMatchObject({
      provider: "openai",
      model: "modele-openai",
      resume: "OPENAI-S",
    });
  });

  it.each(["openai", "opencode"] as const)(
    "conserve conversation, projet et contexte via %s",
    async (provider) => {
      const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const h = withHistory("warband.history", async () => ({
        activeId: projectId,
        projects: [{ id: projectId, name: "Courant" }],
      }));
      await h.session.send("question initiale");
      h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
      h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "CLAUDE-S" }));
      h.f.handlers.onEvent?.(ev({ kind: "agent.text", text: "réponse Claude" }));
      h.f.handlers.onEnded?.({ sessionId: "CLAUDE-S" } as never);
      const id = h.view().history[0]?.id;
      const old = h.f.handlers;
      await h.session.setProvider(provider);
      old.onEvent?.(ev({ kind: "session.started", sessionId: "TARDIF" }));
      expect(h.stored.get("warband.history")).toMatchObject([
        { id, projectId, provider, sessionId: null, runIds: [RUN1] },
      ]);
      expect(
        h.view().items.some((item) => item.kind === "agent" && item.text === "réponse Claude"),
      ).toBe(true);
      await h.session.send("question OpenAI");
      expect(h.f.started).toMatchObject({
        provider,
        conversationContext: {
          messages: [
            { role: "user", text: "question initiale" },
            { role: "assistant", text: "réponse Claude" },
          ],
        },
      });
      expect(h.f.started).not.toHaveProperty("resume");
      h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "OPENAI-S" }));
      h.f.handlers.onEvent?.(ev({ kind: "agent.text", text: "réponse OpenAI" }));
      h.f.handlers.onEnded?.({ sessionId: "OPENAI-S" } as never);
      await h.session.setProvider("claude");
      await h.session.send("retour Claude");
      expect(h.f.started).not.toHaveProperty("resume");
      expect(h.f.started?.conversationContext?.messages.map((message) => message.text)).toEqual([
        "question initiale",
        "réponse Claude",
        "question OpenAI",
        "réponse OpenAI",
      ]);
      expect(h.view().history).toHaveLength(1);
      expect(h.view().history[0]?.id).toBe(id);
      expect(h.stored.get("warband.history")).toMatchObject([{ projectId, provider: "claude" }]);
    },
  );

  it.each(["error", "event-error", "exit", "sdk-error", "ended-error"] as const)(
    "conserve le transfert après un échec %s et recommence sans session SDK partielle",
    async (failure) => {
      const h = withHistory();
      await h.session.send("contexte Claude");
      h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
      h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "CLAUDE-S" }));
      h.f.handlers.onEnded?.({ status: "success", sessionId: "CLAUDE-S" } as never);
      await h.session.setProvider("openai");
      await h.session.send("premier essai OpenAI");
      const failed = h.f.handlers;
      if (failure === "sdk-error" || failure === "ended-error") {
        failed.onEvent?.(ev({ kind: "session.started", sessionId: "PARTIEL" }));
        expect(h.stored.get("warband.history")).toMatchObject([{ sessionId: null }]);
      }
      if (failure === "exit") failed.onExit?.({ code: 1, signal: null });
      else if (failure === "event-error")
        failed.onEvent?.(ev({ kind: "error", code: "error.unknown", message: "échec" }));
      else if (failure === "ended-error")
        failed.onEnded?.({ status: "error", sessionId: "PARTIEL" } as never);
      else failed.onError?.({ code: "error.unknown" } as never);
      expect(h.stored.get("warband.history")).toMatchObject([{ sessionId: null }]);
      failed.onEvent?.(ev({ kind: "session.started", sessionId: "TARDIF" }));
      await h.session.send("réessai OpenAI");
      expect(h.f.starts).toHaveLength(3);
      expect(h.f.started).not.toHaveProperty("resume");
      expect(h.f.started?.conversationContext?.messages.map((message) => message.text)).toEqual([
        "contexte Claude",
        "premier essai OpenAI",
      ]);
    },
  );

  it("confirme le transfert dès le premier tour réussi et conserve cette confirmation après un échec ultérieur", async () => {
    const h = withHistory();
    await h.session.send("contexte Claude");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEvent?.(ev({ kind: "turn.finished", status: "success" }));
    await h.session.setProvider("openai");
    await h.session.send("premier OpenAI");
    h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "OPENAI-S" }));
    expect(h.stored.get("warband.history")).toMatchObject([{ sessionId: null }]);
    h.f.handlers.onEvent?.(ev({ kind: "turn.finished", status: "success" }));
    expect(h.stored.get("warband.history")).toMatchObject([{ sessionId: "OPENAI-S" }]);
    await h.session.send("deuxième OpenAI");
    expect(h.f.starts).toHaveLength(2);
    expect(h.f.calls.filter((call) => call[0] === "prompt")).toEqual([
      ["prompt", "contexte Claude"],
      ["prompt", "premier OpenAI"],
      ["prompt", "deuxième OpenAI"],
    ]);
    h.f.handlers.onError?.({ code: "error.unknown" } as never);
    h.f.handlers.onExit?.({ code: 1, signal: null });
    expect(h.stored.get("warband.history")).toMatchObject([{ sessionId: "OPENAI-S" }]);
    await h.session.send("troisième OpenAI");
    expect(h.f.started).toMatchObject({ resume: "OPENAI-S" });
    expect(h.f.started).not.toHaveProperty("conversationContext");
  });

  it("confirme le transfert seulement après un run réussi puis reprend sans retransmettre le contexte", async () => {
    const h = withHistory();
    await h.session.send("contexte Claude");
    h.f.handlers.onEnded?.({ status: "success", sessionId: "CLAUDE-S" } as never);
    await h.session.setProvider("openai");
    await h.session.send("premier OpenAI");
    h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "OPENAI-S" }));
    h.f.handlers.onEnded?.({ status: "success", sessionId: "OPENAI-S" } as never);
    h.f.handlers.onExit?.({ code: 0, signal: null });
    await h.session.send("suite OpenAI");
    expect(h.f.started).toMatchObject({ resume: "OPENAI-S" });
    expect(h.f.started).not.toHaveProperty("conversationContext");
  });

  it("reprend après un changement sans run sans réutiliser la session SDK de l’ancien fournisseur", async () => {
    const h = withHistory();
    await h.session.send("contexte conservé");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "CLAUDE-S" }));
    h.f.handlers.onEnded?.({ sessionId: "CLAUDE-S" } as never);
    h.written.set(
      RUN1,
      [
        jline({ kind: "user.message", text: "contexte conservé" }, 0),
        jline({ kind: "session.started", sessionId: "CLAUDE-S", model: "m", auth: "auto" }, 1),
      ].join("\n"),
    );
    const id = h.view().history[0]?.id;
    await h.session.setProvider("openai");
    await h.session.openConversation(id);
    await h.session.resumeConversation();
    await h.session.send("suite OpenAI");
    expect(h.f.started).toMatchObject({
      provider: "openai",
      conversationContext: { messages: [{ role: "user", text: "contexte conservé" }] },
    });
    expect(h.f.started).not.toHaveProperty("resume");
  });

  it("reset isole le contexte de la conversation suivante", async () => {
    const h = withHistory();
    await h.session.send("ancienne conversation");
    h.f.handlers.onEnded?.({} as never);
    await h.session.setProvider("openai");
    h.session.reset();
    await h.session.send("nouvelle conversation");
    expect(h.f.started).not.toHaveProperty("conversationContext");
    expect(
      h.view().items.some((item) => item.kind === "user" && item.text === "ancienne conversation"),
    ).toBe(false);
    h.f.handlers.onEnded?.({} as never);
    await h.session.setProvider("claude");
    await h.session.send("suite de la nouvelle conversation");
    expect(h.f.started?.conversationContext?.messages).toEqual([
      { role: "user", text: "nouvelle conversation" },
    ]);
  });

  it("parcourt les archives pendant un tour sans arrêter le moteur ni perdre les approbations", async () => {
    const h = withHistory();
    await h.session.send("début");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    const raw = [jline({ kind: "user.message", text: "début" }, 0)];
    for (let i = 1; i <= 700; i++) raw.push(jline({ kind: "agent.text", text: `message ${i}` }, i));
    h.written.set(RUN1, raw.join("\n"));
    for (const line of raw) h.f.handlers.onEvent?.(JSON.parse(line));
    expect(h.view().items).toHaveLength(60);
    expect(h.view().paging).toMatchObject({ earlier: true, archived: false });
    const calls = h.f.calls.length;
    await Promise.all([h.session.timelinePage("older"), h.session.timelinePage("older")]);
    expect(h.view().paging).toMatchObject({ earlier: true, archived: true, loading: false });
    expect(h.view().items[0]).toMatchObject({ text: "message 581" });
    const previous = h.view().items;
    h.f.handlers.onApproval?.(approval("toujours-active"));
    h.f.handlers.onEvent?.(JSON.parse(jline({ kind: "agent.text", text: "en direct" }, 701)));
    expect(h.view().busy).toBe(true);
    expect(h.view().approvals).toHaveLength(1);
    expect(h.view().items).toEqual(previous);
    expect(h.f.calls).toHaveLength(calls);
    for (let page = 0; page < 20 && h.view().paging?.earlier; page++)
      await h.session.timelinePage("older");
    expect(h.view().items[0]).toMatchObject({ kind: "user", text: "début" });
    expect(h.view().paging?.earlier).toBe(false);
    await h.session.timelinePage("newer");
    expect(h.view().items[0]).toMatchObject({ text: "message 41" });
    await h.session.timelinePage("latest");
    expect(h.view().paging?.archived).toBe(false);
    expect(h.view().items.at(-1)).toMatchObject({ text: "en direct" });
    h.f.handlers.onEnded?.({ sessionId: "S" } as never);
    const id = h.view().history[0]?.id;
    h.session.reset();
    await h.session.openConversation(id);
    expect(h.view().readonly).not.toBeNull();
    await h.session.timelinePage("older");
    await h.session.timelinePage("older");
    for (let page = 0; page < 20 && h.view().paging?.earlier; page++)
      await h.session.timelinePage("older");
    expect(h.view().items[0]).toMatchObject({ text: "début" });
    expect(h.view().approvals).toEqual([]);
    h.session.reset();
    await h.session.timelinePage("older");
    expect(h.view().items).toEqual([]);
    expect(h.view().paging).toMatchObject({ archived: false, loading: false });
  });

  it("transfère objectif et décision sourcée du journal lors du changement de fournisseur", async () => {
    const h = withHistory();
    await h.session.send("objectif initial");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    const lines = [jline({ kind: "user.message", text: "objectif initial" }, 0)];
    lines.push(
      jline(
        {
          kind: "mission.decision",
          decision: {
            objective: "choisir",
            evidenceIds: ["preuve-1"],
            nextAction: "vérifier",
            successCriterion: "preuve obtenue",
          },
        },
        1,
      ),
    );
    for (let i = 2; i <= 140; i++)
      lines.push(jline({ kind: "tool.requested", toolUseId: `t${i}`, tool: "Read", input: {} }, i));
    lines.push(jline({ kind: "agent.text", text: "réponse récente" }, 141));
    h.written.set(RUN1, lines.join("\n"));
    for (const line of lines) h.f.handlers.onEvent?.(JSON.parse(line));
    h.f.handlers.onEnded?.({ status: "success", turns: 1, costUsd: 0, result: null });
    await h.session.setProvider("openai");
    await h.session.send("suite");
    expect(h.f.started?.conversationContext?.messages[0]).toEqual({
      role: "user",
      text: "objectif initial",
    });
    expect(h.f.started?.conversationContext?.decisions).toMatchObject([
      { runId: RUN1, eventId: "e1", decision: { evidenceIds: ["preuve-1"] } },
    ]);
    h.session.dispose();
  });

  it("navigue par échange dans les deux sens à travers plusieurs pages d’outils", async () => {
    const h = withHistory();
    await h.session.send("début");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    h.f.handlers.onEnded?.({ sessionId: "S" } as never);
    const conversation = h.view().history[0]?.id;
    const lines = [jline({ kind: "user.message", text: "début" }, 0)];
    let seq = 1;
    const tools = () => {
      for (let i = 0; i < 140; i++, seq++)
        lines.push(
          jline({ kind: "tool.requested", toolUseId: `t${seq}`, tool: "Read", input: {} }, seq),
        );
    };
    tools();
    lines.push(jline({ kind: "agent.text", text: "réponse A" }, seq++));
    tools();
    lines.push(jline({ kind: "user.message", text: "question B" }, seq++));
    lines.push(jline({ kind: "agent.text", text: "réponse C" }, seq++));
    h.written.set(RUN1, lines.join("\n"));
    await h.session.openConversation(conversation);
    let item = h.view().items.at(-1);
    expect(item).toMatchObject({ kind: "agent", text: "réponse C" });
    for (const [direction, text] of [
      ["older", "question B"],
      ["older", "réponse A"],
      ["older", "début"],
      ["newer", "réponse A"],
      ["newer", "question B"],
      ["newer", "réponse C"],
    ] as const) {
      if (!item) throw new Error("Échange introuvable");
      await h.session.timelineExchange(direction, item.id, item.source);
      const view = h.view();
      expect(view.items.length).toBeLessThanOrEqual(60);
      item = view.items.find((entry) => entry.source === view.exchangeTarget?.source);
      expect(item).toMatchObject({ text });
    }
    await h.session.timelinePage("latest");
    expect(h.view().paging?.archived).toBe(false);
    h.session.dispose();
  });

  it("une lecture tardive ne remplit jamais une nouvelle conversation", async () => {
    const h = withHistory();
    await h.session.send("ancienne");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    const raw = [jline({ kind: "user.message", text: "ancienne" }, 0)];
    for (let i = 1; i <= 301; i++) raw.push(jline({ kind: "agent.text", text: `ancien ${i}` }, i));
    h.written.set(RUN1, raw.join("\n"));
    for (const line of raw) h.f.handlers.onEvent?.(JSON.parse(line));
    let release!: () => void;
    h.holdReads(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = h.session.timelinePage("older");
    expect(h.view().paging?.loading).toBe(true);
    const oldKey = h.view().conversation;
    h.session.reset();
    await h.session.send("nouvelle");
    expect(h.view().conversation).not.toBe(oldKey);
    release();
    await pending;
    expect(h.view().items).toMatchObject([{ kind: "user", text: "nouvelle" }]);
    expect(h.view().paging).toMatchObject({ archived: false, loading: false });
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

  it("écrit l'index sous la clé du chat", async () => {
    const h = withHistory("warband.history.c2");
    await h.session.send("une consigne pour ce chat");
    h.f.handlers.onStarted?.({ runId: RUN1, policySource: null });
    expect([...h.stored.keys()]).toEqual(["warband.history.c2"]);
  });
});

describe("session de chat : lien du Bypass (ADR 0006)", () => {
  it("après start, le lien reçoit le moteur ; l'accusé lui est routé ; la sortie le libère", async () => {
    const f = fake();
    const links: { acked: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }[] = [];
    let send: ((state: null) => number) | undefined;
    const attach = vi.fn((s: (state: null) => number) => {
      send = s;
      const link = { acked: vi.fn(), release: vi.fn() };
      links.push(link);
      return link;
    });
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: [],
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: () => {},
      createController: f.create,
      sdkVersion: "1.0.0",
      bypass: { attach },
    });
    await session.send("hi");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(send?.(null)).toBe(1);
    expect(f.calls).toContainEqual(["bypass", null]);
    f.handlers.onBypassAck?.({ seq: 1, state: null });
    expect(links[0]?.acked).toHaveBeenCalledWith(1, null);
    f.handlers.onExit?.({ code: 0, signal: null });
    expect(links[0]?.release).toHaveBeenCalledTimes(1);
  });
});

describe("session de chat : arrêt du moteur et Bypass (lot 2c)", () => {
  const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("ouverture d'une conversation : Bypass hôte remis à « off », lien libéré, moteur arrêté", async () => {
    const f = fake();
    const stored = new Map<string, unknown>();
    const reset = vi.fn();
    const release = vi.fn();
    const attach = vi.fn(() => ({ acked: vi.fn(), release }));
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: [],
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: () => {},
      createController: f.create,
      bypass: { attach, reset },
      history: {
        index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
        files: {
          dir: "/h",
          read: async () => null,
          size: async () => 0,
          remove: async () => {},
          removeAll: async () => {},
        },
        confirmDelete: async () => true,
      },
    });
    await session.send("une");
    f.handlers.onStarted?.({ runId: RUN, policySource: null });
    f.handlers.onEnded?.({ sessionId: "S1" } as never);
    const id = session.view().history[0]?.id as string;
    f.calls.length = 0;
    await session.openConversation(id);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    // Le moteur reçoit l'état nul (kill) : l'ancien moteur ne garde aucune activation.
    expect(f.calls).toContainEqual(["kill"]);
    expect(reset.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      release.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("reset : le lien du moteur est libéré avant l'arrêt", async () => {
    const f = fake();
    const release = vi.fn();
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e.mjs",
      engineArgs: [],
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: () => {},
      createController: f.create,
      bypass: { attach: () => ({ acked: vi.fn(), release }) },
    });
    await session.send("hi");
    session.reset();
    expect(release).toHaveBeenCalledTimes(1);
    expect(f.calls).toContainEqual(["kill"]);
  });
});

describe("deux chats (ADR 0008)", () => {
  it("les cartes restent dans leur session ; fermer l'un laisse le Bypass de l'autre", async () => {
    const host = createBypassHost({
      clock: {
        now: () => 1_000_000,
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      onChange: () => {},
    });
    const make = (key: string) => {
      const f = fake();
      const stored = new Map<string, unknown>();
      const session = createChatSession({
        cwd: "/w",
        enginePath: "/e.mjs",
        engineArgs: [],
        readSettings: () => ({}),
        getToken: async () => undefined,
        confirmAlways: async () => false,
        onView: () => {},
        createController: f.create,
        bypass: host,
        history: {
          key,
          index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
          files: {
            dir: `/h/${key}`,
            read: async () => null,
            size: async () => 0,
            remove: async () => {},
            removeAll: async () => {},
          },
          confirmDelete: async () => true,
        },
      });
      return { f, session };
    };
    const a = make("warband.history.a");
    const b = make("warband.history.b");
    host.request(true, true);
    await a.session.send("chat a");
    const stateA = a.f.calls.find((c) => c[0] === "bypass")?.[1] as BypassState;
    a.f.handlers.onBypassAck?.({ seq: 1, state: stateA });
    await b.session.send("chat b");
    const stateB = b.f.calls.find((c) => c[0] === "bypass")?.[1] as BypassState;
    b.f.handlers.onBypassAck?.({ seq: 1, state: stateB });
    expect(host.snapshot().on).toBe(true);
    a.f.handlers.onApproval?.(approval("only-a"));
    expect(a.session.view().approvals.map((c) => c.toolUseId)).toEqual(["only-a"]);
    expect(b.session.view().approvals).toEqual([]);
    a.session.dispose();
    expect(a.f.calls).toContainEqual(["kill"]);
    expect(b.f.calls).not.toContainEqual(["kill"]);
    expect(host.snapshot().on).toBe(true);
    host.reset();
    expect(host.snapshot().on).toBe(false);
    expect(b.f.calls.filter((c) => c[0] === "bypass").at(-1)?.[1]).toBeNull();
    host.dispose();
  });
});

describe("isolation des chats", () => {
  it("les préférences et le mode apprentissage ne contaminent ni les autres chats ni la migration", async () => {
    const data = new Map<string, unknown>([["warband.prefs", { provider: "claude" }]]);
    const store = {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => void data.set(key, value),
    };
    const a = setup({ store, prefsKey: "prefs.a", learningKey: "learning.a" });
    const b = setup({ store, prefsKey: "prefs.b", learningKey: "learning.b" });
    await a.session.setProvider("openai");
    a.session.setLearning(true);
    expect(b.session.getProvider()).toBe("claude");
    expect(b.session.view().controls?.learning).toBe(false);
    const c = setup({ store, prefsKey: "prefs.c", learningKey: "learning.c" });
    expect(c.session.getProvider()).toBe("claude");
    expect(data.get("warband.prefs")).toEqual({ provider: "claude" });
    expect(setup({ store, prefsKey: "prefs.a" }).session.getProvider()).toBe("openai");
    a.session.dispose();
    b.session.dispose();
    c.session.dispose();
  });

  it("les choix de modèle, effort et ressources restent locaux", async () => {
    const data = new Map<string, unknown>();
    const store = {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => void data.set(key, value),
    };
    const settings = {
      capabilities: {
        providers: ["claude"],
        skills: ["mentor"],
        integrations: ["playwright"],
        webSearch: true,
      },
      integrations: [{ id: "playwright", port: 9877, transport: "http", path: "/mcp" }],
    };
    const a = setup({ store, prefsKey: "prefs.a", settings });
    const b = setup({ store, prefsKey: "prefs.b", settings });
    a.f.setModels([{ value: "a", displayName: "A", supportedEffortLevels: ["low", "high"] }]);
    await a.session.loadModels();
    a.session.setModel("a");
    a.session.setEffort("high");
    a.session.setSelection({
      profile: "mentor",
      integrations: ["playwright"],
      burp: false,
      webSearch: true,
    });
    expect(b.session.view().controls).toMatchObject({ model: null, effort: null });
    expect(b.session.view().capabilities?.selection).toEqual({
      profile: null,
      integrations: [],
      burp: false,
      webSearch: false,
    });
    const c = setup({ store, prefsKey: "prefs.c", settings });
    expect(c.session.view().controls).toMatchObject({ model: null, effort: null });
    await b.session.send("b");
    expect(b.f.started).toMatchObject({ integrations: [], webSearch: false });
    expect(b.f.started).toHaveProperty("profile", "out-of-box");
    a.session.dispose();
    b.session.dispose();
    c.session.dispose();
  });

  it("la variante d’un chat ne devient pas le choix d’un autre", async () => {
    const data = new Map<string, unknown>([["warband.prefs", { provider: "opencode" }]]);
    const store = {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => void data.set(key, value),
    };
    const models = [{ value: "a", displayName: "A", reasoningVariants: ["deep", "fast"] }];
    const a = setup({ store, prefsKey: "prefs.a" });
    const b = setup({ store, prefsKey: "prefs.b" });
    a.f.setModels(models);
    await a.session.loadModels();
    a.session.setModel("a");
    a.session.setVariant("deep");
    expect(a.session.view().controls?.variant).toBe("deep");
    expect(b.session.view().controls?.variant).toBeNull();
    const c = setup({ store, prefsKey: "prefs.c" });
    expect(c.session.view().controls?.variant).toBeNull();
    a.session.dispose();
    b.session.dispose();
    c.session.dispose();
  });

  it("activation, accusé et reset d’un hôte ne touchent pas l’autre moteur", async () => {
    const make = () => {
      const f = fake();
      const host = createBypassHost({
        clock: {
          now: () => 1000,
          schedule: (fn, ms) => setTimeout(fn, ms),
          cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        },
        onChange: () => {},
      });
      const session = createChatSession({
        cwd: "/w",
        enginePath: "/e",
        engineArgs: [],
        readSettings: () => ({}),
        getToken: async () => undefined,
        confirmAlways: async () => false,
        onView: () => {},
        createController: f.create,
        bypass: host,
      });
      return { f, host, session };
    };
    const a = make();
    const b = make();
    await a.session.send("a");
    await b.session.send("b");
    a.host.request(true, true);
    const state = a.f.calls.filter((c) => c[0] === "bypass").at(-1)?.[1] as BypassState;
    a.f.handlers.onBypassAck?.({ seq: 2, state });
    expect(a.host.snapshot().on).toBe(true);
    expect(b.host.snapshot()).toMatchObject({ on: false, armed: false });
    expect(b.f.calls.filter((c) => c[0] === "bypass").map((c) => c[1])).toEqual([null]);
    b.session.reset();
    expect(a.host.snapshot().on).toBe(true);
    a.session.reset();
    expect(a.host.snapshot().on).toBe(false);
    a.session.dispose();
    b.session.dispose();
    a.host.dispose();
    b.host.dispose();
  });
});

describe("mode apprentissage (ADR 0010)", () => {
  const memory = () => {
    const data = new Map<string, unknown>();
    return {
      data,
      store: {
        get: (k: string) => data.get(k),
        set: (k: string, v: unknown) => void data.set(k, v),
      },
    };
  };

  it("désactivé par défaut : start sans mode", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    expect(t.session.view().controls?.learning).toBe(false);
    await t.session.send("un");
    expect(t.f.started).not.toHaveProperty("mode");
  });

  it("activé : start porte mode learning et jamais systemPrompt", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    t.session.setLearning(true);
    expect(t.view().controls?.learning).toBe(true);
    await t.session.send("un");
    expect(t.f.started).toMatchObject({ mode: "learning" });
    expect(t.f.started).not.toHaveProperty("systemPrompt");
  });

  it("persisté par chat, relu en booléen strict, sans toucher warband.prefs", async () => {
    const m = memory();
    const a = setup({ store: m.store, learningKey: "warband.learning.a" });
    a.session.setLearning(true);
    expect(m.data.get("warband.learning.a")).toBe(true);
    expect(m.data.has("warband.prefs")).toBe(false);
    // Rechargement du même chat.
    const again = setup({ store: m.store, learningKey: "warband.learning.a" });
    again.session.view();
    await again.session.send("x");
    expect(again.f.started).toMatchObject({ mode: "learning" });
    // Autre chat : non concerné.
    const b = setup({ store: m.store, learningKey: "warband.learning.b" });
    await b.session.send("x");
    expect(b.f.started).not.toHaveProperty("mode");
  });

  it("valeur stockée non booléenne : mode inactif", async () => {
    for (const bad of ["true", 1, {}, null]) {
      const m = memory();
      m.data.set("warband.learning.a", bad);
      const t = setup({ store: m.store, learningKey: "warband.learning.a" });
      await t.session.send("x");
      expect(t.f.started).not.toHaveProperty("mode");
    }
  });

  it("refuse un non-booléen venu de la webview", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    t.session.setLearning("true");
    t.session.setLearning(1);
    t.session.setLearning({ enabled: true });
    await t.session.send("x");
    expect(t.f.started).not.toHaveProperty("mode");
  });

  it("gelé pendant un tour", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    await t.session.send("x");
    t.session.setLearning(true);
    expect(t.view().controls?.learning).toBe(false);
  });

  it("bascule sur une conversation commencée : moteur remplacé, même session reprise", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    await t.session.send("un");
    t.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1" }));
    t.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    t.session.setLearning(true);
    await t.session.send("deux");
    expect(t.f.starts).toHaveLength(2);
    expect(t.f.starts[1]).toMatchObject({ mode: "learning", resume: "S1" });
    expect(t.f.starts[1]).not.toHaveProperty("systemPrompt");
    expect(t.f.calls.filter((c) => c[0] === "kill")).toHaveLength(1);
    expect(
      t.view().items.some((i) => i.kind === "notice" && i.text.startsWith("Réglages modifiés")),
    ).toBe(true);
  });

  it("sans bascule : le moteur est réutilisé", async () => {
    const t = setup({ learningKey: "warband.learning.a" });
    t.session.setLearning(true);
    await t.session.send("un");
    t.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    await t.session.send("deux");
    expect(t.f.starts).toHaveLength(1);
  });
});

it("nouvelle conversation : les événements tardifs de l’ancien moteur ne restaurent pas sa session", async () => {
  const first = fake();
  const second = fake();
  const queue = [first, second];
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e",
    engineArgs: [],
    readSettings: () => ({}),
    getToken: async () => undefined,
    confirmAlways: async () => false,
    onView: () => {},
    createController: (options) => {
      const engine = queue.shift();
      if (!engine) throw new Error("moteur inattendu");
      return engine.create(options);
    },
  });
  await session.send("ancienne conversation");
  session.reset();
  first.handlers.onEvent?.(
    ev({ kind: "session.started", sessionId: "ancienne-session", model: "modele" }),
  );
  first.handlers.onEnded?.({
    status: "success",
    turns: 1,
    costUsd: 0,
    result: null,
    sessionId: "ancienne-session",
  });
  await session.send("nouvelle conversation");
  expect(second.started).not.toHaveProperty("resume");
  expect(second.calls).toContainEqual(["prompt", "nouvelle conversation"]);
  session.dispose();
});

it("nouvelle conversation pendant la lecture du jeton : l’ancienne consigne n’est jamais envoyée", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let tokenRequested = false;
  const engine = fake();
  const create = vi.fn(engine.create);
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e",
    engineArgs: [],
    readSettings: () => ({}),
    getToken: async () => {
      tokenRequested = true;
      await waiting;
      return undefined;
    },
    confirmAlways: async () => false,
    onView: () => {},
    createController: create,
  });
  const sending = session.send("à abandonner");
  await vi.waitFor(() => expect(tokenRequested).toBe(true));
  session.reset();
  release();
  await sending;
  expect(create).not.toHaveBeenCalled();
  expect(engine.calls).not.toContainEqual(["prompt", "à abandonner"]);
});

describe("sélection du fournisseur", () => {
  it("ne démarre pas en auth auto si les identifiants disparaissent après le sondage", async () => {
    const f = fake();
    let connected = true;
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e",
      engineArgs: [],
      readSettings: () => ({}),
      requireProvider: true,
      getToken: async () =>
        connected
          ? {
              mode: "api-key" as const,
              auth: { name: "OPENAI_API_KEY" as const, value: "secret-test" },
            }
          : undefined,
      store: {
        get: (key) => (key === "warband.prefs" ? { provider: "openai" } : undefined),
        set: () => {},
      },
      confirmAlways: async () => false,
      onView: () => {},
      createController: f.create,
    });
    await session.authChanged();
    connected = false;
    await session.send("à ne pas envoyer avec le cache OAuth");
    expect(f.starts).toEqual([]);
    expect(f.calls.some((call) => call[0] === "prompt")).toBe(false);
    expect(session.view().noProvider).toBe(true);
    expect(session.view().busy).toBe(false);
  });
  it("refuse un changement pendant un tour et isole les événements tardifs après changement", async () => {
    const t = setup({ settings: { model: "ancien-claude" } });
    await t.session.send("premier");
    const old = t.f.handlers;
    old.onEvent?.(ev({ kind: "session.started", sessionId: "CLAUDE-S" }));
    await t.session.setProvider("openai");
    expect(t.session.getProvider()).toBe("claude");
    old.onEnded?.({ sessionId: "CLAUDE-S" } as never);
    await t.session.setProvider("openai");
    old.onEvent?.(ev({ kind: "session.started", sessionId: "LATE" }));
    t.session.setEffort("high");
    await t.session.send("nouveau");
    expect(t.f.started).toMatchObject({ provider: "openai" });
    expect(t.f.started).not.toHaveProperty("resume");
    expect(t.f.started).not.toHaveProperty("model");
    expect(t.f.started).not.toHaveProperty("effort");
  });

  it("sépare les caches et refuse les fournisseurs inconnus", async () => {
    const values = new Map<string, unknown>([
      ["warband.prefs", { provider: "openai" }],
      [
        "warband.models",
        { sdk: "1.0.0", models: [{ value: "claude-cache", displayName: "Claude" }] },
      ],
    ]);
    const t = setup({
      store: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
    });
    expect(t.session.view().controls?.models).toBeNull();
    await t.session.setProvider("inconnu");
    expect(t.session.getProvider()).toBe("openai");
    t.f.setModels([{ value: "openai-cache", displayName: "OpenAI" }]);
    await t.session.loadModels();
    expect(values.get("warband.models.openai")).toMatchObject({
      models: [{ value: "openai-cache" }],
    });
    expect(values.get("warband.models")).toMatchObject({ models: [{ value: "claude-cache" }] });
  });

  it("ignore un sondage ancien et transmet fournisseur et auth sans secret", async () => {
    const f = fake();
    let resolve!: (models: ModelOption[]) => void;
    const pending = new Promise<ModelOption[]>((done) => {
      resolve = done;
    });
    const probes: unknown[] = [];
    const getToken = vi.fn(async () => ({ mode: "subscription" as const }));
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e",
      engineArgs: [],
      readSettings: () => ({}),
      getToken,
      confirmAlways: async () => false,
      onView: () => {},
      createController: (options) => {
        const ctl = f.create(options);
        return {
          ...ctl,
          models: async (params) => {
            probes.push(params);
            return params.provider === "claude"
              ? pending
              : [{ value: "nouveau", displayName: "Nouveau" }];
          },
        };
      },
    });
    const first = session.loadModels();
    await vi.waitFor(() => expect(probes).toHaveLength(1));
    await session.setProvider("openai");
    expect(f.calls).toContainEqual(["kill"]);
    resolve([{ value: "ancien", displayName: "Ancien" }]);
    await first;
    expect(session.view().controls?.models).toMatchObject([{ value: "nouveau" }]);
    expect(probes).toContainEqual({
      cwd: "/w",
      auth: "subscription",
      provider: "openai",
      timeoutMs: MODEL_LOAD_TIMEOUT_MS,
    });
    expect(getToken).toHaveBeenCalledWith("openai");
    expect(f.options).not.toHaveProperty("auth");
    await session.authChanged();
    expect(probes).toHaveLength(3);
  });
});

describe("cycle de chargement des modèles", () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }
  function lifecycle(
    getToken = async () => undefined as import("../src/logic/session.js").TokenChoice | undefined,
    requireProvider = false,
  ) {
    const probes: {
      result: ReturnType<typeof deferred<ModelOption[]>>;
      kill: ReturnType<typeof vi.fn>;
      handlers: EngineHandlers;
    }[] = [];
    const logs = vi.fn();
    const values = new Map<string, unknown>();
    const create = vi.fn((options: EngineControllerOptions) => {
      const result = deferred<ModelOption[]>();
      const kill = vi.fn();
      probes.push({ result, kill, handlers: options.handlers ?? {} });
      return { ...fake().create(options), models: () => result.promise, kill };
    });
    const onView = vi.fn();
    const session = createChatSession({
      cwd: "/w",
      enginePath: "/e",
      engineArgs: [],
      readSettings: () => ({}),
      getToken,
      requireProvider,
      confirmAlways: async () => false,
      onView,
      onLog: logs,
      createController: create,
      store: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
    });
    return { session, probes, create, values, onView, logs };
  }

  it("affiche et journalise le diagnostic d'un sondage sans exposer sa sortie brute", async () => {
    const t = lifecycle();
    const loading = t.session.loadModels();
    await flush();
    t.probes[0]?.result.reject(
      new ModelProbeError({
        code: "opencode.serverFailed",
        params: { detail: "code 7 oc_sk_test-secret" },
      }),
    );
    await loading;
    expect(t.session.view().controls?.modelsMessage).toContain("code de sortie 7");
    expect(t.logs).toHaveBeenCalledWith(expect.stringContaining("opencode.serverFailed"));
    expect(JSON.stringify([t.session.view(), t.logs.mock.calls])).not.toContain(
      "oc_sk_test-secret",
    );
  });

  it("borne la lecture du jeton sans créer de moteur après son expiration", async () => {
    vi.useFakeTimers();
    try {
      const token = deferred<undefined>();
      const t = lifecycle(() => token.promise);
      const loading = t.session.loadModels();
      await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS);
      await loading;
      expect(t.session.view().controls).toMatchObject({
        modelsStatus: "unavailable",
        modelsMessage: expect.stringContaining("45 secondes"),
      });
      token.resolve(undefined);
      await flush();
      expect(t.create).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("borne aussi la reconnexion native et ignore sa réponse après dispose", async () => {
    vi.useFakeTimers();
    try {
      const token = deferred<undefined>();
      const t = lifecycle(() => token.promise, true);
      const loading = t.session.authChanged();
      expect(t.session.view().controls?.modelsStatus).toBe("loading");
      await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS);
      await loading;
      expect(t.session.view().controls?.modelsMessage).toContain("45 secondes");
      t.session.dispose();
      const count = t.onView.mock.calls.length;
      token.resolve(undefined);
      await flush();
      expect(t.create).not.toHaveBeenCalled();
      expect(t.onView).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("termine un moteur sans réponse puis permet de réessayer", async () => {
    vi.useFakeTimers();
    try {
      const t = lifecycle();
      const loading = t.session.loadModels();
      await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS);
      await loading;
      expect(t.probes[0]?.kill).toHaveBeenCalledOnce();
      const retry = t.session.loadModels(true);
      await flush();
      t.probes[1]?.result.resolve([{ value: "nouveau", displayName: "Nouveau" }]);
      await retry;
      t.probes[0]?.result.resolve([{ value: "ancien", displayName: "Ancien" }]);
      await flush();
      expect(t.session.view().controls).toMatchObject({
        modelsStatus: "ready",
        models: [{ value: "nouveau" }],
      });
      expect(t.session.view().controls?.modelsMessage).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un retry forcé remplace immédiatement le sondage et ignore ses résultats et logs tardifs", async () => {
    const t = lifecycle();
    const old = t.session.loadModels();
    await flush();
    const retry = t.session.loadModels(true);
    await old;
    expect(t.probes[0]?.kill).toHaveBeenCalledOnce();
    t.probes[1]?.result.resolve([{ value: "nouveau", displayName: "Nouveau" }]);
    await retry;
    t.probes[0]?.handlers.onLog?.("ancien log");
    t.probes[0]?.result.resolve([{ value: "ancien", displayName: "Ancien" }]);
    await flush();
    expect(t.logs).not.toHaveBeenCalled();
    expect(t.session.view().controls?.models).toMatchObject([{ value: "nouveau" }]);
    expect(t.values.get("warband.models")).toMatchObject({ models: [{ value: "nouveau" }] });
  });

  it("un changement d’authentification tue le sondage actif avant de relancer la découverte", async () => {
    const t = lifecycle();
    const old = t.session.loadModels();
    await flush();
    const loading = t.session.authChanged();
    await old;
    await flush();
    expect(t.probes[0]?.kill).toHaveBeenCalledOnce();
    t.probes[1]?.result.resolve([{ value: "reconnecte", displayName: "Reconnecté" }]);
    await loading;
    t.probes[0]?.result.resolve([{ value: "ancien", displayName: "Ancien" }]);
    await flush();
    expect(t.session.view().controls?.models).toMatchObject([{ value: "reconnecte" }]);
  });

  it("une connexion absente fournit une explication sans démarrer de moteur", async () => {
    const t = lifecycle(async () => undefined, true);
    await t.session.loadModels();
    expect(t.session.view().controls).toMatchObject({
      modelsStatus: "unavailable",
      modelsMessage: expect.stringContaining("Connexion au fournisseur indisponible"),
    });
    expect(t.session.view().noProvider).toBe(true);
    expect(t.create).not.toHaveBeenCalled();
  });

  it("dispose annule le chargement et nettoie le moteur et le délai", async () => {
    vi.useFakeTimers();
    try {
      const t = lifecycle();
      const loading = t.session.loadModels();
      await flush();
      t.session.dispose();
      const count = t.onView.mock.calls.length;
      await loading;
      expect(t.probes[0]?.kill).toHaveBeenCalledOnce();
      t.probes[0]?.result.resolve([{ value: "tardif", displayName: "Tardif" }]);
      await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS);
      await t.session.loadModels(true);
      expect(t.onView).toHaveBeenCalledTimes(count);
      expect(t.create).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("explique une liste vide et un échec sans exposer le message brut ni multiplier les avis", async () => {
    const t = setup();
    await t.session.loadModels();
    expect(t.session.view().controls?.modelsMessage).toContain("aucun modèle utilisable");
    const fail = lifecycle(async () => {
      throw new Error("secret-test https://login.example/token?secret=secret-test");
    });
    await fail.session.loadModels();
    await fail.session.loadModels(true);
    expect(fail.session.view().controls?.modelsMessage).toContain("Impossible de charger");
    expect(fail.session.view().items.filter((item) => item.kind === "notice")).toHaveLength(1);
    expect(JSON.stringify(fail.session.view())).not.toMatch(/secret-test|login.example/);
  });
});

it("transmet les observations du moteur actif et efface au reset, sans événements détachés", async () => {
  const observe = vi.fn();
  const t = setup({ observe });
  await t.session.send("test");
  const handlers = t.f.handlers;
  const started = ev({ kind: "run.started", runId: "courant", prompt: "masqué", cwd: "/w" });
  handlers.onEvent?.(started);
  expect(observe).toHaveBeenLastCalledWith(started);
  t.session.reset();
  expect(observe).toHaveBeenLastCalledWith(null);
  const count = observe.mock.calls.length;
  handlers.onEvent?.(ev({ kind: "user.message", runId: "courant", text: "tardif" }));
  expect(observe).toHaveBeenCalledTimes(count);
  t.session.dispose();
});

it.each(["claude", "openai", "opencode"] as const)(
  "transmet les endpoints seulement au moteur %s",
  async (provider) => {
    const opencodeProviders = {
      "venator-local": {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://localhost:11434/v1" },
        models: { m: {} },
      },
    };
    const h = setup({ settings: { opencodeProviders } });
    await h.session.setProvider(provider);
    await h.session.send("suite");
    if (provider === "opencode") {
      expect(h.f.started?.opencodeProviders).toEqual(opencodeProviders);
      expect(h.f.calls).toContainEqual(["models", expect.objectContaining({ opencodeProviders })]);
    } else {
      expect(h.f.started).not.toHaveProperty("opencodeProviders");
      for (const call of h.f.calls.filter((item) => item[0] === "models"))
        expect(call[1]).not.toHaveProperty("opencodeProviders");
    }
  },
);

describe("ressources choisies dans chaque conversation", () => {
  const settings = {
    providerCatalog: [{ id: "google", name: "Google Gemini", connected: true }],
    capabilities: {
      providers: ["claude", "google"],
      skills: ["mentor"],
      integrations: ["playwright"],
      webSearch: true,
    },
    integrations: [{ id: "playwright", port: 9877, transport: "http", path: "/mcp" }],
    profile: "htb",
  };
  it("transmet au moteur le profil et le web de la conversation de rédaction", async () => {
    const base = {
      capabilities: { providers: ["claude"], skills: [], integrations: [], webSearch: false },
    };
    const t = setup({ settings: programDraftSettings(base) });
    t.session.setSelection({
      profile: "bug-bounty",
      integrations: [],
      burp: false,
      webSearch: true,
    });
    const prompt = programDraftPrompt("https://example.test/programme");
    expect(await t.session.send(prompt)).toBe(true);
    expect(t.f.started).toMatchObject({ profile: "bug-bounty", webSearch: true, integrations: [] });
    expect(t.f.calls).toContainEqual(["prompt", prompt]);
    expect(base.capabilities).toEqual({
      providers: ["claude"],
      skills: [],
      integrations: [],
      webSearch: false,
    });
    t.session.dispose();
  });
  it("ne transmet que les ressources sélectionnées, puis les oublie à la réinitialisation", async () => {
    const t = setup({ settings });
    t.session.setSelection({
      profile: "mentor",
      integrations: ["playwright"],
      burp: false,
      webSearch: true,
    });
    await t.session.send("Utilise les ressources choisies");
    expect(t.f.started).toMatchObject({
      profile: "mentor",
      integrations: settings.integrations,
      webSearch: true,
    });
    t.session.setSelection({ profile: null, integrations: [], burp: false, webSearch: false });
    expect(t.session.view().capabilities?.selection.profile).toBe("mentor");
    t.session.reset();
    await t.session.send("Nouvelle conversation");
    expect(t.f.started).toMatchObject({ integrations: [], webSearch: false });
    expect(t.f.started).toHaveProperty("profile", "out-of-box");
    t.session.dispose();
  });
  it("le mode Apprentissage exclut les ressources du chat même si elles sont choisies", async () => {
    const t = setup({ settings });
    t.session.setSelection({
      profile: "mentor",
      integrations: ["playwright"],
      burp: false,
      webSearch: true,
    });
    t.session.setLearning(true);
    await t.session.send("Explique mon cours");
    expect(t.f.started).toMatchObject({ mode: "learning", webSearch: false });
    expect(t.f.started).not.toHaveProperty("integrations");
    expect(t.f.started).not.toHaveProperty("profile");
    t.session.dispose();
  });
  it("filtre le catalogue sur Gemini et refuse une route non activée", async () => {
    const t = setup({ settings });
    t.f.setModels([
      { value: "google/real-model", displayName: "Gemini" },
      { value: "other/unrelated", displayName: "Other" },
    ]);
    await t.session.selectProvider("google");
    expect(t.session.view().controls?.models?.map((m) => m.value)).toEqual(["google/real-model"]);
    await t.session.selectProvider("unknown");
    expect(t.session.view().capabilities?.provider).toBe("google");
    t.session.setModel("other/unrelated");
    await t.session.send("Même conversation, fournisseur choisi");
    expect(t.f.started).toMatchObject({ provider: "opencode", model: "google/real-model" });
    t.session.dispose();
  });
});

it("un catalogue OpenAI filtré ne remplace pas le catalogue global d’OpenCode", async () => {
  const providers = vi.fn();
  const t = setup({ providers });
  t.f.setModels([{ value: "openai/m", displayName: "Model" }]);
  await t.session.setProvider("openai");
  t.f.handlers.onProviders?.([{ id: "openai", name: "OpenAI", connected: true }]);
  expect(providers).not.toHaveBeenCalled();
  await t.session.setProvider("opencode");
  t.f.handlers.onProviders?.([{ id: "opencode", name: "OpenCode", connected: true }]);
  expect(providers).toHaveBeenCalledWith([{ id: "opencode", name: "OpenCode", connected: true }]);
  t.session.dispose();
});

it("refuse les images pour un modèle explicitement incompatible avant la bulle et accepte une capacité inconnue", async () => {
  const image = { name: "a.png", mimeType: "image/png" as const, data: "iVBORw0KGgo=" };
  const t = setup();
  t.f.setModels([{ value: "a", displayName: "A", supportsImages: false }]);
  await t.session.loadModels();
  expect(await t.session.send("observer", "observer", false, [image])).toBe(false);
  expect(t.view().items.some((item) => JSON.stringify(item).includes("observer"))).toBe(false);
  t.f.setModels([{ value: "a", displayName: "A" }]);
  await t.session.loadModels(true);
  expect(await t.session.send("observer", "observer", false, [image])).toBe(true);
  expect(
    t.f.calls.some((call) => call[0] === "prompt" && JSON.stringify(call).includes(image.data)),
  ).toBe(true);
  t.session.dispose();
});

describe("niveau d'encadrement (webview → session)", () => {
  /** Contrôles calculés une fois la liste des modèles chargée. */
  const ready = async (t: ReturnType<typeof setup>) => {
    t.f.setModels([{ value: "a", displayName: "A" }]);
    await t.session.loadModels();
    return t;
  };
  it("par défaut standard ; le choix est transmis au démarrage et affiché", async () => {
    const t = await ready(setup({}));
    expect(t.view().controls?.supervision).toBe("standard");
    t.session.setSupervision("strict");
    expect(t.view().controls?.supervision).toBe("strict");
    await t.session.send("x");
    expect(t.f.started).toMatchObject({ supervision: "strict" });
  });

  it("valeur invalide : retour à standard", async () => {
    const t = await ready(setup({}));
    t.session.setSupervision("light");
    for (const bad of ["max", "", 3, null, undefined, { level: "strict" }]) {
      t.session.setSupervision("strict");
      t.session.setSupervision(bad);
      expect(t.view().controls?.supervision, String(bad)).toBe("standard");
    }
  });

  it("gelé pendant un tour", async () => {
    const t = await ready(setup({}));
    await t.session.send("x");
    t.session.setSupervision("strict");
    expect(t.view().controls?.supervision).toBe("standard");
  });

  it("persisté par chat : relu au rechargement, sans fuite vers un autre chat", async () => {
    const data = new Map<string, unknown>();
    const store = {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => void data.set(key, value),
    };
    const a = await ready(setup({ store, prefsKey: "prefs.a" }));
    a.session.setSupervision("strict");
    expect((data.get("prefs.a") as { supervision?: string }).supervision).toBe("strict");
    const again = await ready(setup({ store, prefsKey: "prefs.a" }));
    expect(again.session.view().controls?.supervision).toBe("strict");
    const other = await ready(setup({ store, prefsKey: "prefs.b" }));
    expect(other.session.view().controls?.supervision).toBe("standard");
  });

  it("changement entre deux messages : moteur inactif remplacé, nouvelle valeur transmise", async () => {
    const t = setup({});
    await t.session.send("un");
    t.f.handlers.onEvent?.(ev({ kind: "session.started", sessionId: "S1" }));
    t.f.handlers.onEnded?.({ sessionId: "S1" } as never);
    t.session.setSupervision("strict");
    await t.session.send("deux");
    expect(t.f.starts[1]).toMatchObject({ supervision: "strict", resume: "S1" });
  });
});

it.each([
  "alice@example.com:mot-secret",
  "password=mot-secret",
  "pass=mot-secret",
  "mdp mot-secret",
  "Cookie: sid=mot-secret",
])("avertit sans bloquer l’envoi de %s", async (prompt) => {
  const t = setup();
  expect(await t.session.send(prompt)).toBe(true);
  expect(t.f.calls).toContainEqual(["prompt", prompt]);
  expect(t.view().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "notice",
        text: "Identifiant détecté : il a été masqué dans les journaux. Utilisez la page Comptes de test pour que l'agent puisse s'en servir.",
      }),
    ]),
  );
  t.session.dispose();
});
