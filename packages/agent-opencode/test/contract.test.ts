/**
 * Test de contrat avec le VRAI binaire OpenCode, sans clé API : un faux
 * fournisseur OpenAI-compatible local répond d'abord par des appels d'outils,
 * puis par un texte. Désactivé sans `OPENCODE_BIN` (chemin du binaire).
 *   OPENCODE_BIN=/chemin/vers/opencode pnpm vitest run packages/agent-opencode/test/contract
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_METHODOLOGY,
  createRecorder,
  createSubagentBoard,
  type EngineEvent,
} from "@warband/core";
import { afterAll, describe, expect, it } from "vitest";
import { createOpencodeRunner, dockerToolset } from "../src/index.js";
import { fakeDocker, harness } from "./helpers.js";

const BIN = process.env.OPENCODE_BIN;

// Chemin sensible propre à la plateforme (le test POSIX vise /etc/shadow).
const sensitivePath =
  process.platform === "win32" ? join(homedir(), ".ssh", "id_rsa") : "/etc/shadow";

interface Plan {
  name: string;
  args: Record<string, unknown>;
}

/** Mesures du faux fournisseur sur les requêtes des sous-agents (celles dont les outils n'incluent pas `task`). */
interface ProviderStats {
  /** Requêtes de sous-agent simultanément en cours, au maximum. */
  maxChildConcurrency: number;
}

/**
 * Faux fournisseur : 1re réponse = appels d'outils du plan, ensuite texte final. `childPlan` : première
 * réponse de chaque sous-agent (requête avec outils mais sans `task`), après `childDelayMs`.
 */
function fakeProvider(
  plan: Plan[],
  options: { childPlan?: Plan[]; childDelayMs?: number } = {},
): Promise<{ server: Server; port: number; bodies: unknown[]; stats: ProviderStats }> {
  const bodies: unknown[] = [];
  const stats: ProviderStats = { maxChildConcurrency: 0 };
  let childActive = 0;
  let childCalls = 0;
  let planIssued = false;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", async () => {
      const body = JSON.parse(raw || "{}") as {
        messages?: { role: string }[];
        tools?: { function?: { name?: string } }[];
      };
      bodies.push(body);
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const toolsAnswered = (body.messages ?? []).some((m) => m.role === "tool");
      const isChild =
        planIssued &&
        (body.tools?.length ?? 0) > 0 &&
        !body.tools?.some((t) => t.function?.name === "task");
      let calls: Plan[] = [];
      if (isChild) {
        childActive++;
        stats.maxChildConcurrency = Math.max(stats.maxChildConcurrency, childActive);
        if (options.childDelayMs) await new Promise((r) => setTimeout(r, options.childDelayMs));
        childActive--;
        if (!toolsAnswered && options.childPlan) calls = options.childPlan;
      } else if (
        (body.tools?.length ?? 0) > 0 &&
        !toolsAnswered &&
        plan.length > 0 &&
        !planIssued
      ) {
        planIssued = true;
        calls = plan;
      }
      if (calls.length > 0) {
        const tag = isChild ? `child${++childCalls}` : "call";
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: null,
                tool_calls: calls.map((p, i) => ({
                  index: i,
                  id: `${tag}_${i}`,
                  type: "function",
                  function: { name: p.name, arguments: JSON.stringify(p.args) },
                })),
              },
              finish_reason: null,
            },
          ],
        });
        send({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      } else {
        send({
          ...base,
          choices: [
            { index: 0, delta: { role: "assistant", content: "terminé" }, finish_reason: null },
          ],
        });
        send({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
        });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: (server.address() as AddressInfo).port, bodies, stats }),
    ),
  );
}

const servers: Server[] = [];
afterAll(() => {
  for (const s of servers) s.close();
});

/** Joue un plan d'appels d'outils contre le vrai binaire et renvoie le journal. */
async function playPlan(
  plan: Plan[],
  extra: {
    cwd?: string;
    isolate?: boolean;
    /** Mode « Sous-agents » actif : descriptions des places approuvées (ADR 0054). */
    subagents?: string[];
    childPlan?: Plan[];
    childDelayMs?: number;
  } = {},
) {
  const cwd = extra.cwd ?? mkdtempSync(join(tmpdir(), "oc-contract-"));
  writeFileSync(join(cwd, "a.txt"), "bonjour");
  const home = mkdtempSync(join(tmpdir(), "oc-contract-home-"));
  for (const d of [".config", ".local/share", ".cache", ".local/state"]) {
    mkdirSync(join(home, d), { recursive: true });
  }
  const personal = join(home, ".config", "opencode", "opencode.json");
  const auth = join(home, ".local/share/opencode/auth.json");
  const globalConfig = JSON.stringify({
    agent: { personnel: { permission: { bash: "allow" } } },
    plugin: ["./plugin-personnel.mjs"],
  });
  if (extra.isolate) {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".local/share/opencode"), { recursive: true });
    writeFileSync(personal, globalConfig);
    writeFileSync(auth, '{"opencode":{"type":"api","key":"test-only"}}');
    writeFileSync(
      join(home, ".config/opencode/plugin-personnel.mjs"),
      `throw new Error("Le plugin personnel ne doit pas être chargé");`,
    );
  }
  const docker = await fakeDocker();
  const provider = await fakeProvider(plan, {
    ...(extra.childPlan && { childPlan: extra.childPlan }),
    ...(extra.childDelayMs && { childDelayMs: extra.childDelayMs }),
  });
  servers.push(provider.server);
  const recorder = createRecorder({ runId: "r" });
  const board = extra.subagents ? createSubagentBoard({ recorder }) : undefined;
  if (board && extra.subagents) {
    // Proposition acceptée en entier, comme le ferait la carte de l'utilisateur.
    const accepted = board.propose(
      extra.subagents.map((name) => ({ name, goal: `volet ${name}` })),
    );
    board.answer(board.pending()?.proposalId ?? "", board.pending()?.items.map((i) => i.id) ?? []);
    await accepted;
  }
  const h = harness({ workspace: cwd, recorder, ...(board && { subagents: board }) });
  const runner = createOpencodeRunner({
    binary: BIN as string,
    ...(extra.isolate && { isolateConfig: true }),
    toolsets: [dockerToolset({ binary: docker.bin, argsPrefix: docker.argsPrefix })],
    builtinTools: ["read", "write", "glob", "grep"],
    config: {
      provider: {
        fake: {
          npm: "@ai-sdk/openai-compatible",
          name: "fake",
          options: { baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "x" },
          models: { m: { name: "m", tool_call: true, limit: { context: 100000, output: 4000 } } },
        },
      },
    },
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"),
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    },
  });
  if (extra.isolate) {
    const models = await runner.listModels?.({ cwd });
    expect(models?.some((model) => model.value === "fake/m")).toBe(true);
  }
  const summary = await h.run(runner, { cwd, model: "fake/m" });
  if (extra.isolate) {
    expect(readFileSync(personal, "utf8")).toBe(globalConfig);
    expect(readFileSync(auth, "utf8")).toBe('{"opencode":{"type":"api","key":"test-only"}}');
  }
  const ev = <K extends EngineEvent["kind"]>(kind: K) =>
    h.events.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);
  return { summary, ev, cwd, docker, provider, events: h.events, board };
}

describe.skipIf(!BIN)("contrat OpenCode réel (faux fournisseur local)", () => {
  it("isole le catalogue et la conversation des plugins et agents globaux sans modifier auth", async () => {
    const r = await playPlan([], { isolate: true });
    expect(r.summary).toMatchObject({ status: "success", result: "terminé" });
  }, 90_000);
  it("transmet le skill complet une seule fois au parent et au sous-agent redwidow", async () => {
    const childPrompt = "Contrôle local de la méthode : réponds terminé.";
    const r = await playPlan(
      [
        {
          name: "task",
          args: {
            description: "Vérifier le contexte",
            prompt: childPrompt,
            subagent_type: "redwidow",
          },
        },
      ],
      { subagents: ["Vérifier le contexte"] },
    );
    expect(r.summary.status).toBe("success");
    expect(r.ev("tool.requested").some((e) => e.tool === "Task")).toBe(true);
    const bodies = r.provider.bodies as {
      messages: { role: string; content: unknown }[];
      tools?: unknown[];
    }[];
    // OpenCode génère aussi des titres : ces appels sans outils ne sont pas des agents de mission.
    const agentBodies = bodies.filter((body) => (body.tools?.length ?? 0) > 0);
    const child = agentBodies.find((body) =>
      body.messages.some(
        (m) => m.role === "user" && JSON.stringify(m.content).includes(childPrompt),
      ),
    );
    expect(child).toBeDefined();
    for (const body of [agentBodies[0], child]) {
      const system =
        body?.messages
          .filter((m) => m.role === "system")
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n") ?? "";
      expect(system).toContain(AGENT_METHODOLOGY);
      expect(system.split(AGENT_METHODOLOGY)).toHaveLength(2);
    }
  }, 90_000);

  it("sous-agents : deux task d'un même message tournent en parallèle, leurs appels portent agentId et agentToolUseId", async () => {
    const task = (description: string): Plan => ({
      name: "task",
      args: { description, prompt: `Volet ${description}`, subagent_type: "redwidow" },
    });
    const r = await playPlan([task("Domaines"), task("API")], {
      subagents: ["Domaines", "API"],
      childPlan: [{ name: "read", args: { filePath: "a.txt" } }],
      childDelayMs: 700,
    });
    expect(r.summary).toMatchObject({ status: "success", result: "terminé" });
    // OpenCode exécute les deux task en même temps (constat sur 1.19.0).
    expect(r.provider.stats.maxChildConcurrency).toBeGreaterThanOrEqual(2);
    const requested = r.ev("tool.requested");
    const tasks = requested.filter((e) => e.tool === "Task");
    expect(tasks.map((e) => e.toolUseId).sort()).toEqual(["call_0", "call_1"]);
    expect(
      r.ev("approval.decided").filter((d) => tasks.some((t) => t.toolUseId === d.toolUseId)),
    ).toEqual([
      expect.objectContaining({
        decision: "allow",
        reason: expect.objectContaining({ code: "subagents.approved" }),
      }),
      expect.objectContaining({
        decision: "allow",
        reason: expect.objectContaining({ code: "subagents.approved" }),
      }),
    ]);
    // Les lectures des sous-agents s'imbriquent sous leur Task, avec l'identifiant de la session enfant.
    const reads = requested.filter((e) => e.tool === "Read");
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      const parent = tasks.find((t) => t.toolUseId === read.agentToolUseId);
      expect(parent).toBeDefined();
      expect(read.parentId).toBe(parent?.id);
      expect(read.agentId).toMatch(/^ses_/);
    }
    expect(new Set(reads.map((e) => e.agentId)).size).toBe(2);
    expect(new Set(reads.map((e) => e.agentToolUseId)).size).toBe(2);
    // Les places sont libérées par les résultats des Task.
    expect(r.board?.running()).toBe(0);
    expect(r.board?.places()).toEqual([]);
  }, 90_000);

  it("sous-agents : un type autre que redwidow n'est jamais lancé", async () => {
    const r = await playPlan(
      [
        {
          name: "task",
          args: { description: "Domaines", prompt: "CHILD-GENERAL", subagent_type: "general" },
        },
      ],
      { subagents: ["Domaines"] },
    );
    // Aucun sous-agent n'a reçu le prompt (il n'apparaît que dans l'appel d'outil du fil principal).
    const bodies = r.provider.bodies as { messages: { role: string; content: unknown }[] }[];
    expect(
      bodies.some((b) =>
        b.messages.some(
          (m) => m.role === "user" && JSON.stringify(m.content).includes("CHILD-GENERAL"),
        ),
      ),
    ).toBe(false);
    expect(r.ev("approval.decided").some((d) => d.reason.code === "subagents.approved")).toBe(
      false,
    );
    // La place reste intacte pour un lancement correct.
    expect(r.board?.running()).toBe(0);
    expect(r.board?.places().map((p) => p.description)).toEqual(["Domaines"]);
  }, 90_000);

  it("autorise les appels permis par la politique (natif + MCP) et corrèle les processus", async () => {
    const r = await playPlan([
      { name: "read", args: { filePath: "a.txt" } },
      { name: "docker_ps", args: {} },
    ]);
    expect(r.summary).toMatchObject({ status: "success", result: "terminé" });
    expect(r.ev("approval.decided").map((d) => d.decision)).toEqual(["allow", "allow"]);
    expect(
      r
        .ev("tool.requested")
        .map((t) => t.tool)
        .sort(),
    ).toEqual(["Read", "mcp__docker__ps"]);
    expect(await r.docker.calls()).toEqual(["ps|--format|{{json .}}|"]);
    expect(r.ev("process.started")).toHaveLength(1);
    expect(r.ev("process.started")[0]?.correlation).toBe("inferred");
    expect(r.ev("tool.result").some((t) => t.output.includes("web"))).toBe(true);
    // Les outils non activés ne sont pas proposés au modèle.
    const withTools = r.provider.bodies.find(
      (b) => ((b as { tools?: unknown[] }).tools?.length ?? 0) > 0,
    );
    const offered = (withTools as { tools: { function: { name: string } }[] }).tools.map(
      (t) => t.function.name,
    );
    expect(offered).toContain("docker_ps");
    expect(offered).not.toContain("bash");
    expect(offered).not.toContain("webfetch");
    expect(r.ev("session.started")[0]?.model).toBe("fake/m");
  }, 90_000);

  it.each([
    ["chemin sensible", [{ name: "read", args: { filePath: sensitivePath } }], "path.sensitive"],
    [
      "ask sans approbateur",
      [{ name: "write", args: { filePath: "nouveau.txt", content: "x" } }],
      "approval.noAsker",
    ],
    [
      "deny de la politique (MCP)",
      [{ name: "docker_rm", args: { container: "web" } }],
      "policy.rule.custom",
    ],
  ] as [string, Plan[], string][])(
    "refuse : %s",
    async (_label, plan, code) => {
      const r = await playPlan(plan);
      if (process.env.DEBUG_EVENTS) console.log(JSON.stringify(r.events));
      const decided = r.ev("approval.decided");
      expect(decided).toHaveLength(1);
      expect(decided[0]).toMatchObject({ decision: "deny" });
      expect(decided[0]?.reason.code).toBe(code);
      expect(readFileSafe(join(r.cwd, "nouveau.txt"))).toBeNull();
      expect(await r.docker.calls()).toEqual([]);
      expect(r.ev("tool.result")[0]?.isError).toBe(true);
      // Constat sur 1.19.0 : un refus interrompt le tour (pas de nouvelle réponse du modèle).
      expect(r.summary.result).toBeNull();
    },
    90_000,
  );

  it("refuse de démarrer avec une configuration utilisateur laxiste côté agent", async () => {
    // Une configuration globale `agent.build.permission.bash = allow` est neutralisée par la config imposée.
    const cwd = mkdtempSync(join(tmpdir(), "oc-contract2-"));
    const home = mkdtempSync(join(tmpdir(), "oc-contract2-home-"));
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ agent: { build: { permission: { bash: "allow" } } } }),
    );
    const provider = await fakeProvider([
      { name: "bash", args: { command: "echo pwn > pwn.txt", description: "x" } },
    ]);
    servers.push(provider.server);
    const h = harness({ workspace: cwd });
    const runner = createOpencodeRunner({
      binary: BIN as string,
      bash: true,
      config: {
        provider: {
          fake: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "x" },
            models: { m: { name: "m", tool_call: true, limit: { context: 100000, output: 4000 } } },
          },
        },
      },
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local/share"),
        XDG_CACHE_HOME: join(home, ".cache"),
        OPENCODE_DISABLE_MODELS_FETCH: "1",
      },
    });
    await h.run(runner, { cwd, model: "fake/m" });
    // La commande est soumise à la gate (ask → refusé sans approbateur) et n'a rien exécuté.
    expect(readFileSafe(join(cwd, "pwn.txt"))).toBeNull();
    expect(h.events.filter((e) => e.kind === "approval.decided")).toHaveLength(1);
  }, 90_000);
});

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
