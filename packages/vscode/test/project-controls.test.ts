import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFinding,
  associateContainer,
  readFindings,
  readSummary,
  renameProject,
  USER_PROJECT_FILE,
  writeSummary,
} from "@warband/core";
import { afterEach, expect, it } from "vitest";
import {
  activateSelectedProject,
  createSelectedProject,
  manageSelectedProject,
  readProjectChoices,
} from "../src/logic/project-controls.js";

const dirs: string[] = [];
const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-project-ui-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("crée et active un projet, conserve les précédents et permet de les sélectionner", async () => {
  const dir = await temp();
  expect(await readProjectChoices(dir)).toEqual({ activeId: null, projects: [] });
  const first = await createSelectedProject(dir, "Premier", dir);
  const second = await createSelectedProject(dir, "Second", dir);
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
  const first = await createSelectedProject(dir, "Premier", dir);
  const second = await createSelectedProject(dir, "Second", dir);
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
  const first = await createSelectedProject(dir, "Premier", dir);
  const second = await createSelectedProject(dir, "Second", dir);
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
  const id = await createSelectedProject(dir, "Projet", dir);
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
  const id = await createSelectedProject(dir, "Projet", dir);
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
