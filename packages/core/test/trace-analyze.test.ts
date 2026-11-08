import { describe, expect, it } from "vitest";
import {
  analyzeTrace,
  approachKey,
  type EngineEvent,
  type EventPayload,
  parseJournal,
} from "../src/index.js";

/** Construit un journal JSONL synthétique (1 s entre événements sauf `gapBefore`) et le relit. */
class Journal {
  private lines: string[] = [];
  private seq = 0;
  private clock = Date.parse("2026-01-01T00:00:00Z");
  private n = 0;

  emit(payload: EventPayload, gapMs = 1000): string {
    this.clock += gapMs;
    const event = {
      v: 1,
      id: `e${this.seq}`,
      seq: this.seq++,
      ts: new Date(this.clock).toISOString(),
      runId: "r1",
      parentId: null,
      ...payload,
    };
    this.lines.push(JSON.stringify(event));
    return event.id;
  }

  /** Appel d'outil suivi de son résultat. */
  call(
    tool: string,
    input: Record<string, unknown>,
    output = "ok",
    extra: { truncated?: boolean; bytes?: number; gapMs?: number } = {},
  ): void {
    const toolUseId = `t${this.n++}`;
    this.emit({ kind: "tool.requested", toolUseId, tool, input }, extra.gapMs);
    this.emit({
      kind: "tool.result",
      toolUseId,
      isError: false,
      output,
      truncated: extra.truncated ?? false,
      bytes: extra.bytes ?? Buffer.byteLength(output),
    });
  }

  finish(status: "success" | "error" = "success"): void {
    this.emit({ kind: "turn.finished", turns: 1, costUsd: 0, status, result: null });
    this.emit({ kind: "run.finished", status, turns: 1, costUsd: 0, result: null });
  }

  events(): EngineEvent[] {
    const { events, issues } = parseJournal(this.lines.join("\n"));
    expect(issues).toEqual([]);
    return events;
  }
}

const start = (j: Journal) => j.emit({ kind: "run.started", prompt: "p", cwd: "/w" });

describe("analyzeTrace : run normal", () => {
  const j = new Journal();
  start(j);
  j.call("Bash", { command: "nmap -sV 10.0.0.1" }, "80/tcp open", { gapMs: 5000 });
  j.call("mcp__web__search_web", { query: "apache 2.4 cve" }, "résultats");
  j.call("mcp__web__read_url", { url: "https://a.example/x?y=1" }, "page");
  j.emit({
    kind: "mission.decision",
    decision: { objective: "o", evidenceIds: [], nextAction: "n", successCriterion: "s" },
  });
  j.call("Bash", { command: "curl http://10.0.0.1/" }, "<html>");
  j.finish();
  const report = analyzeTrace(j.events());

  it("compte le volume", () => {
    expect(report.volume.calls).toBe(4);
    expect(report.volume.turns).toBe(1);
    expect(report.volume.callsByTool.Bash).toBe(2);
    expect(report.volume.durationMs).toBeGreaterThan(0);
    expect(report.volume.longestGaps[0]?.ms).toBe(5000);
  });

  it("décrit la fin et les appels depuis la dernière décision", () => {
    expect(report.ending.endCode).toBe("turn-finished");
    expect(report.ending.lastEvent?.kind).toBe("run.finished");
    expect(report.ending.callsSinceLastDecision).toBe(1);
    expect(report.ending.lastDecisionSeq).not.toBeNull();
  });

  it("note la recherche web et son moment", () => {
    expect(report.web.searches).toHaveLength(1);
    expect(report.web.searches[0]).toMatchObject({ query: "apache 2.4 cve", callsBefore: 1 });
    expect(report.web.coverage).toBeNull();
  });

  it("ne trouve ni troncature ni répétition ni blocage dominant", () => {
    expect(report.truncation.truncated).toBe(0);
    expect(report.repetition.repeated).toEqual([]);
    expect(report.blockClass.dominant).toBeNull();
  });
});

describe("analyzeTrace : run tronqué (classe A)", () => {
  const j = new Journal();
  start(j);
  j.call("Bash", { command: "echo début" });
  j.call("mcp__docker__exec", { command: "gobuster dir -u http://t" }, "… 812 lignes tronquées\nx");
  j.call("mcp__kali__scan", { target: "t" }, "x".repeat(16384));
  j.call("mcp__docker__exec", { command: "cat /var/log/big" }, "début", {
    truncated: true,
    bytes: 90000,
  });
  j.finish();
  const report = analyzeTrace(j.events());

  it("repère les trois signes de troncature", () => {
    expect(report.truncation.truncated).toBe(3);
    const signs = report.truncation.top.flatMap((r) => r.signs).sort();
    expect(signs).toEqual(["cut16k", "flag", "lineMarker"]);
  });

  it("classe les plus gros en premier avec la taille d'origine connue", () => {
    const [first] = report.truncation.top;
    expect(first).toMatchObject({
      tool: "mcp__docker__exec",
      command: "cat /var/log/big",
      originalBytes: 90000,
    });
    expect(
      report.truncation.top.find((r) => r.signs.includes("lineMarker"))?.originalBytes,
    ).toBeNull();
  });

  it("limite la liste à topN", () => {
    expect(analyzeTrace(j.events(), { topN: 1 }).truncation.top).toHaveLength(1);
  });

  it("désigne la classe A", () => {
    expect(report.truncation.truncatedInTail).toBe(3);
    expect(report.blockClass.dominant).toBe("A");
  });
});

describe("analyzeTrace : run répétitif", () => {
  const j = new Journal();
  start(j);
  for (let i = 0; i < 5; i++)
    j.call("Bash", { command: `sqlmap -u http://t/?id=${i} --batch` }, "no injection found");
  j.call("mcp__web__read_url", { url: "https://t.example/login?a=1" }, "A");
  j.call("mcp__web__read_url", { url: "https://t.example/login?a=2" }, "B");
  j.finish();
  const report = analyzeTrace(j.events());

  it("groupe par approche en ignorant les arguments", () => {
    expect(report.repetition.repeated).toEqual([
      { approach: "Bash sqlmap", calls: 5, similarResults: 5 },
    ]);
    expect(report.repetition.approaches).toBe(2);
  });

  it("ne signale pas un groupe aux résultats différents", () => {
    const k = new Journal();
    start(k);
    for (let i = 0; i < 5; i++)
      k.call("Bash", { command: `ls dir${i}` }, `${i}`.repeat(i + 1) + "z".repeat(i * 300));
    k.finish();
    expect(analyzeTrace(k.events()).repetition.repeated).toEqual([]);
  });

  it("respecte le seuil repeatMin", () => {
    expect(analyzeTrace(j.events(), { repeatMin: 6 }).repetition.repeated).toEqual([]);
  });
});

describe("analyzeTrace : run sans recherche (classe C, puis B)", () => {
  const build = (withCoverage: boolean) => {
    const j = new Journal();
    start(j);
    j.call("Bash", { command: "nmap t" }, "a");
    j.call("Bash", { command: "curl t" }, "b");
    if (withCoverage)
      j.emit({
        kind: "audit.coverage",
        cells: [
          { surface: "/login", parameter: "user", testClass: "sqli", state: "untested" },
          { surface: "/login", parameter: "user", testClass: "sqli", state: "blocked" },
          { surface: "/admin", testClass: "authz", state: "confirmed" },
          { surface: "/api", testClass: "idor", state: "untested" },
        ],
      });
    j.finish();
    return analyzeTrace(j.events());
  };

  it("classe C : aucune recherche et peu d'approches", () => {
    const report = build(false);
    expect(report.web.searches).toEqual([]);
    expect(report.blockClass.scores).toEqual({ A: false, B: false, C: true });
    expect(report.blockClass.dominant).toBe("C");
  });

  it("agrège la couverture au dernier état et liste les cases restantes", () => {
    const cov = build(true).web.coverage;
    expect(cov?.total).toBe(3);
    expect(cov?.counts).toMatchObject({ untested: 1, blocked: 1, confirmed: 1 });
    expect(cov?.remaining.map((c) => c.state).sort()).toEqual(["blocked", "untested"]);
  });

  it("classe B : arrêt du modèle avec cases restantes (prioritaire sur C)", () => {
    expect(build(true).blockClass.dominant).toBe("B");
  });
});

describe("analyzeTrace : fins de run et cas limites", () => {
  it("journal vide", () => {
    const report = analyzeTrace([]);
    expect(report.runId).toBeNull();
    expect(report.ending).toMatchObject({ lastEvent: null, endCode: "incomplete" });
    expect(report.volume).toMatchObject({ calls: 0, turns: 0, durationMs: 0 });
    expect(report.blockClass.dominant).toBe("C");
  });

  it("run sans fin enregistrée", () => {
    const j = new Journal();
    start(j);
    j.call("Bash", { command: "ls" });
    expect(analyzeTrace(j.events()).ending.endCode).toBe("incomplete");
  });

  it("erreur, quota, arrêt", () => {
    const err = new Journal();
    start(err);
    err.emit({ kind: "error", code: "error.unknown", message: "boum" });
    err.finish("error");
    expect(analyzeTrace(err.events()).ending.endCode).toBe("run-error");

    const quota = new Journal();
    start(quota);
    quota.emit({ kind: "rate.limited", status: "rejected" });
    quota.finish("error");
    expect(analyzeTrace(quota.events()).ending.endCode).toBe("quota");

    const abort = new Journal();
    start(abort);
    abort.emit({ kind: "error", code: "run.aborted" });
    abort.finish("error");
    expect(analyzeTrace(abort.events()).ending.endCode).toBe("aborted");
  });

  it("journal plafonné", () => {
    const j = new Journal();
    start(j);
    j.emit({ kind: "journal.truncated", limitBytes: 10, droppedEvents: 3 });
    expect(analyzeTrace(j.events()).ending.endCode).toBe("journal-truncated");
  });

  it("résultat sans appel correspondant", () => {
    const j = new Journal();
    j.emit({
      kind: "tool.result",
      toolUseId: "?",
      isError: false,
      output: "x",
      truncated: true,
      bytes: 99,
    });
    const report = analyzeTrace(j.events());
    expect(report.truncation.top[0]).toMatchObject({ tool: "?", originalBytes: 99 });
  });
});

describe("approchesKey", () => {
  it("ignore variables d'environnement, chemin et arguments", () => {
    expect(approachKey("Bash", { command: "FOO=1 /usr/bin/nmap -p- t" })).toBe("Bash nmap");
  });
  it("utilise hôte et chemin d'URL sans la requête", () => {
    expect(approachKey("mcp__web__read_url", { url: "https://h.example/a/b?x=1#f" })).toBe(
      "mcp__web__read_url h.example/a/b",
    );
  });
  it("retombe sur l'outil seul", () => {
    expect(approachKey("Read", { path: "/x" })).toBe("Read");
  });
});
