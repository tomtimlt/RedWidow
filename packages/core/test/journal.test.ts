import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRecorder, openJournal, parseJournal, readJournal } from "../src/index.js";

const tmp = () => mkdtemp(join(tmpdir(), "john-journal-"));

describe("journal JSONL", () => {
  it("écrit puis relit les événements dans l'ordre", async () => {
    const path = join(await tmp(), "nested", "run.jsonl");
    const journal = await openJournal(path);
    const recorder = createRecorder({ runId: "r1" });
    recorder.subscribe(journal.sink);
    const root = recorder.emit({ kind: "run.started", prompt: "p", cwd: "/" });
    for (let i = 0; i < 50; i++) recorder.emit({ kind: "agent.text", text: `t${i}` }, root.id);
    await journal.close();

    const text = await readFile(path, "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(51);

    const { events, issues } = await readJournal(path);
    expect(issues).toEqual([]);
    expect(events.map((e) => e.seq)).toEqual([...Array(51).keys()]);
    expect(events[1]).toMatchObject({
      kind: "agent.text",
      text: "t0",
      parentId: root.id,
      runId: "r1",
    });
  });

  it("ajoute à un journal existant", async () => {
    const path = join(await tmp(), "run.jsonl");
    for (const prompt of ["a", "b"]) {
      const j = await openJournal(path);
      const r = createRecorder();
      r.subscribe(j.sink);
      r.emit({ kind: "run.started", prompt, cwd: "/" });
      await j.close();
    }
    expect((await readJournal(path)).events).toHaveLength(2);
  });

  it("signale les lignes corrompues sans échouer", async () => {
    const good = JSON.stringify({
      id: "a",
      seq: 0,
      ts: "2026-01-01T00:00:00.000Z",
      runId: "r",
      parentId: null,
      kind: "error",
      message: "x",
    });
    const text = [good, "{pas du json", JSON.stringify({ kind: "inconnu" }), '{"id":"tronq'].join(
      "\n",
    );
    const { events, issues } = parseJournal(text);
    expect(events).toHaveLength(1);
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4]);

    const path = join(await tmp(), "bad.jsonl");
    await writeFile(path, `${text.replace(/\n/g, "\r\n")}\r\n`);
    const streamed = await readJournal(path);
    expect(streamed.events).toHaveLength(1);
    expect(streamed.issues).toHaveLength(3);
  });
});
