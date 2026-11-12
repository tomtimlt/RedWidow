import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSdkRunner, deskToolset, type QueryFn } from "@warband/agent-sdk";
import { CREDENTIAL_TOOL, DEFAULT_POLICY } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import type { FromEngine } from "../src/logic/protocol.js";

type SDKMessage = ReturnType<QueryFn> extends AsyncIterable<infer M> ? M : never;
type Server = { instance: { connect(transport: never): Promise<void> } };

/** Valeur que l'agent a « découverte » : elle ne doit apparaître nulle part hors du message `credential`. */
const SECRET = "tok_0123456789abcdefSECRET";
const INPUT = { label: "ADMIN", login: "root", secret: SECRET, kind: "token" } as const;

/** Le tour est terminé (le run multi-tours, lui, ne s'achève qu'au `dispose`). */
const turnDone = (sent: FromEngine[]) =>
  sent.some((m) => m.type === "event" && m.event.kind === "turn.finished");

function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(structuredClone(m)),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: () => {},
  };
  return { channel, sent, receive: (raw: unknown) => onMessage(raw) };
}

async function callTool(server: Server, name: string, args: Record<string, unknown>) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await server.instance.connect(b as never);
  await client.connect(a);
  try {
    const result = await client.callTool({ name, arguments: args });
    return (result.content as { text: string }[]).map((c) => c.text).join("\n");
  } finally {
    await client.close();
  }
}

type Order = "hook-first" | "message-first";

/** Moteur réel + runner Claude dont le SDK est simulé : le « modèle » appelle `store_credential`. */
function setup(order: Order, observed: { toolResult?: string }) {
  const sdkMessage = (content: unknown[]) =>
    ({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content },
    }) as unknown as SDKMessage;
  const modelTurn = (): SDKMessage =>
    sdkMessage([
      { type: "thinking", thinking: `Je stocke ${SECRET} pour la suite.` },
      { type: "text", text: `Voici le jeton : ${SECRET}` },
      { type: "tool_use", id: "tu1", name: CREDENTIAL_TOOL, input: INPUT },
    ]);
  return createSdkRunner({
    processEnv: {},
    toolsets: [deskToolset()],
    query: async function* ({ prompt, options }) {
      if (typeof prompt === "string") return;
      for await (const _ of prompt) {
        const decide = async () => {
          const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
          if (!hook) throw new Error("hook absent");
          const out = (await hook(
            {
              hook_event_name: "PreToolUse",
              tool_name: CREDENTIAL_TOOL,
              tool_input: { ...INPUT },
              tool_use_id: "tu1",
            } as never,
            "tu1",
            { signal: new AbortController().signal },
          )) as { hookSpecificOutput?: { permissionDecision?: string } };
          return out.hookSpecificOutput?.permissionDecision;
        };
        let decision: string | undefined;
        if (order === "hook-first") decision = await decide();
        yield modelTurn();
        if (order === "message-first") decision = await decide();
        if (decision === "allow") {
          const server = options.mcpServers?.desk;
          if (!server || !("instance" in server)) throw new Error("serveur desk absent");
          observed.toolResult = await callTool(server as Server, "store_credential", INPUT);
          yield {
            type: "user",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "tu1", content: observed.toolResult }],
            },
          } as unknown as SDKMessage;
        }
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0,
          result: "ok",
        } as unknown as SDKMessage;
      }
    },
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "warband-credential-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function journalText(): Promise<string> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  expect(files.length).toBeGreaterThan(0);
  return (await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))).join("\n");
}

async function drive(
  order: Order,
  answer: "allow" | "deny",
  host: "store" | "no-capability" = "store",
) {
  const t = fakeChannel();
  const observed: { toolResult?: string } = {};
  const done = runEngine({
    channel: t.channel,
    createRunner: () => setup(order, observed),
    policyLoader: async () => ({
      policy: DEFAULT_POLICY,
      source: null,
      origin: "builtin" as const,
    }),
  });
  t.receive({
    v: 1,
    type: "start",
    cwd: dir,
    journalDir: dir,
    ...(host === "store" && { credentialStore: true }),
  });
  await expect.poll(() => t.sent.some((m) => m.type === "started")).toBe(true);
  t.receive({ v: 1, type: "prompt", text: "enregistre le jeton" });
  await expect.poll(() => t.sent.some((m) => m.type === "approval")).toBe(true);
  t.receive({ v: 1, type: "answer", toolUseId: "tu1", decision: answer });
  if (answer === "allow") {
    await expect.poll(() => t.sent.some((m) => m.type === "credential")).toBe(true);
    const request = t.sent.find((m) => m.type === "credential");
    if (request?.type !== "credential") throw new Error("credential absent");
    t.receive({ v: 1, type: "credentialAck", requestId: request.requestId, ok: true, id: "acc-1" });
  }
  await expect.poll(() => turnDone(t.sent)).toBe(true);
  t.receive({ v: 1, type: "dispose" });
  await done;
  return { t, observed };
}

describe("moteur : outil store_credential", () => {
  it.each(["hook-first", "message-first"] as const)(
    "approuvé (%s) : demande envoyée à l'hôte, secret absent du journal, des événements et du résultat",
    async (order) => {
      const { t, observed } = await drive(order, "allow");
      const request = t.sent.find((m) => m.type === "credential");
      expect(request).toMatchObject({ type: "credential", ...INPUT });
      // L'outil ne rend que {ok, id}.
      expect(JSON.parse(observed.toolResult ?? "{}")).toEqual({ ok: true, id: "acc-1" });
      // Hors du message `credential` lui-même, rien de ce qui part vers l'hôte ne contient le secret.
      const others = t.sent.filter((m) => m.type !== "credential");
      expect(JSON.stringify(others)).not.toContain(SECRET);
      expect(JSON.stringify(others)).not.toContain(Buffer.from(SECRET).toString("base64"));
      expect(await journalText()).not.toContain(SECRET);
      // Les événements ont bien été journalisés (la vérification n'est pas vide).
      expect(await journalText()).toContain("tool.requested");
    },
  );

  it("refusé par la gate : aucune demande à l'hôte, rien n'est stocké, secret toujours masqué", async () => {
    const { t, observed } = await drive("hook-first", "deny");
    expect(t.sent.some((m) => m.type === "credential")).toBe(false);
    expect(observed.toolResult).toBeUndefined();
    expect(JSON.stringify(t.sent)).not.toContain(SECRET);
    expect(await journalText()).not.toContain(SECRET);
  });

  it("hôte sans la capacité : l'outil n'est pas exposé", async () => {
    const t = fakeChannel();
    let tools: string[] | undefined;
    const done = runEngine({
      channel: t.channel,
      createRunner: () =>
        createSdkRunner({
          processEnv: {},
          toolsets: [deskToolset()],
          query: async function* ({ prompt, options }) {
            if (typeof prompt === "string") return;
            for await (const _ of prompt) {
              const server = options.mcpServers?.desk;
              if (!server || !("instance" in server)) throw new Error("serveur desk absent");
              const [a, b] = InMemoryTransport.createLinkedPair();
              const client = new Client({ name: "test", version: "0" });
              await (server as Server).instance.connect(b as never);
              await client.connect(a);
              tools = (await client.listTools()).tools.map((x) => x.name);
              await client.close();
              yield {
                type: "result",
                subtype: "success",
                is_error: false,
                num_turns: 1,
                total_cost_usd: 0,
                result: "ok",
              } as unknown as SDKMessage;
            }
          },
        }),
    });
    t.receive({ v: 1, type: "start", cwd: dir, journalDir: dir });
    await expect.poll(() => t.sent.some((m) => m.type === "started")).toBe(true);
    t.receive({ v: 1, type: "prompt", text: "liste" });
    await expect.poll(() => tools !== undefined).toBe(true);
    expect(tools).toContain("load_skill");
    expect(tools).not.toContain("store_credential");
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("sans accusé de l'hôte dans le délai : l'enregistrement est tenu pour échoué", async () => {
    const t = fakeChannel();
    const observed: { toolResult?: string } = {};
    const done = runEngine({
      channel: t.channel,
      createRunner: () => setup("hook-first", observed),
      policyLoader: async () => ({
        policy: DEFAULT_POLICY,
        source: null,
        origin: "builtin" as const,
      }),
      credentialTimeoutMs: 20,
    });
    t.receive({ v: 1, type: "start", cwd: dir, journalDir: dir, credentialStore: true });
    await expect.poll(() => t.sent.some((m) => m.type === "started")).toBe(true);
    t.receive({ v: 1, type: "prompt", text: "enregistre" });
    await expect.poll(() => t.sent.some((m) => m.type === "approval")).toBe(true);
    t.receive({ v: 1, type: "answer", toolUseId: "tu1", decision: "allow" });
    await expect.poll(() => turnDone(t.sent)).toBe(true);
    expect(JSON.parse(observed.toolResult ?? "{}")).toEqual({ ok: false });
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("accusé inconnu rejeté ; credentialStore refusé en apprentissage", async () => {
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: () => ({
        run: async () => ({ status: "success", turns: 0, costUsd: 0, result: null }),
      }),
    });
    t.receive({ v: 1, type: "credentialAck", requestId: "inconnu", ok: true });
    t.receive({ v: 1, type: "credentialAck", requestId: "x", ok: true, secret: "non" });
    t.receive({ v: 1, type: "start", cwd: dir, mode: "learning", credentialStore: true });
    expect(t.sent.filter((m) => m.type === "error")).toHaveLength(3);
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  });
});
