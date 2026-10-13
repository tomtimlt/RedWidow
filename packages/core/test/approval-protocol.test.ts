import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ApprovalAnswer,
  type Asker,
  createApprovalGate,
  createApprovalQueue,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
  type Policy,
  type PolicyRule,
} from "../src/index.js";

const signal = () => new AbortController().signal;

function setup(options: {
  ask?: Asker;
  policy?: Policy;
  timeoutMs?: number;
  persistRule?: (rule: PolicyRule) => void | Promise<void>;
  cwd?: string;
}) {
  const recorder = createRecorder({ runId: "r", redact: false });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({
    policy: options.policy ?? DEFAULT_POLICY,
    recorder,
    workspace: { cwd: options.cwd ?? "/w", home: "/h", realpath: (p) => p },
    ...(options.ask && { ask: options.ask }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.persistRule && { persistRule: options.persistRule }),
  });
  return { gate, events };
}

const bash = (command: string, id = "t") => ({
  toolUseId: id,
  tool: "Bash",
  input: { command },
});

/** Asker de test : compte les appels et renvoie la réponse donnée. */
function asker(answer: ApprovalAnswer) {
  const seen: string[] = [];
  const ask: Asker = async (request) => {
    seen.push(request.toolUseId);
    return answer;
  };
  return { ask, seen };
}

describe("approval.requested", () => {
  it("est émis avant de solliciter l'Asker, puis suivi de approval.decided", async () => {
    const order: string[] = [];
    const { gate, events } = setup({
      ask: async () => {
        order.push(`ask après ${events.map((e) => e.kind).join(",")}`);
        return { decision: "allow" };
      },
    });
    await gate.decide(bash("docker stop web"), signal(), "parent");
    expect(order).toEqual(["ask après approval.requested"]);
    expect(events.map((e) => e.kind)).toEqual(["approval.requested", "approval.decided"]);
    expect(events[0]).toMatchObject({
      toolUseId: "t",
      tool: "Bash",
      input: { command: "docker stop web" },
      verdict: { code: "bash.noRule" },
      parentId: "parent",
    });
  });

  it("n'est pas émis quand la politique tranche seule ou sans Asker", async () => {
    const { gate, events } = setup({});
    await gate.decide(bash("docker ps"), signal());
    await gate.decide(bash("docker stop web", "u"), signal());
    expect(events.map((e) => e.kind)).toEqual(["approval.decided", "approval.decided"]);
  });
});

describe("timeoutMs", () => {
  it("refuse avec approval.timeout, annule le signal de l'Asker et ignore une réponse tardive", async () => {
    let askSignal: AbortSignal | undefined;
    const { gate, events } = setup({
      timeoutMs: 20,
      ask: (_r, _v, s) => {
        askSignal = s;
        return new Promise(() => undefined); // ne répond jamais
      },
    });
    const outcome = await gate.decide(bash("docker stop web"), signal());
    expect(outcome).toMatchObject({
      decision: "deny",
      source: "user",
      reason: {
        code: "approval.timeout",
        params: { seconds: 0.02 },
        cause: { code: "bash.noRule" },
      },
    });
    expect(askSignal?.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "approval.decided", decision: "deny" });
  });

  it("laisse passer une réponse arrivée à temps", async () => {
    const { gate } = setup({ timeoutMs: 1000, ask: async () => ({ decision: "allow" }) });
    expect((await gate.decide(bash("docker stop web"), signal())).decision).toBe("allow");
  });

  it("une interruption (signal) reste approval.interrupted, pas un délai", async () => {
    const controller = new AbortController();
    const { gate } = setup({
      timeoutMs: 5000,
      ask: (_r, _v, s) =>
        new Promise((_, reject) => s.addEventListener("abort", () => reject(new Error("stop")))),
    });
    const pending = gate.decide(bash("docker stop web"), controller.signal);
    controller.abort();
    expect((await pending).reason).toMatchObject({ code: "approval.interrupted" });
  });
});

describe("remember", () => {
  it("session : la même commande exacte n'est plus demandée, une autre l'est", async () => {
    const { ask, seen } = asker({ decision: "allow", remember: "session" });
    const { gate, events } = setup({ ask });
    expect((await gate.decide(bash("docker stop web", "a"), signal())).decision).toBe("allow");
    const again = await gate.decide(bash("docker stop web", "b"), signal());
    expect(again).toMatchObject({
      decision: "allow",
      source: "user",
      reason: { code: "approval.remembered", cause: { code: "bash.noRule" } },
    });
    await gate.decide(bash("docker stop db", "c"), signal());
    expect(seen).toEqual(["a", "c"]);
    // Pas de approval.requested pour la décision mémorisée.
    expect(events.filter((e) => e.kind === "approval.requested")).toHaveLength(2);
  });

  it("once (ou absent) ne mémorise rien", async () => {
    for (const remember of [undefined, "once" as const]) {
      const { ask, seen } = asker({ decision: "allow", ...(remember && { remember }) });
      const { gate } = setup({ ask });
      await gate.decide(bash("docker stop web", "a"), signal());
      await gate.decide(bash("docker stop web", "b"), signal());
      expect(seen).toEqual(["a", "b"]);
    }
  });

  it("un refus n'est jamais mémorisé", async () => {
    const { ask, seen } = asker({ decision: "deny", remember: "session" });
    const { gate } = setup({ ask });
    await gate.decide(bash("docker stop web", "a"), signal());
    await gate.decide(bash("docker stop web", "b"), signal());
    expect(seen).toEqual(["a", "b"]);
  });

  it("pour un autre outil que Bash, la mémoire porte sur l'outil", async () => {
    const { ask, seen } = asker({ decision: "allow", remember: "session" });
    const { gate } = setup({ ask });
    await gate.decide(
      { toolUseId: "a", tool: "mcp__docker__run", input: { image: "x" } },
      signal(),
    );
    await gate.decide(
      { toolUseId: "b", tool: "mcp__docker__run", input: { image: "y" } },
      signal(),
    );
    await gate.decide({ toolUseId: "c", tool: "mcp__docker__stop", input: {} }, signal());
    expect(seen).toEqual(["a", "c"]);
  });

  it("une règle mémorisée ne contourne jamais un deny de la politique", async () => {
    const { ask, seen } = asker({ decision: "allow", remember: "session" });
    const policy: Policy = {
      default: "ask",
      rules: [{ tool: "Bash", command: "docker rm *", decision: "deny" }],
    };
    const { gate } = setup({ ask, policy });
    // On mémorise l'outil pour Bash sur une commande « ask », puis on tente une commande refusée.
    await gate.decide(bash("docker stop web", "a"), signal());
    const denied = await gate.decide(bash("docker rm web", "b"), signal());
    expect(denied).toMatchObject({ decision: "deny", source: "policy" });
    // Même pour un outil entier : le deny l'emporte toujours.
    const tool: Policy = { default: "ask", rules: [{ tool: "mcp__docker__rm", decision: "deny" }] };
    const second = setup({ ask, policy: tool });
    await second.gate.decide({ toolUseId: "c", tool: "mcp__docker__rm", input: {} }, signal());
    expect(seen).toEqual(["a"]);
  });

  it("une règle mémorisée ne contourne pas les dangers du shell ni l'accès hôte", async () => {
    const { ask, seen } = asker({ decision: "allow", remember: "session" });
    const { gate } = setup({ ask });
    await gate.decide(bash("docker stop $(docker ps -q)", "a"), signal());
    await gate.decide(bash("docker stop $(docker ps -q)", "b"), signal());
    const host = await gate.decide(bash("docker run -v /:/host alpine", "c"), signal());
    await gate.decide(bash("docker run -v /:/host alpine", "d"), signal());
    expect(host).toMatchObject({ decision: "deny", reason: { code: "docker.hostAccess" } });
    expect(seen).toEqual(["a", "b"]);
  });

  it("une règle mémorisée ne contourne pas les chemins sensibles ni hors espace de travail", async () => {
    const root = mkdtempSync(join(tmpdir(), "john-gate-"));
    const inside = join(root, "in.txt");
    writeFileSync(inside, "x");
    const other = mkdtempSync(join(tmpdir(), "john-gate-out-"));
    mkdirSync(other, { recursive: true });
    const outside = join(other, "out.txt");
    writeFileSync(outside, "x");
    const policy: Policy = { default: "ask", rules: [{ tool: "Write", decision: "ask" }] };
    const { ask, seen } = asker({ decision: "allow", remember: "session" });
    const { gate } = setup({ ask, policy, cwd: root });

    // Mémorise « Write » pour un chemin dans l'espace de travail…
    await gate.decide({ toolUseId: "a", tool: "Write", input: { file_path: inside } }, signal());
    expect(
      (await gate.decide({ toolUseId: "b", tool: "Write", input: { file_path: inside } }, signal()))
        .reason.code,
    ).toBe("approval.remembered");
    // …sans que cela couvre un chemin extérieur ou sensible.
    const out = await gate.decide(
      { toolUseId: "c", tool: "Write", input: { file_path: outside } },
      signal(),
    );
    const sensitive = await gate.decide(
      { toolUseId: "d", tool: "Write", input: { file_path: "/h/.ssh/id_rsa" } },
      signal(),
    );
    expect(out.reason.code).not.toBe("approval.remembered");
    expect(sensitive).toMatchObject({ decision: "deny", reason: { code: "path.sensitive" } });
    expect(seen).toEqual(["a", "c"]);
  });

  it("always : appelle persistRule avec la règle exacte, et retient aussi pour la session", async () => {
    const persisted: PolicyRule[] = [];
    const { ask, seen } = asker({ decision: "allow", remember: "always" });
    const { gate } = setup({ ask, persistRule: (rule) => void persisted.push(rule) });
    await gate.decide(bash("docker stop web", "a"), signal());
    await gate.decide(bash("docker stop web", "b"), signal());
    expect(persisted).toEqual([{ tool: "Bash", command: "docker stop web", decision: "allow" }]);
    expect(seen).toEqual(["a"]);
  });

  it("always : ne persiste pas ce qui ne se décrit pas par une règle sûre", async () => {
    const persisted: PolicyRule[] = [];
    const { ask } = asker({ decision: "allow", remember: "always" });
    const { gate } = setup({ ask, persistRule: (rule) => void persisted.push(rule) });
    await gate.decide(bash("docker stop web && docker stop db", "a"), signal()); // 2 segments
    await gate.decide(bash("docker run --name 'a b' alpine", "b"), signal()); // espace dans un argument
    await gate.decide(bash("docker stop $(x)", "c"), signal()); // danger shell
    expect(persisted).toEqual([]);
  });

  it("always : un échec de persistance n'empêche pas l'autorisation", async () => {
    const { ask } = asker({ decision: "allow", remember: "always" });
    const { gate, events } = setup({
      ask,
      persistRule: () => {
        throw new Error("disque plein");
      },
    });
    expect((await gate.decide(bash("docker stop web"), signal())).decision).toBe("allow");
    expect(events.some((e) => e.kind === "error")).toBe(true);
  });
});

describe("createApprovalQueue", () => {
  const verdict = { decision: "ask" as const, reason: { code: "bash.noRule" }, rule: null };

  it("sert d'Asker : pending(), answer() et résolution", async () => {
    const queue = createApprovalQueue();
    const waiting = queue({ toolUseId: "a", tool: "Bash", input: {} }, verdict, signal());
    expect(queue.pending()).toMatchObject([{ toolUseId: "a", tool: "Bash", verdict }]);
    expect(queue.answer("zzz", { decision: "allow" })).toBe(false);
    expect(queue.answer("a", { decision: "allow", remember: "session" })).toBe(true);
    await expect(waiting).resolves.toEqual({ decision: "allow", remember: "session" });
    expect(queue.pending()).toEqual([]);
    expect(queue.answer("a", { decision: "deny" })).toBe(false);
  });

  it("requests() rend les demandes en attente puis les nouvelles, et s'arrête à close()", async () => {
    const queue = createApprovalQueue();
    const first = queue({ toolUseId: "a", tool: "Bash", input: {} }, verdict, signal());
    const seen: string[] = [];
    const consumer = (async () => {
      for await (const p of queue.requests()) seen.push(p.toolUseId);
    })();
    const second = queue({ toolUseId: "b", tool: "Bash", input: {} }, verdict, signal());
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["a", "b"]);
    first.catch(() => undefined);
    second.catch(() => undefined);
    queue.close();
    await consumer;
    await expect(first).rejects.toThrow();
  });

  it("retire la demande quand le signal est annulé, et le gate refuse", async () => {
    const queue = createApprovalQueue();
    const recorder = createRecorder({ redact: false });
    const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, ask: queue });
    const controller = new AbortController();
    const decision = gate.decide(bash("docker stop web"), controller.signal);
    await Promise.resolve();
    expect(queue.pending()).toHaveLength(1);
    controller.abort();
    expect(await decision).toMatchObject({
      decision: "deny",
      reason: { code: "approval.interrupted" },
    });
    expect(queue.pending()).toEqual([]);
  });

  it("fonctionne de bout en bout avec la gate (session mémorisée)", async () => {
    const queue = createApprovalQueue();
    const recorder = createRecorder({ redact: false });
    const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, ask: queue });
    const first = gate.decide(bash("docker stop web", "a"), signal());
    await Promise.resolve();
    queue.answer("a", { decision: "allow", remember: "session" });
    expect((await first).decision).toBe("allow");
    expect((await gate.decide(bash("docker stop web", "b"), signal())).decision).toBe("allow");
    expect(queue.pending()).toEqual([]);
  });

  it("une file fermée refuse toute nouvelle demande", async () => {
    const queue = createApprovalQueue();
    queue.close();
    await expect(
      queue({ toolUseId: "a", tool: "Bash", input: {} }, verdict, signal()),
    ).rejects.toThrow();
  });
});
