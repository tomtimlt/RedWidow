import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecorder, readJournal } from "@warband/core";
import { describe, expect, it } from "vitest";
import { formatJournalDiagnostic } from "../src/journal-diagnostic.js";

describe("diagnostic du journal", () => {
  it("rapporte les événements valides, anomalies et extraits bornés", async () => {
    const events: string[] = [];
    const recorder = createRecorder({ runId: "r1" });
    recorder.subscribe((event) => events.push(JSON.stringify(event)));
    recorder.emit({ kind: "tool.requested", toolUseId: "t", tool: "read", input: {} });
    for (let i = 0; i < 6; i++) {
      recorder.emit({
        kind: "tool.result",
        toolUseId: `t${i}`,
        isError: false,
        output: "é".repeat(300),
        truncated: true,
        bytes: 1000,
      });
    }
    recorder.emit({ kind: "turn.finished", turns: 1, costUsd: 0, status: "success", result: null });
    const path = join(await mkdtemp(join(tmpdir(), "diagnostic-")), "journal.jsonl");
    await writeFile(path, `${events.join("\n")}\n{invalide\n`);
    const report = formatJournalDiagnostic(await readJournal(path), "fr");
    expect(report).toContain("tool.requested : 1");
    expect(report).toContain("turn.finished : 1");
    expect(report).toContain("turn.finished success (run r1)");
    expect(report).toContain("Anomalies de lecture : 1");
    expect(report).toContain("ligne 9");
    expect(report).not.toContain("| t0 |");
    expect(report).toContain("| t5 |");
    expect(report).toContain("é".repeat(256));
    expect(report).not.toContain("é".repeat(257));
    expect(report).toContain("indéterminables");
  });

  it("décrit un journal vide", () => {
    const report = formatJournalDiagnostic({ events: [], issues: [] }, "fr");
    expect(report).toContain("Dernier événement : aucun");
    expect(report).toContain("Dernier état de fin observé : aucun");
  });
});
