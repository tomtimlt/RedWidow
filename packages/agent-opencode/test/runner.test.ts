import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type ApprovalAnswer,
  createRecorder,
  createRedactor,
  type EngineEvent,
} from "@warband/core";
import { describe, expect, it } from "vitest";
import { createOpencodeRunner, dockerToolset, parseModel, parsePermission } from "../src/index.js";
import {
  assistantMessage,
  fakeDocker,
  fakeOpencode,
  harness,
  permission,
  SESSION,
  type Stage,
  toolPart,
  userMessage,
} from "./helpers.js";

const kinds = (events: EngineEvent[]) => events.map((e) => e.kind);
const of = <K extends EngineEvent["kind"]>(events: EngineEvent[], kind: K) =>
  events.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);

/** Début de tour : message utilisateur, message assistant. */
const begin = (s: Stage, user = "msg_u") => {
  s.emit("message.updated", userMessage(user));
  s.emit("message.updated", assistantMessage());
};

/** Un appel d'outil complet passant par la permission `perm`. */
async function toolCall(
  s: Stage,
  opts: {
    callID: string;
    tool: string;
    input: Record<string, unknown>;
    perm: string;
    permId: string;
    output?: string;
  },
) {
  s.emit("message.part.updated", {
    part: toolPart(opts.callID, opts.tool, { status: "running", input: opts.input }),
  });
  const response = await s.ask(permission(opts.permId, opts.perm, opts.callID));
  s.emit("message.part.updated", {
    part: toolPart(
      opts.callID,
      opts.tool,
      response === "once"
        ? { status: "completed", input: opts.input, output: opts.output ?? "ok" }
        : { status: "error", input: opts.input, error: "rejected" },
    ),
  });
  return response;
}

describe("parseModel / parsePermission", () => {
  it("découpe fournisseur/modèle (le modèle peut contenir des /)", () => {
    expect(parseModel("openrouter/vendor/name")).toEqual({
      providerID: "openrouter",
      modelID: "vendor/name",
    });
    expect(parseModel("nom", "p")).toEqual({ providerID: "p", modelID: "nom" });
    expect(() => parseModel("nom")).toThrow(/opencode.invalidModel/);
    expect(() => parseModel("/x")).toThrow();
  });

  it("lit les formes permission.asked (binaire) et permission.updated (SDK)", () => {
    expect(
      parsePermission({
        id: "p1",
        sessionID: "s",
        permission: "bash",
        patterns: ["ls"],
        metadata: { command: "ls" },
        tool: { messageID: "m", callID: "c" },
      }),
    ).toMatchObject({ permission: "bash", messageID: "m", callID: "c", patterns: ["ls"] });
    expect(
      parsePermission({
        id: "p2",
        sessionID: "s",
        type: "edit",
        pattern: "a.txt",
        messageID: "m",
        callID: "c",
        title: "t",
        metadata: {},
      }),
    ).toMatchObject({ permission: "edit", patterns: ["a.txt"], callID: "c" });
    expect(parsePermission({ id: "p" })).toBeNull();
  });
});

describe("createOpencodeRunner (faux client)", () => {
  it("traduit un tour complet en événements et répond « once » aux outils autorisés", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-run-"));
    writeFileSync(join(cwd, "a.txt"), "x");
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: {
            id: "t1",
            sessionID: SESSION,
            messageID: "msg_a",
            type: "reasoning",
            text: "je réfléchis",
            time: { start: 1, end: 2 },
          },
        });
        const response = await toolCall(s, {
          callID: "call_0",
          tool: "read",
          input: { filePath: join(cwd, "a.txt") },
          perm: "read",
          permId: "per_1",
          output: "contenu",
        });
        expect(response).toBe("once");
        s.emit("message.part.updated", {
          part: {
            id: "sf1",
            sessionID: SESSION,
            messageID: "msg_a",
            type: "step-finish",
            cost: 0.01,
          },
        });
        s.emit("message.part.updated", {
          part: {
            id: "tx",
            sessionID: SESSION,
            messageID: "msg_a",
            type: "text",
            text: "fini",
            time: { start: 1, end: 2 },
          },
        });
        s.emit("message.part.updated", {
          part: { id: "sn", sessionID: SESSION, messageID: "msg_a", type: "snapshot" },
        });
        s.emit("quelque.chose.d.inconnu", {});
        s.emit("session.status", { sessionID: SESSION, status: { type: "idle" } });
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd });
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }));

    expect(summary).toMatchObject({
      status: "success",
      turns: 1,
      result: "fini",
      sessionId: SESSION,
    });
    expect(summary.costUsd).toBeCloseTo(0.01);
    expect(summary.unhandledMessages).toEqual({
      "message.part.updated/snapshot": 1,
      "quelque.chose.d.inconnu": 1,
    });
    expect(kinds(h.events)).toEqual([
      "run.started",
      "session.started",
      "agent.thinking",
      "tool.requested",
      "approval.decided",
      "tool.result",
      "agent.text",
      "turn.finished",
      "run.finished",
    ]);
    expect(of(h.events, "session.started")[0]).toMatchObject({
      sessionId: SESSION,
      model: "fake/m",
    });
    expect(of(h.events, "tool.requested")[0]).toMatchObject({
      toolUseId: "call_0",
      tool: "Read",
      input: { file_path: join(cwd, "a.txt") },
    });
    expect(of(h.events, "tool.result")[0]).toMatchObject({ isError: false, output: "contenu" });
    expect(fake.replies).toEqual([{ id: "per_1", response: "once" }]);
    expect(fake.closed()).toBe(true);
    // Les outils non activés sont coupés par `false` seulement : jamais de `true` (règle « allow »).
    const tools = fake.prompts[0]?.body.tools ?? {};
    expect(Object.values(tools).every((v) => v === false)).toBe(true);
    expect(tools).toMatchObject({
      bash: false,
      write: false,
      edit: false,
      webfetch: false,
      task: false,
    });
    expect(tools.read).toBeUndefined();
    expect(fake.prompts[0]?.body.model).toEqual({ providerID: "fake", modelID: "m" });
  });

  it("refuse les chemins sensibles, bash et les cas ask sans approbateur (reject)", async () => {
    const home = mkdtempSync(join(tmpdir(), "oc-home-"));
    // Chemin sensible propre à la plateforme (le test POSIX vise /etc/shadow).
    const sensitivePath =
      process.platform === "win32" ? join(homedir(), ".ssh", "id_rsa") : "/etc/shadow";
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        const results = [];
        results.push(
          await toolCall(s, {
            callID: "c1",
            tool: "read",
            input: { filePath: sensitivePath },
            perm: "read",
            permId: "p1",
          }),
        );
        results.push(
          await toolCall(s, {
            callID: "c2",
            tool: "bash",
            input: { command: "rm -rf x" },
            perm: "bash",
            permId: "p2",
          }),
        );
        results.push(
          await toolCall(s, {
            callID: "c3",
            tool: "write",
            input: { filePath: join(home, "n.txt"), content: "x" },
            perm: "edit",
            permId: "p3",
          }),
        );
        results.push(
          await toolCall(s, {
            callID: "c4",
            tool: "patch",
            input: { patchText: "x" },
            perm: "edit",
            permId: "p4",
          }),
        );
        s.emit("quoi", { results });
        s.idle();
      },
    ]);
    const h = harness({ workspace: home });
    await h.run(createOpencodeRunner({ createClient: fake.createClient, bash: true }));
    expect(fake.replies.map((r) => r.response)).toEqual(["reject", "reject", "reject", "reject"]);
    const decided = of(h.events, "approval.decided");
    expect(decided.map((d) => d.decision)).toEqual(["deny", "deny", "deny", "deny"]);
    expect(decided[0]?.reason.code).toBe("path.sensitive");
    expect(decided[1]?.reason.code).toBe("policy.rule");
    expect(decided[2]?.reason.code).toBe("approval.noAsker");
    expect(decided[3]?.reason.code).toBe("opencode.pathUnknown");
    expect(of(h.events, "tool.requested").map((e) => e.tool)).toEqual([
      "Read",
      "Bash",
      "Write",
      "Patch",
    ]);
  });

  it("ne répond jamais « always » même si l'utilisateur mémorise : la mémoire reste dans la gate", async () => {
    const answers: ApprovalAnswer[] = [
      { decision: "allow", remember: "always" },
      { decision: "allow", remember: "session" },
    ];
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        await toolCall(s, {
          callID: "c1",
          tool: "webfetch",
          input: { url: "http://x" },
          perm: "webfetch",
          permId: "p1",
        });
        await toolCall(s, {
          callID: "c2",
          tool: "webfetch",
          input: { url: "http://x" },
          perm: "webfetch",
          permId: "p2",
        });
        s.idle();
      },
    ]);
    const asked: string[] = [];
    const h = harness({
      ask: async (request) => {
        asked.push(request.toolUseId);
        return answers.shift() ?? { decision: "deny" };
      },
    });
    await h.run(
      createOpencodeRunner({ createClient: fake.createClient, builtinTools: ["read", "webfetch"] }),
    );
    expect(fake.replies).toEqual([
      { id: "p1", response: "once" },
      { id: "p2", response: "once" },
    ]);
    expect(asked).toEqual(["c1"]); // la seconde est autorisée par la mémoire de la gate
    expect(of(h.events, "approval.decided")[1]?.reason.code).toBe("approval.remembered");
  });

  it("external_directory partage la décision de l'appel (une seule approbation)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-ext-"));
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: toolPart("c1", "read", { status: "running", input: { filePath: "/etc/hostname" } }),
        });
        const [a, b] = await Promise.all([
          s.ask(permission("p_ext", "external_directory", "c1")),
          s.ask(permission("p_read", "read", "c1")),
        ]);
        s.emit("quoi", { a, b });
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, ask: async () => ({ decision: "allow" }) });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(of(h.events, "approval.requested")).toHaveLength(1);
    expect(of(h.events, "approval.decided")).toHaveLength(1);
    expect(of(h.events, "approval.decided")[0]?.reason.code).toBe("path.outside");
    expect(fake.replies.map((r) => r.response)).toEqual(["once", "once"]);
  });

  it("external_directory sans motif après la décision de l'outil : nouvelle décision, jamais mémorisée", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-extn-"));
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: toolPart("c1", "read", { status: "running", input: { filePath: "a.txt" } }),
        });
        const a = await s.ask(permission("p_read", "read", "c1"));
        const b = await s.ask(permission("p_ext", "external_directory", "c1", { patterns: [] }));
        const c = await s.ask(permission("p_ext2", "external_directory", "c1", { patterns: [] }));
        s.emit("quoi", { a, b, c });
        s.idle();
      },
    ]);
    const asked: Record<string, unknown>[] = [];
    const h = harness({
      workspace: cwd,
      ask: async (r) => {
        asked.push(r.input);
        return { decision: "allow", remember: "session" };
      },
    });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    // Le read dans l'espace de travail est autorisé par la politique ; l'accès externe demande l'utilisateur.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.externalDirectories).toEqual([]);
    const decided = of(h.events, "approval.decided");
    expect(decided).toHaveLength(2);
    expect(decided[0]?.source).toBe("policy");
    expect(decided[1]?.source).toBe("user");
    expect(fake.replies.map((r) => r.response)).toEqual(["once", "once", "once"]);
  });

  it("external_directory sans appel : base fixe des motifs, sensible refusé, normal soumis à approbation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-extp-"));
    const other = mkdtempSync(join(tmpdir(), "oc-other-"));
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        const bare = (id: string, patterns: string[]) =>
          permission(id, "external_directory", "c", { tool: undefined, patterns });
        const a = await s.ask(bare("p1", [join(other, "**", "*.txt")]));
        const b = await s.ask(bare("p2", ["~/.ssh/*"]));
        const c = await s.ask(bare("p3", ["~/.claude/**"]));
        s.emit("quoi", { a, b, c });
        s.idle();
      },
    ]);
    const asked: string[] = [];
    const h = harness({
      workspace: cwd,
      ask: async (r) => {
        asked.push(JSON.stringify(r.input));
        return { decision: "allow" };
      },
    });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(fake.replies.map((r) => r.response)).toEqual(["once", "reject", "reject"]);
    expect(asked).toHaveLength(1); // seul le répertoire normal est soumis à l'approbation
    const decided = of(h.events, "approval.decided");
    expect(decided.map((d) => d.decision)).toEqual(["allow", "deny", "deny"]);
    expect(decided[1]?.reason.code).toBe("path.sensitive");
    expect(decided[2]?.reason.code).toBe("path.sensitive");
  });

  it("external_directory avec appel : un chemin sensible dans les motifs refuse l'appel", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-extq-"));
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: toolPart("c1", "read", { status: "running", input: { filePath: "a.txt" } }),
        });
        const a = await s.ask(
          permission("p_ext", "external_directory", "c1", { patterns: ["~/.aws/*"] }),
        );
        s.emit("quoi", { a });
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, ask: async () => ({ decision: "allow" }) });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(fake.replies.map((r) => r.response)).toEqual(["reject"]);
    expect(of(h.events, "approval.decided")[0]?.reason.code).toBe("path.sensitive");
  });

  it("relit l'entrée d'un appel absente du flux avant de trancher (sinon reject)", async () => {
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        // Aucune partie `tool` n'a été émise : le faux client ne sait pas la fournir.
        const r = await s.ask(permission("p1", "read", "inconnu"));
        s.emit("quoi", { r });
        s.idle();
      },
    ]);
    const h = harness();
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(fake.replies).toEqual([{ id: "p1", response: "reject" }]);
  });

  it("refuse de démarrer si la configuration effective est plus laxiste que ask", async () => {
    for (const [effective, setting] of [
      [
        (c: Record<string, unknown>) => ({ ...c, permission: { "*": "ask", bash: "allow" } }),
        "permission.bash",
      ],
      [
        (c: Record<string, unknown>) => ({
          ...c,
          permission: { "*": "ask", bash: { "ls *": "allow" } },
        }),
        "permission.bash.ls *",
      ],
      [(c: Record<string, unknown>) => ({ ...c, permission: { read: "ask" } }), "permission.*"],
      [
        (c: Record<string, unknown>) => ({
          ...c,
          agent: { build: { permission: { bash: "allow" } } },
        }),
        "agent.build.permission.bash",
      ],
      [(c: Record<string, unknown>) => ({ ...c, plugin: ["x"] }), "plugin"],
    ] as const) {
      const fake = fakeOpencode([], { effective });
      const h = harness();
      const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }));
      expect(summary.status).toBe("error");
      expect(of(h.events, "error")[0]).toMatchObject({
        code: "opencode.unsafeConfig",
        params: { setting },
      });
      expect(fake.prompts).toHaveLength(0);
    }
  });

  it("impose une configuration sûre, même face à celle de l'utilisateur", async () => {
    const fake = fakeOpencode([
      (s) => {
        begin(s);
        s.idle();
      },
    ]);
    const h = harness();
    await h.run(
      createOpencodeRunner({
        createClient: fake.createClient,
        config: {
          model: "fake/m",
          provider: { fake: { npm: "x" } },
          permission: { bash: "allow" },
          plugin: ["mauvais"],
          share: "auto",
          agent: { build: { permission: { bash: "allow" }, prompt: "p" } },
        },
      }),
      { maxTurns: 7 },
    );
    const config = fake.init().config as {
      share: string;
      autoupdate: boolean;
      plugin?: unknown;
      provider: unknown;
      permission: unknown;
      agent: { build: unknown };
    };
    expect(config.share).toBe("disabled");
    expect(config.autoupdate).toBe(false);
    expect(config.plugin).toBeUndefined();
    expect(config.provider).toEqual({ fake: { npm: "x" } });
    expect(config.permission).toMatchObject({
      "*": "ask",
      bash: "deny",
      read: "ask",
      edit: "deny",
      external_directory: "ask",
    });
    expect(JSON.stringify(config)).not.toContain('"allow"');
    expect(config.agent.build).toMatchObject({
      prompt: "p",
      maxSteps: 7,
      permission: config.permission,
    });
  });

  it("exige un modèle", async () => {
    const fake = fakeOpencode([], { effective: (c) => ({ ...c }) });
    const h = harness();
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }), {
      // biome-ignore lint/suspicious/noExplicitAny: retire le modèle imposé par le harnais.
      model: undefined as any,
    });
    expect(summary.status).toBe("error");
    expect(of(h.events, "error")[0]?.code).toBe("opencode.noModel");
  });

  it("traduit les erreurs de fournisseur, les essais et le coût", async () => {
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("session.status", {
          sessionID: SESSION,
          status: { type: "retry", attempt: 1, message: "surcharge", next: Date.now() + 5000 },
        });
        s.emit("session.error", {
          sessionID: SESSION,
          error: { name: "ProviderAuthError", data: { providerID: "openai", message: "m" } },
        });
        s.emit("session.error", {
          sessionID: SESSION,
          error: { name: "APIError", data: { message: "boom\ntrace", statusCode: 500 } },
        });
        s.idle();
      },
    ]);
    const h = harness();
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(summary.status).toBe("error");
    expect(of(h.events, "api.retry")[0]).toMatchObject({
      attempt: 1,
      error: "surcharge",
      errorStatus: null,
    });
    const errors = of(h.events, "error");
    expect(errors[0]).toMatchObject({
      code: "provider.authFailed",
      params: { provider: "openai" },
    });
    expect(errors[1]).toMatchObject({
      code: "provider.error",
      params: { name: "APIError", message: "boom", status: 500 },
    });
  });

  it("interrompt la session quand le budget est dépassé", async () => {
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: {
            id: "sf",
            sessionID: SESSION,
            messageID: "msg_a",
            type: "step-finish",
            cost: 0.5,
          },
        });
        s.emit("session.error", {
          sessionID: SESSION,
          error: { name: "MessageAbortedError", data: { message: "Aborted" } },
        });
        s.idle();
      },
    ]);
    const h = harness();
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }), {
      maxBudgetUsd: 0.1,
    });
    expect(summary.status).toBe("error");
    expect(fake.aborts).toContain(SESSION);
    expect(of(h.events, "error").map((e) => e.code)).toEqual(["budget.exceeded"]);
  });

  it("annulation : refuse les permissions en attente et interrompt la session", async () => {
    const abort = new AbortController();
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        await toolCall(s, {
          callID: "c1",
          tool: "webfetch",
          input: { url: "http://x" },
          perm: "webfetch",
          permId: "p1",
        });
      },
    ]);
    const h = harness({
      ask: (_r, _v, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          setTimeout(() => abort.abort(new Error("stop")), 20);
        }),
    });
    const summary = await h.run(
      createOpencodeRunner({ createClient: fake.createClient, builtinTools: ["webfetch"] }),
      {},
      abort.signal,
    );
    expect(summary.status).toBe("error");
    expect(fake.aborts).toEqual([SESSION]);
    expect(of(h.events, "approval.decided")[0]).toMatchObject({ decision: "deny" });
    expect(kinds(h.events).at(-1)).toBe("run.finished");
  });

  it("reprend une session existante (resume) et enchaîne les tours d'un flux", async () => {
    const fake = fakeOpencode([
      (s) => {
        s.emit("message.updated", userMessage("u1"));
        s.idle();
      },
      (s) => {
        s.emit("message.updated", userMessage("u2"));
        s.idle();
      },
    ]);
    const h = harness();
    async function* texts() {
      yield "un";
      yield "deux";
    }
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }), {
      prompt: texts(),
      resume: "ses_1",
      systemPrompt: "sois bref",
    });
    expect(summary.turns).toBe(2);
    expect(fake.prompts.map((p) => p.body.text)).toEqual(["un", "deux"]);
    expect(fake.prompts[0]?.body.system).toBe("sois bref");
    expect(kinds(h.events).filter((k) => k === "turn.finished")).toHaveLength(2);

    const missing = fakeOpencode([], { hasSession: false });
    const h2 = harness();
    const s2 = await h2.run(createOpencodeRunner({ createClient: missing.createClient }), {
      resume: "x",
    });
    expect(s2.status).toBe("error");
    expect(of(h2.events, "error")[0]?.code).toBe("opencode.sessionNotFound");
  });

  it("masque les secrets dans tout ce qui est journalisé", async () => {
    const recorder = createRecorder({
      runId: "r",
      redact: createRedactor({ values: ["s3cr3t-valeur-xyz"] }),
    });
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        await toolCall(s, {
          callID: "c1",
          tool: "read",
          input: { filePath: join(process.cwd(), "package.json") },
          perm: "read",
          permId: "p1",
          output: "clé = s3cr3t-valeur-xyz",
        });
        s.idle();
      },
    ]);
    const h = harness({ recorder });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(JSON.stringify(h.events)).not.toContain("s3cr3t-valeur-xyz");
    expect(JSON.stringify(h.events)).toContain("[REDACTED]");
  });
});

describe("outils docker par serveur MCP HTTP", () => {
  const mcpClient = async (init: { url: string; headers: Record<string, string> }) => {
    const client = new Client({ name: "test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(init.url), {
      requestInit: { headers: init.headers },
    });
    // exactOptionalPropertyTypes : le typage du transport du SDK MCP n'est pas compatible.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    return client;
  };

  it("exige le jeton Bearer", async () => {
    const docker = await fakeDocker();
    let statuses: number[] = [];
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        const mcp = (
          s.init.config.mcp as Record<string, { url: string; headers: Record<string, string> }>
        ).docker;
        if (!mcp) throw new Error("serveur MCP absent");
        const post = (headers: Record<string, string>) =>
          fetch(mcp.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...headers,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          });
        const none = await post({});
        const bad = await post({ authorization: "Bearer faux" });
        const get = await fetch(mcp.url, { headers: mcp.headers });
        const good = await post(mcp.headers);
        const other = await fetch(mcp.url.replace("/docker", "/inconnu"), {
          method: "POST",
          headers: mcp.headers,
        });
        statuses = [none.status, bad.status, get.status, good.status, other.status];
        s.idle();
      },
    ]);
    const h = harness();
    await h.run(
      createOpencodeRunner({
        createClient: fake.createClient,
        toolsets: [dockerToolset({ binary: docker.bin, argsPrefix: docker.argsPrefix })],
      }),
    );
    expect(of(h.events, "error")).toEqual([]);
    // sans jeton, mauvais jeton, GET, bon jeton, serveur inconnu
    expect(statuses).toEqual([401, 401, 405, 200, 404]);
    expect(fake.init().config.mcp).toMatchObject({ docker: { type: "remote", enabled: true } });
    expect(await docker.calls()).toEqual([]);
  });

  it("passe par la gate avant d'exécuter : décision préalable corrélée, sinon décision locale", async () => {
    const docker = await fakeDocker();
    let outputs: string[] = [];
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        const mcp = (
          s.init.config.mcp as Record<string, { url: string; headers: Record<string, string> }>
        ).docker;
        if (!mcp) throw new Error("serveur MCP absent");
        // 1. Chemin normal : permission OpenCode → gate (allow) → appel MCP corrélé.
        s.emit("message.part.updated", {
          part: toolPart("c1", "docker_ps", { status: "running", input: {} }),
        });
        expect(await s.ask(permission("p1", "docker_ps", "c1"))).toBe("once");
        const client = await mcpClient(mcp);
        const ps = await client.callTool({ name: "ps", arguments: {} });
        // 2. Permission contournée : aucun enregistrement préalable, la gate refuse `run` (ask sans approbateur).
        const run = await client.callTool({ name: "run", arguments: { image: "nginx" } });
        // 3. `rm` est un deny de la politique.
        const rm = await client.callTool({ name: "rm", arguments: { container: "web" } });
        await client.close();
        outputs = [ps, run, rm].map((r) =>
          (r.content as { text: string }[]).map((c) => c.text).join(""),
        );
        s.emit("message.part.updated", {
          part: toolPart("c1", "docker_ps", { status: "completed", input: {}, output: outputs[0] }),
        });
        s.idle();
      },
    ]);
    const h = harness();
    await h.run(
      createOpencodeRunner({
        createClient: fake.createClient,
        toolsets: [dockerToolset({ binary: docker.bin, argsPrefix: docker.argsPrefix })],
      }),
    );

    expect(outputs[0]).toContain("web");
    expect(outputs[1]).toMatch(/^Refusé par warband : /);
    expect(outputs[2]).toMatch(/^Refusé par warband : /);
    expect(await docker.calls()).toEqual(["ps|--format|{{json .}}|"]);
    const requested = of(h.events, "tool.requested");
    expect(requested[0]).toMatchObject({ toolUseId: "c1", tool: "mcp__docker__ps" });
    const started = of(h.events, "process.started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ parentId: requested[0]?.id, correlation: "inferred" });
    // Les appels contournés ont leurs propres décisions dans le journal.
    expect(requested.map((e) => e.tool)).toEqual([
      "mcp__docker__ps",
      "mcp__docker__run",
      "mcp__docker__rm",
    ]);
    expect(of(h.events, "approval.decided").map((d) => d.decision)).toEqual([
      "allow",
      "deny",
      "deny",
    ]);
  });
});

it.each([
  { message: "Free usage exceeded, subscribe to Go", delayMs: 0, name: "QuotaExceeded" },
  { message: "Free usage exceeded, subscribe to Go", delayMs: 43_000_000, name: "QuotaExceeded" },
  { message: "surcharge", delayMs: 120_000, name: "RetryDelayed" },
])(
  "termine sans attendre idle un retry terminal : $name, $delayMs",
  async ({ message, delayMs, name }) => {
    const fake = fakeOpencode([
      (s) => {
        begin(s);
        // Même tentative d'abord annoncée sans délai, puis précisée par session.status.
        s.emit("session.status", {
          sessionID: SESSION,
          status: { type: "retry", attempt: 1, message: "surcharge", next: Date.now() },
        });
        s.emit("session.status", {
          sessionID: SESSION,
          status: { type: "retry", attempt: 1, message, next: Date.now() + delayMs },
        });
        // Aucun session.idle : l'adaptateur doit débloquer le tour lui-même.
      },
    ]);
    const h = harness();
    const summary = await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(summary).toMatchObject({ status: "error", turns: 1 });
    expect(of(h.events, "error")).toMatchObject([{ code: "provider.error", params: { name } }]);
    expect(of(h.events, "turn.finished")).toHaveLength(1);
    expect(fake.closed()).toBe(true);
  },
);

it("transmet l’image au client sans la journaliser", async () => {
  const image = { name: "capture.png", mimeType: "image/png" as const, data: "iVBORw0KGgo=" };
  const fake = fakeOpencode([
    (stage) => {
      begin(stage);
      stage.idle();
    },
  ]);
  const h = harness();
  await h.run(createOpencodeRunner({ createClient: fake.createClient }), {
    prompt: { text: "observer", images: [image] },
  });
  expect(fake.prompts[0]?.body.images).toEqual([image]);
  expect(JSON.stringify(h.events)).not.toContain(image.data);
  expect(h.events.find((e) => e.kind === "run.started")).toMatchObject({ prompt: "observer" });
});

type Script = Parameters<typeof fakeOpencode>[0][number];

describe("context.usage (OpenCode)", () => {
  const catalog = {
    all: [{ id: "fake", models: { m: { id: "m", limit: { context: 128000, output: 4096 } } } }],
    connected: ["fake"],
  };
  const step = (id: string, tokens?: Record<string, unknown>) => ({
    part: {
      id,
      sessionID: SESSION,
      messageID: "msg_a",
      type: "step-finish",
      cost: 0,
      ...(tokens && { tokens }),
    },
  });
  const play = async (stages: Script[], model: string, providers?: Record<string, unknown>) => {
    const fake = fakeOpencode(stages, providers ? { providers } : {});
    const h = harness();
    await h.run(createOpencodeRunner({ createClient: fake.createClient }), { model });
    return of(h.events, "context.usage");
  };
  const oneStep =
    (tokens?: Record<string, unknown>): Script =>
    (s) => {
      begin(s);
      s.emit(
        "message.part.updated",
        step("sf1", { input: 1, output: 1, cache: { read: 1, write: 1 } }),
      );
      s.emit("message.part.updated", step("sf2", tokens));
      s.idle();
    };

  it("émet la dernière étape (entrée + cache) et limit.context du modèle", async () => {
    const usages = await play(
      [oneStep({ input: 100, output: 50, reasoning: 0, cache: { read: 4000, write: 20 } })],
      "fake/m",
      catalog,
    );
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ usedTokens: 4120, windowTokens: 128000 });
  });

  it("omet windowTokens pour un modèle hors catalogue", async () => {
    const usages = await play(
      [oneStep({ input: 10, cache: { read: 0, write: 0 } })],
      "fake/inconnu",
      catalog,
    );
    expect(usages[0]).toMatchObject({ usedTokens: 10 });
    expect(usages[0]).not.toHaveProperty("windowTokens");
  });

  it("omet windowTokens sans catalogue", async () => {
    const usages = await play([oneStep({ input: 10 })], "fake/m");
    expect(usages[0]).toMatchObject({ usedTokens: 10 });
    expect(usages[0]).not.toHaveProperty("windowTokens");
  });

  it("n'émet rien sans usage pour le tour", async () => {
    const fake = fakeOpencode(
      [
        (s) => {
          begin(s);
          s.emit("message.part.updated", step("sf1"));
          s.idle();
        },
      ],
      { providers: catalog },
    );
    const h = harness();
    await h.run(createOpencodeRunner({ createClient: fake.createClient }), { model: "fake/m" });
    expect(of(h.events, "context.usage")).toHaveLength(0);
  });
});
