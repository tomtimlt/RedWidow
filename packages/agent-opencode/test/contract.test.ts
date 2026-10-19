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
import type { EngineEvent } from "@warband/core";
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

/** Faux fournisseur : 1re réponse = appels d'outils du plan, ensuite texte final. */
function fakeProvider(plan: Plan[]): Promise<{ server: Server; port: number; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { messages?: { role: string }[]; tools?: unknown[] };
      bodies.push(body);
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const toolsAnswered = (body.messages ?? []).some((m) => m.role === "tool");
      if ((body.tools?.length ?? 0) > 0 && !toolsAnswered && plan.length > 0) {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: null,
                tool_calls: plan.map((p, i) => ({
                  index: i,
                  id: `call_${i}`,
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
      resolve({ server, port: (server.address() as AddressInfo).port, bodies }),
    ),
  );
}

const servers: Server[] = [];
afterAll(() => {
  for (const s of servers) s.close();
});

/** Joue un plan d'appels d'outils contre le vrai binaire et renvoie le journal. */
async function playPlan(plan: Plan[], extra: { cwd?: string } = {}) {
  const cwd = extra.cwd ?? mkdtempSync(join(tmpdir(), "oc-contract-"));
  writeFileSync(join(cwd, "a.txt"), "bonjour");
  const home = mkdtempSync(join(tmpdir(), "oc-contract-home-"));
  for (const d of [".config", ".local/share", ".cache", ".local/state"]) {
    mkdirSync(join(home, d), { recursive: true });
  }
  const docker = await fakeDocker();
  const provider = await fakeProvider(plan);
  servers.push(provider.server);
  const h = harness({ workspace: cwd });
  const runner = createOpencodeRunner({
    binary: BIN as string,
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
  const summary = await h.run(runner, { cwd, model: "fake/m" });
  const ev = <K extends EngineEvent["kind"]>(kind: K) =>
    h.events.filter((e): e is Extract<EngineEvent, { kind: K }> => e.kind === kind);
  return { summary, ev, cwd, docker, provider, events: h.events };
}

describe.skipIf(!BIN)("contrat OpenCode réel (faux fournisseur local)", () => {
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
