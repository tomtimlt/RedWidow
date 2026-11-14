import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { appendFinding, createProject, readFindings } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY } from "../src/bridge/deps.js";
import { isOpenWindowMessage, openWindowMessage } from "../src/bridge/shell-messages.js";
import { INTEGRATIONS_KEY, parseStudioExtra } from "../src/bridge/studio-extra.js";
import {
  createLinkedProject,
  emptyBackends,
  type FakeSocket,
  type Msg,
  nthDialog,
  replyDialog,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();
const SECRET = "cle-SECRETE-9f3a7c1d";
const settle = (ms = 60) => new Promise((ok) => setTimeout(ok, ms));
type T = ReturnType<typeof setup>;

async function fixture() {
  const configDir = join(ctx.dir, "config");
  await mkdir(configDir, { recursive: true });
  const workspace = join(ctx.dir, "containers", "box", "alpha");
  await mkdir(workspace, { recursive: true });
  const project = await createLinkedProject(configDir, { name: "Alpha", workspace });
  return { configDir, project };
}

const setupX = (extra: Parameters<typeof setup>[1] = {}) =>
  setup(ctx, { backends: emptyBackends(), killchainPollMs: 0, ...extra });

function studio(t: T) {
  const s = shellOf(t);
  s.say("studio", "st", { type: "ready" });
  return s;
}
const say = (s: FakeSocket, m: Msg) => s.say("studio", "st", m);
const settings = () => JSON.stringify(ctx.storage.state.get(SETTINGS_KEY) ?? {});
const sent = (s: FakeSocket) => JSON.stringify(s.sent);
/** Répond au `n`-ième dialogue ; renvoie sa description. */
async function reply(s: FakeSocket, n: number, value: unknown) {
  const d = await nthDialog(s, n);
  replyDialog(s, d, value);
  return d;
}

describe("studio partie B : forme et refus sans humain", () => {
  it("parseStudioExtra : forme exacte seulement", () => {
    expect(parseStudioExtra({ type: "diagnostic" })).toEqual({ type: "diagnostic" });
    expect(parseStudioExtra({ type: "diagnostic", x: 1 })).toBeNull();
    expect(parseStudioExtra({ type: "autre" })).toBeNull();
  });

  it("chooseProfile, configureBurp, addProvider annulés : rien n'est écrit", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "chooseProfile" });
    await reply(s, 1, null);
    say(s, { type: "configureBurp" });
    await reply(s, 2, null);
    say(s, { type: "configureProvider", id: "add" });
    await reply(s, 3, null);
    await settle();
    expect(settings()).not.toContain("profile");
    expect(settings()).not.toContain("burp");
    expect(settings()).not.toContain("venator-");
    expect(t.audit.filter((e) => e.kind === "settings.set" || e.kind === "provider.add")).toEqual(
      [],
    );
  });

  it("openFreeGuideLink : ui.external (rien sans réponse)", async () => {
    const t = setupX();
    const s = studio(t);
    say(s, { type: "openFreeGuideLink", key: "zen" });
    const d = await nthDialog(s);
    expect(d).toMatchObject({ kind: "external", url: "https://opencode.ai/docs/zen/" });
    replyDialog(s, d, false);
    await settle();
  });
});

describe("studio partie B : Burp", () => {
  it("configureBurp : port et transport seulement (aucune saisie d'hôte), réglages validés", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "configureBurp" });
    await reply(s, 1, "enable");
    const port = await reply(s, 2, "9999");
    expect(String(port.title)).toContain("127.0.0.1");
    await reply(s, 3, "sse");
    await vi.waitFor(() => expect(settings()).toContain("9999"));
    expect(s.of("shell", "dialog")).toHaveLength(3);
    expect(settings()).not.toMatch(/burp\.host|"host"/);
    expect(t.audit.some((e) => e.kind === "burp.configure" && e.port === 9999)).toBe(true);
  });

  it("configureBurp : port invalide refusé, rien d'écrit", async () => {
    const t = setupX();
    const s = studio(t);
    say(s, { type: "configureBurp" });
    await reply(s, 1, "enable");
    await reply(s, 2, "70000");
    await vi.waitFor(() =>
      expect(s.of("studio", "burpResult").at(-1)?.msg).toMatchObject({ error: true }),
    );
    expect(settings()).not.toContain("burp");
  });

  it("testBurp : délai borné même si le client ne répond jamais ; succès compté", async () => {
    const t = setupX({
      studioExtra: {
        burpTestMs: 40,
        burpBackend: () => ({ list: () => new Promise(() => undefined), call: async () => ({}) }),
      } as never,
    });
    const s = studio(t);
    await ctx.storage.state.set(SETTINGS_KEY, { "burp.enabled": true, "burp.port": 9876 });
    say(s, { type: "testBurp" });
    await vi.waitFor(() =>
      expect(s.of("studio", "burpResult").at(-1)?.msg).toMatchObject({ error: true }),
    );
    const t2 = setupX({
      studioExtra: {
        burpBackend: () => ({ list: async () => ({ tools: [1, 2, 3] }), call: async () => ({}) }),
      } as never,
    });
    const s2 = studio(t2);
    say(s2, { type: "testBurp" });
    await vi.waitFor(() =>
      expect(s2.of("studio", "burpResult").at(-1)?.msg).toMatchObject({ error: false }),
    );
    expect(String(s2.of("studio", "burpResult").at(-1)?.msg.text)).toContain("3");
  });
});

describe("studio partie B : services MCP", () => {
  it("configureMcp sans confirmation : rien ; confirmé : point d'accès exact affiché puis écrit", async () => {
    const { project } = await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "configureMcp", id: "playwright" });
    await reply(s, 1, "configure");
    await reply(s, 2, "9900");
    await reply(s, 3, "http");
    await reply(s, 4, "/mcp");
    const c = await nthDialog(s, 5);
    expect(c).toMatchObject({ kind: "confirm", danger: true });
    expect(String(c.text)).toContain("http://127.0.0.1:9900/mcp");
    replyDialog(s, c, false);
    await settle();
    expect(ctx.storage.state.get(INTEGRATIONS_KEY)).toBeUndefined();
    say(s, { type: "configureMcp", id: "playwright" });
    await reply(s, 6, "configure");
    await reply(s, 7, "9900");
    await reply(s, 8, "http");
    await reply(s, 9, "/mcp");
    await reply(s, 10, true);
    await vi.waitFor(() =>
      expect(JSON.stringify(ctx.storage.state.get(INTEGRATIONS_KEY))).toContain("9900"),
    );
    expect(JSON.stringify(ctx.storage.state.get(INTEGRATIONS_KEY))).toContain(project.id);
  });

  it("configureMcp : chemin avec URL ou traversée refusé ; plus de quatre services refusé", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "configureMcp", id: "playwright" });
    await reply(s, 1, "configure");
    await reply(s, 2, "9900");
    await reply(s, 3, "http");
    await reply(s, 4, "//evil.example/../x");
    await settle();
    expect(s.of("shell", "dialog")).toHaveLength(4);
    expect(ctx.storage.state.get(INTEGRATIONS_KEY)).toBeUndefined();
    say(s, { type: "configureIntegrations" });
    await reply(s, 5, ["playwright", "filesystem", "markitdown", "reptor", "burp-x"]);
    await settle();
    expect(ctx.storage.state.get(INTEGRATIONS_KEY)).toBeUndefined();
  });

  it("configureIntegrations : sélection enregistrée avec des ports distincts", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "configureIntegrations" });
    await reply(s, 1, ["playwright", "markitdown"]);
    await vi.waitFor(() => expect(ctx.storage.state.get(INTEGRATIONS_KEY)).toBeDefined());
    const text = JSON.stringify(ctx.storage.state.get(INTEGRATIONS_KEY));
    expect(text).toContain("9877");
    expect(text).toContain("9878");
  });
});

describe("studio partie B : comptes de test, audit", () => {
  it("saveTestAccount : secret au coffre, jamais dans un message ni l'audit ; deleteTestAccount le retire", async () => {
    const { project } = await fixture();
    const t = setupX();
    const s = studio(t);
    const account = {
      label: "ADMIN",
      host: "",
      identifier: "root",
      secret: SECRET,
      kind: "password",
    };
    say(s, { type: "saveTestAccount", projectId: project.id, account });
    await vi.waitFor(() => expect(t.audit.some((e) => e.kind === "account.add")).toBe(true));
    const list = t.hub.context.storage.state.get("accounts");
    expect(JSON.stringify(list)).toContain("ADMIN");
    expect(JSON.stringify(list)).not.toContain(SECRET);
    await settle();
    expect(sent(s)).not.toContain(SECRET);
    expect(JSON.stringify(t.audit)).not.toContain(SECRET);
    say(s, { type: "deleteTestAccount", projectId: project.id, label: "ADMIN" });
    await vi.waitFor(() => expect(t.audit.some((e) => e.kind === "account.remove")).toBe(true));
  });

  it("saveTestAccount : projet non actif refusé", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, {
      type: "saveTestAccount",
      projectId: "00000000-0000-4000-8000-000000000000",
      account: { label: "ADMIN", host: "", identifier: "r", secret: SECRET, kind: "password" },
    });
    await settle(100);
    expect(t.audit.some((e) => e.kind === "account.add")).toBe(false);
    expect(sent(s)).not.toContain(SECRET);
  });

  it("setAuditEnabled puis exportAudit : ZIP offert à l'émetteur, sans valeur secrète", async () => {
    const { project } = await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "setAuditEnabled", projectId: project.id, enabled: true });
    await vi.waitFor(() => expect(t.audit.some((e) => e.kind === "audit.enabled")).toBe(true));
    say(s, { type: "exportAudit", projectId: project.id });
    await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(1));
    const d = s.of("shell", "download")[0]?.msg as { id: string; filename: string };
    expect(d.filename).toMatch(/^venator-audit-.*\.zip$/);
    const file = t.hub.context.downloads.take(d.id);
    expect(file?.mime).toBe("application/zip");
    expect(file?.body.toString("latin1")).not.toContain(SECRET);
    expect(JSON.stringify(t.audit)).not.toContain(SECRET);
  });
});

describe("studio partie B : cours, espace de travail, mission", () => {
  it("openWindow files : champ path validé comme les chemins de l'API Fichiers", () => {
    expect(isOpenWindowMessage(openWindowMessage("files", "main", { path: "cours" }))).toBe(true);
    expect(isOpenWindowMessage(openWindowMessage("files", "main"))).toBe(true);
    for (const path of ["../x", "/etc", "a\\b", "a/../b", ""])
      expect(isOpenWindowMessage(openWindowMessage("files", "main", { path }))).toBe(false);
    expect(isOpenWindowMessage(openWindowMessage("chat", "c1", { path: "cours" }))).toBe(false);
  });

  it("openCours : crée <projet>/cours puis openWindow files path:cours ; openWorkspace sans path", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    say(s, { type: "openCours" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(1));
    expect(s.of("shell", "openWindow")[0]?.msg).toMatchObject({
      view: "files",
      frame: "main",
      path: "cours",
    });
    expect((await stat(join(ctx.dir, "containers", "box", "alpha", "cours"))).isDirectory()).toBe(
      true,
    );
    say(s, { type: "openWorkspace" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(2));
    expect(s.of("shell", "openWindow")[1]?.msg).toMatchObject({ view: "files" });
    expect(s.of("shell", "openWindow")[1]?.msg.path).toBeUndefined();
    say(s, { type: "prepareMission" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(3));
    expect(s.of("shell", "openWindow")[2]?.msg).toMatchObject({ view: "chat" });
  });

  it("openCours : espace de travail hors de la racine des projets, rien n'est créé", async () => {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    const outside = join(ctx.dir, "ailleurs");
    await mkdir(outside, { recursive: true });
    await createProject(configDir, { name: "Hors", workspace: outside });
    const t = setupX();
    const s = studio(t);
    say(s, { type: "openCours" });
    await settle(100);
    expect(s.of("shell", "openWindow")).toHaveLength(0);
    await expect(stat(join(outside, "cours"))).rejects.toThrow();
  });
});

describe("studio partie B : fournisseur personnalisé", () => {
  async function add(s: FakeSocket, url: string, key: string, from = 1) {
    say(s, { type: "configureProvider", id: "add" });
    await reply(s, from, "Mon LLM");
    await reply(s, from + 1, url);
    return url.startsWith("https://") || url.startsWith("http://localhost")
      ? [await reply(s, from + 2, "m1,m2"), await reply(s, from + 3, key)]
      : [];
  }

  it("clé au coffre, jamais dans les réglages, les messages ni l'audit", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    await add(s, "https://api.exemple.test/v1", SECRET);
    await vi.waitFor(() => expect(settings()).toContain("venator-mon-llm"));
    expect(settings()).not.toContain(SECRET);
    await settle();
    expect(sent(s)).not.toContain(SECRET);
    expect(JSON.stringify(t.audit)).not.toContain(SECRET);
    expect(t.audit.some((e) => e.kind === "provider.add" && e.keyed === true)).toBe(true);
  });

  it("baseURL http distante ou avec secret refusée ; http vers localhost admis", async () => {
    await fixture();
    const t = setupX();
    const s = studio(t);
    await add(s, "http://api.distante.test/v1", "");
    await settle();
    expect(settings()).not.toContain("venator-");
    expect(s.of("shell", "dialog")).toHaveLength(2);
    const t2 = setupX();
    const s2 = studio(t2);
    await add(s2, "https://u:p@api.exemple.test/v1", "");
    await settle();
    expect(settings()).not.toContain("venator-");
    const t3 = setupX();
    const s3 = studio(t3);
    await add(s3, "http://localhost:11434/v1", "");
    await vi.waitFor(() => expect(settings()).toContain("venator-mon-llm"));
  });
});

describe("studio partie B : diagnostic", () => {
  it("sortie masquée et bornée à 64 Kio, à l'émetteur seul", async () => {
    const t = setupX({
      studioExtra: {
        diagnostic: async () => ({ code: 0, output: `ok ${"x".repeat(200_000)}` }),
      } as never,
    });
    const s = studio(t);
    const autre = studio(t);
    say(s, { type: "diagnostic" });
    await vi.waitFor(() => expect(s.of("studio", "diagnosticResult")).toHaveLength(1));
    const text = String(s.of("studio", "diagnosticResult")[0]?.msg.text);
    expect(text.length).toBeLessThanOrEqual(64 * 1024);
    expect(autre.of("studio", "diagnosticResult")).toHaveLength(0);
  });

  it("valeur secrète de l'environnement masquée", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZ";
    try {
      const t = setupX({
        studioExtra: {
          diagnostic: async () => ({ code: 1, output: `clé ${process.env.ANTHROPIC_API_KEY}` }),
        } as never,
      });
      const s = studio(t);
      say(s, { type: "diagnostic" });
      await vi.waitFor(() => expect(s.of("studio", "diagnosticResult")).toHaveLength(1));
      const m = s.of("studio", "diagnosticResult")[0]?.msg;
      expect(String(m?.text)).not.toContain("ZZZZZZZZ");
      expect(m?.error).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("studio partie B : gestes Kill chain (réutilisation de M3)", () => {
  it("deleteFinding : confirmation humaine requise, réponse sur le cadre du studio", async () => {
    const { configDir, project } = await fixture();
    const f = await appendFinding(configDir, project.id, {
      kind: "host",
      state: "confirmed",
      label: "Hôte 10.0.0.5",
    });
    const t = setupX();
    const s = studio(t);
    say(s, { type: "deleteFinding", projectId: project.id, id: f.id });
    await reply(s, 1, false);
    await vi.waitFor(() => expect(s.of("studio", "findingDeleteState").length).toBeGreaterThan(0));
    expect((await readFindings(configDir, project.id)).some((x) => x.id === f.id)).toBe(true);
    say(s, { type: "deleteFinding", projectId: project.id, id: f.id });
    await reply(s, 2, true);
    await vi.waitFor(async () =>
      expect((await readFindings(configDir, project.id)).some((x) => x.id === f.id)).toBe(false),
    );
  });

  it("exportKillchain : téléchargement offert au seul émetteur", async () => {
    const { configDir, project } = await fixture();
    await appendFinding(configDir, project.id, { kind: "host", state: "confirmed", label: "H" });
    const t = setupX();
    const s = studio(t);
    say(s, { type: "exportKillchain", projectId: project.id });
    await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(1));
    expect(studio(t).of("shell", "download")).toHaveLength(0);
  });
});
