/**
 * Test de contrat contre le VRAI Claude Agent SDK (appels API facturés).
 * Désactivé par défaut ; lancer avec :
 *
 *   ANTHROPIC_API_KEY=… JOHN_SDK_CONTRACT=1 pnpm test:contract
 *
 * Il vérifie les hypothèses que les faux `QueryFn` des autres tests ne peuvent
 * pas vérifier : le hook PreToolUse voit chaque outil (y compris ceux que le SDK
 * auto-approuve), l'ordre des messages, et la liste des outils natifs exposés.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  type EngineEvent,
} from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { createSdkRunner, dockerToolset, type QueryFn } from "../../src/index.js";
import { fakeDocker } from "../helpers.js";

const enabled = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.JOHN_SDK_CONTRACT === "1";
const MODEL = process.env.JOHN_CONTRACT_MODEL ?? "claude-haiku-5-5";
const TIMEOUT = 180_000;

/** Lance un vrai run et collecte événements et types de messages SDK observés. */
async function realRun(prompt: string, cwd: string, extra: { docker?: string } = {}) {
  const recorder = createRecorder();
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, workspace: { cwd } });

  const seen: string[] = [];
  let tools: string[] = [];
  const query: QueryFn = (params) =>
    (async function* () {
      for await (const message of sdkQuery(params)) {
        const subtype = "subtype" in message ? `/${String(message.subtype)}` : "";
        seen.push(`${message.type}${subtype}`);
        if (message.type === "system" && message.subtype === "init") {
          tools = (message as unknown as { tools: string[] }).tools;
        }
        yield message;
      }
    })();

  const runner = createSdkRunner({
    query,
    toolsets: extra.docker ? [dockerToolset({ binary: extra.docker })] : [],
  });
  const summary = await runner.run({ prompt, cwd, model: MODEL, maxTurns: 6 }, { recorder, gate });
  console.info(
    `[contrat] ${prompt.slice(0, 40)}… → messages SDK : ${[...new Set(seen)].join(", ")}`,
  );
  return { events, summary, tools };
}

const noContractError = (events: EngineEvent[]) =>
  expect(events.filter((e) => e.kind === "error")).toEqual([]);

describe.skipIf(!enabled)("contrat Claude Agent SDK (réel)", () => {
  it(
    "outil MCP docker : tool.requested → approval.decided → process.* → tool.result",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "john-contract-"));
      const fake = await fakeDocker();
      const { events } = await realRun(
        "Appelle une seule fois l'outil mcp__docker__ps (sans argument) puis réponds « OK ».",
        cwd,
        { docker: fake.bin },
      );

      const kinds = events.map((e) => e.kind);
      const requested = events.find(
        (e) => e.kind === "tool.requested" && e.tool === "mcp__docker__ps",
      );
      expect(requested).toBeDefined();
      const at = (kind: string) => kinds.indexOf(kind as EngineEvent["kind"]);
      expect(at("approval.decided")).toBeGreaterThan(events.indexOf(requested as EngineEvent));
      expect(at("process.started")).toBeGreaterThan(at("approval.decided"));
      expect(kinds.lastIndexOf("tool.result")).toBeGreaterThan(at("process.exited"));

      const started = events.find((e) => e.kind === "process.started");
      expect(started?.parentId).toBe(requested?.id);
      const decided = events.find((e) => e.kind === "approval.decided");
      expect(decided).toMatchObject({
        decision: "allow",
        toolUseId: (requested as { toolUseId: string }).toolUseId,
      });
      noContractError(events);
    },
    TIMEOUT,
  );

  it(
    "le hook voit une lecture que le SDK auto-approuve (dans le cwd)",
    async () => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), "john-contract-")));
      writeFileSync(join(cwd, "notes.txt"), "contenu-du-fichier");
      const { events } = await realRun(
        "Lis le fichier notes.txt avec l'outil Read puis réponds « OK ».",
        cwd,
      );
      const read = events.find((e) => e.kind === "tool.requested" && e.tool === "Read");
      expect(read).toBeDefined();
      expect(
        events.find(
          (e) =>
            e.kind === "approval.decided" &&
            e.toolUseId === (read as { toolUseId: string }).toolUseId,
        ),
      ).toMatchObject({ decision: "allow", source: "policy" });
      noContractError(events);
    },
    TIMEOUT,
  );

  it(
    "refuse une lecture hors de l'espace de travail, sans fuite du contenu",
    async () => {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), "john-contract-")));
      const other = realpathSync(mkdtempSync(join(tmpdir(), "john-contract-out-")));
      mkdirSync(other, { recursive: true });
      const marker = "MARQUEUR-SECRET-9f3a1c";
      const target = join(other, "secret.txt");
      writeFileSync(target, marker);
      const { events } = await realRun(
        `Lis le fichier ${target} avec l'outil Read puis réponds « OK ».`,
        cwd,
      );
      const decided = events.find((e) => e.kind === "approval.decided");
      expect(decided).toMatchObject({ decision: expect.stringMatching(/deny/) });
      expect(JSON.stringify(events)).not.toContain(marker);
      noContractError(events);
    },
    TIMEOUT,
  );

  it(
    "n'expose pas Bash et ne laisse que les lectures natives",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "john-contract-"));
      const { tools, events } = await realRun("Réponds simplement « OK ».", cwd);
      expect(tools).not.toContain("Bash");
      expect(tools).not.toContain("Write");
      expect(tools).not.toContain("WebFetch");
      expect(tools).toEqual(expect.arrayContaining(["Read"]));
      noContractError(events);
    },
    TIMEOUT,
  );
});
