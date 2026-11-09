import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeTrace, createRecorder } from "@warband/core";
import { expect, it } from "vitest";
import { parseTraceInput, readTraceInput } from "../src/trace-input.js";

it("désenveloppe l’audit, reconstruit la séquence une fois et lit un ZIP", async () => {
  const r = createRecorder();
  const events = [
    r.emit({
      kind: "tool.requested",
      toolUseId: "a",
      tool: "mcp__web__http_request",
      input: { url: "https://example.test/app" },
    }),
    r.emit({
      kind: "tool.result",
      toolUseId: "a",
      output: "ok",
      bytes: 2,
      truncated: false,
      isError: false,
    }),
    r.emit({ kind: "turn.finished", turns: 1, costUsd: 0, status: "success", result: null }),
  ];
  const audit = events
    .map((e) => {
      const { seq: _, ...data } = e;
      return JSON.stringify({
        v: 1,
        id: e.id,
        projectId: "project",
        ts: e.ts,
        actor: "agent",
        kind: "engine",
        runId: e.runId,
        data,
      });
    })
    .join("\n");
  const parsed = parseTraceInput(audit);
  expect(parsed.issues).toEqual([]);
  expect(parsed.restoredSequences).toBe(3);
  expect(analyzeTrace(parsed.events)).toEqual(analyzeTrace(events));
  const root = await mkdtemp(join(tmpdir(), "trace-audit-"));
  try {
    const { ZipFile } = createRequire(new URL("../../vscode/package.json", import.meta.url))(
      "yazl",
    );
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      zip.outputStream.on("end", resolve);
      zip.outputStream.on("error", reject);
    });
    zip.addBuffer(Buffer.from(audit), "journals/events-fixture-000000.jsonl");
    zip.addBuffer(Buffer.from("ne pas analyser"), "chat.md");
    zip.end();
    await done;
    const file = join(root, "audit.zip");
    await writeFile(file, Buffer.concat(chunks));
    expect(analyzeTrace((await readTraceInput(file)).events)).toEqual(analyzeTrace(events));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
