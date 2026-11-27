import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createRecorder,
  createSubagentBoard,
  type EngineEvent,
  SUBAGENT_DESCRIPTION,
  SUBAGENT_PROMPT,
  type SubagentBoard,
} from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  assertSafeConfig,
  buildConfig,
  createOpencodeRunner,
  deskToolset,
  forcedPermission,
  normalizeInput,
  policyToolName,
} from "../src/index.js";
import {
  assistantMessage,
  fakeOpencode,
  harness,
  permission,
  SESSION,
  type Stage,
  toolPart,
  userMessage,
} from "./helpers.js";

const CHILD = "ses_child";
const kinds = (events: EngineEvent[]) => events.map((e) => e.kind);
const of = <K extends EngineEvent["kind"]>(events: EngineEvent[], kind: K) =>
  events.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);

const READ_TOOLS = new Set(["read", "glob", "grep"]);
const baseConfig = (extra: { subagents?: boolean; maxTurns?: number; user?: object } = {}) =>
  buildConfig({
    user: extra.user as Record<string, unknown> | undefined,
    enabledTools: READ_TOOLS,
    mcp: {},
    maxTurns: extra.maxTurns,
    ...(extra.subagents !== undefined && { subagents: extra.subagents }),
  });
const agents = (config: Record<string, unknown>) =>
  config.agent as Record<string, { permission: Record<string, unknown>; [key: string]: unknown }>;

describe("configuration OpenCode : mode « Sous-agents » (ADR 0054)", () => {
  it("mode inactif : configuration strictement identique, task refusé partout, aucun agent redwidow", () => {
    const before = baseConfig();
    expect(baseConfig({ subagents: false })).toEqual(before);
    const { build, general, plan, explore } = agents(before);
    for (const agent of [build, general, plan, explore])
      expect(agent?.permission).toMatchObject({ task: "deny" });
    expect(agents(before)).not.toHaveProperty("redwidow");
    expect(before.permission).toMatchObject({ task: "deny" });
  });

  it("mode actif : task passe à ask pour build seulement, limité au type redwidow", () => {
    const config = baseConfig({ subagents: true, maxTurns: 9 });
    const all = agents(config);
    expect(all.build?.permission.task).toEqual({ "*": "deny", redwidow: "ask" });
    expect(all.build).toMatchObject({ maxSteps: 9 });
    // Les autres agents intégrés et la permission globale restent en deny.
    for (const name of ["plan", "general", "explore"])
      expect(all[name]?.permission.task, name).toBe("deny");
    expect(config.permission).toMatchObject({ task: "deny" });
    // Le reste des permissions de build est celui du mode inactif.
    const { task: _a, ...activeRest } = all.build?.permission ?? {};
    const { task: _b, ...inactiveRest } = agents(baseConfig()).build?.permission ?? {};
    expect(activeRest).toEqual(inactiveRest);
  });

  it("mode actif : agent redwidow en mode sous-agent, mêmes permissions forcées, sans task ni orchestration", () => {
    const all = agents(baseConfig({ subagents: true, maxTurns: 9 }));
    const redwidow = all.redwidow;
    expect(redwidow).toMatchObject({
      mode: "subagent",
      description: SUBAGENT_DESCRIPTION,
      prompt: SUBAGENT_PROMPT,
      maxSteps: 9,
    });
    expect(redwidow?.permission.task).toBe("deny");
    expect(redwidow?.permission.desk_propose_subagents).toBe("deny");
    const { task: _t, desk_propose_subagents: _d, ...rest } = redwidow?.permission ?? {};
    const { task: _b, ...buildRest } = all.build?.permission ?? {};
    expect(rest).toEqual(buildRest);
    const { task: _f, ...forced } = forcedPermission(READ_TOOLS);
    expect(rest).toEqual(forced);
  });

  it("mode actif : aucun allow, la configuration reste sûre ; une définition redwidow de l'utilisateur est écartée", () => {
    const config = baseConfig({
      subagents: true,
      user: {
        agent: {
          redwidow: {
            mode: "primary",
            prompt: "autre",
            permission: { bash: "allow", task: "allow" },
          },
          perso: { permission: { bash: "allow" } },
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain('"allow"');
    expect(() => assertSafeConfig(config)).not.toThrow();
    const all = agents(config);
    expect(all.redwidow).toMatchObject({ mode: "subagent", prompt: SUBAGENT_PROMPT });
    // Un agent de l'utilisateur ne peut pas lancer de sous-agent.
    expect(all.perso?.permission.task).toBe("deny");
  });

  it("normalise l'entrée Task : description et subagent_type, avec repli sur les métadonnées", () => {
    expect(policyToolName("task")).toBe("Task");
    const input = { description: "API", prompt: "p", subagent_type: "redwidow" };
    expect(normalizeInput("Task", input)).toEqual(input);
    // Entrée de l'appel pas encore connue : la demande de permission porte les deux champs.
    expect(
      normalizeInput("Task", {}, { description: "API", subagent_type: "redwidow", autre: 1 }),
    ).toEqual({ description: "API", subagent_type: "redwidow" });
    // L'entrée de l'appel l'emporte sur les métadonnées.
    expect(
      normalizeInput("Task", { description: "A", subagent_type: "redwidow" }, { description: "B" }),
    ).toMatchObject({ description: "A" });
    // Rien de connu : aucun champ inventé (la gate refusera).
    expect(normalizeInput("Task", {})).toEqual({});
  });
});

/** Tableau réel avec les places `names` approuvées (la gate de `harness` le partage). */
async function approved(
  names: string[],
): Promise<{ board: SubagentBoard; recorder: ReturnType<typeof createRecorder> }> {
  const recorder = createRecorder({ runId: "r" });
  const board = createSubagentBoard({ recorder });
  const pending = board.propose(names.map((name) => ({ name, goal: `volet ${name}` })));
  board.answer(board.pending()?.proposalId ?? "", board.pending()?.items.map((i) => i.id) ?? []);
  await pending;
  return { board, recorder };
}

const TASK_INPUT = (description: string, type = "redwidow") => ({
  description,
  prompt: "p",
  subagent_type: type,
});

/** Partie `task` du fil principal ; `child` : session enfant annoncée dans les métadonnées de l'outil. */
const taskPart = (callID: string, input: Record<string, unknown>, state: Record<string, unknown>) =>
  toolPart(callID, "task", { input, ...state });

const childPart = (callID: string, tool: string, state: Record<string, unknown>) => ({
  ...toolPart(callID, tool, state, "msg_child"),
  sessionID: CHILD,
});

const childPermission = (id: string, perm: string, callID: string) =>
  permission(id, perm, callID, { sessionID: CHILD }, "msg_child");

const begin = (s: Stage) => {
  s.emit("message.updated", userMessage("msg_u"));
  s.emit("message.updated", assistantMessage());
};

describe("createOpencodeRunner : sous-agents (faux client)", () => {
  it("mode inactif : task reste coupé, aucun agent redwidow, aucun outil de proposition", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const fake = fakeOpencode([
      (s) => {
        begin(s);
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd });
    await h.run(
      createOpencodeRunner({ createClient: fake.createClient, toolsets: [deskToolset()] }),
    );
    expect(fake.prompts[0]?.body.tools).toMatchObject({ task: false });
    const config = fake.init().config as { agent: object; mcp: Record<string, object> };
    expect(config.agent).not.toHaveProperty("redwidow");
    expect(config.mcp.desk).not.toHaveProperty("timeout");
    expect(of(h.events, "session.started")[0]?.tools).not.toContain("task");
  });

  it("mode actif : task offert, agent redwidow défini, délai MCP du bureau levé, propose_subagents exposé", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines"]);
    let tools: string[] = [];
    const fake = fakeOpencode([
      async (s) => {
        const desk = (
          s.init.config.mcp as Record<string, { url: string; headers: Record<string, string> }>
        ).desk;
        if (!desk) throw new Error("serveur desk absent");
        const client = new Client({ name: "test", version: "1" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(desk.url), {
            requestInit: { headers: desk.headers },
          }) as Parameters<typeof client.connect>[0],
        );
        tools = (await client.listTools()).tools.map((t) => t.name);
        await client.close();
        begin(s);
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(
      createOpencodeRunner({ createClient: fake.createClient, toolsets: [deskToolset()] }),
    );
    // `task` n'est plus coupé pour la session principale ; les autres outils non activés le restent.
    expect(fake.prompts[0]?.body.tools).not.toHaveProperty("task");
    expect(fake.prompts[0]?.body.tools).toMatchObject({ bash: false, write: false });
    const config = fake.init().config as {
      agent: Record<string, unknown>;
      mcp: Record<string, { timeout?: number }>;
    };
    expect(config.agent.redwidow).toMatchObject({ mode: "subagent" });
    expect(config.mcp.desk?.timeout).toBe(24 * 60 * 60 * 1000);
    expect(tools).toContain("propose_subagents");
    expect(of(h.events, "session.started")[0]?.tools).toContain("task");
  });

  it("place approuvée : le Task passe la gate sans demande, l'entrée porte description et subagent_type, la place se libère au résultat", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines", "API"]);
    const input = TASK_INPUT("Domaines");
    let running = -1;
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", { part: taskPart("call_t", input, { status: "running" }) });
        const response = await s.ask(permission("per_t", "task", "call_t"));
        expect(response).toBe("once");
        running = board.running();
        s.emit("message.part.updated", {
          part: taskPart("call_t", input, { status: "completed", output: "synthèse" }),
        });
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    const [requested] = of(h.events, "tool.requested");
    expect(requested).toMatchObject({ toolUseId: "call_t", tool: "Task", input });
    expect(of(h.events, "approval.decided")[0]).toMatchObject({
      toolUseId: "call_t",
      decision: "allow",
      source: "policy",
      reason: { code: "subagents.approved" },
    });
    expect(of(h.events, "approval.requested")).toHaveLength(0);
    // Le `toolUseId` donné à la gate est celui du tool.requested : la place est comptée puis libérée.
    expect(running).toBe(1);
    expect(board.running()).toBe(0);
    expect(board.places().map((p) => p.description)).toEqual(["API"]);
    expect(fake.replies).toEqual([{ id: "per_t", response: "once" }]);
  });

  it("entrée absente du flux : la gate reçoit description et subagent_type des métadonnées de la permission", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines"]);
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        // Partie sans entrée connue ; la demande de permission porte les métadonnées de l'outil.
        s.emit("message.part.updated", { part: taskPart("call_t", {}, { status: "running" }) });
        const response = await s.ask(
          permission("per_t", "task", "call_t", {
            metadata: { description: "Domaines", subagent_type: "redwidow" },
          }),
        );
        expect(response).toBe("once");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(of(h.events, "approval.decided")[0]).toMatchObject({
      decision: "allow",
      reason: { code: "subagents.approved" },
    });
    expect(board.running()).toBe(1);
  });

  it.each([
    ["autre type de sous-agent", TASK_INPUT("Domaines", "general")],
    ["type absent", { description: "Domaines", prompt: "p" }],
    ["description non approuvée", TASK_INPUT("Inconnue")],
  ])("refuse le Task (%s) sans consommer la place", async (_label, input) => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines"]);
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", { part: taskPart("call_t", input, { status: "running" }) });
        expect(await s.ask(permission("per_t", "task", "call_t"))).toBe("reject");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(of(h.events, "approval.decided")[0]).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.not_approved" },
    });
    expect(board.places()).toHaveLength(1);
    expect(board.running()).toBe(0);
  });

  it("mode inactif : le Task d'une configuration étrangère est refusé (subagents.disabled)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", {
          part: taskPart("call_t", TASK_INPUT("Domaines"), { status: "running" }),
        });
        expect(await s.ask(permission("per_t", "task", "call_t"))).toBe("reject");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    expect(of(h.events, "approval.decided")[0]).toMatchObject({
      decision: "deny",
      reason: { code: "subagents.disabled" },
    });
  });

  it("session enfant : les appels portent agentId et agentToolUseId, imbriqués sous le Task, et la gate reçoit agentId", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines"]);
    const input = TASK_INPUT("Domaines");
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", { part: taskPart("call_t", input, { status: "running" }) });
        expect(await s.ask(permission("per_t", "task", "call_t"))).toBe("once");
        // OpenCode annonce la session enfant dans les métadonnées de l'outil, puis la crée.
        s.emit("session.created", { info: { id: CHILD, parentID: SESSION } });
        s.emit("message.part.updated", {
          part: taskPart("call_t", input, { status: "running", metadata: { sessionId: CHILD } }),
        });
        s.emit("message.updated", {
          info: { id: "msg_child", sessionID: CHILD, role: "assistant", cost: 0 },
        });
        // Appel d'un outil du sous-agent : lecture, passe par la permission de la session enfant.
        const read = { filePath: join(cwd, "a.txt") };
        s.emit("message.part.updated", {
          part: childPart("child_r", "read", { status: "running", input: read }),
        });
        expect(await s.ask(childPermission("per_r", "read", "child_r"))).toBe("once");
        s.emit("message.part.updated", {
          part: childPart("child_r", "read", { status: "completed", input: read, output: "x" }),
        });
        s.emit("message.part.updated", {
          part: taskPart("call_t", input, { status: "completed", output: "fin" }),
        });
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    const requested = of(h.events, "tool.requested");
    const task = requested.find((e) => e.toolUseId === "call_t");
    const read = requested.find((e) => e.toolUseId === "child_r");
    expect(task).toBeDefined();
    expect(task).not.toHaveProperty("agentId");
    expect(task).not.toHaveProperty("agentToolUseId");
    expect(read).toMatchObject({
      tool: "Read",
      agentId: CHILD,
      agentToolUseId: "call_t",
      parentId: task?.id,
    });
    // Le résultat de l'appel de l'enfant s'imbrique sous son tool.requested.
    expect(of(h.events, "tool.result").find((e) => e.toolUseId === "child_r")?.parentId).toBe(
      read?.id,
    );
    expect(board.running()).toBe(0);
    // Pas d'agent principal étiqueté : seul le sous-agent porte agentId.
    expect(requested.filter((e) => e.agentId !== undefined)).toHaveLength(1);
  });

  it("session enfant : un task lancé par un sous-agent est refusé (pas d'imbrication), place intacte", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["Domaines", "API"]);
    const input = TASK_INPUT("Domaines");
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.part.updated", { part: taskPart("call_t", input, { status: "running" }) });
        expect(await s.ask(permission("per_t", "task", "call_t"))).toBe("once");
        s.emit("session.created", { info: { id: CHILD, parentID: SESSION } });
        s.emit("message.part.updated", {
          part: taskPart("call_t", input, { status: "running", metadata: { sessionId: CHILD } }),
        });
        s.emit("message.updated", {
          info: { id: "msg_child", sessionID: CHILD, role: "assistant", cost: 0 },
        });
        const nested = TASK_INPUT("API");
        s.emit("message.part.updated", {
          part: childPart("child_t", "task", { status: "running", input: nested }),
        });
        expect(await s.ask(childPermission("per_n", "task", "child_t"))).toBe("reject");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    const decided = of(h.events, "approval.decided").find((e) => e.toolUseId === "child_t");
    expect(decided).toMatchObject({ decision: "deny", reason: { code: "subagents.nested" } });
    expect(of(h.events, "tool.requested").find((e) => e.toolUseId === "child_t")).toMatchObject({
      agentId: CHILD,
      agentToolUseId: "call_t",
    });
    expect(board.running()).toBe(1);
    expect(board.places().map((p) => p.description)).toEqual(["API"]);
  });

  it("session enfant inconnue (task non annoncé) : agentId défini quand même, sans agentToolUseId", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["API"]);
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        s.emit("message.updated", {
          info: { id: "msg_child", sessionID: CHILD, role: "assistant", cost: 0 },
        });
        // Aucune métadonnée de task vue : la session n'est reliée à aucun Task.
        s.emit("message.part.updated", {
          part: childPart("child_t", "task", { status: "running", input: TASK_INPUT("API") }),
        });
        expect(await s.ask(childPermission("per_n", "task", "child_t"))).toBe("reject");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    const requested = of(h.events, "tool.requested").find((e) => e.toolUseId === "child_t");
    expect(requested).toMatchObject({ agentId: CHILD });
    expect(requested).not.toHaveProperty("agentToolUseId");
    expect(requested?.parentId).toBe(of(h.events, "run.started")[0]?.id);
    expect(of(h.events, "approval.decided")[0]).toMatchObject({
      reason: { code: "subagents.nested" },
    });
    expect(board.running()).toBe(0);
  });

  it("fil principal : aucun agentId, même avec le mode actif", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oc-sub-"));
    const { board, recorder } = await approved(["API"]);
    const fake = fakeOpencode([
      async (s) => {
        begin(s);
        const read = { filePath: join(cwd, "a.txt") };
        s.emit("message.part.updated", {
          part: toolPart("call_r", "read", { status: "running", input: read }),
        });
        expect(await s.ask(permission("per_r", "read", "call_r"))).toBe("once");
        s.idle();
      },
    ]);
    const h = harness({ workspace: cwd, recorder, subagents: board });
    await h.run(createOpencodeRunner({ createClient: fake.createClient }));
    const [requested] = of(h.events, "tool.requested");
    expect(requested).not.toHaveProperty("agentId");
    expect(requested).not.toHaveProperty("agentToolUseId");
    expect(kinds(h.events)).toContain("approval.decided");
  });
});
