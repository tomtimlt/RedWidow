/**
 * ADR 0056 : un projet vit dans un conteneur. Dossier partagé automatique sous `<données>/containers`,
 * création de projet exigeant un conteneur, projets existants « à lier » déplacés après un choix humain,
 * suppression d'un conteneur sans perte de données sans seconde confirmation.
 */
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createProject, readProjects } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locate, moveProjectIntoFolder } from "../src/bridge/workspaces.js";
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
import { type FakeContainer, fakeDocker } from "./docker-fake.js";

const ctx = useStorage();
const settle = (ms = 50) => new Promise((ok) => setTimeout(ok, ms));
const configDir = () => join(ctx.dir, "config");
const projects = () => readProjects(configDir());

/** `kali1` démarré et `kali2` arrêté ont un dossier partagé ; `ancien` (créé avant l'ADR 0056) n'en a pas. */
const FIXTURES: FakeContainer[] = [
  ...["kali1", "kali2"].map((name, i) => ({
    id: String(i + 1).repeat(64),
    name,
    image: "redwidow-kali:local",
    running: i === 0,
    labels: { "io.warband.runtime": "kali", "io.warband.workspace": name },
  })),
  {
    id: "9".repeat(64),
    name: "ancien",
    image: "redwidow-kali:local",
    running: true,
    labels: { "io.warband.runtime": "kali" },
  },
];

let docker: Awaited<ReturnType<typeof fakeDocker>>;
beforeEach(async () => {
  docker = await fakeDocker(FIXTURES);
  for (const name of ["kali1", "kali2"])
    await mkdir(join(ctx.storage.paths.containers, name), { recursive: true });
});
afterEach(async () => {
  ctx.hub?.dispose();
  await docker.close();
});

const boot = (extra: Parameters<typeof setup>[1] = {}) => {
  const t = setup(ctx, { backends: emptyBackends(), docker: docker.api, ...extra });
  const s = shellOf(t);
  s.say("studio", "st", { type: "ready" });
  return { t, s };
};
const lastView = (s: FakeSocket) => s.of("studio", "view").at(-1)?.msg as Msg;
const picks = (s: FakeSocket) => s.of("shell", "dialog").filter((d) => d.msg.kind === "pick");

/** Répond au dialogue `pick` suivant (`before` : nombre de `pick` déjà reçus avant le geste). */
async function answerPick(s: FakeSocket, value: unknown, before: number) {
  await vi.waitFor(() => expect(picks(s).length).toBeGreaterThan(before));
  const d = picks(s)[before]?.msg as Msg;
  replyDialog(s, d, value);
  return d;
}

describe("création d'un projet : un conteneur est imposé", () => {
  it("sans conteneur géré : erreur affichable, aucun dialogue, aucun projet, aucun dossier", async () => {
    docker.ctl.created.length = 0;
    const d0 = await fakeDocker([]);
    const t = setup(ctx, { backends: emptyBackends(), docker: d0.api });
    const s = shellOf(t);
    s.say("studio", "st", { type: "ready" });
    s.say("studio", "st", { type: "createProject", name: "Alpha" });
    await vi.waitFor(() =>
      expect(String(lastView(s).projectError)).toContain("créez d’abord un conteneur"),
    );
    expect(String(lastView(s).projectError)).toContain("Conteneurs");
    expect(picks(s)).toHaveLength(0);
    expect(await projects()).toBeNull();
    expect(await readdir(ctx.storage.paths.containers)).toEqual(["kali1", "kali2"]);
    expect(await readdir(join(ctx.storage.paths.containers, "kali1"))).toEqual([]);
    await d0.close();
  });

  it("un conteneur sans dossier partagé n'est pas proposé", async () => {
    const { s } = boot();
    s.say("studio", "st", { type: "createProject", name: "Alpha" });
    const d = await nthDialogOfKind(s);
    expect((d.items as { id: string }[]).map((i) => i.id)).toEqual(["kali1", "kali2"]);
  });

  it("démarré ou arrêté : le projet naît dans <containers>/<conteneur>/<projet>, plusieurs par conteneur", async () => {
    const { s } = boot();
    for (const [name, container] of [
      ["Un", "kali2"],
      ["Deux", "kali2"],
      ["Trois", "kali1"],
    ] as const) {
      const before = (await projects())?.projects.length ?? 0;
      const asked = picks(s).length;
      s.say("studio", "st", { type: "createProject", name });
      await answerPick(s, container, asked);
      await vi.waitFor(async () => expect((await projects())?.projects.length).toBe(before + 1));
    }
    const file = await projects();
    const root = ctx.storage.paths.containers;
    expect(file?.projects.map((p) => [p.name, p.workspace, p.containers])).toEqual([
      ["Un", join(root, "kali2", "un"), ["kali2"]],
      ["Deux", join(root, "kali2", "deux"), ["kali2"]],
      ["Trois", join(root, "kali1", "trois"), ["kali1"]],
    ]);
    expect(file?.activeId).toBe(file?.projects[2]?.id);
    // La racine RedWidow est posée dans chaque projet.
    expect((await readdir(join(root, "kali2", "un"))).sort()).toContain("evidence");
    // Les conteneurs annoncent leur dossier (nom) et leurs projets.
    const t2 = setup(ctx, { backends: emptyBackends(), docker: docker.api });
    const sh = shellOf(t2);
    sh.say("shell", "shell", { type: "containersList" });
    await vi.waitFor(() => expect(sh.of("shell", "containers")).toHaveLength(1));
    const items = sh.of("shell", "containers")[0]?.msg.items as {
      name: string;
      folder?: string;
      projects?: { id: string; name: string }[];
    }[];
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName.kali2?.folder).toBe("kali2");
    expect(byName.kali2?.projects?.map((p) => p.name)).toEqual(["Un", "Deux"]);
    expect(byName.kali1?.projects?.map((p) => p.name)).toEqual(["Trois"]);
    expect(byName.ancien).not.toHaveProperty("folder");
    expect(JSON.stringify(sh.sent)).not.toContain(ctx.dir);
  });

  it("dialogue sans réponse : aucun projet ; réponse hors liste refusée", async () => {
    const { s } = boot();
    s.say("studio", "st", { type: "createProject", name: "Alpha" });
    const d = await nthDialogOfKind(s);
    replyDialog(s, d, "/etc");
    replyDialog(s, d, "ancien");
    await settle();
    expect(await projects()).toBeNull();
    expect(await readdir(join(ctx.storage.paths.containers, "kali1"))).toEqual([]);
  });
});

async function nthDialogOfKind(s: FakeSocket): Promise<Msg> {
  await vi.waitFor(() => expect(picks(s).length).toBeGreaterThanOrEqual(1));
  return picks(s)[0]?.msg as Msg;
}

describe("message shell projectCreate {name, container}", () => {
  it("conteneur choisi explicitement : projet créé et `projects` diffusé avec linked et container", async () => {
    const { t, s } = boot();
    s.say("shell", "shell", { type: "projectCreate", name: "Via shell", container: "kali1" });
    await vi.waitFor(() => expect(s.of("shell", "projects")).toHaveLength(1));
    const file = await projects();
    expect(file?.projects[0]?.workspace).toBe(
      join(ctx.storage.paths.containers, "kali1", "via-shell"),
    );
    expect(s.of("shell", "projects")[0]?.msg.items).toEqual([
      { id: file?.projects[0]?.id, name: "Via shell", linked: true, container: "kali1" },
    ]);
    expect(t.audit).toContainEqual(expect.objectContaining({ kind: "project.create" }));
  });

  it("conteneur inconnu, non géré ou sans dossier partagé : refusé, rien n'est créé", async () => {
    const { s } = boot();
    for (const [i, container] of ["inexistant", "nginx", "ancien"].entries()) {
      s.say("shell", "shell", { type: "projectCreate", name: "X", container });
      await vi.waitFor(() => expect(s.of("shell", "projectError")).toHaveLength(i + 1));
    }
    expect(s.of("shell", "projectError").map((e) => e.msg.code)).toEqual([
      "project.containerUnknown",
      "project.containerUnknown",
      "project.containerUnknown",
    ]);
    expect(await projects()).toBeNull();
    expect(await readdir(join(ctx.storage.paths.containers, "kali1"))).toEqual([]);
  });

  it("forme invalide (chemin, nom vide, clé en trop) : ignoré", async () => {
    const { t, s } = boot();
    const before = t.bridge.stats().ignored;
    s.say("shell", "shell", { type: "projectCreate", name: "X", container: "../../etc" });
    s.say("shell", "shell", { type: "projectCreate", name: "  ", container: "kali1" });
    s.say("shell", "shell", { type: "projectCreate", name: "X", container: "kali1", path: "/etc" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 3));
    expect(await projects()).toBeNull();
  });
});

describe("projet existant sans conteneur : « à lier »", () => {
  /** Ancien projet sous <données>/projects, avec une arborescence et un lien symbolique sortant. */
  async function legacy() {
    await mkdir(configDir(), { recursive: true });
    const workspace = join(ctx.storage.paths.projects, "ancien-projet");
    await mkdir(join(workspace, "scans", "profond"), { recursive: true });
    await writeFile(join(workspace, "notes.md"), "mes notes");
    await writeFile(join(workspace, "scans", "profond", "nmap.txt"), "80/tcp open");
    const outside = join(ctx.dir, "dehors");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "NE-PAS-COPIER");
    await symlink(outside, join(workspace, "lien"));
    const p = await createProject(configDir(), { name: "Ancien", workspace });
    return { p, workspace, outside };
  }

  it("activation : dialogue (conteneurs + « Créer un conteneur… ») ; sans réponse, rien ne bouge", async () => {
    const { p, workspace } = await legacy();
    const { s } = boot();
    s.say("studio", "st", { type: "activateProject", projectId: p.id });
    const d = await nthDialogOfKind(s);
    expect(d.title).toBe("Choisir le conteneur où déplacer ce projet");
    expect((d.items as { id: string; label: string }[]).map((i) => i.label)).toEqual([
      "kali1",
      "kali2",
      "Créer un conteneur…",
    ]);
    await settle();
    expect((await projects())?.projects[0]?.workspace).toBe(workspace);
    expect((await stat(workspace)).isDirectory()).toBe(true);
    expect(await readdir(join(ctx.storage.paths.containers, "kali1"))).toEqual([]);
  });

  it("« Créer un conteneur… » : erreur affichable (aller dans Conteneurs), projet inchangé", async () => {
    const { p, workspace } = await legacy();
    const { s } = boot();
    s.say("studio", "st", { type: "activateProject", projectId: p.id });
    await answerPick(s, "+create", 0);
    await vi.waitFor(() =>
      expect(String(lastView(s).projectError)).toContain("créez d’abord un conteneur"),
    );
    expect((await projects())?.projects[0]?.workspace).toBe(workspace);
  });

  it("réponse : dossier déplacé (arbre conservé, lien jamais suivi), fiche liée, puis activation", async () => {
    const { p, workspace, outside } = await legacy();
    const { t, s } = boot();
    s.say("studio", "st", { type: "activateProject", projectId: p.id });
    await answerPick(s, "kali2", 0);
    const dest = join(ctx.storage.paths.containers, "kali2", "ancien-projet");
    await vi.waitFor(async () => expect((await projects())?.projects[0]?.workspace).toBe(dest));
    const file = await projects();
    expect(file?.projects[0]?.containers).toEqual(["kali2"]);
    expect(file?.activeId).toBe(p.id);
    expect(await readFile(join(dest, "notes.md"), "utf8")).toBe("mes notes");
    expect(await readFile(join(dest, "scans", "profond", "nmap.txt"), "utf8")).toBe("80/tcp open");
    // Le lien est resté un lien vers la même cible : jamais suivi ni copié.
    expect((await lstat(join(dest, "lien"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(dest, "lien"))).toBe(outside);
    expect(await readdir(outside)).toEqual(["secret.txt"]);
    await expect(lstat(workspace)).rejects.toThrow();
    expect(t.audit).toContainEqual({ kind: "project.move", id: p.id, container: "kali2" });
  });

  it("projet déjà lié : activation sans dialogue", async () => {
    await mkdir(configDir(), { recursive: true });
    const a = await createLinkedProject(
      configDir(),
      { name: "A", workspace: join(ctx.storage.paths.containers, "kali1", "a") },
      "kali1",
    );
    await mkdir(join(ctx.storage.paths.containers, "kali1", "a"), { recursive: true });
    const { s } = boot();
    s.say("studio", "st", { type: "activateProject", projectId: a.id });
    await vi.waitFor(() => expect(lastView(s)).toMatchObject({ projectId: a.id }));
    expect(picks(s)).toHaveLength(0);
  });

  it("un projet hors de <containers> n'est pas activable sans déplacement ; vues et fichiers répondent « à lier »", async () => {
    const { p } = await legacy();
    const { s } = boot({
      backends: emptyBackends({ activeProjectId: async () => p.id }),
    });
    s.say("program", "prog", { type: "ready" });
    await vi.waitFor(() =>
      expect(s.of("program", "error")[0]?.msg).toMatchObject({
        code: "project.unlinked",
        text: expect.stringContaining("Projet à lier"),
      }),
    );
    s.say("shell", "shell", { type: "fsList", path: "" });
    await vi.waitFor(() => expect(s.of("shell", "fsError")).toHaveLength(1));
    expect(s.of("shell", "fsError")[0]?.msg.reason).toMatchObject({ code: "project.unlinked" });
  });

  it("message projects : projet ancien linked:false, sans container", async () => {
    await legacy();
    const t = setup(ctx, { backends: emptyBackends(), docker: docker.api });
    const sh = shellOf(t);
    sh.say("shell", "shell", { type: "projectsList" });
    await vi.waitFor(() => expect(sh.of("shell", "projects")).toHaveLength(1));
    expect(sh.of("shell", "projects")[0]?.msg.items).toEqual([
      expect.objectContaining({ name: "Ancien", linked: false }),
    ]);
    expect(sh.of("shell", "projects")[0]?.msg.items).not.toEqual([
      expect.objectContaining({ container: expect.anything() }),
    ]);
  });

  it("déplacement entre volumes (EXDEV) : copie vérifiée, fiche mise à jour, puis suppression de l'ancien", async () => {
    const { p, workspace } = await legacy();
    const roots = { containers: ctx.storage.paths.containers, legacy: ctx.storage.paths.projects };
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    const moved = await moveProjectIntoFolder({
      configDir: configDir(),
      roots,
      project: p,
      folder: "kali1",
      container: "kali1",
      io: {
        rename: async () => {
          throw exdev;
        },
      },
    });
    expect(moved.workspace).toBe(join(roots.containers, "kali1", "ancien-projet"));
    expect(await readFile(join(moved.workspace, "notes.md"), "utf8")).toBe("mes notes");
    expect((await lstat(join(moved.workspace, "lien"))).isSymbolicLink()).toBe(true);
    await expect(lstat(workspace)).rejects.toThrow();
    expect((await projects())?.projects[0]?.workspace).toBe(moved.workspace);
  });

  it("source hors des deux racines : refus path.outside, rien n'est déplacé", async () => {
    await mkdir(configDir(), { recursive: true });
    const ailleurs = join(ctx.dir, "ailleurs");
    await mkdir(ailleurs);
    await writeFile(join(ailleurs, "x"), "x");
    const p = await createProject(configDir(), { name: "Hors", workspace: ailleurs });
    await expect(
      moveProjectIntoFolder({
        configDir: configDir(),
        roots: { containers: ctx.storage.paths.containers, legacy: ctx.storage.paths.projects },
        project: p,
        folder: "kali1",
        container: "kali1",
      }),
    ).rejects.toMatchObject({ code: "path.outside" });
    expect(await readdir(ailleurs)).toEqual(["x"]);
    expect((await projects())?.projects[0]?.workspace).toBe(ailleurs);
  });

  it("destination déjà occupée : jamais d'écrasement, suffixe", async () => {
    const { p } = await legacy();
    const occupied = join(ctx.storage.paths.containers, "kali1", "ancien-projet");
    await mkdir(occupied);
    await writeFile(join(occupied, "autre.txt"), "pas touche");
    const moved = await moveProjectIntoFolder({
      configDir: configDir(),
      roots: { containers: ctx.storage.paths.containers, legacy: ctx.storage.paths.projects },
      project: p,
      folder: "kali1",
      container: "kali1",
    });
    expect(moved.workspace).toBe(`${occupied}-2`);
    expect(await readdir(occupied)).toEqual(["autre.txt"]);
  });
});

describe("locate : projet dans un dossier partagé", () => {
  it("lexical : <racine>/<dossier>/<projet> seulement", () => {
    const root = "/srv/containers";
    expect(locate("/srv/containers/kali-1/p", root)).toEqual({ folder: "kali-1", project: "p" });
    expect(locate("/srv/containers/kali-1", root)).toBeNull();
    expect(locate("/srv/containers", root)).toBeNull();
    expect(locate("/srv/projects/p", root)).toBeNull();
    expect(locate("/srv/containers/../projects/x/y", root)).toBeNull();
  });
});

describe("suppression d'un conteneur : le dossier partagé n'est jamais perdu sans seconde confirmation", () => {
  async function removal() {
    await mkdir(configDir(), { recursive: true });
    const workspace = join(ctx.storage.paths.containers, "kali1", "mission");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "preuve.txt"), "à garder");
    await createLinkedProject(configDir(), { name: "Mission", workspace }, "kali1");
    const t = setup(ctx, {
      docker: docker.api,
      backends: emptyBackends({
        cockpit: {
          ...emptyBackends().cockpit,
          remove: async (name, o) =>
            (await o.confirm({
              name,
              state: "running",
              family: "kali",
              force: false,
              projects: [],
            }))
              ? { status: "removed", name }
              : { status: "cancelled", name },
        },
      }),
    });
    const s = shellOf(t);
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    return { t, s, workspace };
  }
  const lastOp = (s: FakeSocket) => s.of("cockpit", "operation").at(-1)?.msg as Msg;

  it("conteneur supprimé, seconde confirmation refusée : dossier et projets conservés, utilisateur prévenu", async () => {
    const { s, workspace } = await removal();
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 1), true);
    const second = await nthDialog(s, 2);
    expect(second).toMatchObject({ kind: "confirm", danger: true });
    expect(String(second.text)).toContain("Supprimer aussi le dossier partagé et ses 1 projets ?");
    replyDialog(s, second, false);
    await vi.waitFor(() => expect(lastOp(s)).toMatchObject({ busy: false }));
    expect(String(lastOp(s).message)).toContain("conservés");
    expect(await readFile(join(workspace, "preuve.txt"), "utf8")).toBe("à garder");
    expect((await projects())?.projects).toHaveLength(1);
  });

  it("seconde confirmation sans réponse (silence) : conservé aussi", async () => {
    const { s, workspace } = await removal();
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 1), true);
    await nthDialog(s, 2);
    await settle();
    expect(await readFile(join(workspace, "preuve.txt"), "utf8")).toBe("à garder");
  });

  it("première confirmation refusée : aucune seconde question, rien n'est touché", async () => {
    const { s, workspace } = await removal();
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 1), false);
    await vi.waitFor(() => expect(lastOp(s)).toMatchObject({ busy: false }));
    expect(s.of("shell", "dialog")).toHaveLength(1);
    expect(await readFile(join(workspace, "preuve.txt"), "utf8")).toBe("à garder");
  });

  it("seconde confirmation acceptée : dossier partagé et fiches des projets supprimés (audit)", async () => {
    const { t, s } = await removal();
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 1), true);
    replyDialog(s, await nthDialog(s, 2), true);
    await vi.waitFor(() => expect(lastOp(s)).toMatchObject({ busy: false }));
    await expect(lstat(join(ctx.storage.paths.containers, "kali1"))).rejects.toThrow();
    expect(await projects()).toBeNull();
    expect(t.audit).toContainEqual({ kind: "containerFolderRemove", container: "kali1" });
    // L'autre dossier partagé n'est pas touché.
    expect((await stat(join(ctx.storage.paths.containers, "kali2"))).isDirectory()).toBe(true);
  });
});
