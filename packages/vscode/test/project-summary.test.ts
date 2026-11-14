import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, readSummary, setActiveProject, USER_PROJECT_FILE } from "@warband/core";
import { afterEach, expect, it } from "vitest";
import { readProjectSummary, saveProjectSummary } from "../src/logic/project-summary.js";

const dirs: string[] = [];
const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-summary-ui-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("charge le résumé réel et sauvegarde les changements, y compris un effacement", async () => {
  const dir = await temp();
  expect(await readProjectSummary(dir)).toBeNull();
  const project = await createProject(dir, {
    containers: ["kali-1"],
    name: "Mission",
    workspace: dir,
  });
  expect(await readProjectSummary(dir)).toEqual({
    projectId: project.id,
    projectName: "Mission",
    text: "",
  });
  await saveProjectSummary(dir, project.id, "Nouvelle mémoire");
  expect((await readProjectSummary(dir))?.text).toBe("Nouvelle mémoire");
  await saveProjectSummary(dir, project.id, "");
  expect(await readSummary(dir, project.id)).toBe("");
});

it("refuse une sauvegarde après changement de projet sans toucher les deux résumés", async () => {
  const dir = await temp();
  const first = await createProject(dir, {
    containers: ["kali-1"],
    name: "Premier",
    workspace: dir,
  });
  await saveProjectSummary(dir, first.id, "À conserver");
  const second = await createProject(dir, {
    containers: ["kali-1"],
    name: "Second",
    workspace: dir,
  });
  await setActiveProject(dir, second.id);
  await expect(saveProjectSummary(dir, first.id, "À rejeter")).rejects.toMatchObject({
    code: "project.absent",
  });
  expect(await readSummary(dir, first.id)).toBe("À conserver");
  expect(await readSummary(dir, second.id)).toBe("");
});

it("ne transforme pas un fichier de projet invalide en résumé vide", async () => {
  const dir = await temp();
  await writeFile(join(dir, USER_PROJECT_FILE), "invalide");
  await expect(readProjectSummary(dir)).rejects.toMatchObject({ code: "project.invalid" });
});
