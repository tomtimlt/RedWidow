import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveProgram,
  createMissionDesk,
  createRecorder,
  DEFAULT_POLICY,
  deskToolSpecs,
  evaluatePolicy,
  type ProgramDraftInput,
  readProgram,
  writeProgramDraft,
} from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const URL_PAGE = "https://example.com/program";
const PAGE_TEXT = "Rules.\n  Scope:   *.Example.com  and api.example.com\nPace: be careful";

const dir = () => mkdtemp(join(tmpdir(), "warband-draft-"));

function setup(configDir: string, projectId: string | null = ID) {
  const recorder = createRecorder({ runId: "run", redact: false });
  const desk = createMissionDesk({
    recorder,
    programDraft: (text) => writeProgramDraft(configDir, projectId, text),
  });
  let n = 0;
  const readUrl = (url: string, text: string, finalUrl = url) => {
    const toolUseId = `c${n++}`;
    recorder.emit({
      kind: "tool.requested",
      toolUseId,
      tool: "mcp__web__read_url",
      input: { url },
    });
    const output = JSON.stringify({ url: finalUrl, retrievedAt: "2026-11-07T10:00:00Z", text });
    recorder.emit({
      kind: "tool.result",
      toolUseId,
      output,
      isError: false,
      truncated: false,
      bytes: output.length,
    });
  };
  return { desk, readUrl };
}

const cite = <T>(value: T, quote: string, url = URL_PAGE) => ({
  value,
  quote,
  url,
  retrievedAt: "2026-11-07T10:00:00Z",
});
const draft = (quote: string, url = URL_PAGE): ProgramDraftInput => ({
  inScope: cite(["*.example.com"], quote, url),
  outOfScope: cite(["admin.example.com"], "texte introuvable"),
  pace: cite({ preset: "careful" as const }, "pace: be careful", url),
});

describe("program_draft", () => {
  it("calcule verified : citation absente → false, présente (espaces, casse normalisés) → true", async () => {
    const d = await dir();
    const { desk, readUrl } = setup(d);
    readUrl(URL_PAGE, PAGE_TEXT);
    const result = await desk.draftProgram(draft("scope: *.example.com and API.example.com"));
    expect(result.unverified).toEqual(["outOfScope"]);
    const status = await readProgram(d, ID);
    expect(status.state).toBe("draft");
    expect(status.draft?.inScope.verified).toBe(true);
    expect(status.draft?.pace.verified).toBe(true);
    expect(status.draft?.outOfScope.verified).toBe(false);
    expect(result.digest).toBe(status.digest);
    expect(result.notice).toContain("program approve --digest");
  });

  it("sans read_url sur cette URL (autre URL, aucune lecture) → rien de vérifié", async () => {
    const d = await dir();
    const { desk, readUrl } = setup(d);
    expect((await desk.draftProgram(draft("scope"))).unverified).toEqual([
      "inScope",
      "outOfScope",
      "pace",
    ]);
    readUrl("https://other.example.org/", PAGE_TEXT);
    expect((await desk.draftProgram(draft("scope"))).unverified).toContain("inScope");
  });

  it("l'URL finale après redirection compte comme page lue", async () => {
    const { desk, readUrl } = setup(await dir());
    readUrl("https://example.com/old", PAGE_TEXT, URL_PAGE);
    expect((await desk.draftProgram(draft("Pace: be careful", URL_PAGE))).unverified).toEqual([
      "outOfScope",
    ]);
  });

  it("ignore un `verified` fourni par l'agent (outil complet)", async () => {
    const d = await dir();
    const { desk } = setup(d);
    const tool = deskToolSpecs(desk).find((spec) => spec.name === "program_draft");
    expect(tool).toBeDefined();
    const forged = (value: unknown, quote: string) => ({ ...cite(value, quote), verified: true });
    await tool?.run(
      {
        inScope: forged(["*.example.com"], "jamais lu"),
        outOfScope: forged([], "jamais lu"),
        pace: forged({ preset: "fast" }, "jamais lu"),
      },
      {} as never,
    );
    const status = await readProgram(d, ID);
    expect(status.draft?.inScope.verified).toBe(false);
    expect(status.draft?.pace.verified).toBe(false);
  });

  it("sans projet actif : project.absent ; brouillon invalide : program.invalid", async () => {
    const { desk } = setup(await dir(), null);
    await expect(desk.draftProgram(draft("x"))).rejects.toMatchObject({ code: "project.absent" });
    const bare = createMissionDesk({ recorder: createRecorder({ runId: "r", redact: false }) });
    await expect(bare.draftProgram(draft("x"))).rejects.toMatchObject({ code: "project.absent" });
    const d = await dir();
    const ok = setup(d);
    const bad = draft("x");
    bad.inScope.value = ["pas un hôte !"];
    await expect(ok.desk.draftProgram(bad)).rejects.toMatchObject({ code: "program.invalid" });
    expect((await readProgram(d, ID)).state).toBe("none");
  });

  it("écrire invalide une approbation existante et n'approuve jamais", async () => {
    const d = await dir();
    const { desk } = setup(d);
    await desk.draftProgram(draft("a"));
    await approveProgram(d, ID, (await readProgram(d, ID)).digest);
    expect((await readProgram(d, ID)).state).toBe("approved");
    const result = await desk.draftProgram({
      ...draft("b"),
      outOfScope: cite(["x.example.com"], "b"),
    });
    expect(result.state).toBe("invalidated");
    expect((await readProgram(d, ID)).applied).toBeUndefined();
  });

  it("politique : program_draft demande toujours (jamais allow)", () => {
    const verdict = evaluatePolicy(DEFAULT_POLICY, "mcp__desk__program_draft", {});
    expect(verdict.decision).toBe("ask");
  });
});
