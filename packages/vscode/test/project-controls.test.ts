import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFinding,
  associateContainer,
  type CommonRoot,
  createProject,
  prepareCommonRoot,
  readFindings,
  readProjects,
  readSummary,
  renameProject,
  USER_PROJECT_FILE,
  writeSummary,
} from "@warband/core";
import { afterEach, expect, it, vi } from "vitest";
import {
  activateSelectedProject,
  applyProjectPlan,
  createManagedSelectedProject,
  manageSelectedProject,
  type ProjectCreationHost,
  planProjectCreation,
  projectSeenBy,
  projectVisibility,
  projectVisibleNames,
  proposedProjectName,
  readProjectChoices,
  setProjectPrimary,
  unassociatedProjectIds,
} from "../src/logic/project-controls.js";
import { createSelectedProject } from "./fixtures/projects.js";

const dirs: string[] = [];
const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-project-ui-"));
  dirs.push(dir);
  return dir;
};

it("crée et active le projet sans dialogue dans la racine machine", async () => {
  const config = await temp();
  const root = await temp();
  const project = await createManagedSelectedProject(config, "Mission Démo", root);
  expect(project.workspace).toBe(join(root, "projets", "mission-demo"));
  expect((await readProjectChoices(config)).activeId).toBe(project.id);
  expect(await readFile(join(config, USER_PROJECT_FILE), "utf8")).toContain(project.id);
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("crée et active un projet, conserve les précédents et permet de les sélectionner", async () => {
  const dir = await temp();
  expect(await readProjectChoices(dir)).toEqual({ activeId: null, projects: [] });
  const first = await createSelectedProject(dir, "Premier", dir, "kali-1");
  const second = await createSelectedProject(dir, "Second", dir, "kali-1");
  expect(await readProjectChoices(dir)).toEqual({
    activeId: second,
    projects: [
      { id: first, name: "Premier", workspace: dir },
      { id: second, name: "Second", workspace: dir },
    ],
  });
  await activateSelectedProject(dir, first);
  expect((await readProjectChoices(dir)).activeId).toBe(first);
  await expect(
    activateSelectedProject(dir, "11111111-1111-4111-8111-111111111111"),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect((await readProjectChoices(dir)).activeId).toBe(first);
});

it("une erreur de lecture n'est pas présentée comme une liste vide", async () => {
  const dir = await temp();
  await writeFile(join(dir, USER_PROJECT_FILE), "cassé");
  await expect(readProjectChoices(dir)).rejects.toMatchObject({ code: "project.invalid" });
});

it("renomme une fiche inactive sans déplacer son dossier ni changer les identités", async () => {
  const dir = await temp();
  const first = await createSelectedProject(dir, "Premier", dir, "kali-1");
  const second = await createSelectedProject(dir, "Second", dir, "kali-1");
  await writeFile(join(dir, "preuve.txt"), "conservée");
  expect(
    await manageSelectedProject(dir, first, "rename", {
      busy: () => false,
      isCurrent: () => true,
      rename: async (name) => {
        expect(name).toBe("Premier");
        return "  Nouveau nom  ";
      },
      confirmRemove: async () => false,
    }),
  ).toBe(true);
  const result = await readProjectChoices(dir);
  expect(result.activeId).toBe(second);
  expect(result.projects[0]).toEqual({ id: first, name: "Nouveau nom", workspace: dir });
  expect(await readFile(join(dir, "preuve.txt"), "utf8")).toBe("conservée");
});

it("supprime la fiche active sans activer une autre ni supprimer ses données", async () => {
  const dir = await temp();
  const first = await createSelectedProject(dir, "Premier", dir, "kali-1");
  const second = await createSelectedProject(dir, "Second", dir, "kali-1");
  await writeSummary(dir, second, "Mémoire à conserver");
  await appendFinding(dir, second, { kind: "host", label: "Hôte à conserver", state: "confirmed" });
  const snapshot = await readFindings(dir, second);
  await associateContainer(dir, second, "kali-test", {
    listLabelPrefix: async () => [
      { name: "kali-test", family: "kali", state: "running", image: "kali", labels: {} },
    ],
  });
  await manageSelectedProject(dir, second, "remove", {
    busy: () => false,
    isCurrent: () => true,
    rename: async () => undefined,
    confirmRemove: async () => true,
  });
  expect(await readProjectChoices(dir)).toEqual({
    activeId: null,
    projects: [{ id: first, name: "Premier", workspace: dir }],
  });
  expect(await readSummary(dir, second)).toBe("Mémoire à conserver");
  expect(await readFindings(dir, second)).toEqual(snapshot);
});

it("une annulation, un tour en cours ou une cible périmée ne modifie rien", async () => {
  const dir = await temp();
  const id = await createSelectedProject(dir, "Projet", dir, "kali-1");
  const before = await readFile(join(dir, USER_PROJECT_FILE), "utf8");
  const host = {
    busy: () => false,
    isCurrent: () => true,
    rename: async () => undefined,
    confirmRemove: async () => false,
  };
  expect(await manageSelectedProject(dir, id, "rename", host)).toBe(false);
  expect(await manageSelectedProject(dir, id, "remove", host)).toBe(false);
  expect(
    await manageSelectedProject(dir, id, "remove", {
      ...host,
      busy: () => true,
      confirmRemove: async () => {
        throw Error("Dialogue interdit");
      },
    }),
  ).toBe(false);
  await expect(
    manageSelectedProject(dir, id, "rename", { ...host, rename: async () => "\0nom" }),
  ).rejects.toMatchObject({ code: "project.invalid" });
  expect(await readFile(join(dir, USER_PROJECT_FILE), "utf8")).toBe(before);
  let current = true;
  await expect(
    manageSelectedProject(dir, id, "remove", {
      ...host,
      isCurrent: () => current,
      confirmRemove: async () => {
        current = false;
        return true;
      },
    }),
  ).rejects.toThrow("changé");
  expect(await readFile(join(dir, USER_PROJECT_FILE), "utf8")).toBe(before);
});

it("revalide la fiche après le dialogue et refuse un projet modifié ailleurs", async () => {
  const dir = await temp();
  const id = await createSelectedProject(dir, "Projet", dir, "kali-1");
  await expect(
    manageSelectedProject(dir, id, "remove", {
      busy: () => false,
      isCurrent: () => true,
      rename: async () => undefined,
      confirmRemove: async () => {
        await renameProject(dir, id, "Renommé ailleurs");
        return true;
      },
    }),
  ).rejects.toThrow("changé");
  expect((await readProjectChoices(dir)).projects[0]?.name).toBe("Renommé ailleurs");
});

const commonOf = async (): Promise<CommonRoot> => prepareCommonRoot(await temp());

const creationHost = (over: Partial<ProjectCreationHost> = {}) => {
  const calls: string[] = [];
  const host: ProjectCreationHost = {
    commonRoot: async () => {
      calls.push("root");
      return undefined;
    },
    pickExisting: async (dir) => {
      calls.push(`pick:${dir}`);
      return undefined;
    },
    askName: async (proposed) => {
      calls.push(`ask:${proposed}`);
      return undefined;
    },
    ...over,
  };
  return { host, calls };
};

it("racine annulée : aucun autre dialogue, aucun plan, rien d'écrit", async () => {
  const config = await temp();
  const { host, calls } = creationHost();
  for (const kind of ["create", "adopt"] as const)
    expect(await planProjectCreation({ kind, name: "Mission" }, host)).toBeUndefined();
  expect(calls).toEqual(["root", "root"]);
  expect(await readProjects(config)).toBeNull();
});

it("création : la racine est demandée une fois, projet sous <racine>/projets/<slug> sans conteneur ni primary", async () => {
  const config = await temp();
  const common = await commonOf();
  const commonRoot = vi.fn(async () => common);
  const known = creationHost({ commonRoot });
  const plan = await planProjectCreation({ kind: "create", name: "Dans racine" }, known.host);
  expect(plan).toEqual({ kind: "create", name: "Dans racine", root: common.root });
  expect(commonRoot).toHaveBeenCalledTimes(1);
  if (!plan) throw Error("plan absent");
  const project = await applyProjectPlan(config, plan);
  expect(project.workspace).toBe(join(common.root, "projets", "dans-racine"));
  expect(project.primary).toBeUndefined();
  expect((await readProjectChoices(config)).activeId).toBe(project.id);
  expect(known.calls).toEqual([]);
});

it("dossier existant : le sélecteur s'ouvre sur <racine>/projets, le nom est proposé puis le projet adopté sans primary", async () => {
  const config = await temp();
  const common = await commonOf();
  const folder = join(common.projects, "client");
  await mkdir(folder);
  const calls: string[] = [];
  const { host } = creationHost({
    commonRoot: async () => common,
    pickExisting: async (dir) => {
      calls.push(`pick:${dir}`);
      return folder;
    },
    askName: async (proposed) => {
      calls.push(`ask:${proposed}`);
      return "Client";
    },
  });
  const plan = await planProjectCreation({ kind: "adopt", name: "" }, host);
  expect(calls).toEqual([`pick:${common.projects}`, "ask:client"]);
  expect(plan).toEqual({ kind: "adopt", name: "Client", folder });
  if (!plan) throw Error("plan absent");
  const project = await applyProjectPlan(config, plan);
  expect(project.primary).toBeUndefined();
  expect((await readProjectChoices(config)).activeId).toBe(project.id);
});

it("dossier existant : un nom fourni évite la question ; hors racine accepté ; annulations = rien", async () => {
  const config = await temp();
  const common = await commonOf();
  const outside = await temp();
  const ask = vi.fn(async () => "x");
  const pick = vi.fn<(dir: string) => Promise<string | undefined>>();
  const { host } = creationHost({
    commonRoot: async () => common,
    pickExisting: pick,
    askName: ask,
  });
  pick.mockResolvedValueOnce(outside);
  const plan = await planProjectCreation({ kind: "adopt", name: "Nommé" }, host);
  expect(plan).toEqual({ kind: "adopt", name: "Nommé", folder: outside });
  expect(ask).not.toHaveBeenCalled();
  pick.mockResolvedValueOnce(undefined);
  expect(await planProjectCreation({ kind: "adopt", name: "" }, host)).toBeUndefined();
  pick.mockResolvedValueOnce(outside);
  ask.mockResolvedValueOnce(undefined as never);
  expect(await planProjectCreation({ kind: "adopt", name: "" }, host)).toBeUndefined();
  expect(await readProjects(config)).toBeNull();
});

it("dossier existant (plan direct) hors racine : adopté sans conteneur ; déjà projet refusé par le cœur", async () => {
  const config = await temp();
  const folder = join(await temp(), "client");
  await mkdir(folder);
  const plan = { kind: "adopt", name: "Un", folder } as const;
  const project = await applyProjectPlan(config, plan);
  expect(project.primary).toBeUndefined();
  await expect(applyProjectPlan(config, { ...plan, name: "Deux" })).rejects.toMatchObject({
    code: "project.folderAlreadyProject",
  });
});

const rows = [
  // Démarré, voit tout `projets` par un montage dédié.
  {
    name: "exegol-a",
    family: "exegol",
    mounts: [{ source: "/srv/racine/projets", target: "/workspace/projets" }],
  },
  // Arrêté, voit l'ancien montage /workspace seul.
  { name: "kali-1", family: "kali", workspace: "/srv/ancien" },
  // Conteneur libre : ne voit aucun projet.
  { name: "kali-libre", family: "kali", workspace: "/srv/vide" },
  // Famille inconnue : ignoré.
  { name: "autre", workspace: "/srv/racine/projets" },
];
const projects = [
  { id: "a", workspace: "/srv/racine/projets/a" },
  { id: "b", workspace: "/ailleurs/b" },
  { id: "c", workspace: "/srv/ancien/c" },
];

it("visibilité : tous montages, conteneurs arrêtés compris, conteneur libre = liste vide", () => {
  const seen = projectVisibility(projects, rows);
  expect(seen).toEqual({ a: ["exegol-a"], b: [], c: ["kali-1"] });
  expect(Object.values(seen).flat()).not.toContain("kali-libre");
  expect(Object.values(seen).flat()).not.toContain("autre");
});

it("projets non associés : aucun conteneur ne voit le dossier ; docker indisponible = rien d'affirmé", () => {
  expect(unassociatedProjectIds(projects, projectVisibility(projects, rows))).toEqual(["b"]);
  expect(unassociatedProjectIds(projects, projectVisibility(projects, []))).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(unassociatedProjectIds(projects, undefined)).toEqual([]);
});

it("carte projet : conteneurs qui voient le projet (état conservé) et défaut ; rien sans liste Docker", () => {
  const seen = projectVisibility(projects, rows);
  const view = [
    { name: "exegol-a", short: "a", state: "running" as const },
    { name: "kali-1", short: "kali-1", state: "stopped" as const },
  ];
  const card = projectSeenBy(
    [{ id: "a", primary: "exegol-a" }, { id: "b" }, { id: "c" }],
    seen,
    view,
  );
  expect(card.a).toEqual({
    containers: [{ name: "exegol-a", short: "a", state: "running" }],
    primary: "exegol-a",
  });
  expect(card.b).toEqual({ containers: [], primary: null });
  expect(card.c?.containers).toEqual([{ name: "kali-1", short: "kali-1", state: "stopped" }]);
  expect(projectSeenBy([{ id: "a" }], undefined, view)).toEqual({});
});

it("setProjectPrimary : refuse un conteneur qui ne voit pas le projet, accepte un qui le voit, null retire", async () => {
  const config = await temp();
  const root = await temp();
  const created = await createProject(config, { name: "P", workspace: root });
  const project = created.id;
  const dir = created.workspace;
  const list = async () => [
    { name: "exegol-a", family: "exegol", mounts: [{ source: dir, target: "/workspace/p" }] },
    { name: "kali-libre", family: "kali", workspace: "/srv/vide" },
  ];
  await expect(setProjectPrimary(config, project, "kali-libre", list)).rejects.toThrow();
  await expect(setProjectPrimary(config, project, "inconnu", list)).rejects.toThrow();
  expect((await readProjects(config))?.projects[0]?.primary).toBeUndefined();
  await setProjectPrimary(config, project, "exegol-a", list);
  expect((await readProjects(config))?.projects[0]?.primary).toBe("exegol-a");
  await setProjectPrimary(config, project, null, list);
  expect((await readProjects(config))?.projects[0]?.primary).toBeUndefined();
  await expect(
    setProjectPrimary(config, "11111111-1111-4111-8111-111111111111", null, list),
  ).rejects.toMatchObject({ code: "project.absent" });
});

it("proposedProjectName borne le nom de base du dossier", () => {
  expect(proposedProjectName("/a/b/Client X")).toBe("Client X");
  expect(proposedProjectName(`/a/${"x".repeat(200)}`)).toHaveLength(80);
});

// Terminal de preuves, terminal d'éditeur et mission : même règle que `exec` (ADR 0054), fail-closed.
const mount = (source: string) => ({ source, target: "/workspace" });
const run = (name: string, source: string, state = "running", family = "exegol") => ({
  name,
  state,
  family,
  workspace: source,
  mounts: [mount(source)],
});

it("allowlist des preuves : deux conteneurs démarrés qui voient le projet sont autorisés tous les deux", async () => {
  const project = { workspace: "/srv/racine/projets/a" };
  const names = await projectVisibleNames(project, async () => [
    run("exegol-a", "/srv/racine"),
    run("kali-1", "/srv/racine/projets", "running", "kali"),
  ]);
  expect(names).toEqual(["exegol-a", "kali-1"]);
});

it("allowlist des preuves : un conteneur qui ne voit pas le projet, arrêté ou de famille inconnue est absent", async () => {
  const project = { workspace: "/srv/racine/projets/a" };
  const names = await projectVisibleNames(project, async () => [
    run("exegol-a", "/srv/racine"),
    run("exegol-libre", "/srv/vide"),
    run("exegol-arrete", "/srv/racine", "stopped"),
    run("autre", "/srv/racine", "running", "inconnue"),
  ]);
  expect(names).toEqual(["exegol-a"]);
});

it("allowlist des preuves : liste Docker en erreur, liste vide (fail-closed)", async () => {
  const names = await projectVisibleNames({ workspace: "/srv/racine/projets/a" }, async () => {
    throw new Error("docker indisponible");
  });
  expect(names).toEqual([]);
});
