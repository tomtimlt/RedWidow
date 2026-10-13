import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** Faux binaire docker : journalise son argv (un appel par ligne, `|` entre arguments). */
export async function fakeDocker(): Promise<{ bin: string; calls: () => Promise<string[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "john-fake-docker-"));
  const bin = join(dir, "docker");
  const log = join(dir, "calls.log");
  await writeFile(
    bin,
    `#!/bin/sh
printf '%s|' "$@" >> "${log}"; echo >> "${log}"
case "$1" in
  ps) echo '{"ID":"1","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":""}';;
  images) echo '{"ID":"i1","Repository":"nginx","Tag":"latest","Size":"10MB"}';;
  logs) echo out-line; echo err-line >&2;;
  inspect) echo '[{"Id":"abc"}]';;
  run) echo cid123;;
  start|stop|rm) [ "$2" = "nope" ] && { echo "no such container" >&2; exit 1; }; echo "$2";;
esac
`,
  );
  await chmod(bin, 0o755);
  return {
    bin,
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

/** Appelle un outil d'un serveur MCP SDK via le vrai protocole (transport mémoire). */
export async function callMcpTool(
  server: McpSdkServerConfigWithInstance,
  name: string,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await server.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true };
  } finally {
    await client.close();
  }
}
