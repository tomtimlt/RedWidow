import { describe, expect, it } from "vitest";
import {
  createRecorder,
  createSubagentBoard,
  type EngineEvent,
  type EventOf,
  isSubagentTool,
  SUBAGENT_TASK_TOOL,
  SUBAGENTS_MAX_RUNNING,
  SUBAGENTS_NOTE_MAX,
  subagentNameKey,
} from "../src/index.js";

/** Tableau de test : recorder sans masquage, identifiants de proposition prévisibles. */
function fixture() {
  const recorder = createRecorder({ redact: false });
  const events: EngineEvent[] = [];
  recorder.subscribe((event) => events.push(event));
  const proposals: { proposalId: string; items: unknown[] }[] = [];
  let n = 0;
  const board = createSubagentBoard({
    recorder,
    newId: () => `p${++n}`,
    onProposal: (proposal) => proposals.push(proposal),
  });
  const kinds = (kind: EngineEvent["kind"]) => events.filter((event) => event.kind === kind);
  return { recorder, events, proposals, board, kinds };
}

const DRAFTS = [
  { name: "Domaines", goal: "Énumérer les sous-domaines" },
  { name: "Fuzzing", goal: "Fuzzer les paramètres" },
  { name: "API", goal: "Cartographier les routes" },
];

/** Propose puis accepte les éléments `ids` ; rend les places retenues. */
async function accepted(f: ReturnType<typeof fixture>, ids: string[]) {
  const pending = f.board.propose(DRAFTS);
  const proposal = f.board.pending();
  expect(proposal).not.toBeNull();
  expect(f.board.answer(proposal?.proposalId ?? "", ids)).toBe(true);
  return pending;
}

describe("tableau des sous-agents : proposition", () => {
  it("attribue des identifiants, journalise la proposition et la relaie", async () => {
    const f = fixture();
    const parent = "tool-event";
    const outcome = f.board.propose(DRAFTS, { parentId: parent });
    expect(f.board.pending()).toEqual({
      proposalId: "p1",
      items: [
        { id: "s1", name: "Domaines", goal: "Énumérer les sous-domaines" },
        { id: "s2", name: "Fuzzing", goal: "Fuzzer les paramètres" },
        { id: "s3", name: "API", goal: "Cartographier les routes" },
      ],
    });
    expect(f.proposals).toHaveLength(1);
    expect(f.proposals[0]?.proposalId).toBe("p1");
    const proposed = f.kinds("subagents.proposed")[0] as EventOf<"subagents.proposed">;
    expect(proposed.parentId).toBe(parent);
    expect(proposed.items.map((i) => i.id)).toEqual(["s1", "s2", "s3"]);
    f.board.cancel();
    await outcome;
  });

  it("l'accord retient les éléments cochés dans l'ordre de la proposition", async () => {
    const f = fixture();
    const outcome = await accepted(f, ["s3", "s1"]);
    expect(outcome).toEqual({
      decision: "accepted",
      selected: [
        { id: "s1", description: "Domaines" },
        { id: "s3", description: "API" },
      ],
    });
    expect(f.board.pending()).toBeNull();
    expect(f.board.places().map((p) => p.description)).toEqual(["Domaines", "API"]);
    const decided = f.kinds("subagents.decided")[0] as EventOf<"subagents.decided">;
    expect(decided).toMatchObject({ proposalId: "p1", decision: "accepted" });
    expect(decided.selected).toHaveLength(2);
    expect(decided.note).toBeUndefined();
  });

  it("une réponse vide vaut refus, avec la note éventuelle", async () => {
    const f = fixture();
    const pending = f.board.propose(DRAFTS);
    expect(f.board.answer("p1", [], "  pas maintenant  ")).toBe(true);
    expect(await pending).toEqual({ decision: "declined", note: "pas maintenant" });
    expect(f.board.places()).toEqual([]);
    expect(f.kinds("subagents.decided")[0]).toMatchObject({
      decision: "declined",
      selected: [],
      note: "pas maintenant",
    });
  });

  it("des identifiants inconnus ne retiennent rien (refus)", async () => {
    const f = fixture();
    const pending = f.board.propose(DRAFTS);
    expect(f.board.answer("p1", ["s9", "autre"])).toBe(true);
    expect(await pending).toEqual({ decision: "declined" });
    expect(f.board.places()).toEqual([]);
  });

  it("ignore une réponse dont le proposalId est inconnu ou périmé", async () => {
    const f = fixture();
    expect(f.board.answer("p1", ["s1"])).toBe(false); // aucune proposition
    const pending = f.board.propose(DRAFTS);
    expect(f.board.answer("p0", ["s1"])).toBe(false);
    expect(f.board.pending()?.proposalId).toBe("p1");
    expect(f.board.answer("p1", ["s1"])).toBe(true);
    await pending;
    expect(f.board.answer("p1", ["s2"])).toBe(false); // déjà tranchée
    expect(f.board.places().map((p) => p.id)).toEqual(["s1"]);
  });

  it("un texte libre refuse avec ce texte pour note, sans proposition il ne fait rien", async () => {
    const f = fixture();
    expect(f.board.declineWithText("bonjour")).toBe(false);
    const pending = f.board.propose(DRAFTS);
    expect(f.board.declineWithText("  plutôt, scanne d'abord le port 443 ")).toBe(true);
    expect(await pending).toEqual({
      decision: "declined",
      note: "plutôt, scanne d'abord le port 443",
    });
    expect(f.board.pending()).toBeNull();
    expect(f.board.declineWithText("encore")).toBe(false);
  });

  it("borne la note de l'utilisateur", async () => {
    const f = fixture();
    const pending = f.board.propose(DRAFTS);
    f.board.declineWithText("x".repeat(SUBAGENTS_NOTE_MAX + 500));
    const outcome = await pending;
    expect(outcome.note?.length).toBe(SUBAGENTS_NOTE_MAX);
  });

  it("refuse une seconde proposition pendant la première", async () => {
    const f = fixture();
    const first = f.board.propose(DRAFTS);
    await expect(f.board.propose(DRAFTS)).rejects.toMatchObject({
      code: "subagents.pendingProposal",
    });
    // La première reste intacte.
    expect(f.board.pending()?.proposalId).toBe("p1");
    f.board.answer("p1", ["s1"]);
    expect((await first).decision).toBe("accepted");
    // Une fois tranchée, une nouvelle proposition est admise.
    const second = f.board.propose(DRAFTS);
    expect(f.board.pending()?.proposalId).toBe("p2");
    f.board.cancel();
    await second;
  });

  it("une nouvelle proposition annule les places approuvées jamais lancées", async () => {
    const f = fixture();
    await accepted(f, ["s1", "s2"]);
    expect(f.board.places()).toHaveLength(2);
    const next = f.board.propose(DRAFTS);
    expect(f.board.places()).toEqual([]);
    expect(
      f.board.admitTask({ toolUseId: "t1", input: { description: "Domaines" } }).reason.code,
    ).toBe("subagents.not_approved");
    f.board.cancel();
    await next;
  });

  it.each([
    ["aucun élément", []],
    ["cinq éléments", ["a", "b", "c", "d", "e"].map((name) => ({ name, goal: "x" }))],
    [
      "noms en double",
      [
        { name: "API", goal: "a" },
        { name: "  api ", goal: "b" },
      ],
    ],
    [
      "noms voisins (accents, casse)",
      [
        { name: "Énumération", goal: "a" },
        { name: "enumeration", goal: "b" },
      ],
    ],
    ["nom vide", [{ name: "  ", goal: "x" }]],
    ["nom trop long", [{ name: "n".repeat(61), goal: "x" }]],
    ["nom sur plusieurs lignes", [{ name: "a\nb", goal: "x" }]],
    ["objectif vide", [{ name: "API", goal: "" }]],
    ["champ inconnu", [{ name: "API", goal: "x", model: "autre" }]],
  ])("refuse une proposition invalide : %s", async (_label, items) => {
    const f = fixture();
    await expect(f.board.propose(items as never)).rejects.toMatchObject({
      code: "subagents.invalidProposal",
    });
    expect(f.board.pending()).toBeNull();
    expect(f.kinds("subagents.proposed")).toHaveLength(0);
  });

  it("l'annulation de l'appel d'outil refuse la proposition en attente", async () => {
    const f = fixture();
    const controller = new AbortController();
    const pending = f.board.propose(DRAFTS, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ decision: "declined" });
    expect(f.board.pending()).toBeNull();
    expect(f.kinds("subagents.decided")).toHaveLength(1);
    // Déjà annulé à l'entrée : refus sans aucune proposition ni événement.
    expect(await f.board.propose(DRAFTS, { signal: controller.signal })).toEqual({
      decision: "declined",
    });
    expect(f.kinds("subagents.proposed")).toHaveLength(1);
  });

  it("l'arrêt de la course refuse la proposition et ferme le tableau", async () => {
    const f = fixture();
    const pending = f.board.propose(DRAFTS);
    f.board.cancel();
    expect(await pending).toEqual({ decision: "declined" });
    expect(f.kinds("subagents.decided")[0]).toMatchObject({ decision: "declined", selected: [] });
    await expect(f.board.propose(DRAFTS)).rejects.toMatchObject({ code: "subagents.disabled" });
    f.board.cancel(); // idempotent
    expect(f.kinds("subagents.decided")).toHaveLength(1);
  });

  it("l'arrêt retire aussi les places approuvées : plus aucun Task n'est admis", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    f.board.cancel();
    expect(f.board.places()).toEqual([]);
    expect(
      f.board.admitTask({ toolUseId: "t1", input: { description: "Domaines" } }).reason.code,
    ).toBe("subagents.disabled");
  });
});

describe("tableau des sous-agents : appels Task", () => {
  const call = (toolUseId: string, description: unknown, extra: object = {}) => ({
    toolUseId,
    input: { description, prompt: "p", subagent_type: "redwidow", ...extra },
  });

  it("n'admet qu'une place approuvée, une seule fois", async () => {
    const f = fixture();
    expect(f.board.admitTask(call("t0", "Domaines")).reason.code).toBe("subagents.not_approved");
    await accepted(f, ["s1", "s2"]);
    const verdict = f.board.admitTask(call("t1", "Domaines"));
    expect(verdict).toEqual({
      decision: "allow",
      reason: { code: "subagents.approved", params: { description: "Domaines" } },
    });
    expect(f.board.running()).toBe(1);
    expect(f.board.places().map((p) => p.description)).toEqual(["Fuzzing"]);
    // Même description, autre appel : la place est consommée.
    expect(f.board.admitTask(call("t2", "Domaines")).reason.code).toBe("subagents.not_approved");
    // Description non retenue ou absente : refus, rien ne change.
    expect(f.board.admitTask(call("t3", "API")).decision).toBe("deny");
    expect(f.board.admitTask(call("t4", undefined)).reason).toEqual({
      code: "subagents.not_approved",
    });
    expect(f.board.admitTask(call("t5", 3)).decision).toBe("deny");
    expect(f.board.running()).toBe(1);
    expect(f.board.places()).toHaveLength(1);
  });

  it("compare la description à l'identique", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    for (const d of ["domaines", "Domaines ", " Domaines", "Domaine", "Domaines\n"]) {
      expect(f.board.admitTask(call("t", d)).reason.code).toBe("subagents.not_approved");
    }
    expect(f.board.admitTask(call("t", "Domaines")).decision).toBe("allow");
  });

  it("refuse un appel venu d'un sous-agent, même avec une place approuvée", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    const nested = f.board.admitTask({ ...call("t1", "Domaines"), agentId: "agent-7" });
    expect(nested).toEqual({ decision: "deny", reason: { code: "subagents.nested" } });
    // La place n'a pas été consommée.
    expect(f.board.places()).toHaveLength(1);
    expect(f.board.running()).toBe(0);
    // Un identifiant vide compte aussi : en cas de doute on refuse.
    expect(f.board.admitTask({ ...call("t2", "Domaines"), agentId: "" }).reason.code).toBe(
      "subagents.nested",
    );
  });

  it("plafonne à 4 sous-agents en cours et garde la place refusée", async () => {
    const f = fixture();
    const pending = f.board.propose([
      { name: "A", goal: "a" },
      { name: "B", goal: "b" },
      { name: "C", goal: "c" },
      { name: "D", goal: "d" },
    ]);
    f.board.answer("p1", ["s1", "s2", "s3", "s4"]);
    await pending;
    // Deuxième proposition : une cinquième place pendant que quatre tournent.
    expect(SUBAGENTS_MAX_RUNNING).toBe(4);
    for (const [i, name] of ["A", "B", "C", "D"].entries()) {
      expect(f.board.admitTask(call(`t${i}`, name)).decision).toBe("allow");
    }
    expect(f.board.running()).toBe(4);
    const next = f.board.propose([{ name: "E", goal: "e" }]);
    f.board.answer("p2", ["s1"]);
    await next;
    const refused = f.board.admitTask(call("t9", "E"));
    expect(refused).toEqual({
      decision: "deny",
      reason: { code: "subagents.limit", params: { max: 4 } },
    });
    expect(f.board.places()).toEqual([{ id: "s1", description: "E" }]);
    // La fin d'un sous-agent libère une place : E peut partir.
    expect(f.board.finish("t0")).toBe(true);
    expect(f.board.finish("t0")).toBe(false);
    expect(f.board.admitTask(call("t9", "E")).decision).toBe("allow");
    expect(f.board.running()).toBe(4);
  });

  it("un appel déjà admis soumis de nouveau garde la même place", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    expect(f.board.admitTask(call("t1", "Domaines")).decision).toBe("allow");
    expect(f.board.admitTask(call("t1", "Domaines")).decision).toBe("allow");
    expect(f.board.running()).toBe(1);
  });

  it("libère la place sur le résultat de l'outil (succès ou échec)", async () => {
    const f = fixture();
    await accepted(f, ["s1", "s2"]);
    f.board.admitTask(call("t1", "Domaines"));
    f.board.admitTask(call("t2", "Fuzzing"));
    expect(f.board.running()).toBe(2);
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "t1",
      isError: false,
      output: "ok",
      truncated: false,
      bytes: 2,
    });
    expect(f.board.running()).toBe(1);
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "t2",
      isError: true,
      output: "échec",
      truncated: false,
      bytes: 5,
    });
    expect(f.board.running()).toBe(0);
    // Le résultat d'un autre outil ne libère rien.
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "autre",
      isError: false,
      output: "",
      truncated: false,
      bytes: 0,
    });
    expect(f.board.running()).toBe(0);
  });

  it("libère la place sur task.updated terminé du même appel, pas sur les autres phases", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    f.board.admitTask(call("t1", "Domaines"));
    const emit = (phase: "started" | "progress" | "updated" | "finished", toolUseId?: string) =>
      f.recorder.emit({
        kind: "task.updated",
        taskId: "k1",
        ...(toolUseId !== undefined && { toolUseId }),
        phase,
      });
    emit("started", "t1");
    emit("progress", "t1");
    emit("updated", "t1");
    emit("finished", "autre");
    emit("finished");
    expect(f.board.running()).toBe(1);
    emit("finished", "t1");
    expect(f.board.running()).toBe(0);
  });

  it("un Task en arrière-plan garde sa place jusqu'à la fin du sous-agent", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    f.board.admitTask(call("t1", "Domaines", { run_in_background: true }));
    // Le résultat de l'outil arrive tout de suite : le sous-agent tourne encore.
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "t1",
      isError: false,
      output: "lancé",
      truncated: false,
      bytes: 5,
    });
    expect(f.board.running()).toBe(1);
    f.recorder.emit({ kind: "task.updated", taskId: "k", toolUseId: "t1", phase: "finished" });
    expect(f.board.running()).toBe(0);
  });

  it("cancel() cesse d'écouter le recorder", async () => {
    const f = fixture();
    await accepted(f, ["s1"]);
    f.board.admitTask(call("t1", "Domaines"));
    f.board.cancel();
    f.recorder.emit({
      kind: "tool.result",
      toolUseId: "t1",
      isError: false,
      output: "",
      truncated: false,
      bytes: 0,
    });
    expect(f.board.running()).toBe(1);
  });

  it("borne la description citée dans un motif de refus", () => {
    const f = fixture();
    const verdict = f.board.admitTask(call("t1", "x".repeat(5000)));
    expect(String(verdict.reason.params?.description).length).toBeLessThanOrEqual(201);
  });
});

describe("outil Task", () => {
  it("la règle ne vise que le nom canonique Task", () => {
    expect(SUBAGENT_TASK_TOOL).toBe("Task");
    expect(isSubagentTool("Task")).toBe(true);
    for (const other of ["task", "TASK", "Read", "Bash", "mcp__x__Task", "Task ", "Agent", ""])
      expect(isSubagentTool(other), other).toBe(false);
  });

  it("subagentNameKey ignore la casse, les accents et les espaces multiples", () => {
    expect(subagentNameKey("  Énumération   DNS ")).toBe(subagentNameKey("enumeration dns"));
  });
});
