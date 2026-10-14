/**
 * Test de contrat contre le VRAI Claude Agent SDK (appels API facturés).
 * Désactivé par défaut ; lancer avec :
 *
 *   ANTHROPIC_API_KEY=… JOHN_SDK_CONTRACT=1 pnpm test:contract
 *
 * Il vérifie les hypothèses que les faux `QueryFn` des autres tests ne peuvent
 * pas vérifier : le hook PreToolUse voit chaque outil (y compris ceux que le SDK
 * auto-approuve), l'ordre des messages, la liste des outils natifs exposés, et
 * la présence de `_meta` / de l'identifiant d'appel dans `extra` des handlers MCP
 * (consignée dans la sortie, car elle décide si la corrélation est exacte).
 *
 * Sans clé API (abonnement Pro/Max) : avec une connexion `claude` (/login) ou
 * CLAUDE_CODE_OAUTH_TOKEN,
 *
 *   JOHN_SDK_CONTRACT=1 JOHN_CONTRACT_SUBSCRIPTION=1 pnpm test:contract
 *
 * exécute TOUS les scénarios en `auth: "subscription"` (l'environnement du
 * binaire est alors filtré de toute clé API), puis un scénario final consigne `apiKeySource` et
 * `accountInfo()` : cela vérifie empiriquement que `settingSources: []` (forcé
 * par le moteur) n'empêche pas le chargement des identifiants d'abonnement.
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
import {
  createSdkRunner,
  dockerToolset,
  type QueryFn,
  toolUseIdFromExtra,
} from "../../src/index.js";
import { fakeDocker } from "../helpers.js";

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
/** Sans clé API, les scénarios principaux tournent avec l'abonnement (connexion `claude` /login). */
const viaSubscription = !hasApiKey && process.env.JOHN_CONTRACT_SUBSCRIPTION === "1";
const enabled = process.env.JOHN_SDK_CONTRACT === "1" && (hasApiKey || viaSubscription);
/** Modèle facultatif ; à défaut, celui du SDK. */
const MODEL = process.env.JOHN_CONTRACT_MODEL;
const TIMEOUT = 180_000;

/** Lance un vrai run et collecte événements et types de messages SDK observés. */
async function realRun(prompt: string, cwd: string, extra: { docker?: string } = {}) {
  const recorder = createRecorder();
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, workspace: { cwd } });

  const seen: string[] = [];
  let tools: string[] = [];
  /** Ce que le SDK passe en second argument aux handlers MCP. */
  const extras: { tool: string; hasMeta: boolean; metaKeys: string[]; toolUseId?: string }[] = [];
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

  const docker = extra.docker ? dockerToolset({ binary: extra.docker }) : undefined;
  const runner = createSdkRunner({
    query,
    toolsets: docker
      ? [
          {
            ...docker,
            create: (ctx) =>
              docker.create({
                ...ctx,
                resolveCall: (name, args, handlerExtra) => {
                  const meta = (handlerExtra as { _meta?: Record<string, unknown> } | undefined)
                    ?._meta;
                  const toolUseId = toolUseIdFromExtra(handlerExtra);
                  extras.push({
                    tool: name,
                    hasMeta: meta !== undefined && meta !== null,
                    metaKeys: Object.keys(meta ?? {}),
                    ...(toolUseId !== undefined && { toolUseId }),
                  });
                  return ctx.resolveCall(name, args, handlerExtra);
                },
              }),
          },
        ]
      : [],
  });
  const summary = await runner.run(
    {
      prompt,
      cwd,
      maxTurns: 6,
      auth: viaSubscription ? "subscription" : "auto",
      ...(MODEL && { model: MODEL }),
    },
    { recorder, gate },
  );
  console.info(
    `[contrat] ${prompt.slice(0, 40)}… → messages SDK : ${[...new Set(seen)].join(", ")}`,
  );
  for (const e of extras) {
    console.info(
      `[contrat] extra MCP ${e.tool} : _meta ${e.hasMeta ? `présent (clés : ${e.metaKeys.join(", ") || "aucune"})` : "absent"} · toolUseId ${e.toolUseId ?? "absent"}`,
    );
  }
  return { events, summary, tools, extras };
}

const noContractError = (events: EngineEvent[]) =>
  expect(events.filter((e) => e.kind === "error")).toEqual([]);

describe.skipIf(!enabled)("contrat Claude Agent SDK (réel)", () => {
  it(
    "outil MCP docker : tool.requested → approval.decided → process.* → tool.result",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "john-contract-"));
      const fake = await fakeDocker();
      const { events, extras } = await realRun(
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
      // Si le SDK transmet l'id d'appel, la corrélation doit être exacte ; sinon inférée.
      expect(extras.length).toBeGreaterThan(0);
      expect(started).toMatchObject({
        correlation: extras[0]?.toolUseId !== undefined ? "exact" : "inferred",
      });
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

const subscription =
  process.env.JOHN_SDK_CONTRACT === "1" && process.env.JOHN_CONTRACT_SUBSCRIPTION === "1";

describe.skipIf(!subscription)("contrat Claude Agent SDK : abonnement (réel)", () => {
  it(
    "authentifie via l'abonnement malgré settingSources: [] et consigne apiKeySource / accountInfo",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "john-contract-"));
      const recorder = createRecorder();
      const events: EngineEvent[] = [];
      recorder.subscribe((e) => events.push(e));
      const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder, workspace: { cwd } });
      const summary = await createSdkRunner().run(
        { prompt: "Réponds simplement « OK ».", cwd, maxTurns: 2, auth: "subscription" },
        { recorder, gate },
      );
      const started = events.find((e) => e.kind === "session.started");
      const info = events.find((e) => e.kind === "auth.info");
      console.info(
        `[contrat] abonnement : session.started.auth = ${JSON.stringify(started && "auth" in started ? started.auth : null)} · auth.info = ${JSON.stringify(info ?? null)} · erreurs = ${JSON.stringify(events.filter((e) => e.kind === "error"))}`,
      );
      // Aucune erreur d'authentification : les identifiants d'abonnement ont bien été chargés.
      expect(events.filter((e) => e.kind === "error" && e.code.startsWith("auth."))).toEqual([]);
      expect(summary.status).toBe("success");
    },
    TIMEOUT,
  );
});
