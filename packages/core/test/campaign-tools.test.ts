import { describe, expect, it } from "vitest";
import {
  type AgentCampaignPort,
  type CampaignRunRole,
  CodedError,
  createCampaignCoordinator,
  createLocalCampaignPort,
  createMissionDesk,
  createRecorder,
  deskToolSpecs,
} from "../src/index.js";

const SANS_CAMPAGNE = [
  "load_skill",
  "record_test",
  "record_coverage",
  "record_step",
  "record_teardown",
  "program_draft",
  "mission_context",
  "record_decision",
];

function setup() {
  const recorder = createRecorder({ redact: false });
  const coordinator = createCampaignCoordinator({ recorder });
  coordinator.start("auditer");
  const planner: CampaignRunRole = {
    role: "planner",
    port: createLocalCampaignPort(coordinator, { role: "planner" }),
  };
  const worker = (id: string): AgentCampaignPort =>
    createLocalCampaignPort(coordinator, { role: "worker", workerRunId: id });
  return { recorder, coordinator, planner, worker };
}

const names = (specs: { name: string }[]) => specs.map((s) => s.name);
const spec = (specs: ReturnType<typeof deskToolSpecs>, name: string) => {
  const found = specs.find((s) => s.name === name);
  if (!found) throw new Error(`outil absent : ${name}`);
  return found;
};

describe("outils de campagne multi-agents", () => {
  it("sans campagne, la liste d'outils du bureau est inchangée", () => {
    const { recorder } = setup();
    expect(names(deskToolSpecs())).toEqual(["load_skill"]);
    expect(names(deskToolSpecs(createMissionDesk({ recorder })))).toEqual(SANS_CAMPAGNE);
  });

  it("expose les outils selon le rôle, jamais ceux de l'autre", () => {
    const { planner, worker } = setup();
    const p = names(deskToolSpecs(undefined, planner));
    expect(p).toEqual(["load_skill", "campaign_open_intent", "campaign_status"]);
    const w = names(
      deskToolSpecs(undefined, {
        role: "worker",
        port: worker("w1"),
        intent: { id: "i1", title: "t", rationale: "r" },
      }),
    );
    expect(w).toEqual(["load_skill", "campaign_close_intent"]);
  });

  it("même readOnly que record_decision", () => {
    const { recorder, planner } = setup();
    const specs = deskToolSpecs(createMissionDesk({ recorder }), planner);
    const decision = spec(specs, "record_decision").readOnly;
    expect(spec(specs, "campaign_open_intent").readOnly).toBe(decision);
    expect(spec(specs, "campaign_status").readOnly).toBe(decision);
  });

  it("valide les entrées : 5 brouillons et outcome invalide refusés", async () => {
    const { planner, worker } = setup();
    const open = spec(deskToolSpecs(undefined, planner), "campaign_open_intent");
    const five = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, rationale: "r" }));
    await expect(open.run({ intents: five }, {} as never)).rejects.toThrow();
    await expect(open.run({ intents: [] }, {} as never)).rejects.toThrow();
    const close = spec(
      deskToolSpecs(undefined, {
        role: "worker",
        port: worker("w1"),
        intent: { id: "i1", title: "t", rationale: "r" },
      }),
      "campaign_close_intent",
    );
    await expect(
      close.run({ outcome: "gagné", summary: "", evidence: [] }, {} as never),
    ).rejects.toThrow();
    await expect(
      close.run({ outcome: "reported", summary: "x".repeat(2001), evidence: [] }, {} as never),
    ).rejects.toThrow();
    await expect(
      close.run(
        { outcome: "reported", summary: "", evidence: Array.from({ length: 51 }, () => "e") },
        {} as never,
      ),
    ).rejects.toThrow();
  });

  it("de bout en bout via le port local : ouvre 2 intentions, un worker en ferme une", async () => {
    const { coordinator, planner, worker } = setup();
    const ctx = {} as never;
    const open = spec(deskToolSpecs(undefined, planner), "campaign_open_intent");
    const opened = JSON.parse(
      await open.run(
        {
          intents: [
            { title: "Injection SQL", rationale: "paramètres" },
            { title: "IDOR", rationale: "identifiants" },
          ],
        },
        ctx,
      ),
    );
    expect(opened).toHaveLength(2);
    const claimed = coordinator.claimNext("w1");
    expect(claimed?.title).toBe("Injection SQL");
    const close = spec(
      deskToolSpecs(undefined, {
        role: "worker",
        port: worker("w1"),
        intent: { id: claimed?.id ?? "", title: "Injection SQL", rationale: "paramètres" },
      }),
      "campaign_close_intent",
    );
    const closed = JSON.parse(
      await close.run({ outcome: "no_issue_found", summary: "rien", evidence: ["e1"] }, ctx),
    );
    expect(closed).toMatchObject({ state: "done", outcome: "no_issue_found", evidence: ["e1"] });
    const status = JSON.parse(
      await spec(deskToolSpecs(undefined, planner), "campaign_status").run({}, ctx),
    );
    expect(status.counts).toMatchObject({ done: 1, open: 1, claimed: 0 });
  });

  it("le port local refuse un mauvais rôle et un worker sans intention", async () => {
    const { coordinator, planner, worker } = setup();
    await expect(
      planner.port.closeIntent({ outcome: "reported", summary: "", evidence: [] }),
    ).rejects.toBeInstanceOf(CodedError);
    await expect(worker("w1").openIntents([{ title: "a", rationale: "" }])).rejects.toBeInstanceOf(
      CodedError,
    );
    await expect(
      worker("w1").closeIntent({ outcome: "reported", summary: "", evidence: [] }),
    ).rejects.toMatchObject({ code: "campaign.notClaimant" });
    expect(coordinator.status().counts.done).toBe(0);
  });

  it("une erreur du port remonte à l'outil (rejet), sans exception côté hôte", async () => {
    const failing: AgentCampaignPort = {
      async openIntents() {
        throw new CodedError("campaign.budgetExhausted");
      },
      async status() {
        throw new CodedError("campaign.finished");
      },
      async closeIntent() {
        throw new CodedError("campaign.invalidTransition", { intentId: "i1", state: "done" });
      },
    };
    const open = spec(
      deskToolSpecs(undefined, { role: "planner", port: failing }),
      "campaign_open_intent",
    );
    await expect(
      open.run({ intents: [{ title: "a", rationale: "" }] }, {} as never),
    ).rejects.toMatchObject({ code: "campaign.budgetExhausted" });
  });

  it("l'intention du worker figure dans mission_context comme bloc structuré non fiable", () => {
    const recorder = createRecorder({ redact: false });
    const intent = { id: "i1", title: "IDOR <script>", rationale: "ids" };
    const withIntent = createMissionDesk({ recorder, campaignIntent: intent });
    expect(withIntent.context().campaignIntent).toMatchObject({ untrusted: true, ...intent });
    expect(createMissionDesk({ recorder }).context()).not.toHaveProperty("campaignIntent");
  });
});
