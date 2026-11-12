import type { EngagementPageView } from "@warband/vscode/logic/engagement-controls";
import type { ProgramView } from "@warband/vscode/logic/program-controls";
import { describe, expect, it, vi } from "vitest";
import { emptyBackends, setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();

const programView = (over: Partial<ProgramView> = {}): ProgramView =>
  ({
    state: "draft",
    digest: "d1",
    inScope: null,
    outOfScope: null,
    userAgentSuffix: null,
    pace: null,
    haltedHosts: ["api.example.com"],
    canValidate: true,
    canSuspend: true,
    ...over,
  }) as ProgramView;

function fakeProgram() {
  const calls: unknown[][] = [];
  const view = programView();
  const controls = {
    view: async () => view,
    validate: async (d: string) => (calls.push(["validate", d]), view),
    suspend: async () => (calls.push(["suspend"]), view),
    importDraft: async () => view,
    resume: async (h: string) => (calls.push(["resume", h]), { resumed: true, view }),
  };
  return { calls, controls, view };
}

describe("vue program", () => {
  it("ready : vue envoyée ; validate routé avec l'empreinte affichée ; suspend ; resume d'un hôte arrêté", async () => {
    const p = fakeProgram();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = t.connect();
    const other = t.connect();
    s.say("program", "prog", { type: "ready" });
    other.say("program", "prog2", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    expect(s.of("program", "view")[0]?.frame).toBe("prog");

    s.say("program", "prog", { type: "validate" });
    await vi.waitFor(() => expect(p.calls).toEqual([["validate", "d1"]]));
    // Diffusé à tous les abonnés, chacun sur son cadre.
    await vi.waitFor(() => expect(other.of("program", "view")).toHaveLength(2));
    expect(other.of("program", "view").at(-1)?.frame).toBe("prog2");

    s.say("program", "prog", { type: "suspend" });
    s.say("program", "prog", { type: "resume", host: "API.example.com" });
    s.say("program", "prog", { type: "resume", host: "inconnu.example.com" });
    await vi.waitFor(() =>
      expect(p.calls).toEqual([["validate", "d1"], ["suspend"], ["resume", "api.example.com"]]),
    );
  });

  it("message invalide (digest fourni, clé en plus, type inconnu), geste sans équivalent, non abonné : ignorés", async () => {
    const p = fakeProgram();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = t.connect();
    s.say("program", "prog", { type: "validate" }); // avant ready
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    const bad: unknown[] = [
      { type: "validate", digest: "d2" },
      { type: "resume" },
      { type: "resume", host: "a b" },
      { type: "nimporte" },
      { type: "importFile" },
      { type: "askAgent", url: "https://example.com" },
    ];
    for (const m of bad) s.say("program", "prog", m);
    s.say("program", "autre", { type: "validate" }); // mauvais cadre
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(1 + bad.length + 1));
    expect(p.calls).toEqual([]);
  });

  it("sans projet actif : erreur sans détail ; digest périmé : le cœur refuse et l'erreur est un code", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = t.connect();
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() =>
      expect(s.of("program", "error")[0]?.msg).toEqual({ type: "error", code: "project.none" }),
    );
    const p = fakeProgram();
    p.controls.validate = async () => {
      throw new Error("détail interne à ne pas révéler");
    };
    const t2 = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s2 = t2.connect();
    s2.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s2.of("program", "view")).toHaveLength(1));
    s2.say("program", "prog", { type: "validate" });
    await vi.waitFor(() =>
      expect(s2.of("program", "error")[0]?.msg).toEqual({ type: "error", code: "view.failed" }),
    );
    expect(JSON.stringify(s2.sent)).not.toContain("détail interne");
  });

  it("le projet actif a changé depuis l'affichage : geste refusé", async () => {
    const p = fakeProgram();
    let active = "p1";
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => active, program: () => p.controls }),
    });
    const s = t.connect();
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    active = "p2";
    s.say("program", "prog", { type: "validate" });
    await vi.waitFor(() =>
      expect(s.of("program", "error")[0]?.msg).toMatchObject({ code: "project.changed" }),
    );
    expect(p.calls).toEqual([]);
  });
});

const engagementView = (): EngagementPageView =>
  ({
    state: "draft",
    digest: "e1",
    sheet: null,
    halt: { active: true, since: "2026-01-01T00:00:00Z" },
    campaign: { state: "draft", digest: "c1", canValidate: true, canSuspend: false },
    journal: { rows: [], total: 0 },
    closure: null,
    canValidate: true,
    canSuspend: true,
  }) as unknown as EngagementPageView;

describe("vue engagement", () => {
  const make = () => {
    const calls: string[] = [];
    const v = engagementView();
    const c =
      (name: string) =>
      async (...a: unknown[]) => (calls.push([name, ...a].join(":")), v);
    const controls = {
      view: async () => v,
      validateEngagement: c("validateEngagement"),
      suspendSheet: c("suspendSheet"),
      halt: c("halt"),
      resume: c("resume"),
      validateCampaign: c("validateCampaign"),
      suspendPlan: c("suspendPlan"),
      importEngagement: c("importEngagement"),
      importCampaign: c("importCampaign"),
    };
    return { calls, controls };
  };

  it("gestes valides routés (empreintes affichées) ; invalides et imports ignorés", async () => {
    const e = make();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", engagement: () => e.controls }),
    });
    const s = t.connect();
    s.say("engagement", "eng", { type: "ready" });
    await vi.waitFor(() => expect(s.of("engagement", "view")).toHaveLength(1));
    s.say("engagement", "eng", { type: "validateEngagement" });
    s.say("engagement", "eng", { type: "validateCampaign" });
    s.say("engagement", "eng", { type: "halt" });
    s.say("engagement", "eng", { type: "resume" });
    await vi.waitFor(() =>
      expect(e.calls).toEqual(["validateEngagement:e1", "validateCampaign:c1", "halt", "resume"]),
    );
    const before = t.bridge.stats().ignored;
    s.say("engagement", "eng", { type: "importEngagement" });
    s.say("engagement", "eng", { type: "validateEngagement", digest: "x" });
    s.say("engagement", "eng", { type: "openCitation", field: "nimporte" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 3));
  });

  it("arrêt global actif : le resume de la page engagement est refusé (seul shell/resume lève)", async () => {
    const e = make();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", engagement: () => e.controls }),
    });
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "halt" });
    await vi.waitFor(() => expect(t.hub.halted()).toBe(true));
    const s = t.connect();
    s.say("engagement", "eng", { type: "ready" });
    await vi.waitFor(() => expect(s.of("engagement", "view")).toHaveLength(1));
    const before = t.bridge.stats().ignored;
    s.say("engagement", "eng", { type: "resume" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(e.calls).toEqual([]);
  });
});

describe("vues cockpit, sessions et non branchées", () => {
  it("cockpit : ready charge la vue ; start routé puis vue rechargée et diffusée ; nom invalide ignoré", async () => {
    const calls: string[] = [];
    const t = setup(ctx, {
      backends: emptyBackends({
        cockpit: {
          load: async () => ({ type: "view", docker: "reachable" }) as never,
          link: async () => ({ type: "view" }) as never,
          setPrimary: async () => ({ type: "view" }) as never,
          control: async (a, n) => void calls.push(`${a}:${n}`),
        },
      }),
    });
    const s = t.connect();
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "start", name: "exegol-1" });
    s.say("cockpit", "ck", { type: "start", name: "" });
    s.say("cockpit", "ck", { type: "createExegol", name: "x y" });
    await vi.waitFor(() => expect(calls).toEqual(["start:exegol-1"]));
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(2));
    expect(t.bridge.stats().ignored).toBe(2);
  });

  it("sessions : tuiles des chats ouverts ; open d'un chat connu seulement", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    const s = t.connect();
    s.say("sessions", "grid", { type: "ready" });
    await vi.waitFor(() => expect(s.of("sessions", "view")).toHaveLength(1));
    expect(s.of("sessions", "view")[0]?.msg.tiles).toMatchObject([{ id: "f1", state: "idle" }]);
    s.say("sessions", "grid", { type: "open", chatId: "f1" });
    s.say("sessions", "grid", { type: "open", chatId: "inconnu" });
    await vi.waitFor(() =>
      expect(s.of("sessions", "open")).toEqual([
        expect.objectContaining({ msg: { type: "open", chatId: "f1" } }),
      ]),
    );
  });

  it("vues non branchées : acceptées par l'enveloppe, ignorées et comptées", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = t.connect();
    for (const view of ["killchain", "viewer", "term"]) s.say(view, "x", { type: "ready" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(3));
    expect(t.bridge.stats().accepted).toBe(0);
    expect(s.sent).toEqual([]);
  });

  it("socket fermé : plus de diffusion vers lui", async () => {
    const p = fakeProgram();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const a = t.connect();
    const b = t.connect();
    a.say("program", "prog", { type: "ready" });
    b.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(b.of("program", "view")).toHaveLength(1));
    a.close();
    b.say("program", "prog", { type: "refresh" });
    await vi.waitFor(() => expect(b.of("program", "view")).toHaveLength(2));
    expect(a.of("program", "view")).toHaveLength(1);
  });
});
