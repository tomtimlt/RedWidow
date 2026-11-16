import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecorder, type EngineEvent } from "@warband/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCampaignActive } from "../src/logic/campaign-host.js";
import type { ChatView } from "../src/logic/chat.js";
import type {
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "../src/logic/controller.js";
import { parseIndex } from "../src/logic/history.js";
import type { StartParams } from "../src/logic/protocol.js";
import { createChatSession } from "../src/logic/session.js";

/** Reprise d'une campagne rouverte depuis l'historique (ADR 0054) : journaux synthétiques. */

const CONV = "c0000000-0000-4000-8000-000000000000";
const CAMP = "c1000000-0000-4000-8000-000000000001";
const PLAN = "c2000000-0000-4000-8000-000000000002";
const W1 = "c3000000-0000-4000-8000-000000000003";
const W2 = "c4000000-0000-4000-8000-000000000004";

/** Journal JSONL d'un run : l'horloge est imposée pour fixer l'ordre chronologique entre journaux. */
function journal(
  runId: string,
  start: number,
  write: (r: ReturnType<typeof createRecorder>) => void,
) {
  const lines: string[] = [];
  let tick = start;
  const recorder = createRecorder({
    runId,
    redact: false,
    now: () => new Date(2026, 0, 1, 12, 0, tick++),
  });
  recorder.subscribe((e: EngineEvent) => void lines.push(JSON.stringify(e)));
  write(recorder);
  return `${lines.join("\n")}\n`;
}

function journals(): Map<string, string> {
  const files = new Map<string, string>();
  files.set(
    CAMP,
    journal(CAMP, 0, (r) => {
      r.emit({ kind: "campaign.started", objective: "Auditer le site", maxWorkers: 2 });
      r.emit({
        kind: "campaign.intent.opened",
        intentId: "i1",
        title: "Injection SQL",
        rationale: "r",
        key: "injection sql|",
        round: 1,
      });
      r.emit({
        kind: "campaign.intent.opened",
        intentId: "i2",
        title: "XSS",
        rationale: "r",
        key: "xss|",
        round: 1,
      });
      r.emit({ kind: "campaign.intent.claimed", intentId: "i1", workerRunId: W1 });
      r.emit({ kind: "campaign.intent.claimed", intentId: "i2", workerRunId: W2 });
      r.emit({
        kind: "campaign.intent.closed",
        intentId: "i1",
        workerRunId: W1,
        outcome: "reported",
        summary: "faille trouvée",
        evidence: [],
      });
    }),
  );
  files.set(
    PLAN,
    journal(PLAN, 10, (r) => void r.emit({ kind: "agent.text", text: "Je planifie" })),
  );
  // Le worker 2 écrit AVANT le worker 1 : l'ordre chronologique, pas celui des runIds, fait foi.
  files.set(
    W1,
    journal(W1, 30, (r) => void r.emit({ kind: "agent.text", text: "Résultat W1" })),
  );
  files.set(
    W2,
    journal(W2, 20, (r) => void r.emit({ kind: "agent.text", text: "Travail W2" })),
  );
  return files;
}

interface Fake extends EngineController {
  handlers: EngineHandlers;
  started?: StartParams;
  calls: unknown[][];
}

function makeFactory() {
  const ctls: Fake[] = [];
  const create = (options: EngineControllerOptions): EngineController => {
    const calls: unknown[][] = [];
    const ctl: Fake = {
      handlers: options.handlers ?? {},
      calls,
      start: async (params) => {
        ctl.started = params;
      },
      models: async () => [],
      prompt: (text) => void calls.push(["prompt", text]),
      answer: () => undefined,
      abort: () => undefined,
      dispose: () => undefined,
      kill: () => undefined,
      bypass: () => 1,
      campaignResult: () => undefined,
      exited: Promise.resolve(),
    };
    ctls.push(ctl);
    return ctl;
  };
  return { ctls, create };
}

const dirs: string[] = [];
const sessions: { dispose(): void }[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  expect(isCampaignActive()).toBe(false);
});

async function harness(
  options: {
    withTable?: boolean;
    files?: Map<string, string>;
    runIds?: string[];
    sessionId?: string;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "warband-resume-"));
  dirs.push(dir);
  const files = options.files ?? journals();
  const withTable = options.withTable ?? true;
  const row = {
    id: CONV,
    title: "Auditer le site",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:05:00.000Z",
    provider: "claude",
    model: null,
    effort: null,
    sessionId: options.sessionId ?? null,
    runIds: options.runIds ?? [CAMP, PLAN, W1, W2],
    tools: 0,
    ...(withTable && {
      agents: {
        [CAMP]: { role: "campaign", index: 0 },
        [PLAN]: { role: "planner", index: 0 },
        [W1]: { role: "worker", index: 1 },
        [W2]: { role: "worker", index: 2 },
      },
    }),
  };
  const stored = new Map<string, unknown>([["warband.history", [row]]]);
  const f = makeFactory();
  let view!: ChatView;
  const session = createChatSession({
    cwd: "/w",
    enginePath: "/e.mjs",
    engineArgs: [],
    readSettings: () => ({}),
    getToken: async () => undefined,
    confirmAlways: async () => false,
    onView: (v) => {
      view = v;
    },
    createController: f.create,
    history: {
      key: "warband.history",
      index: { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v) },
      files: {
        dir,
        read: async (id) => files.get(id) ?? null,
        size: async () => 0,
        remove: async () => undefined,
        removeAll: async () => undefined,
      },
      confirmDelete: async () => true,
    },
  });
  sessions.push(session);
  return { session, f, stored, dir, view: () => session.view(), last: () => view };
}

describe("campagne rouverte depuis l'historique", () => {
  it("transcription chronologique avec étiquettes d'agent, panneau reconstruit, bouton de campagne", async () => {
    const h = await harness();
    await h.session.openConversation(CONV);
    const v = h.view();
    expect(v.readonly).toMatchObject({ campaign: true });
    const items = v.items.filter((i) => i.kind === "user" || i.kind === "agent");
    expect(items.map((i) => (i.kind === "user" || i.kind === "agent" ? i.text : ""))).toEqual([
      "Auditer le site",
      "Je planifie",
      "Travail W2",
      "Résultat W1",
    ]);
    expect(items[1]?.agent).toMatchObject({ role: "planner", index: 0 });
    expect(items[2]?.agent).toMatchObject({ role: "worker", index: 2, intent: "XSS" });
    expect(items[3]?.agent).toMatchObject({ role: "worker", index: 1, intent: "Injection SQL" });
    expect(v.campaign).toMatchObject({
      finished: true,
      objective: "Auditer le site",
      counts: { done: 1, open: 1, claimed: 0 },
    });
    expect(v.campaign?.intents.find((i) => i.id === "i1")).toMatchObject({ worker: 1 });
  });

  it("« Reprendre la campagne » : planificateur avec l'instantané et la consigne, intentions open attribuées", async () => {
    const h = await harness();
    await h.session.openConversation(CONV);
    await h.session.resumeConversation("  Concentre-toi sur l'API  ");
    expect(isCampaignActive()).toBe(true);
    await vi.waitFor(() => expect(h.f.ctls.length).toBeGreaterThanOrEqual(2));
    const planner = h.f.ctls.find((c) => c.started?.multiAgent?.role === "planner");
    await vi.waitFor(() => expect(planner?.calls.some((c) => c[0] === "prompt")).toBe(true));
    const prompt = String(planner?.calls.find((c) => c[0] === "prompt")?.[1]);
    expect(prompt).toContain("Auditer le site");
    expect(prompt).toContain("faille trouvée"); // instantané : done conservé
    expect(prompt).toContain("Concentre-toi sur l'API");
    // L'intention interrompue (i2) est de nouveau ouverte, donc attribuée à un worker neuf.
    const worker = h.f.ctls.find((c) => c.started?.multiAgent?.role === "worker");
    expect(worker?.started?.multiAgent?.intent?.title).toBe("XSS");
    expect(h.view().readonly).toBeNull();
    expect(h.view().busy).toBe(true);
    // Le nouveau journal de campagne rejoint la conversation, avec resumedFrom.
    const rows = parseIndex(h.stored.get("warband.history"));
    const newCamp = rows[0]?.runIds.find((id) => ![CAMP, PLAN, W1, W2].includes(id));
    expect(newCamp).toBeDefined();
    expect(rows[0]?.agents?.[newCamp as string]).toEqual({ role: "campaign", index: 0 });
    // Le worker repris continue la numérotation (3, après les workers 1 et 2).
    expect(rows[0]?.agents?.[worker?.started?.multiAgent?.runId as string]).toEqual({
      role: "worker",
      index: 3,
    });
    await vi.waitFor(async () => {
      const names = await readdir(h.dir);
      expect(names.length).toBeGreaterThan(0);
    });
    const text = await readFile(join(h.dir, `${newCamp}.jsonl`), "utf8");
    expect(text).toContain(`"resumedFrom":"${CAMP}"`);
    h.session.stopCampaign();
  });

  it("une deuxième campagne active est refusée : rien n'est lancé, la lecture seule reste", async () => {
    const h = await harness();
    const other = await harness();
    other.session.setMultiAgent(true);
    await other.session.send("autre campagne");
    await vi.waitFor(() => expect(isCampaignActive()).toBe(true));
    await h.session.openConversation(CONV);
    await h.session.resumeConversation();
    expect(h.f.ctls).toHaveLength(0);
    expect(h.view().readonly).not.toBeNull();
    expect(h.view().items.some((i) => i.kind === "notice" && i.level === "error")).toBe(true);
    other.session.stopCampaign();
  });

  it("sans campagne : bouton et reprise d'un agent simple inchangés", async () => {
    const h = await harness({ withTable: false, runIds: [PLAN], sessionId: "S1" });
    await h.session.openConversation(CONV);
    expect(h.view().readonly?.campaign).toBeUndefined();
    expect(h.view().campaign).toBeUndefined();
    await h.session.resumeConversation();
    expect(isCampaignActive()).toBe(false);
    expect(h.view().readonly).toBeNull();
    expect(h.f.ctls).toHaveLength(0);
  });

  it("un historique ancien (sans table de rôles) se relit sans erreur", async () => {
    const h = await harness({ withTable: false });
    await h.session.openConversation(CONV);
    const v = h.view();
    expect(v.readonly).not.toBeNull();
    expect(v.readonly?.campaign).toBeUndefined();
    expect(v.campaign).toBeUndefined();
  });

  it("un journal de campagne incohérent : ouverture possible, pas de reprise de campagne", async () => {
    const files = journals();
    files.set(
      CAMP,
      journal(CAMP, 0, (r) => {
        r.emit({ kind: "campaign.intent.claimed", intentId: "i9", workerRunId: W1 });
      }),
    );
    const h = await harness({ files });
    await h.session.openConversation(CONV);
    expect(h.view().readonly).not.toBeNull();
    expect(h.view().readonly?.campaign).toBeUndefined();
    expect(h.view().items.some((i) => i.kind === "notice" && i.level === "error")).toBe(true);
  });
});
