import type { AgentPrompt, EngineEvent, MissionDesk, RunContext } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createOpencodeRunner, deskToolset, type OpencodeToolset } from "../src/index.js";
import {
  assistantMessage,
  fakeOpencode,
  harness,
  SESSION,
  type Stage,
  toolPart,
  userMessage,
} from "./helpers.js";

const of = <K extends EngineEvent["kind"]>(events: EngineEvent[], kind: K) =>
  events.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);

const cell = { surface: "/login", parameter: "user", testClass: "sqli" };

/** Runner avec bureau de mission ; `desk()` donne le bureau du run (créé au démarrage du run). */
function setup() {
  let current: MissionDesk | undefined;
  const base = deskToolset();
  const set: OpencodeToolset = {
    ...base,
    create(ctx) {
      current = ctx.missionDesk;
      return base.create(ctx);
    },
  };
  return {
    desk: () => current as MissionDesk,
    runner: (
      createClient: Parameters<typeof createOpencodeRunner>[0] extends infer O
        ? O extends { createClient?: infer C }
          ? C
          : never
        : never,
    ) => createOpencodeRunner({ processEnv: {}, toolsets: [set], createClient }),
  };
}

/** Tour normal : message utilisateur, message assistant, fin de tour. */
const normalTurn = (s: Stage, i: number) => {
  s.emit("message.updated", userMessage(`u${i}`));
  s.emit("message.updated", assistantMessage(`a${i}`));
  s.idle();
};

const toolTurn = (s: Stage, i: number) => {
  s.emit("message.part.updated", {
    part: toolPart(`call${i}`, "read", { status: "running", input: {} }, `a${i}`),
  });
  normalTurn(s, i);
};

/** Referme toutes les pistes : un test observé, puis la case marquée `negative` avec sa référence. */
function closeLeads(h: ReturnType<typeof harness>, desk: MissionDesk, toolUseId = "close"): void {
  h.recorder.emit({ kind: "tool.requested", toolUseId, tool: "Read", input: {} });
  const evidence = h.recorder.emit({
    kind: "tool.result",
    toolUseId,
    output: "rien",
    bytes: 4,
    truncated: false,
    isError: false,
  });
  const test = desk.recordTest({
    objective: "Tester le login",
    target: "lab",
    testContext: "",
    method: "curl",
    observed: "rien",
    conclusion: "not-observed",
    evidenceIds: [evidence.id],
  });
  desk.recordCoverage([{ ...cell, state: "negative", testRefs: [test.eventId] }]);
}

/** Suffisamment de scripts pour que le faux client ne reste jamais sans réponse. */
const scripts = (
  count: number,
  first: (s: Stage) => void,
  rest: (s: Stage, i: number) => void = normalTurn,
) => Array.from({ length: count }, (_, i) => (s: Stage) => (i === 0 ? first(s) : rest(s, i)));

// La continuation issue d’une matrice obligatoire appartient au profil Bug bounty.
const relentless: Partial<RunContext> = {
  supervision: "relentless",
  mission: { profile: "bug-bounty", containers: ["laboratoire"] },
};

describe("continuation automatique (OpenCode)", () => {
  it.each(["out-of-box", "htb"])(
    "%s : une matrice facultative ne force pas un nouveau tour",
    async (profile) => {
      const h = harness();
      const t = setup();
      const fake = fakeOpencode([
        (stage) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          toolTurn(stage, 0);
        },
      ]);
      const summary = await h.run(t.runner(fake.createClient), {}, undefined, {
        ...relentless,
        mission: { profile, containers: ["laboratoire"] },
      });
      expect(summary).toMatchObject({ status: "success", turns: 1 });
      expect(of(h.events, "continuation.auto")).toHaveLength(0);
    },
  );

  it("ré-amorce un tour après fin normale jusqu'à maxAutoContinues, puis s'arrête", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(
        30,
        (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          toolTurn(s, 0);
        },
        toolTurn,
      ),
    );
    const seenPrompts: string[] = [];
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, {
      ...relentless,
      onMissionContext: (snapshot) => seenPrompts.push(snapshot.prompt),
    });
    expect(summary).toMatchObject({ status: "success", turns: 21 });
    expect(fake.prompts).toHaveLength(21);
    const events = of(h.events, "continuation.auto");
    expect(events).toHaveLength(20);
    expect(events.map((e) => e.count)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(events[0]).toMatchObject({ max: 20, openLeads: 1 });
    expect(fake.prompts[0]?.body.text).not.toContain("Continuation automatique");
    const second = fake.prompts[1]?.body.text ?? "";
    expect(second).toContain("Continuation automatique : 1 piste(s) ouverte(s)");
    expect(second).toContain("/login / user / sqli");
    expect(second).toContain("<mission_context>");
    // La consigne de mission d'origine n'est pas remplacée par la relance.
    expect(new Set(seenPrompts)).toEqual(new Set(["go"]));
  });

  it("arrête après deux tours sans outil et journalise le motif", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(5, (s) => {
        t.desk().recordCoverage([{ ...cell, state: "untested" }]);
        normalTurn(s, 0);
      }),
    );
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(summary.turns).toBe(2);
    expect(of(h.events, "continuation.auto")).toHaveLength(1);
    expect(of(h.events, "continuation.stalled")).toHaveLength(1);
  });

  it("un appel d'outil remet à zéro les tours sans outil", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(
        6,
        (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          normalTurn(s, 0);
        },
        (s, i) => {
          if (i === 1) toolTurn(s, i);
          else normalTurn(s, i);
        },
      ),
    );
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(summary.turns).toBe(4);
    expect(of(h.events, "continuation.auto")).toHaveLength(3);
    expect(of(h.events, "continuation.stalled")).toHaveLength(1);
  });

  it("ne compte pas le rejeu d'un outil déjà terminé", async () => {
    const t = setup();
    const h = harness();
    const completed = toolPart(
      "ancien",
      "read",
      { status: "completed", input: {}, output: "ok" },
      "a0",
    );
    const fake = fakeOpencode(
      scripts(
        6,
        (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          s.emit("message.part.updated", { part: completed });
          normalTurn(s, 0);
        },
        (s, i) => {
          s.emit("message.part.updated", { part: completed });
          normalTurn(s, i);
        },
      ),
    );
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(summary.turns).toBe(3);
    expect(of(h.events, "continuation.auto")).toHaveLength(2);
    expect(of(h.events, "continuation.stalled")).toHaveLength(1);
  });

  it("attend un humain lorsque seul un prérequis subsiste", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(3, (s) => {
        t.desk().recordCoverage([{ ...cell, state: "prerequisite", note: "Compte requis" }]);
        normalTurn(s, 0);
      }),
    );
    await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(of(h.events, "continuation.auto")).toHaveLength(0);
    expect(of(h.events, "continuation.waitingHuman")).toMatchObject([{ openLeads: 1 }]);
  });

  it("s'arrête dès qu'aucune piste n'est ouverte", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(
        5,
        (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          normalTurn(s, 0);
        },
        (s, i) => {
          if (i === 1) closeLeads(h, t.desk());
          normalTurn(s, i);
        },
      ),
    );
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(summary).toMatchObject({ status: "success", turns: 2 });
    expect(of(h.events, "continuation.auto")).toHaveLength(1);
  });

  it("ne ré-amorce pas sans autoContinue (standard, par défaut)", async () => {
    for (const context of [
      {},
      { supervision: "standard" as const },
      { supervision: "strict" as const },
    ]) {
      const t = setup();
      const h = harness();
      const fake = fakeOpencode(
        scripts(3, (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          normalTurn(s, 0);
        }),
      );
      const summary = await h.run(t.runner(fake.createClient), {}, undefined, context);
      expect(summary.turns).toBe(1);
      expect(fake.prompts).toHaveLength(1);
      expect(of(h.events, "continuation.auto")).toHaveLength(0);
    }
  });

  it("ne ré-amorce pas sans bureau de mission", async () => {
    const h = harness();
    const fake = fakeOpencode(scripts(3, (s) => normalTurn(s, 0)));
    const summary = await h.run(
      createOpencodeRunner({ processEnv: {}, createClient: fake.createClient }),
      {},
      undefined,
      relentless,
    );
    expect(summary.turns).toBe(1);
  });

  it("ne ré-amorce pas après une erreur fournisseur", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(3, (s) => {
        t.desk().recordCoverage([{ ...cell, state: "untested" }]);
        s.emit("message.updated", userMessage("u0"));
        s.emit("message.updated", assistantMessage("a0"));
        s.emit("session.error", {
          sessionID: SESSION,
          error: { name: "APIError", data: { message: "quota", statusCode: 429 } },
        });
        s.idle();
      }),
    );
    const summary = await h.run(t.runner(fake.createClient), {}, undefined, relentless);
    expect(summary).toMatchObject({ status: "error", turns: 1 });
    expect(fake.prompts).toHaveLength(1);
    expect(of(h.events, "continuation.auto")).toHaveLength(0);
  });

  it("ne ré-amorce pas après une annulation", async () => {
    const t = setup();
    const h = harness();
    const abort = new AbortController();
    const fake = fakeOpencode(
      scripts(3, (s) => {
        t.desk().recordCoverage([{ ...cell, state: "untested" }]);
        s.emit("message.updated", userMessage("u0"));
        s.emit("message.updated", assistantMessage("a0"));
        abort.abort();
        s.idle();
      }),
    );
    await h.run(t.runner(fake.createClient), {}, abort.signal, relentless);
    expect(fake.prompts).toHaveLength(1);
    expect(of(h.events, "continuation.auto")).toHaveLength(0);
  });

  it("ne ré-amorce pas sous arrêt d'urgence d'engagement (ni s'il est illisible)", async () => {
    const unreadable = () => {
      throw new Error("illisible");
    };
    for (const halted of [() => true, unreadable]) {
      const t = setup();
      const h = harness();
      const fake = fakeOpencode(
        scripts(3, (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          normalTurn(s, 0);
        }),
      );
      const summary = await h.run(t.runner(fake.createClient), {}, undefined, {
        ...relentless,
        halted,
      });
      expect(summary.turns).toBe(1);
      expect(fake.prompts).toHaveLength(1);
      expect(of(h.events, "continuation.auto")).toHaveLength(0);
    }
  });

  it("respecte maxTurns", async () => {
    const t = setup();
    const h = harness();
    const fake = fakeOpencode(
      scripts(
        10,
        (s) => {
          t.desk().recordCoverage([{ ...cell, state: "untested" }]);
          toolTurn(s, 0);
        },
        toolTurn,
      ),
    );
    const summary = await h.run(
      t.runner(fake.createClient),
      { maxTurns: 3 },
      undefined,
      relentless,
    );
    expect(summary.turns).toBe(3);
  });

  it("un message humain en attente passe avant la continuation et remet le compteur à zéro", async () => {
    const t = setup();
    const h = harness();
    let human: (prompt: AgentPrompt) => void = () => undefined;
    const typed = new Promise<AgentPrompt>((resolve) => {
      human = resolve;
    });
    async function* source(): AsyncGenerator<AgentPrompt> {
      yield "go";
      yield await typed;
    }
    const fake = fakeOpencode([
      (s) => {
        t.desk().recordCoverage([{ ...cell, state: "untested" }]);
        normalTurn(s, 0);
      },
      (s) => {
        // Le message humain arrive pendant la première relance automatique.
        human("changement de cap");
        normalTurn(s, 1);
      },
      (s) => {
        closeLeads(h, t.desk());
        normalTurn(s, 2);
      },
    ]);
    const summary = await h.run(
      t.runner(fake.createClient),
      { prompt: source() },
      undefined,
      relentless,
    );
    expect(summary.turns).toBe(3);
    expect(fake.prompts[1]?.body.text).toContain("Continuation automatique");
    expect(fake.prompts[2]?.body.text).toContain("changement de cap");
    expect(fake.prompts[2]?.body.text).not.toContain("Continuation automatique");
    expect(of(h.events, "continuation.auto")).toHaveLength(1);
  });
});
