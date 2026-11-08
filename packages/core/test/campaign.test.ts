import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuditStore,
  approveCampaign,
  type CampaignPlan,
  campaignDigest,
  campaignLog,
  campaignOverview,
  canCloseEngagement,
  createCampaignPort,
  createMissionDesk,
  createRecorder,
  DEFAULT_POLICY,
  deskToolSpecs,
  evaluatePolicy,
  importCampaignDraft,
  parseCampaignPlan,
  projectCampaignApprovalPath,
  projectCampaignPath,
  projectCampaignStepsPath,
  projectTeardownPath,
  readCampaign,
  readCampaignSync,
  readTeardownSync,
  suspendCampaign,
} from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const allowAll = { default: "allow" as const, rules: [{ tool: "*", decision: "allow" as const }] };
const dir = () => mkdtemp(join(tmpdir(), "warband-campaign-"));

const plan = (over: Record<string, unknown> = {}) => ({
  version: 1,
  threatSummary: {
    value: "Groupe criminel ciblant la messagerie et les VPN du secteur.",
    quote: "Rapport de menace sectoriel, section 2",
    url: "https://example.com/threat",
    retrievedAt: "2026-11-08T10:00:00Z",
    verified: true,
  },
  objectives: [
    { id: "o1", label: "Lire la boîte du DSI", successCriterion: "Capture d'un message du DSI" },
  ],
  steps: [
    {
      id: "s1",
      label: "Hameçonnage ciblé",
      tactic: "TA0001",
      technique: "T1566",
      precondition: "Fenêtre ouverte",
      decisionPoint: "Si le filtre bloque, passer à s2",
      stopCriterion: "Alerte SOC non déconflictée",
      objectiveId: "o1",
    },
    { id: "s2", label: "Mot de passe faible sur le VPN", tactic: "TA0006", technique: "T1110.003" },
  ],
  teardown: [
    { id: "t1", label: "Supprimer le compte de test", kind: "account" },
    { id: "t2", label: "Détruire le serveur de redirection", kind: "infrastructure" },
  ],
  ...over,
});

async function approved(d: string, body: Record<string, unknown> = plan()) {
  const draft = await importCampaignDraft(d, ID, JSON.stringify(body));
  await approveCampaign(d, ID, draft.digest);
  return draft.digest as string;
}

describe("plan de campagne : validation et empreinte", () => {
  it("forme canonique stable ; teardown par défaut vide", () => {
    const a = parseCampaignPlan(plan());
    const b = parseCampaignPlan(JSON.parse(JSON.stringify(plan())));
    expect(campaignDigest(a)).toBe(campaignDigest(b));
    expect(campaignDigest(a)).toMatch(/^[0-9a-f]{64}$/);
    const { teardown: _t, ...rest } = plan();
    expect(parseCampaignPlan(rest).teardown).toEqual([]);
  });

  it.each([
    ["tactique inconnue", { steps: [{ id: "s1", label: "x", tactic: "TA9999" }] }],
    ["technique mal formée", { steps: [{ id: "s1", label: "x", technique: "1566" }] }],
    ["objectif inexistant", { steps: [{ id: "s1", label: "x", objectiveId: "nope" }] }],
    [
      "étapes en double",
      {
        steps: [
          { id: "s1", label: "x" },
          { id: "s1", label: "y" },
        ],
      },
    ],
    ["aucune étape", { steps: [] }],
    ["champ inconnu", { extra: true }],
    ["synthèse non citée", { threatSummary: "texte nu" }],
    ["démontage de nature inconnue", { teardown: [{ id: "t1", label: "x", kind: "autre" }] }],
  ])("refuse : %s", (_name, over) => {
    expect(() => parseCampaignPlan(plan(over))).toThrow(/campaign\.invalid/);
  });
});

describe("plan de campagne : stockage et états", () => {
  it("import : draft, 0o600 (dossier 0o700), rien d'appliqué", async () => {
    const d = await dir();
    const status = await importCampaignDraft(d, ID, JSON.stringify(plan()));
    expect(status.state).toBe("draft");
    expect(status.applied).toBeUndefined();
    if (process.platform !== "win32") {
      expect((await stat(projectCampaignPath(d, ID))).mode & 0o777).toBe(0o600);
      expect((await stat(join(d, "projects", ID))).mode & 0o777).toBe(0o700);
    }
  });

  it("import invalide ou id non UUID : refus, rien d'écrit", async () => {
    const d = await dir();
    await expect(importCampaignDraft(d, ID, "{")).rejects.toThrow(/campaign\.invalid/);
    await expect(importCampaignDraft(d, "../x", JSON.stringify(plan()))).rejects.toThrow(
      /project\.invalid/,
    );
    expect((await readCampaign(d, ID)).state).toBe("none");
  });

  it("approve sans --digest ou avec une fausse empreinte : refus", async () => {
    const d = await dir();
    const draft = await importCampaignDraft(d, ID, JSON.stringify(plan()));
    await expect(approveCampaign(d, ID, undefined)).rejects.toThrow(/campaign\.digestRequired/);
    await expect(approveCampaign(d, ID, "")).rejects.toThrow(/campaign\.digestRequired/);
    await expect(approveCampaign(d, ID, "0".repeat(64))).rejects.toThrow(
      /campaign\.digestMismatch/,
    );
    expect((await readCampaign(d, ID)).state).toBe("draft");
    const ok = await approveCampaign(d, ID, (draft.digest as string).toUpperCase());
    expect(ok.state).toBe("approved");
    expect(ok.applied?.steps).toHaveLength(2);
    await expect(approveCampaign(d, OTHER, draft.digest)).rejects.toThrow(/campaign\.absent/);
  });

  it("plan modifié après approbation : invalidated ; suspension puis réapprobation", async () => {
    const d = await dir();
    await approved(d);
    const path = projectCampaignPath(d, ID);
    const edited = JSON.parse(await readFile(path, "utf8"));
    edited.steps[0].label = "Autre libellé";
    await writeFile(path, JSON.stringify(edited));
    const status = await readCampaign(d, ID);
    expect(status.state).toBe("invalidated");
    expect(status.applied).toBeUndefined();
    expect(readCampaignSync(d, ID).state).toBe("invalidated");
    const redraft = await importCampaignDraft(d, ID, JSON.stringify(edited));
    await approveCampaign(d, ID, redraft.digest);
    expect((await suspendCampaign(d, ID)).state).toBe("suspended");
    await approveCampaign(d, ID, redraft.digest);
    expect((await readCampaign(d, ID)).state).toBe("approved");
    await expect(suspendCampaign(d, OTHER)).rejects.toThrow(/campaign\.absent/);
  });

  it("approbation illisible : unreadable", async () => {
    const d = await dir();
    await approved(d);
    await writeFile(projectCampaignApprovalPath(d, ID), "{}");
    const status = await readCampaign(d, ID);
    expect(status.state).toBe("unreadable");
    expect(status.applied).toBeUndefined();
  });
});

describe("chemins sensibles du plan de campagne", () => {
  const custom = "/srv/wb-config";
  const files = [
    "campaign.json",
    "campaign.approval.json",
    "campaign.steps.json",
    "teardown.json",
    "campaign.json.123.tmp",
  ].map((n) => `${custom}/projects/${ID}/${n}`);
  const ctx = { cwd: "/work", home: "/home/u", platform: "posix" as const, env: {} };

  it.each(files)("Write, Edit et Read refusés : %s", (file_path) => {
    for (const tool of ["Write", "Edit", "Read"]) {
      expect(evaluatePolicy(allowAll, tool, { file_path }, ctx)).toMatchObject({
        decision: "deny",
        reason: { code: "path.sensitive" },
      });
    }
  });

  it.each(files)("Bash refusé : %s", (file) => {
    for (const command of [`cat ${file}`, `echo '{}' > ${file}`, `rm ${file}`])
      expect(evaluatePolicy(allowAll, "Bash", { command }, ctx).decision).toBe("deny");
  });

  it("noms nus refusés dans un shell, variante Windows refusée", () => {
    for (const command of ["cat campaign.approval.json", "rm campaign.steps.json"])
      expect(evaluatePolicy(allowAll, "Bash", { command }, ctx).decision).toBe("deny");
    const v = evaluatePolicy(
      allowAll,
      "Write",
      { file_path: `D:\\cfg\\projects\\${ID}\\campaign.json` },
      {
        cwd: "D:\\w",
        platform: "win32",
        home: "C:\\Users\\x",
        env: { USERPROFILE: "C:\\Users\\x" },
      },
    );
    expect(v.decision).toBe("deny");
  });
});

function setup(d: string, projectId: string | null = ID) {
  let clock = Date.parse("2026-12-01T22:00:00Z");
  const now = () => {
    clock += 1000;
    return new Date(clock);
  };
  const recorder = createRecorder({ runId: "run", redact: false });
  const events: { kind: string }[] = [];
  recorder.subscribe((e) => events.push(e));
  const port = createCampaignPort(d, () => projectId, now);
  const desk = createMissionDesk({ recorder, campaign: port });
  let n = 0;
  const observation = (output = "ok") => {
    const toolUseId = `c${n++}`;
    recorder.emit({ kind: "tool.requested", toolUseId, tool: "read", input: {} });
    return recorder.emit({
      kind: "tool.result",
      toolUseId,
      output,
      isError: false,
      truncated: false,
      bytes: output.length,
    });
  };
  return { desk, recorder, events, observation, port };
}

describe("record_step", () => {
  it("stepId inconnu ou plan non approuvé : refus codé, rien d'écrit ni d'émis", async () => {
    const d = await dir();
    const f = setup(d);
    const e = f.observation();
    await expect(
      f.desk.recordStep({ stepId: "s1", result: "success", note: "x", evidenceIds: [e.id] }),
    ).rejects.toThrow(/campaign\.notApproved/);
    await importCampaignDraft(d, ID, JSON.stringify(plan()));
    await expect(
      f.desk.recordStep({ stepId: "s1", result: "success", note: "x", evidenceIds: [e.id] }),
    ).rejects.toThrow(/campaign\.notApproved/);
    await approved(d);
    await expect(
      f.desk.recordStep({ stepId: "s99", result: "success", note: "x", evidenceIds: [e.id] }),
    ).rejects.toThrow(/campaign\.stepUnknown/);
    expect(f.events.some((ev) => ev.kind === "campaign.step")).toBe(false);
    await expect(readFile(projectCampaignStepsPath(d, ID), "utf8")).rejects.toThrow();
  });

  it("sans projet actif : project.absent ; preuve manquante ou inconnue : refus", async () => {
    const d = await dir();
    await approved(d);
    const none = setup(d, null);
    await expect(
      none.desk.recordStep({ stepId: "s1", result: "blocked", note: "x" }),
    ).rejects.toThrow(/project\.absent/);
    const f = setup(d);
    await expect(f.desk.recordStep({ stepId: "s1", result: "success", note: "x" })).rejects.toThrow(
      /campaign\.evidenceRequired/,
    );
    await expect(
      f.desk.recordStep({ stepId: "s1", result: "success", note: "x", evidenceIds: ["inconnu"] }),
    ).rejects.toThrow(/campaign\.evidenceUnknown/);
    await expect(
      f.desk.recordStep({ stepId: "s1", result: "pas-un-resultat" as never, note: "x" }),
    ).rejects.toThrow();
  });

  it("étape valide : événement, mission_context à jour, pourcentage", async () => {
    const d = await dir();
    const digest = await approved(d);
    const f = setup(d);
    const e = f.observation();
    const before = f.desk.context().campaign;
    expect(before).toMatchObject({ untrusted: true, digest, stepsExecuted: 0, stepsTotal: 2 });
    expect(before?.executedPercent).toBe(0);
    expect(before?.steps.map((s) => s.executed)).toEqual([false, false]);
    expect(before?.steps[0]).toMatchObject({
      technique: "T1566",
      stopCriterion: expect.any(String),
    });
    expect(before?.objectives[0]?.id).toBe("o1");

    const out = await f.desk.recordStep({
      stepId: "s1",
      result: "success",
      note: "message du DSI lu",
      target: "mail.example.com",
      evidenceIds: [e.id],
    });
    expect(out).toMatchObject({
      stepId: "s1",
      stepsExecuted: 1,
      stepsTotal: 2,
      executedPercent: 50,
    });
    const event = f.events.find((ev) => ev.kind === "campaign.step");
    expect(event).toMatchObject({
      stepId: "s1",
      stepLabel: "Hameçonnage ciblé",
      tactic: "TA0001",
      technique: "T1566",
      objectiveId: "o1",
      target: "mail.example.com",
      planDigest: digest,
      evidenceIds: [e.id],
    });
    const after = f.desk.context().campaign;
    expect(after?.executedPercent).toBe(50);
    expect(after?.steps.map((s) => [s.id, s.executed, s.result])).toEqual([
      ["s1", true, "success"],
      ["s2", false, undefined],
    ]);
    // `blocked` ne compte pas comme exécutée.
    await f.desk.recordStep({ stepId: "s2", result: "blocked", note: "filtre actif" });
    expect(f.desk.context().campaign?.stepsExecuted).toBe(1);
    expect(campaignOverview(d, ID).executedCount).toBe(1);
  });

  it("plan modifié puis réapprouvé : l'ancien avancement n'est plus compté", async () => {
    const d = await dir();
    await approved(d);
    const f = setup(d);
    const e = f.observation();
    await f.desk.recordStep({ stepId: "s1", result: "success", note: "ok", evidenceIds: [e.id] });
    await approved(d, plan({ steps: [{ id: "s1", label: "Nouveau déroulé" }] }));
    expect(campaignOverview(d, ID).executedCount).toBe(0);
    expect(f.desk.context().campaign?.stepsExecuted).toBe(0);
  });

  it("masque les secrets de la note", async () => {
    const d = await dir();
    await approved(d);
    const recorder = createRecorder({ runId: "run" });
    const seen: unknown[] = [];
    recorder.subscribe((e) => seen.push(e));
    const desk = createMissionDesk({ recorder, campaign: createCampaignPort(d, () => ID) });
    await desk.recordStep({ stepId: "s1", result: "blocked", note: "password=topsecretvalue" });
    expect(JSON.stringify(seen)).not.toContain("topsecretvalue");
  });

  it("politique : record_step et record_teardown demandent toujours (jamais allow)", () => {
    for (const tool of ["mcp__desk__record_step", "mcp__desk__record_teardown"])
      expect(evaluatePolicy(DEFAULT_POLICY, tool, {}).decision).toBe("ask");
  });

  it("outils exposés avec le bureau seulement", () => {
    const f = setup("/tmp/x");
    const names = deskToolSpecs(f.desk).map((s) => s.name);
    expect(names).toContain("record_step");
    expect(names).toContain("record_teardown");
    expect(deskToolSpecs().map((s) => s.name)).toEqual(["load_skill"]);
  });
});

describe("clôture et démontage", () => {
  it("canCloseEngagement : vrai sans plan, faux tant qu'un élément n'est pas fait, vrai ensuite", async () => {
    const d = await dir();
    expect(canCloseEngagement(d, ID)).toBe(true);
    await importCampaignDraft(d, ID, JSON.stringify(plan()));
    expect(canCloseEngagement(d, ID)).toBe(true); // jamais approuvé : aucune obligation
    await approved(d);
    expect(canCloseEngagement(d, ID)).toBe(false);
    expect(readTeardownSync(d, ID)).toMatchObject({ remaining: 2, canClose: false });

    const f = setup(d);
    await f.desk.recordTeardown({ itemId: "t1", proof: "compte supprimé, vérifié par login" });
    expect(canCloseEngagement(d, ID)).toBe(false);
    expect(readTeardownSync(d, ID).remaining).toBe(1);
    const last = await f.desk.recordTeardown({ itemId: "t2", proof: "serveur détruit" });
    expect(last).toMatchObject({ remaining: 0, canClose: true });
    expect(canCloseEngagement(d, ID)).toBe(true);
    expect(canCloseEngagement(d, OTHER)).toBe(true);
  });

  it("record_teardown coche avec preuve, émet teardown.state, refuse l'élément inconnu", async () => {
    const d = await dir();
    await approved(d);
    const f = setup(d);
    const out = await f.desk.recordTeardown({ itemId: "t1", proof: "supprimé" });
    expect(out).toMatchObject({ itemId: "t1", remaining: 1, canClose: false });
    expect(out.closure?.code).toBe("teardown.closeBlocked");
    expect(f.events.find((e) => e.kind === "teardown.state")).toMatchObject({
      itemId: "t1",
      done: true,
      proof: "supprimé",
      remaining: 1,
    });
    const item = readTeardownSync(d, ID).items.find((i) => i.id === "t1");
    expect(item).toMatchObject({ done: true, proof: "supprimé" });
    await expect(f.desk.recordTeardown({ itemId: "zz", proof: "x" })).rejects.toThrow(
      /teardown\.itemUnknown/,
    );
    await expect(f.desk.recordTeardown({ itemId: "t2", proof: "" })).rejects.toThrow();
    if (process.platform !== "win32")
      expect((await stat(projectTeardownPath(d, ID))).mode & 0o777).toBe(0o600);
  });

  it("mission_context : clôture bloquée avec le nombre restant ; relance à la conclusion", async () => {
    const d = await dir();
    await approved(d);
    const f = setup(d);
    const ctx = f.desk.context();
    expect(ctx.closure).toMatchObject({ canClose: false, remaining: 2 });
    expect(ctx.closure?.blocked).toEqual({ code: "teardown.closeBlocked", params: { count: 2 } });
    const closing = f.desk.recordDecision({
      objective: "Conclure l'engagement",
      evidenceIds: [],
      nextAction: "Rédiger le rapport final et clôturer",
      successCriterion: "Rapport remis",
    });
    expect(closing.closure?.code).toBe("teardown.closeBlocked");
    await f.desk.recordTeardown({ itemId: "t1", proof: "ok" });
    await f.desk.recordTeardown({ itemId: "t2", proof: "ok" });
    expect(f.desk.context().closure).toMatchObject({ canClose: true, remaining: 0 });
    expect(f.desk.context().closure?.blocked).toBeUndefined();
  });

  it("plan illisible : clôture refusée (fail-closed)", async () => {
    const d = await dir();
    await approved(d);
    await writeFile(projectCampaignApprovalPath(d, ID), "{}");
    expect(canCloseEngagement(d, ID)).toBe(false);
  });

  it("avancement du démontage illisible : aucun élément considéré comme fait", async () => {
    const d = await dir();
    await approved(d);
    await setup(d).desk.recordTeardown({ itemId: "t1", proof: "ok" });
    await writeFile(projectTeardownPath(d, ID), "pas du json");
    expect(readTeardownSync(d, ID).remaining).toBe(2);
  });
});

describe("journal de campagne", () => {
  it("agrège horodatage UTC, étape, technique ATT&CK, cible, résultat et références", async () => {
    const d = await dir();
    await approved(d);
    const audit = new AuditStore(d);
    await audit.setEnabled(ID, true);
    const f = setup(d);
    f.recorder.subscribe((event) => {
      void audit.recordEvent(ID, event);
    });
    const e = f.observation();
    await f.desk.recordStep({
      stepId: "s1",
      result: "success",
      note: "message du DSI lu",
      target: "mail.example.com",
      evidenceIds: [e.id],
    });
    await f.desk.recordStep({ stepId: "s2", result: "failed", note: "verrouillage de compte" });
    await f.desk.recordTeardown({ itemId: "t1", proof: "compte supprimé" });
    await audit.flush(ID);

    const log = await campaignLog(d, ID);
    expect(log.entries).toHaveLength(2);
    const first = log.entries.find((x) => x.stepId === "s1");
    expect(first).toMatchObject({
      stepLabel: "Hameçonnage ciblé",
      tactic: "TA0001",
      technique: "T1566",
      target: "mail.example.com",
      result: "success",
      note: "message du DSI lu",
      evidenceIds: [e.id],
      objectiveId: "o1",
    });
    expect(first?.ts).toMatch(/Z$/);
    expect(log.entries.find((x) => x.stepId === "s2")).toMatchObject({
      technique: "T1110.003",
      result: "failed",
    });
    expect(log.entries.find((x) => x.stepId === "s2")?.target).toBeUndefined();
    expect([...log.entries].map((x) => x.ts)).toEqual([...log.entries].map((x) => x.ts).sort());
    expect(log.teardown).toMatchObject([{ itemId: "t1", proof: "compte supprimé", remaining: 1 }]);
    expect(log.progress).toMatchObject({ total: 2, executed: 2, percent: 100 });
    expect(log.teardownRemaining).toBe(1);

    const view = await audit.view(ID);
    expect(view.campaign?.entries).toHaveLength(2);
    // record_step / record_teardown ne figurent pas parmi les contrôles automatiques.
    expect(view.tests.some((t) => /record_(step|teardown)/.test(t.method))).toBe(false);
  });

  it("projet sans campagne : section absente de la vue d'audit, journal vide", async () => {
    const d = await dir();
    const audit = new AuditStore(d);
    await audit.setEnabled(ID, true);
    expect((await audit.view(ID)).campaign).toBeUndefined();
    expect(await campaignLog(d, ID)).toEqual({ entries: [], teardown: [] });
  });
});

describe("aucun outil d'agent n'approuve ni n'importe un plan", () => {
  it("approveCampaign/suspendCampaign/importCampaignDraft ne sont référencés que par le module et la CLI", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dirPath: string) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test")
          continue;
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|js|mjs)$/.test(entry.name) &&
          !full.includes(join("vscode", "media")) &&
          /\b(approveCampaign|suspendCampaign|importCampaignDraft)\b/.test(
            readFileSync(full, "utf8"),
          )
        )
          hits.push(relative(root, full).split("\\").join("/"));
      }
    };
    for (const pkg of readdirSync(root)) walk(join(root, pkg, "src"));
    expect(hits.sort()).toEqual(["cli/src/main.ts", "core/src/engagement/campaign-store.ts"]);
  });
});

it("type CampaignPlan exporté", () => {
  const p: CampaignPlan = parseCampaignPlan(plan());
  expect(p.steps[0]?.technique).toBe("T1566");
});
