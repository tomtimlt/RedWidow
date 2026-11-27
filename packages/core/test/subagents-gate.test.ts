import { describe, expect, it, vi } from "vitest";
import {
  type ApprovalAnswer,
  type ApprovalRequest,
  createApprovalGate,
  createBypassSwitch,
  createRecorder,
  createSubagentBoard,
  DEFAULT_POLICY,
  deskInstructions,
  deskToolSpecs,
  type EngineEvent,
  evaluatePolicy,
  isRememberable,
  type Policy,
  SUBAGENTS_GUIDANCE,
} from "../src/index.js";

const signal = new AbortController().signal;
const WORKSPACE = { cwd: process.cwd(), posixShell: true };

/** Gate + tableau + `ask` espion (qui répondrait `allow` à tout, pour détecter une seconde demande). */
function fixture(options: { subagents?: boolean; bypass?: boolean; policy?: Policy } = {}) {
  const recorder = createRecorder({ redact: false });
  const events: EngineEvent[] = [];
  recorder.subscribe((event) => events.push(event));
  const board = createSubagentBoard({ recorder });
  const ask = vi.fn(
    async (): Promise<ApprovalAnswer> => ({ decision: "allow", remember: "always" }),
  );
  const bypass = createBypassSwitch({ now: () => 1_000_000 });
  if (options.bypass) bypass.enable(null);
  const gate = createApprovalGate({
    policy: options.policy ?? DEFAULT_POLICY,
    recorder,
    ask,
    workspace: WORKSPACE,
    bypass,
    now: () => 1_000_000,
    ...(options.subagents !== false && { subagents: board }),
  });
  const task = (toolUseId: string, description: unknown, extra: Partial<ApprovalRequest> = {}) =>
    gate.decide(
      {
        toolUseId,
        tool: "Task",
        input: { description, prompt: "p", subagent_type: "redwidow" },
        ...extra,
      },
      signal,
    );
  /** Propose les volets `names` (1 à 4), puis les accepte tous. */
  const approve = async (names: string[]) => {
    const pending = board.propose(names.map((name) => ({ name, goal: `volet ${name}` })));
    const proposal = board.pending();
    board.answer(
      proposal?.proposalId ?? "",
      (proposal?.items ?? []).map((item) => item.id),
    );
    await pending;
  };
  const decided = () =>
    events.filter(
      (event): event is Extract<EngineEvent, { kind: "approval.decided" }> =>
        event.kind === "approval.decided",
    );
  return { recorder, events, board, ask, gate, task, approve, decided };
}

describe("gate : règle structurelle des sous-agents (ADR 0054)", () => {
  it("mode inactif (aucun tableau) : refus subagents.disabled, sans demande", async () => {
    const f = fixture({ subagents: false });
    const outcome = await f.task("t1", "A");
    expect(outcome).toEqual({
      decision: "deny",
      reason: { code: "subagents.disabled" },
      source: "policy",
    });
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.decided()).toHaveLength(1);
    expect(f.decided()[0]).toMatchObject({
      toolUseId: "t1",
      decision: "deny",
      source: "policy",
      reason: { code: "subagents.disabled" },
    });
  });

  it("place non approuvée : refus subagents.not_approved", async () => {
    const f = fixture();
    const outcome = await f.task("t1", "A");
    expect(outcome.decision).toBe("deny");
    expect(outcome.reason).toEqual({
      code: "subagents.not_approved",
      params: { description: "A" },
    });
    await f.approve(["A"]);
    const other = await f.task("t2", "B");
    expect(other.reason.code).toBe("subagents.not_approved");
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("appel d'un sous-agent : refus subagents.nested, même avec une place approuvée", async () => {
    const f = fixture();
    await f.approve(["A"]);
    const outcome = await f.task("t1", "A", { agentId: "agent-1" });
    expect(outcome).toEqual({
      decision: "deny",
      reason: { code: "subagents.nested" },
      source: "policy",
    });
    // La place est intacte pour l'agent principal.
    expect((await f.task("t2", "A")).decision).toBe("allow");
  });

  it("place approuvée : accord sans seconde demande, journalisé, place consommée", async () => {
    const f = fixture();
    await f.approve(["A", "B"]);
    const outcome = await f.task("t1", "A");
    expect(outcome).toEqual({
      decision: "allow",
      reason: { code: "subagents.approved", params: { description: "A" } },
      source: "policy",
    });
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.events.filter((e) => e.kind === "approval.requested")).toHaveLength(0);
    expect(f.board.running()).toBe(1);
    // Une même place n'est pas utilisable deux fois.
    const again = await f.task("t2", "A");
    expect(again.decision).toBe("deny");
    expect(again.reason.code).toBe("subagents.not_approved");
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("4 sous-agents en cours : refus subagents.limit, puis accord après la fin de l'un", async () => {
    const f = fixture();
    await f.approve(["A", "B", "C", "D"]);
    for (const [i, name] of ["A", "B", "C", "D"].entries())
      expect((await f.task(`t${i}`, name)).decision).toBe("allow");
    await f.approve(["E"]);
    const refused = await f.task("t9", "E");
    expect(refused.decision).toBe("deny");
    expect(refused.reason).toEqual({ code: "subagents.limit", params: { max: 4 } });
    // Fin d'un Task : événement du résultat d'outil, vu par le tableau via le recorder.
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "t0",
      isError: false,
      output: "ok",
      truncated: false,
      bytes: 2,
    });
    expect((await f.task("t9", "E")).decision).toBe("allow");
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("les refus ne sont jamais contournés par le Bypass actif (ni remis à l'utilisateur)", async () => {
    const f = fixture({ bypass: true });
    // Garde-fou du test : le Bypass est bien actif pour un autre outil (verdict ask auto-approuvé).
    const other = await f.gate.decide(
      { toolUseId: "x", tool: "mcp__demo__ask", input: {} },
      signal,
    );
    expect(other.source).toBe("bypass");

    const disabled = fixture({ bypass: true, subagents: false });
    expect(await disabled.task("t1", "A")).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.disabled" },
      source: "policy",
    });

    expect(await f.task("t1", "A")).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.not_approved" },
      source: "policy",
    });
    await f.approve(["A"]);
    expect(await f.task("t2", "A", { agentId: "a" })).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.nested" },
      source: "policy",
    });
    await f.approve(["A", "B", "C", "D"]);
    for (const [i, name] of ["A", "B", "C", "D"].entries())
      expect((await f.task(`r${i}`, name)).decision).toBe("allow");
    await f.approve(["E"]);
    expect(await f.task("t3", "E")).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.limit" },
      source: "policy",
    });
    // Aucun de ces refus n'a pris la forme « Bypass » ni n'a sollicité l'utilisateur pour Task.
    expect(f.decided().filter((e) => e.source === "bypass")).toHaveLength(1); // seulement mcp__demo__ask
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("un refus n'est ni mémorisable ni mémorisé : la même demande est refusée de nouveau", async () => {
    const f = fixture();
    const first = await f.task("t1", "A");
    const second = await f.task("t1", "A");
    expect(second).toEqual(first);
    // Hors du verdict de politique « ask », rien n'est proposé à « Toujours ».
    expect(
      isRememberable(
        { toolUseId: "t1", tool: "Task", input: {} },
        { decision: "deny", reason: first.reason, rule: null },
      ),
    ).toBe(false);
    // Une approbation « toujours » d'un autre outil ne couvre pas Task.
    await f.gate.decide({ toolUseId: "x", tool: "mcp__demo__other", input: {} }, signal);
    expect(f.ask).toHaveBeenCalledOnce();
    expect((await f.task("t2", "A")).decision).toBe("deny");
    expect(f.ask).toHaveBeenCalledOnce();
  });

  it("une règle utilisateur « allow Task » ne lève aucun refus structurel", async () => {
    const policy: Policy = { default: "ask", rules: [{ tool: "Task", decision: "allow" }] };
    const f = fixture({ policy });
    expect((await f.task("t1", "A")).reason.code).toBe("subagents.not_approved");
    const off = fixture({ policy, subagents: false });
    expect((await off.task("t1", "A")).reason.code).toBe("subagents.disabled");
  });

  it("l'outil Agent (nom des SDK Claude récents) suit la même règle que Task", async () => {
    const off = fixture({ subagents: false });
    const refused = await off.gate.decide(
      {
        toolUseId: "a0",
        tool: "Agent",
        input: { description: "A", prompt: "p", subagent_type: "redwidow" },
      },
      signal,
    );
    expect(refused.reason.code).toBe("subagents.disabled");

    const f = fixture();
    const agent = (toolUseId: string, input: Record<string, unknown>, extra = {}) =>
      f.gate.decide({ toolUseId, tool: "Agent", input, ...extra }, signal);
    expect((await agent("a1", { description: "A", subagent_type: "redwidow" })).reason.code).toBe(
      "subagents.not_approved",
    );
    await f.approve(["A"]);
    expect(
      (await agent("a2", { description: "A", subagent_type: "redwidow" }, { agentId: "x" })).reason
        .code,
    ).toBe("subagents.nested");
    expect(await agent("a3", { description: "A", subagent_type: "redwidow" })).toMatchObject({
      decision: "allow",
      reason: { code: "subagents.approved" },
      source: "policy",
    });
    expect(f.ask).not.toHaveBeenCalled();
  });

  it("un type de sous-agent autre que redwidow est refusé, même sous Bypass, sans consommer la place", async () => {
    const f = fixture({ bypass: true });
    await f.approve(["A"]);
    for (const tool of ["Task", "Agent"]) {
      for (const subagent_type of ["general-purpose", "Explore", undefined]) {
        const outcome = await f.gate.decide(
          {
            toolUseId: `u-${tool}-${String(subagent_type)}`,
            tool,
            input: { description: "A", prompt: "p", ...(subagent_type && { subagent_type }) },
          },
          signal,
        );
        expect(outcome, `${tool} ${String(subagent_type)}`).toMatchObject({
          decision: "deny",
          reason: { code: "subagents.not_approved" },
          source: "policy",
        });
      }
    }
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.board.places()).toHaveLength(1);
    expect((await f.task("t-ok", "A")).decision).toBe("allow");
  });

  it("la règle ne s'applique qu'à Task et Agent : les autres outils suivent la politique", async () => {
    const f = fixture();
    for (const tool of ["task", "TaskOutput", "mcp__demo__Task", "mcp__demo__Agent", "agent"]) {
      f.ask.mockClear();
      const outcome = await f.gate.decide(
        { toolUseId: `u-${tool}`, tool, input: { description: "A" } },
        signal,
      );
      expect(outcome.reason.code, tool).not.toMatch(/^subagents\./);
      expect(f.ask, tool).toHaveBeenCalledOnce();
    }
    const read = await f.gate.decide(
      { toolUseId: "r", tool: "Read", input: { file_path: `${process.cwd()}/package.json` } },
      signal,
    );
    expect(read.decision).toBe("allow");
    expect(read.reason.code).not.toMatch(/^subagents\./);
  });
});

describe("politique et outil propose_subagents", () => {
  it("la politique par défaut autorise propose_subagents et ne dit rien de Task", () => {
    const verdict = evaluatePolicy(DEFAULT_POLICY, "mcp__desk__propose_subagents", { items: [] });
    expect(verdict.decision).toBe("allow");
    expect(DEFAULT_POLICY.rules.some((rule) => rule.tool === "Task")).toBe(false);
    expect(evaluatePolicy(DEFAULT_POLICY, "Task", { description: "A" }).decision).toBe("ask");
  });

  it("l'outil n'existe que si le tableau est fourni", () => {
    const recorder = createRecorder({ redact: false });
    const board = createSubagentBoard({ recorder });
    expect(deskToolSpecs().map((s) => s.name)).toEqual(["load_skill"]);
    expect(deskToolSpecs(undefined, board).map((s) => s.name)).toEqual([
      "load_skill",
      "propose_subagents",
    ]);
    // Mode inactif : les outils du bureau et la consigne sont inchangés.
    expect(deskInstructions()).not.toContain("propose_subagents");
    expect(SUBAGENTS_GUIDANCE).toContain("propose_subagents");
    expect(SUBAGENTS_GUIDANCE).toContain("redwidow");
    expect(SUBAGENTS_GUIDANCE).toContain("Task");
  });

  const tool = () => {
    const recorder = createRecorder({ redact: false });
    const events: EngineEvent[] = [];
    recorder.subscribe((event) => events.push(event));
    const board = createSubagentBoard({ recorder });
    const spec = deskToolSpecs(undefined, board).find((s) => s.name === "propose_subagents");
    if (!spec) throw new Error("outil absent");
    const run = (args: unknown, ctx: { parentId?: string | null; signal?: AbortSignal } = {}) =>
      spec.run(args, {
        parentId: ctx.parentId ?? "appel",
        correlation: undefined,
        signal: ctx.signal,
      });
    return { board, events, run, spec };
  };

  it("bloque jusqu'à la réponse puis rend les places retenues", async () => {
    const { board, run, events } = tool();
    const result = run({
      items: [
        { name: "Domaines", goal: "dns" },
        { name: "API", goal: "routes" },
      ],
    });
    // Aucune réponse tant que l'utilisateur n'a pas tranché.
    await Promise.resolve();
    const proposal = board.pending();
    expect(proposal?.items).toHaveLength(2);
    board.answer(proposal?.proposalId ?? "", ["s2"], "ok pour l'API");
    expect(JSON.parse(await result)).toEqual({
      decision: "accepted",
      selected: [{ id: "s2", description: "API" }],
      note: "ok pour l'API",
    });
    expect(events.find((e) => e.kind === "subagents.proposed")?.parentId).toBe("appel");
  });

  it("rend un refus avec la note et l'invitation à reproposer", async () => {
    const { board, run } = tool();
    const result = run({ items: [{ name: "API", goal: "routes" }] });
    board.declineWithText("fais plutôt un scan de ports");
    const parsed = JSON.parse(await result);
    expect(parsed).toMatchObject({ decision: "declined", note: "fais plutôt un scan de ports" });
    expect(parsed.hint).toContain("propose_subagents");
    // Sans note : pas de champ note.
    const second = run({ items: [{ name: "API", goal: "routes" }] });
    board.answer(board.pending()?.proposalId ?? "", []);
    expect(Object.keys(JSON.parse(await second)).sort()).toEqual(["decision", "hint"]);
  });

  it("une seconde proposition pendant la première rend une erreur explicite", async () => {
    const { board, run } = tool();
    const first = run({ items: [{ name: "API", goal: "routes" }] });
    await expect(run({ items: [{ name: "Autre", goal: "x" }] })).rejects.toMatchObject({
      code: "subagents.pendingProposal",
    });
    board.cancel();
    expect(JSON.parse(await first).decision).toBe("declined");
  });

  it("l'annulation de l'appel refuse la proposition", async () => {
    const { run } = tool();
    const controller = new AbortController();
    const result = run({ items: [{ name: "API", goal: "routes" }] }, { signal: controller.signal });
    controller.abort();
    expect(JSON.parse(await result).decision).toBe("declined");
  });

  it.each([
    ["0 élément", { items: [] }],
    ["5 éléments", { items: ["a", "b", "c", "d", "e"].map((name) => ({ name, goal: "x" })) }],
    [
      "noms en double",
      {
        items: [
          { name: "API", goal: "a" },
          { name: "api", goal: "b" },
        ],
      },
    ],
    ["champ inconnu dans un élément", { items: [{ name: "API", goal: "a", model: "x" }] }],
    ["champ inconnu à la racine", { items: [{ name: "API", goal: "a" }], force: true }],
    ["items absent", {}],
    ["nom vide", { items: [{ name: "", goal: "a" }] }],
    ["objectif absent", { items: [{ name: "API" }] }],
  ])("refuse une entrée invalide : %s", async (_label, args) => {
    const { run, board } = tool();
    await expect(run(args)).rejects.toMatchObject({ code: "subagents.invalidProposal" });
    expect(board.pending()).toBeNull();
  });

  it("nomme le champ fautif", async () => {
    const { run } = tool();
    await expect(run({ items: [{ name: "", goal: "a" }] })).rejects.toMatchObject({
      params: { field: "items.0.name" },
    });
  });
});
