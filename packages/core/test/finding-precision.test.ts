import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendFinding,
  createEvidence,
  createExegolTargets,
  createRecorder,
  DEFAULT_POLICY,
  type DockerClient,
  type DockerToolSpec,
  type EngineEvent,
  EVENT_VALIDATORS,
  evaluatePolicy,
  exegolToolSpecs,
  MAX_RETESTS,
  projectFindingsPath,
  readFindings,
  recordRetest,
} from "../src/index.js";

const project = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function config() {
  const dir = await mkdtemp(join(tmpdir(), "warband-precision-"));
  dirs.push(dir);
  return dir;
}
async function evidence(dir: string, count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await createEvidence(dir, project, {
      label: `preuve ${i}`,
      text: `contenu ${i}`,
      source: { kind: "editor", reference: "x.ts", startLine: 1, endLine: 2 },
    });
    ids.push(row.id);
  }
  return ids;
}

describe("trouvailles précises : création", () => {
  it("enregistre gravité, cible et niveau de preuve", async () => {
    const dir = await config();
    const [e] = await evidence(dir, 1);
    const finding = await appendFinding(dir, project, {
      kind: "site",
      label: "XSS",
      state: "confirmed",
      severity: "high",
      target: "app.example.com",
      proof: "reproduced",
      evidenceIds: [e as string],
    });
    expect(finding).toMatchObject({
      severity: "high",
      target: "app.example.com",
      proof: "reproduced",
    });
    expect((await readFindings(dir, project))[0]).toEqual(finding);
  });

  it.each(["reproduced", "exploited"] as const)(
    "refuse proof %s sans preuve citée",
    async (proof) => {
      const dir = await config();
      await expect(
        appendFinding(dir, project, { kind: "host", label: "A", state: "confirmed", proof }),
      ).rejects.toMatchObject({ code: "finding.proofRequiresEvidence" });
      await expect(
        appendFinding(dir, project, {
          kind: "host",
          label: "A",
          state: "confirmed",
          proof,
          evidenceIds: [],
        }),
      ).rejects.toMatchObject({ code: "finding.proofRequiresEvidence" });
      expect(await readFindings(dir, project)).toEqual([]);
    },
  );

  it("accepte observed sans preuve", async () => {
    const dir = await config();
    const f = await appendFinding(dir, project, {
      kind: "host",
      label: "A",
      state: "hypothesis",
      proof: "observed",
    });
    expect(f.proof).toBe("observed");
  });

  it("refuse une cible hors périmètre et accepte une cible dans le périmètre", async () => {
    const dir = await config();
    const inScope = (t: string) => t === "in.example.com";
    await expect(
      appendFinding(
        dir,
        project,
        { kind: "host", label: "A", state: "confirmed", target: "out.example.com" },
        { inScope },
      ),
    ).rejects.toMatchObject({ code: "audit.targetOutOfScope" });
    const ok = await appendFinding(
      dir,
      project,
      { kind: "host", label: "A", state: "confirmed", target: "in.example.com" },
      { inScope },
    );
    expect(ok.target).toBe("in.example.com");
    // Sans contrôle (aucune fiche approuvée), la cible est conservée telle quelle.
    const free = await appendFinding(dir, project, {
      kind: "host",
      label: "B",
      state: "confirmed",
      target: "anything.test",
    });
    expect(free.target).toBe("anything.test");
  });

  it("refuse une cible de plus de 253 caractères", async () => {
    const dir = await config();
    await expect(
      appendFinding(dir, project, {
        kind: "host",
        label: "A",
        state: "confirmed",
        target: "a".repeat(254),
      }),
    ).rejects.toMatchObject({ code: "project.invalid" });
  });

  it("relit sans erreur un ancien fichier sans les nouveaux champs", async () => {
    const dir = await config();
    const path = projectFindingsPath(dir, project);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify([{ id: "old-1", kind: "host", label: "Ancienne", state: "confirmed" }]),
    );
    const [old] = await readFindings(dir, project);
    expect(old).toEqual({ id: "old-1", kind: "host", label: "Ancienne", state: "confirmed" });
  });

  it("refuse un fichier dont la gravité est inconnue", async () => {
    const dir = await config();
    const path = projectFindingsPath(dir, project);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify([
        { id: "x", kind: "host", label: "A", state: "confirmed", severity: "extreme" },
      ]),
    );
    await expect(readFindings(dir, project)).rejects.toMatchObject({ code: "project.invalid" });
  });
});

describe("retest", () => {
  async function seeded(extra: Partial<Parameters<typeof appendFinding>[2]> = {}) {
    const dir = await config();
    const ids = await evidence(dir, 3);
    const finding = await appendFinding(dir, project, {
      kind: "site",
      label: "SQLi",
      state: "confirmed",
      ...extra,
    });
    return { dir, ids, finding };
  }

  it("fixed avec une seule preuve est refusé, avec deux il passe l'état à failed", async () => {
    const { dir, ids, finding } = await seeded();
    await expect(
      recordRetest(dir, project, {
        findingId: finding.id,
        verdict: "fixed",
        evidenceIds: [ids[0] as string],
      }),
    ).rejects.toMatchObject({ code: "finding.retestInsufficient" });
    await expect(
      recordRetest(dir, project, {
        findingId: finding.id,
        verdict: "fixed",
        evidenceIds: [ids[0] as string, ids[0] as string],
      }),
    ).rejects.toMatchObject({ code: "finding.retestInsufficient" });
    expect((await readFindings(dir, project))[0]?.state).toBe("confirmed");
    const done = await recordRetest(dir, project, {
      findingId: finding.id,
      verdict: "fixed",
      evidenceIds: [ids[0] as string, ids[1] as string],
      notes: "correctif déployé",
    });
    expect(done.state).toBe("failed");
    expect(done.retests).toHaveLength(1);
    expect(done.retests?.[0]).toMatchObject({ verdict: "fixed", notes: "correctif déployé" });
    expect((await readFindings(dir, project))[0]?.state).toBe("failed");
  });

  it("reproduced élève proof, sans jamais l'abaisser", async () => {
    const { dir, ids, finding } = await seeded();
    const first = await recordRetest(dir, project, {
      findingId: finding.id,
      verdict: "reproduced",
      evidenceIds: [ids[0] as string],
    });
    expect(first.proof).toBe("reproduced");
    const dir2 = await config();
    const ids2 = await evidence(dir2, 1);
    const strong = await appendFinding(dir2, project, {
      kind: "host",
      label: "RCE",
      state: "confirmed",
      proof: "exploited",
      evidenceIds: ids2,
    });
    const after = await recordRetest(dir2, project, {
      findingId: strong.id,
      verdict: "reproduced",
      evidenceIds: ids2,
    });
    expect(after.proof).toBe("exploited");
  });

  it("inconclusive n'altère ni l'état ni la preuve", async () => {
    const { dir, ids, finding } = await seeded();
    const result = await recordRetest(dir, project, {
      findingId: finding.id,
      verdict: "inconclusive",
      evidenceIds: [ids[0] as string],
    });
    expect(result.state).toBe("confirmed");
    expect(result.proof).toBeUndefined();
    expect(result.retests?.at(-1)?.verdict).toBe("inconclusive");
  });

  it("refuse une trouvaille inconnue ou une preuve inconnue", async () => {
    const { dir, ids, finding } = await seeded();
    await expect(
      recordRetest(dir, project, {
        findingId: "inconnue",
        verdict: "reproduced",
        evidenceIds: [ids[0] as string],
      }),
    ).rejects.toMatchObject({ code: "finding.notFound" });
    await expect(
      recordRetest(dir, project, {
        findingId: finding.id,
        verdict: "reproduced",
        evidenceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    await expect(
      recordRetest(dir, project, { findingId: finding.id, verdict: "reproduced", evidenceIds: [] }),
    ).rejects.toMatchObject({ code: "project.invalid" });
  });

  it("plafonne l'historique à 20 retests, les plus anciens tombent", async () => {
    const { dir, ids, finding } = await seeded();
    for (let i = 0; i < MAX_RETESTS + 3; i++)
      await recordRetest(dir, project, {
        findingId: finding.id,
        verdict: "inconclusive",
        evidenceIds: [ids[0] as string],
        notes: `essai ${i}`,
      });
    const retests = (await readFindings(dir, project))[0]?.retests ?? [];
    expect(retests).toHaveLength(MAX_RETESTS);
    expect(retests[0]?.notes).toBe("essai 3");
    expect(retests.at(-1)?.notes).toBe(`essai ${MAX_RETESTS + 2}`);
  });
});

describe("outils Exegol note et record_retest", () => {
  const call = { parentId: "parent-1", signal: undefined, correlation: undefined };

  async function tools(scope?: (t: string) => boolean) {
    const root = await config();
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    const targets = createExegolTargets();
    targets.note("mission", [], project);
    const events: EngineEvent[] = [];
    const recorder = createRecorder();
    recorder.subscribe((e) => events.push(e));
    const specs = exegolToolSpecs({} as DockerClient, targets, undefined, {
      ...(scope && { scope: () => scope }),
      recorder,
    });
    const find = (name: string): DockerToolSpec => {
      const spec = specs.find((s) => s.name === name);
      if (!spec) throw new Error(name);
      return spec;
    };
    return {
      dir: join(root, "warband"),
      events,
      find,
      restore: () => {
        if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = previous;
      },
    };
  }

  it("note accepte gravité, cible et preuve ; refuse hors périmètre et preuve sans id", async () => {
    const t = await tools((x) => x === "in.example.com");
    try {
      const [e] = await evidence(t.dir, 1);
      const out = await t.find("note").run(
        {
          kind: "site",
          label: "IDOR",
          state: "confirmed",
          severity: "critical",
          target: "in.example.com",
          proof: "exploited",
          evidenceIds: [e],
        },
        call,
      );
      expect(out).toContain("IDOR");
      expect((await readFindings(t.dir, project))[0]).toMatchObject({
        severity: "critical",
        target: "in.example.com",
        proof: "exploited",
      });
      await expect(
        t
          .find("note")
          .run({ kind: "site", label: "X", state: "confirmed", target: "out.example.com" }, call),
      ).rejects.toMatchObject({ code: "audit.targetOutOfScope" });
      await expect(
        t
          .find("note")
          .run({ kind: "site", label: "X", state: "confirmed", proof: "reproduced" }, call),
      ).rejects.toMatchObject({ code: "finding.proofRequiresEvidence" });
      await expect(
        t
          .find("note")
          .run({ kind: "site", label: "X", state: "confirmed", severity: "grave" }, call),
      ).rejects.toMatchObject({ code: "finding.invalidInput" });
    } finally {
      t.restore();
    }
  });

  it("record_retest émet finding.retest, validé, et met à jour la trouvaille", async () => {
    const t = await tools();
    try {
      const [a, b] = await evidence(t.dir, 2);
      const finding = await appendFinding(t.dir, project, {
        kind: "site",
        label: "XSS",
        state: "confirmed",
      });
      await expect(
        t
          .find("record_retest")
          .run({ findingId: finding.id, verdict: "fixed", evidenceIds: [a] }, call),
      ).rejects.toMatchObject({ code: "finding.retestInsufficient" });
      expect(t.events.some((e) => e.kind === "finding.retest")).toBe(false);
      await t
        .find("record_retest")
        .run({ findingId: finding.id, verdict: "fixed", evidenceIds: [a, b] }, call);
      const event = t.events.find((e) => e.kind === "finding.retest");
      expect(event).toMatchObject({
        kind: "finding.retest",
        findingId: finding.id,
        verdict: "fixed",
        evidenceIds: [a, b],
        parentId: "parent-1",
      });
      expect(EVENT_VALIDATORS["finding.retest"](event as never)).toBeNull();
      expect((await readFindings(t.dir, project))[0]?.state).toBe("failed");
      await expect(
        t
          .find("record_retest")
          .run({ findingId: "inconnue", verdict: "reproduced", evidenceIds: [a] }, call),
      ).rejects.toMatchObject({ code: "finding.notFound" });
      await expect(
        t.find("record_retest").run(
          {
            findingId: finding.id,
            verdict: "reproduced",
            evidenceIds: [a],
            notes: "x".repeat(1001),
          },
          call,
        ),
      ).rejects.toMatchObject({ code: "finding.invalidInput" });
    } finally {
      t.restore();
    }
  });
});

describe("politique", () => {
  it("record_retest reçoit exactement la décision de note", () => {
    const ctx = { cwd: process.cwd(), posixShell: true };
    const note = evaluatePolicy(DEFAULT_POLICY, "mcp__exegol__note", { label: "x" }, ctx);
    const retest = evaluatePolicy(
      DEFAULT_POLICY,
      "mcp__exegol__record_retest",
      { findingId: "x" },
      ctx,
    );
    expect(retest.decision).toBe(note.decision);
    expect(DEFAULT_POLICY.rules.filter((rule) => rule.tool.includes("record_retest")).length).toBe(
      DEFAULT_POLICY.rules.filter((rule) => rule.tool.includes("exegol__note")).length,
    );
  });
});
