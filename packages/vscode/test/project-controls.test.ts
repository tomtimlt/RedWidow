import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFinding,
  associateContainer,
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
  proposedProjectName,
  readProjectChoices,
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
  const project = await createManagedSelectedProject(config, "Mission Démo", {
    container: "kali-1",
    share: root,
  });
  expect(project.workspace).toBe(join(root, "RedWidow", "projects", "mission-demo"));
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

const creationHost = (over: Partial<ProjectCreationHost> = {}) => {
  const calls: string[] = [];
  const host: ProjectCreationHost = {
    pickExisting: async (share) => {
      calls.push(`pick:${share}`);
      return undefined;
    },
    askName: async (proposed) => {
      calls.push(`ask:${proposed}`);
      return undefined;
    },
    containerMount: async (container) => {
      calls.push(`mount:${container}`);
      return undefined;
    },
    ...over,
  };
  return { host, calls };
};

it("conteneur absent ou sans partage : project.containerRequired, aucun dialogue, rien d'écrit", async () => {
  const config = await temp();
  const { host, calls } = creationHost();
  for (const kind of ["create", "adopt"] as const)
    await expect(
      planProjectCreation({ kind, name: "Mission", container: "inconnu" }, host),
    ).rejects.toMatchObject({ code: "project.containerRequired" });
  expect(calls).toEqual(["mount:inconnu", "mount:inconnu"]);
  expect(await readProjects(config)).toBeNull();
});

it("création : le partage relu par l'hôte donne <partage>/RedWidow/projects/<slug>, conteneur lié", async () => {
  const config = await temp();
  const mount = await temp();
  const known = creationHost({
    containerMount: async (c) => (c === "exegol-a" ? mount : undefined),
  });
  const plan = await planProjectCreation(
    { kind: "create", name: "Dans conteneur", container: "exegol-a" },
    known.host,
  );
  expect(plan).toEqual({
    kind: "create",
    name: "Dans conteneur",
    container: "exegol-a",
    share: mount,
  });
  if (!plan) throw Error("plan absent");
  const project = await applyProjectPlan(config, plan);
  expect(project.workspace).toBe(join(mount, "RedWidow", "projects", "dans-conteneur"));
  expect(project.containers).toEqual(["exegol-a"]);
  expect(project.primary).toBe("exegol-a");
  expect((await readProjectChoices(config)).activeId).toBe(project.id);
  expect(known.calls).toEqual([]);
});

it("dossier existant : le sélecteur s'ouvre sur le partage, le nom est proposé puis le projet adopté", async () => {
  const config = await temp();
  const share = await temp();
  const folder = join(share, "client");
  await mkdir(folder);
  const calls: string[] = [];
  const { host } = creationHost({
    containerMount: async () => share,
    pickExisting: async (s) => {
      calls.push(`pick:${s}`);
      return folder;
    },
    askName: async (proposed) => {
      calls.push(`ask:${proposed}`);
      return "Client";
    },
  });
  const plan = await planProjectCreation({ kind: "adopt", name: "", container: "kali-1" }, host);
  expect(calls).toEqual([`pick:${share}`, "ask:client"]);
  expect(plan).toEqual({ kind: "adopt", name: "Client", folder, container: "kali-1", share });
  if (!plan) throw Error("plan absent");
  const project = await applyProjectPlan(config, plan);
  expect(project.containers).toEqual(["kali-1"]);
  expect((await readProjectChoices(config)).activeId).toBe(project.id);
});

it("dossier existant : un nom fourni évite la question ; hors partage refusé sans nom demandé ; annulation = rien", async () => {
  const config = await temp();
  const share = await temp();
  const inside = join(share, "client");
  await mkdir(inside);
  const outside = await temp();
  const ask = vi.fn(async () => "x");
  const pick = vi.fn<(share: string) => Promise<string | undefined>>();
  const { host } = creationHost({
    containerMount: async () => share,
    pickExisting: pick,
    askName: ask,
  });
  pick.mockResolvedValueOnce(inside);
  expect(
    await planProjectCreation({ kind: "adopt", name: "Nommé", container: "kali-1" }, host),
  ).toMatchObject({ kind: "adopt", name: "Nommé" });
  expect(ask).not.toHaveBeenCalled();
  pick.mockResolvedValueOnce(outside);
  await expect(
    planProjectCreation({ kind: "adopt", name: "", container: "kali-1" }, host),
  ).rejects.toMatchObject({ code: "project.outsideShare" });
  expect(ask).not.toHaveBeenCalled();
  pick.mockResolvedValueOnce(undefined);
  expect(
    await planProjectCreation({ kind: "adopt", name: "", container: "kali-1" }, host),
  ).toBeUndefined();
  pick.mockResolvedValueOnce(inside);
  ask.mockResolvedValueOnce(undefined as never);
  expect(
    await planProjectCreation({ kind: "adopt", name: "", container: "kali-1" }, host),
  ).toBeUndefined();
  expect(await readProjects(config)).toBeNull();
});

it("dossier existant (plan direct) : déjà projet ou hors partage refusé par le cœur", async () => {
  const config = await temp();
  const share = await temp();
  const folder = join(share, "client");
  await mkdir(folder);
  const plan = { kind: "adopt", name: "Un", folder, container: "kali-1", share } as const;
  await applyProjectPlan(config, plan);
  await expect(applyProjectPlan(config, { ...plan, name: "Deux" })).rejects.toMatchObject({
    code: "project.folderAlreadyProject",
  });
  const dehors = await temp();
  await expect(
    applyProjectPlan(config, { ...plan, name: "Trois", folder: dehors }),
  ).rejects.toMatchObject({ code: "project.outsideShare" });
});

it("projets non associés : sans conteneur ou hors du partage ; docker indisponible = seulement « sans conteneur »", () => {
  const projects = [
    { id: "a", workspace: "/srv/a/RedWidow/projects/a", containers: ["kali-1"] },
    { id: "b", workspace: "/ailleurs/b", containers: ["kali-1"] },
    { id: "c", workspace: "/srv/a/RedWidow/projects/c", containers: [] },
    { id: "d", workspace: "/srv/a/x", containers: ["disparu"] },
  ];
  expect(unassociatedProjectIds(projects, [{ name: "kali-1", workspace: "/srv/a" }])).toEqual([
    "b",
    "c",
    "d",
  ]);
  expect(unassociatedProjectIds(projects, [{ name: "kali-1" }])).toEqual(["a", "b", "c", "d"]);
  expect(unassociatedProjectIds(projects, undefined)).toEqual(["c"]);
});

it("proposedProjectName borne le nom de base du dossier", () => {
  expect(proposedProjectName("/a/b/Client X")).toBe("Client X");
  expect(proposedProjectName(`/a/${"x".repeat(200)}`)).toHaveLength(80);
});
