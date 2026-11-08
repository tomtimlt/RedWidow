import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EventPayload,
  importCampaignDraft,
  importEngagementDraft,
  isHalted,
  parseEngagementSheet,
  readCampaign,
  readEngagement,
  writeStepProgress,
} from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  buildEngagementView,
  createEngagementControls,
  type EngagementPageView,
  engagementCitationUrl,
  parseEngagementMessage,
} from "../src/logic/engagement-controls.js";

const ID = "11111111-1111-4111-8111-111111111111";
const here = dirname(fileURLToPath(import.meta.url));

const cited = <T>(value: T, verified = true) => ({
  value,
  quote: "Lettre de mission, article 2",
  url: "https://client.example/mission",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  version: 1,
  authorization: cited({ principal: "ACME", reference: "LM-2026-14", signatory: "A. Martin" }),
  window: cited({ text: "10 au 21 novembre", notBefore: "2026-11-10T00:00:00Z" }),
  inScope: cited(["*.acme.example"]),
  infrastructure: cited(["c2.redteam.example"]),
  outOfScope: cited(["paie.acme.example"], false),
  rulesOfEngagement: cited("Pas de déni de service."),
  whiteTeam: cited({ contact: "soc@acme.example", deconfliction: "Appel avant action" }),
  osintPolicy: cited("Rôles professionnels publics seulement."),
  ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  version: 1,
  threatSummary: cited("APT simulé"),
  objectives: [{ id: "o1", label: "Domain admin", successCriterion: "Compte DA obtenu" }],
  steps: [
    {
      id: "s1",
      label: "Hameçonnage",
      tactic: "TA0001",
      technique: "T1566",
      objectiveId: "o1",
    },
    { id: "s2", label: "Mouvement latéral", tactic: "TA0008", technique: "T1021" },
  ],
  teardown: [{ id: "t1", label: "Retirer la balise", kind: "artifact" }],
  ...over,
});

const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-ectl-"));
  const events: EventPayload[] = [];
  const controls = createEngagementControls(dir, ID, { emit: (e) => events.push(e) });
  return { dir, controls, events };
};

describe("contrôles de l'engagement : vue pour chaque état", () => {
  it("none : aucune donnée, aucun geste de validation, arrêt inactif", async () => {
    const { controls } = await setup();
    const v = await controls.view();
    expect(v).toMatchObject({
      state: "none",
      sheet: null,
      canValidate: false,
      canSuspend: false,
      halt: { active: false },
      closure: null,
      journal: { rows: [], total: 0 },
    });
    expect(v.campaign).toMatchObject({ state: "none", steps: [], total: 0, percent: 0 });
  });

  it("draft : fiche, citations, empreinte, validation possible", async () => {
    const { dir, controls } = await setup();
    await importEngagementDraft(dir, ID, JSON.stringify(sheet()));
    const v = await controls.view();
    expect(v.state).toBe("draft");
    expect(v.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(v.canValidate).toBe(true);
    expect(v.canSuspend).toBe(false);
    expect(v.sheet?.authorization.value.principal).toBe("ACME");
    expect(v.sheet?.outOfScope.citation.verified).toBe(false);
    expect(v.sheet?.infrastructure.value).toEqual(["c2.redteam.example"]);
  });

  it("approved, suspended, invalidated : gestes possibles selon l'état", async () => {
    const { dir, controls } = await setup();
    const draft = await importEngagementDraft(dir, ID, JSON.stringify(sheet()));
    let v = await controls.validateEngagement(draft.digest as string);
    expect(v).toMatchObject({ state: "approved", canValidate: false, canSuspend: true });
    expect(v.approvedAt).toBeDefined();
    v = await controls.suspendSheet();
    expect(v).toMatchObject({ state: "suspended", canValidate: true, canSuspend: false });
    expect(v.suspendedAt).toBeDefined();
    v = await controls.validateEngagement(draft.digest as string);
    expect(v.state).toBe("approved");
    v = await controls.importEngagement(JSON.stringify(sheet({ osintPolicy: cited("autre") })));
    expect(v).toMatchObject({ state: "invalidated", canValidate: true, canSuspend: false });
  });

  it("illisible : aucun geste de validation", async () => {
    const { dir } = await setup();
    const view = buildEngagementView({
      engagement: { state: "unreadable" },
      campaign: { state: "none" },
      overview: { state: "none", plan: null, steps: [], executedCount: 0, executedPercent: 0 },
      log: { entries: [], teardown: [] },
      teardown: { items: [], remaining: 0, canClose: true },
      halt: null,
    });
    expect(view).toMatchObject({ state: "unreadable", canValidate: false, canSuspend: false });
    expect(dir).toBeTruthy();
  });
});

describe("contrôles de l'engagement : validation à empreinte périmée", () => {
  it("engagement : rejet et rien d'écrit si le brouillon a changé depuis l'affichage", async () => {
    const { dir, controls, events } = await setup();
    const shown = await importEngagementDraft(dir, ID, JSON.stringify(sheet()));
    await importEngagementDraft(dir, ID, JSON.stringify(sheet({ osintPolicy: cited("modifié") })));
    await expect(controls.validateEngagement(shown.digest as string)).rejects.toMatchObject({
      code: "engagement.digestMismatch",
    });
    expect((await readEngagement(dir, ID)).state).toBe("draft");
    await expect(controls.validateEngagement("")).rejects.toMatchObject({
      code: "engagement.digestRequired",
    });
    expect(events).toEqual([]);
  });

  it("plan : même refus", async () => {
    const { dir, controls } = await setup();
    const shown = await importCampaignDraft(dir, ID, JSON.stringify(plan()));
    await importCampaignDraft(dir, ID, JSON.stringify(plan({ threatSummary: cited("autre") })));
    await expect(controls.validateCampaign(shown.digest as string)).rejects.toMatchObject({
      code: "campaign.digestMismatch",
    });
    expect((await readCampaign(dir, ID)).state).toBe("draft");
  });

  it("sans brouillon : rejet", async () => {
    const { controls } = await setup();
    await expect(controls.validateEngagement("a".repeat(64))).rejects.toMatchObject({
      code: "engagement.absent",
    });
    await expect(controls.suspendPlan()).rejects.toMatchObject({ code: "campaign.absent" });
  });
});

describe("contrôles de l'engagement : arrêt d'urgence", () => {
  it("halt pose l'interrupteur, resume le lève, les deux journalisent", async () => {
    const { dir, controls, events } = await setup();
    let v = await controls.halt();
    expect(v.halt.active).toBe(true);
    expect(v.halt.since).toMatch(/^\d{4}-/);
    expect(isHalted(dir, ID)).toBe(true);
    // Idempotent : la date d'origine est conservée.
    expect((await controls.halt()).halt.since).toBe(v.halt.since);
    v = await controls.resume();
    expect(v.halt).toEqual({ active: false });
    expect(isHalted(dir, ID)).toBe(false);
    // Lever un arrêt absent n'émet rien de plus.
    await controls.resume();
    expect(events.filter((e) => e.kind === "engagement.halt").map((e) => e.state)).toEqual([
      "on",
      "on",
      "off",
    ]);
  });

  it("un échec du journal ne bloque pas le geste", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-ectl-"));
    const controls = createEngagementControls(dir, ID, {
      emit: () => {
        throw new Error("journal fermé");
      },
    });
    expect((await controls.halt()).halt.active).toBe(true);
    expect(isHalted(dir, ID)).toBe(true);
  });
});

describe("contrôles de l'engagement : plan, journal et clôture", () => {
  it("plan approuvé : étapes, avancement en pourcentage, clôture", async () => {
    const { dir, controls, events } = await setup();
    const draft = await importCampaignDraft(dir, ID, JSON.stringify(plan()));
    let v = await controls.view();
    expect(v.campaign).toMatchObject({ state: "draft", canValidate: true, percent: 0, total: 2 });
    expect(v.campaign.steps.every((s) => !s.executed)).toBe(true);
    // Plan non approuvé : aucune obligation de démontage affichée comme faite ni comme à faire.
    expect(v.closure).toBeNull();

    v = await controls.validateCampaign(draft.digest as string);
    expect(v.campaign).toMatchObject({ state: "approved", canSuspend: true });
    expect(events.at(-1)).toMatchObject({ kind: "campaign.state", state: "approved" });
    expect(v.closure).toMatchObject({ remaining: 1, canClose: false });

    await writeStepProgress(dir, ID, { stepId: "s1", result: "success" });
    await writeStepProgress(dir, ID, { stepId: "s2", result: "blocked" });
    v = await controls.view();
    expect(v.campaign.executed).toBe(1);
    expect(v.campaign.percent).toBe(50);
    expect(v.campaign.steps.map((s) => [s.id, s.executed, s.result])).toEqual([
      ["s1", true, "success"],
      ["s2", false, "blocked"],
    ]);
    expect(v.campaign.steps[0]).toMatchObject({ tactic: "TA0001", technique: "T1566" });

    v = await controls.suspendPlan();
    expect(v.campaign).toMatchObject({ state: "suspended", percent: 0 });
    expect(events.at(-1)).toMatchObject({ kind: "campaign.state", state: "suspended" });
  });

  it("le journal montre horodatage, étape, technique, cible et résultat, au plus 200 lignes", () => {
    const entries = Array.from({ length: 205 }, (_, i) => ({
      ts: `2026-11-08T10:${String(i % 60).padStart(2, "0")}:00Z`,
      eventId: `e${i}`,
      stepId: "s1",
      stepLabel: "Hameçonnage",
      technique: "T1566",
      target: "mail.acme.example",
      result: "success" as const,
      note: "ok",
      evidenceIds: [],
      planDigest: "",
    }));
    const v = buildEngagementView({
      engagement: { state: "none" },
      campaign: { state: "none" },
      overview: { state: "none", plan: null, steps: [], executedCount: 0, executedPercent: 0 },
      log: { entries, teardown: [] },
      teardown: { items: [], remaining: 0, canClose: true },
      halt: null,
    });
    expect(v.journal.total).toBe(205);
    expect(v.journal.rows).toHaveLength(200);
    expect(v.journal.rows[0]).toMatchObject({
      stepId: "s1",
      technique: "T1566",
      target: "mail.acme.example",
      result: "success",
    });
    // La note de l'agent (donnée non fiable) n'est pas envoyée à la page.
    expect(JSON.stringify(v.journal.rows[0])).not.toContain("note");
  });
});

describe("contrôles de l'engagement : événements et imports", () => {
  it("validation et suspension journalisent engagement.state avec l'empreinte", async () => {
    const { dir, controls, events } = await setup();
    const draft = await importEngagementDraft(dir, ID, JSON.stringify(sheet()));
    await controls.validateEngagement(draft.digest as string);
    await controls.suspendSheet();
    expect(events).toEqual([
      { kind: "engagement.state", projectId: ID, state: "approved", digest: draft.digest },
      { kind: "engagement.state", projectId: ID, state: "suspended", digest: draft.digest },
    ]);
  });

  it("importer n'approuve rien ; un brouillon invalide est refusé", async () => {
    const { dir, controls } = await setup();
    expect((await controls.importEngagement(JSON.stringify(sheet()))).state).toBe("draft");
    expect((await controls.importCampaign(JSON.stringify(plan()))).campaign.state).toBe("draft");
    await expect(controls.importEngagement("pas du json")).rejects.toMatchObject({
      code: "engagement.invalid",
    });
    await expect(controls.importCampaign("{}")).rejects.toMatchObject({
      code: "campaign.invalid",
    });
    expect((await readEngagement(dir, ID)).state).toBe("draft");
  });
});

describe("messages de la page et citations", () => {
  it("n'accepte que des messages sans empreinte, sans donnée ni URL", () => {
    for (const type of [
      "ready",
      "refresh",
      "validateEngagement",
      "suspendSheet",
      "halt",
      "resume",
      "validateCampaign",
      "suspendPlan",
      "importEngagement",
      "importCampaign",
    ]) {
      expect(parseEngagementMessage({ type })).toEqual({ type });
      expect(parseEngagementMessage({ type, digest: "a".repeat(64) })).toBeNull();
    }
    expect(parseEngagementMessage({ type: "halt", host: "x" })).toBeNull();
    expect(parseEngagementMessage({ type: "importEngagement", path: "/etc/passwd" })).toBeNull();
    expect(parseEngagementMessage({ type: "importCampaign", content: "{}" })).toBeNull();
    expect(parseEngagementMessage({ type: "openCitation", field: "whiteTeam" })).toEqual({
      type: "openCitation",
      field: "whiteTeam",
    });
    expect(parseEngagementMessage({ type: "openCitation", field: "threatSummary" })).toEqual({
      type: "openCitation",
      field: "threatSummary",
    });
    expect(
      parseEngagementMessage({ type: "openCitation", field: "url", url: "http://x" }),
    ).toBeNull();
    expect(parseEngagementMessage({ type: "openCitation", url: "https://x" })).toBeNull();
    expect(parseEngagementMessage({ type: "inconnu" })).toBeNull();
    expect(parseEngagementMessage(null)).toBeNull();
    expect(parseEngagementMessage([])).toBeNull();
  });

  it("l'URL de citation vient de la vue de l'hôte et doit être en http(s)", async () => {
    const { dir, controls } = await setup();
    const withUrl = (url: string) => ({ ...cited(["a.example"]), url });
    const view = (url: string) => {
      const status = {
        state: "draft" as const,
        digest: "a".repeat(64),
        draft: parseEngagementSheet(sheet()),
      };
      status.draft.inScope = withUrl(url);
      return buildEngagementView({
        engagement: status,
        campaign: { state: "none" },
        overview: { state: "none", plan: null, steps: [], executedCount: 0, executedPercent: 0 },
        log: { entries: [], teardown: [] },
        teardown: { items: [], remaining: 0, canClose: true },
        halt: null,
      });
    };
    expect(engagementCitationUrl(view("https://client.example/p"), "inScope")).toBe(
      "https://client.example/p",
    );
    expect(engagementCitationUrl(view("javascript:alert(1)"), "inScope")).toBeNull();
    expect(engagementCitationUrl(view("file:///etc/passwd"), "inScope")).toBeNull();
    expect(engagementCitationUrl(view("pas une url"), "inScope")).toBeNull();
    await importCampaignDraft(dir, ID, JSON.stringify(plan()));
    expect(engagementCitationUrl(await controls.view(), "threatSummary")).toBe(
      "https://client.example/mission",
    );
    const none: EngagementPageView = await (await setup()).controls.view();
    expect(engagementCitationUrl(none, "osintPolicy")).toBeNull();
    expect(engagementCitationUrl(none, "threatSummary")).toBeNull();
  });
});

describe("aucun chemin d'approbation ni d'arrêt depuis engine/ ou un outil d'agent", () => {
  const SENSITIVE =
    /\b(approveEngagement|suspendEngagement|setHalt|clearHalt|approveCampaign|suspendCampaign|importEngagementDraft|importCampaignDraft|engagement-controls|createEngagementControls)\b/;

  it("engine/ ne référence ni ces fonctions ni le module de contrôles", () => {
    const dir = join(here, "..", "src", "engine");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(SENSITIVE);
    }
  });

  it("dans l'extension, seul engagement-controls.ts les appelle ; les outils d'agent du cœur ne les importent pas", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|mjs|js)$/.test(entry.name) && SENSITIVE.test(readFileSync(full, "utf8")))
          hits.push(relative(join(here, ".."), full).split("\\").join("/"));
      }
    };
    walk(join(here, "..", "src"));
    // Le module de contrôles et l'extension (qui l'importe) : rien d'autre.
    expect(hits.sort()).toEqual(["src/extension/extension.ts", "src/logic/engagement-controls.ts"]);
    // L'extension n'appelle aucune de ces fonctions du cœur directement : elle passe par les contrôles.
    const extension = readFileSync(join(here, "..", "src", "extension", "extension.ts"), "utf8");
    expect(extension).not.toMatch(
      /\b(approveEngagement|suspendEngagement|setHalt|clearHalt|approveCampaign|suspendCampaign|importEngagementDraft|importCampaignDraft)\b/,
    );
    // Les outils d'agent du cœur (record_step, record_teardown) n'ont accès qu'au port de campagne.
    const port = readFileSync(
      join(here, "..", "..", "core", "src", "engagement", "campaign-port.ts"),
      "utf8",
    );
    expect(port).not.toMatch(SENSITIVE);
  });
});
