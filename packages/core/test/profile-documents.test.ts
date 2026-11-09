import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_METHODOLOGY,
  AGENT_PROFILES,
  type AgentProfile,
  type CampaignOverview,
  createApprovalGate,
  createBypassSwitch,
  createExegolTargets,
  createMissionDesk,
  createPaceRegistry,
  createRecorder,
  createWebProgram,
  DEFAULT_POLICY,
  type DockerClient,
  type DockerToolSpec,
  deskInstructions,
  deskToolSpecs,
  evaluatePolicy,
  exegolToolSpecs,
  HTTP_REQUEST_TOOL,
  KALI_OPERATIONAL_TOOLS,
  kaliToolSpecs,
  type PolicyContext,
  parseCampaignPlan,
  parseEngagementSheet,
  parseProgramSheet,
  profileDocuments,
  renderProfileSkill,
  webToolSpecs,
} from "../src/index.js";

const findTool = (specs: readonly DockerToolSpec[], name: string): DockerToolSpec => {
  const found = specs.find((tool) => tool.name === name);
  if (!found) throw Error(`Outil absent : ${name}`);
  return found;
};
const cited = <T>(value: T) => ({
  value,
  quote: "Règle du laboratoire",
  url: "https://example.com/regles",
  retrievedAt: "2026-11-09T10:00:00Z",
  verified: true,
});
const program = parseProgramSheet({
  version: 1,
  inScope: cited(["*.example.com"]),
  outOfScope: cited([]),
  pace: cited({ preset: "normal" }),
});
const engagement = parseEngagementSheet({
  version: 1,
  authorization: cited({ principal: "Laboratoire", reference: "EX-1", signatory: "Équipe test" }),
  window: cited({ text: "novembre 2026" }),
  inScope: cited(["*.example.com"]),
  outOfScope: cited([]),
  infrastructure: cited([]),
  rulesOfEngagement: cited("Pas de déni de service"),
  whiteTeam: cited({ contact: "white@example.com", deconfliction: "Appeler" }),
  osintPolicy: cited("Sources publiques"),
});
const plan = parseCampaignPlan({
  version: 1,
  threatSummary: cited("Scénario de laboratoire"),
  objectives: [
    { id: "o1", label: "Vérifier un contrôle", successCriterion: "Observation enregistrée" },
  ],
  steps: [{ id: "s1", label: "Vérification", tactic: "TA0007", technique: "T1046" }],
});
const campaign: CampaignOverview = {
  state: "approved",
  plan,
  steps: [],
  executedCount: 0,
  executedPercent: 0,
};
const complete = (profile: AgentProfile): PolicyContext => ({
  cwd: process.cwd(),
  profile,
  program: () => ({ state: "approved", applied: program }),
  engagement: () => ({ status: { state: "approved", applied: engagement }, halted: false }),
  campaign: () => campaign,
});
const input = { method: "GET", url: "https://app.example.com/" };
const profiles = Object.keys(AGENT_PROFILES) as AgentProfile[];

describe("documents propres au profil", () => {
  it.each([
    ...KALI_OPERATIONAL_TOOLS,
    "Bash",
    "PowerShell",
    "pwsh",
    "mcp__exegol__exec",
    "mcp__exegol__task_start",
    "mcp__kali__task_start",
  ])("%s : contrôle documentaire indépendant des champs de cible", (tool) => {
    const args = tool.endsWith("metasploit_run")
      ? { module: "auxiliary/scanner/portscan/tcp", options: { RHOSTS: "app.example.com" } }
      : { command: "pwd", argv: ["pwd"] };
    for (const profile of ["bug-bounty", "red-team"] as const) {
      const absent = evaluatePolicy(DEFAULT_POLICY, tool, args, { cwd: process.cwd(), profile });
      expect(absent.decision).toBe("deny");
      expect(absent.reason.code).toBe(
        profile === "bug-bounty" ? "program.required" : "engagement.required",
      );
      expect(evaluatePolicy(DEFAULT_POLICY, tool, args, complete(profile)).decision).not.toBe(
        "deny",
      );
    }
  });

  it("les outils Kali opérationnels restent arrêtés même sans cible extractible", () => {
    for (const tool of KALI_OPERATIONAL_TOOLS) {
      const ctx = complete("red-team");
      ctx.engagement = () => ({ status: { state: "approved", applied: engagement }, halted: true });
      expect(evaluatePolicy(DEFAULT_POLICY, tool, {}, ctx)).toMatchObject({
        decision: "deny",
        reason: { code: "engagement.halted" },
      });
    }
    for (const profile of profiles) {
      for (const tool of [
        "mcp__kali__server_health",
        "mcp__kali__task_status",
        "mcp__kali__task_list",
      ])
        expect(
          evaluatePolicy(DEFAULT_POLICY, tool, {}, { cwd: process.cwd(), profile }).decision,
        ).not.toBe("deny");
    }
  });

  it.each(profiles)("%s : table canonique et contrôle moteur", (profile) => {
    const expected =
      profile === "bug-bounty"
        ? ["program"]
        : profile === "red-team"
          ? ["engagement", "campaign"]
          : [];
    expect(profileDocuments(profile)).toEqual(expected);
    const bare = evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, {
      cwd: process.cwd(),
      profile,
    });
    expect(bare.reason.code).toBe(
      profile === "bug-bounty"
        ? "program.required"
        : profile === "red-team"
          ? "engagement.required"
          : "policy.default",
    );
    expect(
      evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, complete(profile)).decision,
    ).not.toBe("deny");
  });

  it.each(["none", "draft", "unreadable", "suspended", "invalidated"] as const)(
    "un document %s ne satisfait pas l’exigence",
    (state) => {
      const bounty = { ...complete("bug-bounty"), program: () => ({ state }) };
      expect(evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, bounty).reason.code).toBe(
        "program.required",
      );
      const red = {
        ...complete("red-team"),
        engagement: () => ({ status: { state }, halted: false }),
      };
      expect(evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, red).reason.code).toBe(
        "engagement.required",
      );
      expect(
        evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, {
          ...complete("red-team"),
          campaign: () => ({ ...campaign, state, plan: null }),
        }).reason.code,
      ).toBe("campaign.notApproved");
    },
  );

  it("Red Team : la fiche seule ne remplace pas le plan validé", () => {
    const ctx = complete("red-team");
    delete ctx.campaign;
    expect(evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, ctx).reason.code).toBe(
      "campaign.notApproved",
    );
    ctx.campaign = () => {
      throw Error("lecture");
    };
    expect(evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, ctx).decision).toBe("deny");
    const bounty = {
      cwd: process.cwd(),
      profile: "bug-bounty" as const,
      program: () => {
        throw Error("lecture");
      },
    };
    expect(evaluatePolicy(DEFAULT_POLICY, HTTP_REQUEST_TOOL, input, bounty).reason.code).toBe(
      "program.required",
    );
  });

  it.each(profiles)(
    "%s : lectures documentaires et préparation accessibles sans document",
    (profile) => {
      for (const [tool, args] of [
        ["mcp__web__read_url", { url: "https://docs.example.com/" }],
        ["mcp__web__search_web", { query: "documentation" }],
        ["mcp__desk__program_draft", {}],
      ] as const)
        expect(
          evaluatePolicy(DEFAULT_POLICY, tool, args, { cwd: process.cwd(), profile }).decision,
        ).not.toBe("deny");
    },
  );

  it.each(profiles)(
    "%s : arrêt d’urgence prioritaire même avec documents manquants et Bypass",
    async (profile) => {
      const bypass = createBypassSwitch({ now: Date.now });
      bypass.enable(60_000);
      const gate = createApprovalGate({
        policy: DEFAULT_POLICY,
        recorder: createRecorder(),
        bypass,
        workspace: { cwd: process.cwd(), profile },
        engagement: () => ({ status: { state: "none" }, halted: true }),
        ask: async () => ({ decision: "allow" }),
      });
      expect(
        await gate.decide(
          { toolUseId: "halte", tool: HTTP_REQUEST_TOOL, input },
          new AbortController().signal,
        ),
      ).toMatchObject({ decision: "deny", reason: { code: "engagement.halted" } });
    },
  );

  it("préserve le contrat Bypass de la gate et la validation HTTP existante", async () => {
    const bypass = createBypassSwitch({ now: Date.now });
    bypass.enable(60_000);
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder: createRecorder(),
      bypass,
      workspace: { cwd: process.cwd(), profile: "bug-bounty" },
      ask: async () => ({ decision: "allow" }),
    });
    expect(
      (
        await gate.decide(
          { toolUseId: "bypass", tool: HTTP_REQUEST_TOOL, input },
          new AbortController().signal,
        )
      ).decision,
    ).toBe("allow");
    const web = createWebProgram({
      profile: () => "bug-bounty",
      program: () => ({ state: "none" }),
      registry: createPaceRegistry({ configDir: tmpdir(), projectId: () => null }),
    });
    const http = findTool(webToolSpecs({}, web), "http_request");
    await expect(
      http.run(input, { parentId: null, correlation: undefined, signal: undefined }),
    ).rejects.toMatchObject({ code: "program.required" });
  });
});

it.each(["out-of-box", "htb"] as const)(
  "%s sans fiche : HTTP, lecture, exec et Kali fonctionnent après approbation",
  async (profile) => {
    const recorder = createRecorder();
    const ask = vi.fn(async () => ({ decision: "allow" as const }));
    const gate = createApprovalGate({
      policy: DEFAULT_POLICY,
      recorder,
      workspace: { cwd: process.cwd(), profile },
      ask,
    });
    const targets = createExegolTargets();
    targets.note("Tester le laboratoire", ["exegol-lab", "kali-lab"], null);
    const execCapture = vi.fn(async (...args: Parameters<DockerClient["execCapture"]>) => {
      args[2].write("stdout", "contrôle effectué");
      return { code: 0, signal: null };
    });
    const docker = {
      listLabelPrefix: async () => [
        { name: "exegol-lab", family: "exegol", state: "running", image: "laboratoire" },
        { name: "kali-lab", family: "kali", state: "running", image: "laboratoire" },
      ],
      execCapture,
    } as unknown as DockerClient;
    const api = {
      call: vi.fn(async () => [
        JSON.stringify({ stdout: "contrôle effectué", stderr: "", return_code: 0 }),
      ]),
    };
    const web = createWebProgram({
      profile: () => profile,
      program: () => ({ state: "none" }),
      registry: createPaceRegistry({ configDir: tmpdir(), projectId: () => null }),
    });
    const specs = webToolSpecs(
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({
          status: 200,
          headers: { "content-type": "text/plain" },
          body: (async function* () {
            yield Buffer.from("réponse");
          })(),
        }),
      },
      web,
    );
    const calls = [
      {
        tool: HTTP_REQUEST_TOOL,
        args: input,
        spec: findTool(specs, "http_request"),
      },
      {
        tool: "mcp__web__read_url",
        args: { url: "https://docs.example.net/" },
        spec: findTool(specs, "read_url"),
      },
      {
        tool: "mcp__exegol__exec",
        args: { container: "exegol-lab", argv: ["curl", "https://app.example.com/"] },
        spec: findTool(exegolToolSpecs(docker, targets), "exec"),
      },
      {
        tool: "mcp__kali__nmap_scan",
        args: { container: "kali-lab", target: "app.example.com" },
        spec: findTool(kaliToolSpecs(docker, api, targets), "nmap_scan"),
      },
    ];
    for (const call of calls) {
      expect(
        (
          await gate.decide(
            { toolUseId: call.tool, tool: call.tool, input: call.args },
            new AbortController().signal,
          )
        ).decision,
      ).toBe("allow");
      expect(
        await call.spec.run(call.args, {
          parentId: null,
          correlation: undefined,
          signal: undefined,
        }),
      ).toBeTruthy();
    }
    expect(ask).toHaveBeenCalledTimes(4);
    expect(execCapture).toHaveBeenCalledOnce();
    expect(api.call).toHaveBeenCalledOnce();
  },
);

it.each(profiles)(
  "%s : aucun document d’un autre profil dans les consignes injectées",
  (profile) => {
    const text = `${deskInstructions(profile)}\n${renderProfileSkill(profile).instructions}`;
    if (profile !== "bug-bounty")
      expect(text).not.toMatch(/fiche programme|program_draft|record_coverage|User-Agent/i);
    if (profile !== "red-team")
      expect(text).not.toMatch(
        /fiche d[’']engagement|plan de campagne|record_step|record_teardown/i,
      );
    expect(AGENT_METHODOLOGY).not.toMatch(
      /fiche programme|program_draft|record_coverage|fiche d[’']engagement|plan de campagne/i,
    );
  },
);

it.each(["out-of-box", "htb", "mentor", "red-team"])(
  "%s : couverture disponible sans obligation ni relance",
  (profile) => {
    const desk = createMissionDesk({
      recorder: createRecorder(),
      mission: { profile, containers: ["laboratoire"] },
      supervision: "relentless",
    });
    desk.recordCoverage([{ surface: "/page", testClass: "contrôle", state: "untested" }]);
    expect(desk.context().coverage.total).toBe(1);
    const decision = desk.recordDecision({
      objective: "Bilan",
      evidenceIds: [],
      nextAction: "Terminer la mission",
      successCriterion: "Bilan livré",
    });
    expect(decision.coverage).toBeUndefined();
    expect(desk.continuationPrompt()).toBeNull();
    expect(deskToolSpecs(desk).some((tool) => tool.name === "record_coverage")).toBe(true);
  },
);

it.each(["out-of-box", "htb"])(
  "%s : un prérequis humain explicite suspend les relances sans imposer la couverture",
  (profile) => {
    const desk = createMissionDesk({
      recorder: createRecorder(),
      mission: { profile, containers: ["laboratoire"] },
      supervision: "relentless",
    });
    desk.recordCoverage([
      {
        surface: "/page",
        testClass: "contrôle",
        state: "prerequisite",
        note: "Compte de test à fournir",
      },
    ]);
    expect(desk.continuationPrompt()).toBeNull();
    expect(desk.waitingHuman()).toMatchObject({ openLeads: 1 });
  },
);
