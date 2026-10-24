import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_PROJECT_FILE } from "@warband/core";
import { afterEach, expect, it } from "vitest";
import {
  activateSelectedProject,
  createSelectedProject,
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
