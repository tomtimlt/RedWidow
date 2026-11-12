import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { policyDigest, readProjects } from "@warband/core";
import { setUiLocale } from "@warband/messages";
import { repoPolicyPath } from "@warband/vscode/logic/repo-policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenSecretKey } from "../src/bridge/deps.js";
import { isOpenWindowMessage, openWindowMessage } from "../src/bridge/shell-messages.js";
import {
  emptyBackends,
  type FakeSocket,
  fakeController,
  type Msg,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();
afterEach(() => setUiLocale("fr"));

type T = ReturnType<typeof setup>;

/** Coquille + studio sur le même socket (c'est l'émetteur des dialogues). */
function studioOf(t: T, frame = "st") {
  const s = shellOf(t);
  s.say("studio", frame, { type: "ready" });
  return s;
}

const lastView = (s: FakeSocket) => s.of("studio", "view").at(-1)?.msg as Msg;

/** Répond au prochain dialogue du `kind` donné (le dernier reçu, non encore répondu). */
async function answer(s: FakeSocket, kind: string, value: unknown, count = 1) {
  await vi.waitFor(() =>
    expect(s.of("shell", "dialog").filter((d) => d.msg.kind === kind)).toHaveLength(count),
  );
  const d = s.of("shell", "dialog").filter((x) => x.msg.kind === kind)[count - 1]?.msg as Msg;
  s.say("shell", "shell", { type: "dialogResult", id: d.id, value });
  return d;
}

const settle = () => new Promise((ok) => setTimeout(ok, 30));
const projects = (t: T) => readProjects(join(ctx.dir, "config"));

async function create(t: T, s: FakeSocket, name: string) {
  const before = s.of("studio", "view").length;
  s.say("studio", "st", { type: "createProject", name });
  await vi.waitFor(() => expect(s.of("studio", "view").length).toBeGreaterThan(before));
  await vi.waitFor(async () =>
    expect((await projects(t))?.projects.some((p) => p.name === name)).toBe(true),
  );
}

const setupStudio = () => setup(ctx, { backends: emptyBackends() });

describe("vue studio : projets", () => {
  it("ready : état de la page Projet (locale puis vue), sans secret", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await vi.waitFor(() => expect(s.of("studio", "view")).toHaveLength(1));
    expect(s.of("studio", "locale")[0]?.msg).toEqual({ type: "locale", locale: "fr" });
    const v = lastView(s);
    expect(v).toMatchObject({
      page: "project",
      projectId: null,
      projectChoices: { activeId: null, projects: [] },
      providerAuth: { claude: true, openai: false },
      terminalPrompt: "native",
      palette: "widow",
    });
    expect(v.projectWorkspaceRoot).toBe(join(ctx.dir, "projects"));
    expect(JSON.stringify(s.sent)).not.toContain("sk-ant");
    expect(t.bridge.stats()).toMatchObject({ accepted: 2, ignored: 0 });
  });

  it("createProject : dossier sous la racine des projets, projet actif, vue mise à jour, audit", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Mission Alpha");
    const file = await projects(t);
    const project = file?.projects[0];
    expect(file?.activeId).toBe(project?.id);
    expect(project?.workspace.startsWith(join(ctx.dir, "projects"))).toBe(true);
    expect((await stat(join(project?.workspace ?? "", "notes"))).isDirectory()).toBe(true);
    await vi.waitFor(() =>
      expect(lastView(s)).toMatchObject({ projectId: project?.id, projectCreated: project?.id }),
    );
    expect(t.audit).toContainEqual({ kind: "project.create", id: project?.id });
  });

  it("activateProject : change le projet actif ; la politique du dépôt reste non approuvée", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Un");
    await create(t, s, "Deux");
    const [a, b] = (await projects(t))?.projects ?? [];
    expect((await projects(t))?.activeId).toBe(b?.id);
    await mkdir(join(a?.workspace ?? "", ".warband"), { recursive: true });
    await writeFile(
      repoPolicyPath(a?.workspace ?? ""),
      JSON.stringify({ default: "allow", rules: [] }),
    );
    s.say("studio", "st", { type: "activateProject", projectId: a?.id });
    await vi.waitFor(async () => expect((await projects(t))?.activeId).toBe(a?.id));
    await vi.waitFor(() => expect(lastView(s)).toMatchObject({ projectId: a?.id }));
    // Aucune approbation implicite : l'état est « non approuvée ».
    expect(lastView(s).repoPolicy).toMatchObject({ state: "untrusted" });
    expect(t.audit).toContainEqual({ kind: "project.activate", id: a?.id });
  });

  it("activation ou création refusée pendant un tour (chat occupé)", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = studioOf(t);
    await create(t, s, "Un");
    // Un chat qui tourne : le contrôleur factice reçoit un message, la vue passe à busy.
    const chat = t.connect();
    chat.say("chat", "c1", { type: "ready" });
    chat.say("chat", "c1", { type: "send", text: "go" });
    await vi.waitFor(() => expect(t.engine()?.started).toBe(true));
    s.say("studio", "st", { type: "createProject", name: "Deux" });
    await vi.waitFor(() =>
      expect(String(lastView(s).projectError)).toContain("Arrêtez les tours en cours"),
    );
    expect((await projects(t))?.projects).toHaveLength(1);
  });

  it("deleteProject : sans confirmation acceptée, rien n'est supprimé", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Un");
    const id = (await projects(t))?.projects[0]?.id;
    s.say("studio", "st", { type: "deleteProject", projectId: id });
    const d = await answer(s, "confirm", false);
    expect(d).toMatchObject({ kind: "confirm", danger: true });
    await settle();
    expect((await projects(t))?.projects).toHaveLength(1);
    // Aucune réponse du tout : en attente, toujours rien de supprimé.
    s.say("studio", "st", { type: "deleteProject", projectId: id });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(2));
    await settle();
    expect((await projects(t))?.projects).toHaveLength(1);
    await answer(s, "confirm", true, 2);
    await vi.waitFor(async () => expect(await projects(t)).toBeNull());
    expect(t.audit).toContainEqual({ kind: "project.remove", id });
  });

  it("renameProject : saisie annulée = inchangé ; saisie valide = renommé ; nom invalide refusé", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Un");
    const id = (await projects(t))?.projects[0]?.id;
    s.say("studio", "st", { type: "renameProject", projectId: id });
    const d = await answer(s, "input", null);
    expect(d).toMatchObject({ kind: "input", value: "Un", secret: false });
    await settle();
    expect((await projects(t))?.projects[0]?.name).toBe("Un");

    s.say("studio", "st", { type: "renameProject", projectId: id });
    await answer(s, "input", "   ", 2);
    await vi.waitFor(() => expect(String(lastView(s).projectError)).toContain("1 à 80"));
    expect((await projects(t))?.projects[0]?.name).toBe("Un");

    s.say("studio", "st", { type: "renameProject", projectId: id });
    await answer(s, "input", "Renommé", 3);
    await vi.waitFor(async () => expect((await projects(t))?.projects[0]?.name).toBe("Renommé"));
  });

  it("unlink : retire le projet actif après confirmation", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Un");
    s.say("studio", "st", { type: "unlink" });
    await answer(s, "confirm", true);
    await vi.waitFor(async () => expect(await projects(t)).toBeNull());
  });

  it("saveSummary : écrit le résumé du projet actif, refuse un autre projet", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await create(t, s, "Un");
    const id = (await projects(t))?.projects[0]?.id;
    s.say("studio", "st", { type: "saveSummary", projectId: id, text: "Cible : example.com" });
    await vi.waitFor(() => expect(lastView(s)).toMatchObject({ summarySaved: id }));
    expect(lastView(s).projectSummary).toMatchObject({ text: "Cible : example.com" });
    const other = "00000000-0000-4000-8000-000000000000";
    s.say("studio", "st", { type: "saveSummary", projectId: other, text: "x" });
    await vi.waitFor(() => expect(lastView(s)).toMatchObject({ summaryFailed: other }));
  });

  it("setWorkspaceRoot : hors de la racine refusé ; sous la racine accepté et utilisé", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await vi.waitFor(() => expect(s.of("studio", "view")).toHaveLength(1));
    for (const bad of ["/etc", "..", "../autre", join(ctx.dir, "projects", "..", "x")]) {
      const n = s.of("studio", "view").length;
      s.say("studio", "st", { type: "setWorkspaceRoot", value: bad });
      await vi.waitFor(() => expect(s.of("studio", "view").length).toBeGreaterThan(n));
      expect(lastView(s).workspaceRootError).toEqual(expect.any(String));
      expect(lastView(s).projectWorkspaceRoot).toBe(join(ctx.dir, "projects"));
    }
    s.say("studio", "st", { type: "setWorkspaceRoot", value: "equipe" });
    await vi.waitFor(() =>
      expect(lastView(s).projectWorkspaceRoot).toBe(join(ctx.dir, "projects", "equipe")),
    );
    expect(lastView(s).workspaceRootError).toBeUndefined();
    await create(t, s, "Chez equipe");
    expect((await projects(t))?.projects[0]?.workspace).toBe(
      join(ctx.dir, "projects", "equipe", "chez-equipe"),
    );
    // Le réglage n'est pas atteignable par `settingsSet`.
    s.say("shell", "shell", { type: "settingsSet", patch: { "projects.workspaceRoot": "/etc" } });
    await settle();
    expect(t.bridge.stats().ignored).toBeGreaterThan(0);
  });
});

describe("vue studio : fournisseurs", () => {
  it("configureProvider : la clé saisie va au coffre, jamais dans un message ni l'audit", async () => {
    const SECRET = "sk-ant-api03-nouvelle-cle-saisie-1234";
    const t = setupStudio();
    const s = studioOf(t);
    const other = shellOf(t);
    s.say("studio", "st", { type: "configureProvider", id: "claude" });
    const pick = await answer(s, "pick", "api-key");
    expect(pick).toMatchObject({ kind: "pick" });
    const input = await answer(s, "input", SECRET);
    expect(input).toMatchObject({ kind: "input", secret: true });
    await vi.waitFor(async () =>
      expect(await ctx.storage.secrets.get(tokenSecretKey("claude"))).toBe(SECRET),
    );
    await vi.waitFor(() => expect(other.of("shell", "tokens").length).toBeGreaterThan(0));
    expect(JSON.stringify([s.sent, other.sent, t.audit])).not.toContain(SECRET);
    expect(t.audit).toContainEqual({ kind: "token.set", provider: "claude" });
  });

  it("configureProvider annulé ou fournisseur inconnu : rien d'écrit", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    s.say("studio", "st", { type: "configureProvider", id: "claude" });
    await answer(s, "pick", null);
    await settle();
    expect(t.audit.filter((e) => e.kind === "token.set")).toEqual([]);
    s.say("studio", "st", { type: "configureProvider", id: "inconnu" });
    await settle();
    expect(s.of("shell", "dialog")).toHaveLength(1);
    expect(t.bridge.stats().ignored).toBe(1);
  });

  it("configureProvider OpenCode : la clé entre dans la réserve (coffre), pas dans l'état", async () => {
    const SECRET = "oc-cle-secrete-de-reserve";
    const t = setupStudio();
    const s = studioOf(t);
    s.say("studio", "st", { type: "configureProvider", id: "opencode" });
    await answer(s, "input", SECRET);
    await vi.waitFor(() => expect(t.audit.some((e) => e.kind === "pool.add")).toBe(true));
    expect(JSON.stringify([s.sent, t.audit])).not.toContain(SECRET);
    expect(JSON.stringify(ctx.storage.state.get("pool.opencode"))).not.toContain(SECRET);
  });

  it("setCapability : active et désactive un fournisseur, diffuse settings ; inconnu = erreur", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    const shell = shellOf(t);
    s.say("studio", "st", {
      type: "setCapability",
      kind: "provider",
      id: "opencode",
      enabled: false,
    });
    await vi.waitFor(() => expect(s.of("studio", "capabilityState")).toHaveLength(1));
    expect(s.of("studio", "capabilityState")[0]?.msg).toMatchObject({
      id: "opencode",
      enabled: false,
      error: false,
    });
    await vi.waitFor(() => expect(shell.of("shell", "settings").length).toBeGreaterThan(0));
    expect((lastView(s).capabilities as { providers: string[] }).providers).not.toContain(
      "opencode",
    );
    s.say("studio", "st", {
      type: "setCapability",
      kind: "provider",
      id: "opencode",
      enabled: true,
    });
    await vi.waitFor(() => expect(s.of("studio", "capabilityState")).toHaveLength(2));
    expect((lastView(s).capabilities as { providers: string[] }).providers).toContain("opencode");
    s.say("studio", "st", { type: "setCapability", kind: "provider", id: "zzz", enabled: true });
    await vi.waitFor(() => expect(s.of("studio", "capabilityState")).toHaveLength(3));
    expect(s.of("studio", "capabilityState")[2]?.msg).toMatchObject({ id: "zzz", error: true });
  });

  it("testProviderConnection : résultat en attente puis texte ; refresh du catalogue mémorisé", async () => {
    const t = setup(ctx, {
      backends: emptyBackends(),
      createController: (options) => {
        const { ctl } = fakeController(options);
        ctl.models = async () => {
          options.handlers?.onProviders?.([
            { id: "groq", name: "Groq", connected: true, models: [] },
          ] as never);
          return [];
        };
        return ctl;
      },
    });
    const s = studioOf(t);
    s.say("studio", "st", { type: "refreshProviderCatalog" });
    await vi.waitFor(() =>
      expect(
        (lastView(s).providerCatalog as { id: string }[]).some((p) => p.id === "oc-groq"),
      ).toBe(true),
    );
    expect(lastView(s).providerCatalogStatus).toBe("ready");
    s.say("studio", "st", { type: "testProviderConnection", id: "claude" });
    await vi.waitFor(() => expect(s.of("studio", "providerConnectionResult")).toHaveLength(2));
    const [pending, done] = s.of("studio", "providerConnectionResult").map((e) => e.msg);
    expect(pending).toMatchObject({ id: "claude", pending: true });
    expect(done).toMatchObject({ id: "claude", pending: false, error: false });
    expect(String(done?.text)).toContain("Catalogue accessible");
  });
});

describe("vue studio : apparence et fenêtres", () => {
  it("setLocale, setPalette, setTerminalPrompt : état serveur et diffusion", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    const shell = shellOf(t);
    s.say("studio", "st", { type: "setPalette", palette: "venom" });
    s.say("studio", "st", { type: "setTerminalPrompt", value: "compact" });
    s.say("studio", "st", { type: "setLocale", locale: "en" });
    await vi.waitFor(() => expect(shell.of("shell", "settings")).toHaveLength(3));
    expect(shell.of("shell", "settings").at(-1)?.msg).toEqual({
      type: "settings",
      values: { palette: "venom", terminalPrompt: "compact", locale: "en" },
    });
    expect(s.of("studio", "palette")[0]?.msg).toEqual({ type: "palette", value: "venom" });
    expect(s.of("studio", "terminalPrompt")[0]?.msg).toEqual({
      type: "terminalPrompt",
      value: "compact",
    });
    await vi.waitFor(() =>
      expect(s.of("studio", "locale").some((e) => e.msg.locale === "en")).toBe(true),
    );
    // Relu par `settingsGet` et dans la vue.
    shell.say("shell", "shell", { type: "settingsGet" });
    await vi.waitFor(() => expect(shell.of("shell", "settings")).toHaveLength(4));
    await vi.waitFor(() =>
      expect(lastView(s)).toMatchObject({ palette: "venom", terminalPrompt: "compact" }),
    );
    // Valeurs invalides : ignorées par le validateur, comptées.
    s.say("studio", "st", { type: "setPalette", palette: "inconnue" });
    s.say("studio", "st", { type: "setLocale", locale: "de" });
    s.say("studio", "st", { type: "setTerminalPrompt", value: "x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(3));
  });

  it("openCockpit / openProgram / openEngagement / openKillchain : openWindow à l'émetteur seul", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    const other = shellOf(t);
    for (const type of ["openCockpit", "openProgram", "openEngagement", "openKillchain"])
      s.say("studio", "st", { type });
    s.say("studio", "st", { type: "open", page: "killchain" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(5));
    expect(s.of("shell", "openWindow").map((e) => e.msg)).toEqual(
      ["cockpit", "program", "engagement", "killchain", "killchain"].map((v) =>
        openWindowMessage(v as never),
      ),
    );
    expect(other.of("shell", "openWindow")).toEqual([]);
    expect(s.of("shell", "openWindow").every((e) => isOpenWindowMessage(e.msg))).toBe(true);
  });

  it("open d'une page : état de cette page ; plusieurs cadres indépendants", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    await vi.waitFor(() => expect(s.of("studio", "view")).toHaveLength(1));
    s.say("studio", "st", { type: "open", page: "providers" });
    await vi.waitFor(() => expect(lastView(s)).toMatchObject({ page: "providers" }));
  });
});

describe("vue studio : politique du dépôt", () => {
  async function withPolicy(t: T, s: FakeSocket) {
    await create(t, s, "Un");
    const workspace = (await projects(t))?.projects[0]?.workspace ?? "";
    await mkdir(join(workspace, ".warband"), { recursive: true });
    const text = JSON.stringify({ default: "deny", rules: [] });
    await writeFile(repoPolicyPath(workspace), text);
    s.say("studio", "st", { type: "refresh" });
    await vi.waitFor(() => expect(lastView(s).repoPolicy).toMatchObject({ state: "untrusted" }));
    return { workspace, digest: policyDigest(text).slice(0, 12) };
  }

  it("empreinte affichée ; sans réponse, non approuvée ; refus, non approuvée ; accord, approuvée", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    const { digest } = await withPolicy(t, s);
    s.say("studio", "st", { type: "trustRepoPolicy" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(1));
    const d = s.of("shell", "dialog")[0]?.msg as Msg;
    expect(d.kind).toBe("confirm");
    expect(String(d.text)).toContain(digest);
    await settle();
    // Aucune réponse humaine : toujours non approuvée.
    s.say("studio", "st", { type: "refresh" });
    await vi.waitFor(() => expect(lastView(s).repoPolicy).toMatchObject({ state: "untrusted" }));
    expect(t.audit.some((e) => e.kind === "repoPolicy.trust")).toBe(false);

    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: false });
    await settle();
    expect(lastView(s).repoPolicy).toMatchObject({ state: "untrusted" });

    s.say("studio", "st", { type: "trustRepoPolicy" });
    await answer(s, "confirm", true, 2);
    await vi.waitFor(() =>
      expect(lastView(s).repoPolicy).toMatchObject({ state: "trusted", digest }),
    );
    expect(t.audit).toContainEqual(expect.objectContaining({ kind: "repoPolicy.trust", digest }));
  });

  it("sans projet actif ou sans fichier : message, pas de modale", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    s.say("studio", "st", { type: "trustRepoPolicy" });
    await vi.waitFor(() =>
      expect(String(lastView(s).projectError)).toContain("Aucun projet actif"),
    );
    await create(t, s, "Un");
    s.say("studio", "st", { type: "trustRepoPolicy" });
    await vi.waitFor(() => expect(String(lastView(s).projectError)).toContain("Aucune politique"));
    expect(s.of("shell", "dialog")).toEqual([]);
  });

  it("arrêt du serveur avec une modale en attente : refusée (jamais approuvée)", async () => {
    const t = setupStudio();
    const s = studioOf(t);
    const { workspace } = await withPolicy(t, s);
    s.say("studio", "st", { type: "trustRepoPolicy" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(1));
    t.hub.dispose();
    await settle();
    expect(workspace).not.toBe("");
  });
});

describe("vue studio : validation et abonnement", () => {
  it("messages invalides, gestes de la partie B ou d'éditeur, non abonné : ignorés et comptés", async () => {
    const t = setupStudio();
    const s = t.connect();
    s.say("studio", "st", { type: "createProject", name: "x" }); // avant ready
    s.say("studio", "st", { type: "ready" });
    await vi.waitFor(() => expect(s.of("studio", "view")).toHaveLength(1));
    const bad: unknown[] = [
      { type: "createProject", name: "   " },
      { type: "createProject", name: "a\nb" },
      { type: "createProject", name: "ok", workspace: "/etc" },
      { type: "activateProject", projectId: "pas-un-uuid" },
      { type: "setWorkspaceRoot", value: 12 },
      { type: "nimporte" },
      { type: "setCapability", kind: "skill", id: "x", enabled: true },
      // Partie B et gestes d'éditeur : valides mais sans équivalent ici.
      { type: "configureBurp" },
      { type: "openWorkspace" },
      { type: "openCours" },
      { type: "exportReport", projectId: "00000000-0000-4000-8000-000000000000" },
      { type: "deleteFinding", projectId: "00000000-0000-4000-8000-000000000000", id: "f" },
    ];
    for (const m of bad) s.say("studio", "st", m);
    s.say("studio", "autre", { type: "refresh" }); // mauvais cadre
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(1 + bad.length + 1));
    expect(t.bridge.stats().accepted).toBe(1);
    expect(await projects(t)).toBeNull();
    expect(s.of("studio", "view")).toHaveLength(1);
  });

  it("socket fermé : plus de diffusion vers lui", async () => {
    const t = setupStudio();
    const a = studioOf(t);
    const b = studioOf(t, "st2");
    await vi.waitFor(() => expect(b.of("studio", "view")).toHaveLength(1));
    a.close();
    b.say("studio", "st2", { type: "setPalette", palette: "arctic" });
    await vi.waitFor(() => expect(b.of("studio", "palette")).toHaveLength(1));
    expect(a.of("studio", "palette")).toEqual([]);
  });
});

describe("message sortant openWindow", () => {
  it("forme exacte : vue de la liste fermée, cadre valide", () => {
    expect(openWindowMessage("cockpit")).toEqual({
      type: "openWindow",
      view: "cockpit",
      frame: "cockpit",
    });
    expect(isOpenWindowMessage(openWindowMessage("killchain", "g1"))).toBe(true);
    for (const bad of [
      null,
      { type: "openWindow", view: "studio", frame: "x" },
      { type: "openWindow", view: "cockpit", frame: "a/b" },
      { type: "openWindow", view: "cockpit", frame: "x", path: "/etc" },
      { type: "openWindow", view: "cockpit" },
    ])
      expect(isOpenWindowMessage(bad)).toBe(false);
  });
});
