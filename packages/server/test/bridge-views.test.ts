import { CodedError } from "@warband/core";
import type { EngagementPageView } from "@warband/vscode/logic/engagement-controls";
import type { ProgramView } from "@warband/vscode/logic/program-controls";
import { describe, expect, it, vi } from "vitest";
import { isOpenWindowMessage } from "../src/bridge/shell-messages.js";
import {
  emptyBackends,
  type FakeSocket,
  nthDialog,
  replyDialog,
  setup,
  shellOf,
  uploadFor,
  useStorage,
} from "./bridge-helpers.js";

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
    importDraft: async (_text: string) => view,
    resume: async (h: string) => (calls.push(["resume", h]), { resumed: true, view }),
  };
  return { calls, controls, view };
}

describe("vue program", () => {
  it("ready : vue envoyée ; validate, suspend et resume routés après confirmation humaine", async () => {
    const p = fakeProgram();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = shellOf(t);
    const other = t.connect();
    s.say("program", "prog", { type: "ready" });
    other.say("program", "prog2", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    expect(s.of("program", "view")[0]?.frame).toBe("prog");

    s.say("program", "prog", { type: "validate" });
    const d1 = await nthDialog(s, 1);
    expect(d1).toMatchObject({ kind: "confirm" });
    expect(String(d1.text)).toContain("d1");
    // Tant que l'humain n'a pas répondu : rien n'est fait.
    await new Promise((r) => setTimeout(r, 30));
    expect(p.calls).toEqual([]);
    replyDialog(s, d1, true);
    await vi.waitFor(() => expect(p.calls).toEqual([["validate", "d1"]]));
    // Diffusé à tous les abonnés, chacun sur son cadre.
    await vi.waitFor(() => expect(other.of("program", "view")).toHaveLength(2));
    expect(other.of("program", "view").at(-1)?.frame).toBe("prog2");

    s.say("program", "prog", { type: "suspend" });
    replyDialog(s, await nthDialog(s, 2), true);
    await vi.waitFor(() => expect(p.calls).toHaveLength(2));
    s.say("program", "prog", { type: "resume", host: "API.example.com" });
    replyDialog(s, await nthDialog(s, 3), true);
    s.say("program", "prog", { type: "resume", host: "inconnu.example.com" });
    await vi.waitFor(() =>
      expect(p.calls).toEqual([["validate", "d1"], ["suspend"], ["resume", "api.example.com"]]),
    );
    // Hôte inconnu : aucun dialogue.
    expect(s.of("shell", "dialog")).toHaveLength(3);
  });

  it("confirmation refusée ou annulée : rien n'est écrit", async () => {
    const p = fakeProgram();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = shellOf(t);
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    s.say("program", "prog", { type: "validate" });
    replyDialog(s, await nthDialog(s, 1), false);
    s.say("program", "prog", { type: "suspend" });
    replyDialog(s, await nthDialog(s, 2), null);
    s.say("program", "prog", { type: "resume", host: "api.example.com" });
    replyDialog(s, await nthDialog(s, 3), false);
    await new Promise((r) => setTimeout(r, 50));
    expect(p.calls).toEqual([]);
  });

  it("le projet change pendant la confirmation : geste refusé", async () => {
    const p = fakeProgram();
    let active = "p1";
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => active, program: () => p.controls }),
    });
    const s = shellOf(t);
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    s.say("program", "prog", { type: "validate" });
    const d = await nthDialog(s, 1);
    active = "p2";
    replyDialog(s, d, true);
    await vi.waitFor(() =>
      expect(s.of("program", "error")[0]?.msg).toMatchObject({ code: "project.changed" }),
    );
    expect(p.calls).toEqual([]);
  });

  it("importFile : JSON valide importé et fichier supprimé ; annulation : rien ; fichier trop gros : refusé", async () => {
    const p = fakeProgram();
    const imported: string[] = [];
    p.controls.importDraft = async (text: string) => (imported.push(text), p.view);
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = shellOf(t);
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));

    s.say("program", "prog", { type: "importFile" });
    const d = await nthDialog(s, 1);
    expect(d).toMatchObject({ kind: "file", accept: [".json"], maxBytes: 1024 * 1024 });
    const id = await uploadFor(t, s, d, "fiche.json", '{"inScope":[]}');
    await vi.waitFor(() => expect(imported).toEqual(['{"inScope":[]}']));
    // Usage unique : l'identifiant ne se reprend pas, le fichier n'existe plus.
    expect(t.hub.context.uploads.take(id)).toBeUndefined();

    s.say("program", "prog", { type: "importFile" });
    replyDialog(s, await nthDialog(s, 2), null);
    // Plus de 256 Kio (limite d'une fiche, comme l'extension) : erreur affichée, rien importé.
    s.say("program", "prog", { type: "importFile" });
    await uploadFor(t, s, await nthDialog(s, 3), "gros.json", `"${"x".repeat(300 * 1024)}"`);
    await vi.waitFor(() =>
      expect(s.of("program", "error").at(-1)?.msg).toEqual({
        type: "error",
        code: "import.tooLarge",
      }),
    );
    // Non UTF-8 : refusé.
    s.say("program", "prog", { type: "importFile" });
    await uploadFor(t, s, await nthDialog(s, 4), "bin.json", Buffer.from([0xff, 0xfe, 0x00]));
    await vi.waitFor(() =>
      expect(s.of("program", "error").at(-1)?.msg).toEqual({
        type: "error",
        code: "import.badFile",
      }),
    );
    expect(imported).toHaveLength(1);
  });

  it("importFile : contenu rejeté par le cœur (JSON invalide) : code d'erreur sans détail", async () => {
    const p = fakeProgram();
    p.controls.importDraft = async () => {
      throw new CodedError("program.invalid");
    };
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = shellOf(t);
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    s.say("program", "prog", { type: "importFile" });
    await uploadFor(t, s, await nthDialog(s, 1), "x.json", "pas du json");
    await vi.waitFor(() =>
      expect(s.of("program", "error")[0]?.msg).toEqual({ type: "error", code: "program.invalid" }),
    );
  });

  it("openCitation : l'adresse de la vue (pas du navigateur) est proposée à ui.external ; askAgent : openWindow avec brouillon", async () => {
    const p = fakeProgram();
    p.view.inScope = { citation: { url: "https://exemple.org/regles" } } as never;
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", program: () => p.controls }),
    });
    const s = shellOf(t);
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() => expect(s.of("program", "view")).toHaveLength(1));
    s.say("program", "prog", { type: "openCitation", field: "inScope" });
    const d = await nthDialog(s, 1);
    expect(d).toMatchObject({ kind: "external", url: "https://exemple.org/regles" });
    // Champ sans citation : aucun dialogue.
    s.say("program", "prog", { type: "openCitation", field: "pace" });

    s.say("program", "prog", { type: "askAgent", url: "https://exemple.org/programme" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(1));
    const w = s.of("shell", "openWindow")[0]?.msg as Record<string, unknown>;
    expect(isOpenWindowMessage(w)).toBe(true);
    expect(w).toMatchObject({ view: "chat" });
    expect(String(w.frame)).toMatch(/^m-[0-9a-f]{6}$/);
    expect(String(w.draft)).toContain("https://exemple.org/programme");
    expect(String(w.draft).length).toBeLessThanOrEqual(4000);
    expect(s.of("shell", "dialog")).toHaveLength(1);
    // Rien n'est envoyé au moteur : la coquille ouvre la mission, l'humain envoie.
    expect(t.engine()).toBeUndefined();
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
      { type: "askAgent", url: "javascript:alert(1)" },
      { type: "askAgent", url: "https://u:p@example.com" },
      { type: "openCitation", field: "nimporte" },
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
    s2.say("shell", "shell", { type: "ready" });
    s2.say("program", "prog", { type: "validate" });
    replyDialog(s2, await nthDialog(s2, 1), true);
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

  it("halt et resume : aucun dialogue (geste d'urgence en un clic) ; validations et suspensions : confirmées", async () => {
    const e = make();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", engagement: () => e.controls }),
    });
    const s = shellOf(t);
    s.say("engagement", "eng", { type: "ready" });
    await vi.waitFor(() => expect(s.of("engagement", "view")).toHaveLength(1));
    s.say("engagement", "eng", { type: "halt" });
    s.say("engagement", "eng", { type: "resume" });
    await vi.waitFor(() => expect(e.calls).toEqual(["halt", "resume"]));
    expect(s.of("shell", "dialog")).toHaveLength(0);

    for (const [i, type] of ["validateEngagement", "validateCampaign"].entries()) {
      s.say("engagement", "eng", { type });
      const d = await nthDialog(s, i + 1);
      expect(d).toMatchObject({ kind: "confirm" });
      // Sans réponse : rien n'est écrit.
      await new Promise((r) => setTimeout(r, 20));
      expect(e.calls).toEqual(["halt", "resume", ...(i === 1 ? ["validateEngagement:e1"] : [])]);
      replyDialog(s, d, true);
      await vi.waitFor(() => expect(e.calls.at(-1)).toBe(`${type}:${i === 0 ? "e1" : "c1"}`));
    }
    // Refus : rien. Les empreintes sont celles de la vue affichée.
    s.say("engagement", "eng", { type: "suspendSheet" });
    replyDialog(s, await nthDialog(s, 3), false);
    await new Promise((r) => setTimeout(r, 30));
    expect(e.calls).toEqual(["halt", "resume", "validateEngagement:e1", "validateCampaign:c1"]);
    s.say("engagement", "eng", { type: "suspendSheet" });
    replyDialog(s, await nthDialog(s, 4), true);
    await vi.waitFor(() => expect(e.calls.at(-1)).toBe("suspendSheet"));
    // `suspendPlan` : le plan affiché ne peut pas être suspendu (canSuspend faux) : aucun dialogue.
    s.say("engagement", "eng", { type: "suspendPlan" });
    await new Promise((r) => setTimeout(r, 30));
    expect(s.of("shell", "dialog")).toHaveLength(4);
    const before = t.bridge.stats().ignored;
    s.say("engagement", "eng", { type: "validateEngagement", digest: "x" });
    s.say("engagement", "eng", { type: "openCitation", field: "nimporte" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 2));
  });

  it("imports engagement et campagne : JSON téléversé, jamais d'approbation ; trop gros ou sans réponse : rien", async () => {
    const e = make();
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", engagement: () => e.controls }),
    });
    const s = shellOf(t);
    s.say("engagement", "eng", { type: "ready" });
    await vi.waitFor(() => expect(s.of("engagement", "view")).toHaveLength(1));
    s.say("engagement", "eng", { type: "importEngagement" });
    const d1 = await nthDialog(s, 1);
    expect(d1).toMatchObject({ kind: "file", accept: [".json"], maxBytes: 1024 * 1024 });
    // Sans téléversement : rien.
    await new Promise((r) => setTimeout(r, 20));
    expect(e.calls).toEqual([]);
    await uploadFor(t, s, d1, "e.json", '{"a":1}');
    await vi.waitFor(() => expect(e.calls).toEqual(['importEngagement:{"a":1}']));
    s.say("engagement", "eng", { type: "importCampaign" });
    await uploadFor(t, s, await nthDialog(s, 2), "p.json", "[1]");
    await vi.waitFor(() => expect(e.calls).toHaveLength(2));
    s.say("engagement", "eng", { type: "importCampaign" });
    await uploadFor(t, s, await nthDialog(s, 3), "gros.json", "x".repeat(300 * 1024));
    await vi.waitFor(() =>
      expect(s.of("engagement", "error").at(-1)?.msg).toEqual({
        type: "error",
        code: "import.tooLarge",
      }),
    );
    expect(e.calls).toHaveLength(2);
  });

  it("openCitation : adresse de la vue via ui.external", async () => {
    const e = make();
    const view = engagementView();
    view.sheet = { inScope: { citation: { url: "https://exemple.org/lettre" } } } as never;
    e.controls.view = async () => view;
    const t = setup(ctx, {
      backends: emptyBackends({ activeProjectId: async () => "p1", engagement: () => e.controls }),
    });
    const s = shellOf(t);
    s.say("engagement", "eng", { type: "ready" });
    await vi.waitFor(() => expect(s.of("engagement", "view")).toHaveLength(1));
    s.say("engagement", "eng", { type: "openCitation", field: "inScope" });
    expect(await nthDialog(s, 1)).toMatchObject({
      kind: "external",
      url: "https://exemple.org/lettre",
    });
    s.say("engagement", "eng", { type: "openCitation", field: "window" });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.of("shell", "dialog")).toHaveLength(1);
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
          images: async () => [],
          remove: async (name) => ({ status: "cancelled", name }),
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

  it("sessions : tuiles des chats ouverts et historique complet ; open d'un chat ou d'une conversation connus seulement", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const uuid = "11111111-2222-3333-4444-555555555555";
    t.hub.context.storage.state.set("history.index", [
      {
        id: uuid,
        title: "Ancienne mission",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        provider: "claude",
        model: null,
        effort: null,
        sessionId: null,
        runIds: [],
        tools: 0,
      },
    ]);
    const chat = shellOf(t);
    chat.say("chat", "f1", { type: "ready" });
    const s = shellOf(t);
    s.say("sessions", "grid", { type: "ready" });
    await vi.waitFor(() => expect(s.of("sessions", "view")).toHaveLength(1));
    const view = s.of("sessions", "view")[0]?.msg;
    expect(view?.tiles).toMatchObject([{ id: "f1", state: "idle" }]);
    expect(view?.history).toEqual([
      {
        id: uuid,
        title: "Ancienne mission",
        project: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
        live: false,
      },
    ]);
    s.say("sessions", "grid", { type: "open", chatId: "f1" });
    s.say("sessions", "grid", { type: "open", chatId: uuid });
    s.say("sessions", "grid", { type: "open", chatId: "inconnu" });
    s.say("sessions", "grid", { type: "open", chatId: "../x" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(2));
    expect(s.of("shell", "openWindow").map((e) => e.msg)).toEqual([
      { type: "openWindow", view: "chat", frame: "f1" },
      { type: "openWindow", view: "chat", frame: uuid },
    ]);
    expect(s.of("shell", "openWindow").every((e) => isOpenWindowMessage(e.msg))).toBe(true);
    expect(s.of("sessions", "open")).toEqual([]);
  });

  it("killchain, viewer, term : un message inconnu est ignoré et compté, sans réponse", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = t.connect();
    for (const view of ["killchain", "viewer", "term"]) s.say(view, "x", { type: "inconnu" });
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
