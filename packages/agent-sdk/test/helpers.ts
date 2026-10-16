import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Faux docker portable : script Node `.mjs` lancé via `process.execPath` + `argsPrefix`
 * (sans shell ni bit d'exécution). Journalise son argv (un appel par ligne, `|` entre arguments).
 */
export async function fakeDocker(): Promise<{
  bin: string;
  argsPrefix: string[];
  calls: () => Promise<string[]>;
}> {
  const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-fake-docker-"));
  const script = join(dir, "docker.mjs");
  const log = join(dir, "calls.log");
  await writeFile(
    script,
    `import { appendFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "|\\n");
const out = (s) => process.stdout.write(s + "\\n");
const err = (s) => process.stderr.write(s + "\\n");
switch (argv[0]) {
  case "ps": out('{"ID":"1","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":""}'); break;
  case "images": out('{"ID":"i1","Repository":"nginx","Tag":"latest","Size":"10MB"}'); break;
  case "logs": out("out-line"); err("err-line"); break;
  case "inspect": out('[{"Id":"abc"}]'); break;
  case "run": out("cid123"); break;
  case "start": case "stop": case "rm":
    if (argv[1] === "nope") { err("no such container"); process.exit(1); }
    out(argv[1]);
    break;
}
`,
  );
  return {
    bin: process.execPath,
    argsPrefix: [script],
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

/** Appelle un outil d'un serveur MCP SDK via le vrai protocole (transport mémoire). */
export async function callMcpTool(
  server: McpSdkServerConfigWithInstance,
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await server.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args, ...(meta && { _meta: meta }) });
    const content = result.content as { type: string; text: string }[];
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true };
  } finally {
    await client.close();
  }
}
