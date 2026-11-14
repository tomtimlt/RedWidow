import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_PROJECT_FILE } from "@warband/core";
import { afterEach, expect, it, vi } from "vitest";
import { activateSelectedProject, createSelectedProject } from "../src/logic/project-controls.js";
import {
  matchesActiveProjectWorkspace,
  openActiveProjectWorkspace,
  type ProjectWorkspaceHost,
} from "../src/logic/project-workspace.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "warband-workspace-"));
  dirs.push(dir);
  let attempt: string | undefined;
  const host: ProjectWorkspaceHost = {
    folders: () => [],
    hasUnsavedDocuments: () => false,
    attempted: () => attempt,
    rememberAttempt: async (path) => {
      attempt = path;
    },
    openFolder: vi.fn(async () => {}),
  };
  return { dir, host };
}

it("restaure le dossier actif une seule fois, même si l'ouverture ne charge aucun dossier", async () => {
  const { dir, host } = await setup();
  await createSelectedProject(dir, "Actif", dir, "kali-1");
  expect(await openActiveProjectWorkspace(dir, host, "startup")).toBe(true);
  expect(host.openFolder).toHaveBeenCalledWith(dir, false);
  expect(await openActiveProjectWorkspace(dir, host, "startup")).toBe(false);
  expect(host.openFolder).toHaveBeenCalledTimes(1);
  expect(await openActiveProjectWorkspace(dir, host, "selection")).toBe(true);
});

it("préserve une fenêtre occupée au démarrage et ouvre la sélection dans une nouvelle fenêtre si modifiée", async () => {
  const { dir, host } = await setup();
  await createSelectedProject(dir, "Actif", dir, "kali-1");
  host.folders = () => [join(dir, "autre")];
  host.hasUnsavedDocuments = () => true;
  expect(await openActiveProjectWorkspace(dir, host, "startup")).toBe(false);
  expect(host.openFolder).not.toHaveBeenCalled();
  expect(await openActiveProjectWorkspace(dir, host, "selection")).toBe(true);
  expect(host.openFolder).toHaveBeenCalledWith(dir, true);
});

it("ne réouvre pas le même dossier et remplace un multi-dossier lors d'une sélection explicite", async () => {
  const { dir, host } = await setup();
  await createSelectedProject(dir, "Actif", dir, "kali-1");
  host.folders = () => [join(dir, ".")];
  expect(await openActiveProjectWorkspace(dir, host, "selection")).toBe(false);
  host.folders = () => [dir, join(dir, "autre")];
  expect(await openActiveProjectWorkspace(dir, host, "selection")).toBe(true);
  expect(host.openFolder).toHaveBeenCalledWith(dir, false);
});

it("ouvre le dossier créé puis celui du projet sélectionné, sans mélanger les projets", async () => {
  const first = await setup();
  const second = await setup();
  const id = await createSelectedProject(first.dir, "Premier", first.dir, "kali-1");
  await createSelectedProject(first.dir, "Second", second.dir, "kali-1");
  await openActiveProjectWorkspace(first.dir, first.host, "selection");
  expect(first.host.openFolder).toHaveBeenLastCalledWith(second.dir, false);
  expect(await matchesActiveProjectWorkspace(first.dir, first.dir)).toBe(false);
  expect(await matchesActiveProjectWorkspace(first.dir, second.dir)).toBe(true);
  await activateSelectedProject(first.dir, id);
  await openActiveProjectWorkspace(first.dir, first.host, "selection");
  expect(first.host.openFolder).toHaveBeenLastCalledWith(first.dir, false);
  expect(await matchesActiveProjectWorkspace(first.dir, first.dir)).toBe(true);
  expect(await matchesActiveProjectWorkspace(first.dir, second.dir)).toBe(false);
});

it("reste inerte sans projet et rend les erreurs de fichier ou de dossier observables", async () => {
  const { dir, host } = await setup();
  expect(await openActiveProjectWorkspace(dir, host, "startup")).toBe(false);
  expect(await matchesActiveProjectWorkspace(dir, dir)).toBe(true);
  await createSelectedProject(dir, "Absent", join(dir, "absent"), "kali-1");
  await expect(openActiveProjectWorkspace(dir, host, "startup")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await createSelectedProject(dir, "Fichier", join(dir, USER_PROJECT_FILE), "kali-1");
  await expect(openActiveProjectWorkspace(dir, host, "startup")).rejects.toThrow("introuvable");
  await writeFile(join(dir, USER_PROJECT_FILE), "cassé");
  await expect(openActiveProjectWorkspace(dir, host, "startup")).rejects.toMatchObject({
    code: "project.invalid",
  });
  expect(host.openFolder).not.toHaveBeenCalled();
});

it("ne répète pas automatiquement une ouverture refusée et protège les documents sans dossier", async () => {
  const { dir, host } = await setup();
  await createSelectedProject(dir, "Actif", dir, "kali-1");
  host.hasUnsavedDocuments = () => true;
  host.openFolder = vi.fn(async () => {
    expect(host.attempted()).toBe(dir);
    throw new Error("Ouverture refusée");
  });
  await expect(openActiveProjectWorkspace(dir, host, "startup")).rejects.toThrow("refusée");
  expect(host.openFolder).toHaveBeenCalledWith(dir, true);
  expect(await openActiveProjectWorkspace(dir, host, "startup")).toBe(false);
  expect(host.openFolder).toHaveBeenCalledTimes(1);
});
