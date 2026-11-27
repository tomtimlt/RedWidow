import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type CommonRoot, createProject, prepareCommonRoot, readProjects } from "@warband/core";
import { afterEach, expect, it, vi } from "vitest";
import { relocateProject } from "../src/logic/project-relocate.js";

const dirs: string[] = [];
const temp = async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "warband-relocate-")));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Projet hors de la racine commune, avec un ancien `primary` qui ne doit pas bouger. */
async function fixture() {
  const config = await temp();
  const rootDir = await temp();
  const common = await prepareCommonRoot(rootDir);
  const outside = await temp();
  const workspace = join(outside, "mission");
  await mkdir(workspace);
  await writeFile(join(workspace, "notes.txt"), "données");
  const project = await createProject(config, {
    name: "Mission",
    workspace,
    primary: "exegol-old",
  });
  const confirm = vi.fn(async (_info: unknown) => true);
  const root = vi.fn(async (): Promise<CommonRoot | undefined> => common);
  const deps = { configDir: config, busy: () => false, root, confirm };
  return { config, common, workspace, project, deps, confirm, root };
}

it("confirmation donnée : projet déplacé sous <racine>/projets, aucune association ni primary posé", async () => {
  const f = await fixture();
  const result = await relocateProject(f.project.id, f.deps);
  const expected = join(f.common.projects, "mission");
  expect(result).toEqual({ workspace: expected });
  expect(f.confirm).toHaveBeenCalledWith({
    name: "Mission",
    workspace: f.workspace,
    destination: f.common.projects,
  });
  expect(existsSync(join(expected, "notes.txt"))).toBe(true);
  expect(existsSync(f.workspace)).toBe(false);
  const stored = (await readProjects(f.config))?.projects.find((p) => p.id === f.project.id);
  expect(stored?.workspace).toBe(expected);
  // Le déplacement ne pose ni ne modifie aucun conteneur.
  expect(stored?.primary).toBe("exegol-old");
});

it("confirmation refusée : rien n'est déplacé ni modifié", async () => {
  const f = await fixture();
  f.confirm.mockResolvedValueOnce(false);
  const before = await readProjects(f.config);
  expect(await relocateProject(f.project.id, f.deps)).toBeNull();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect(await readProjects(f.config)).toEqual(before);
});

it("racine annulée : ni modale ni déplacement", async () => {
  const f = await fixture();
  f.root.mockResolvedValueOnce(undefined);
  expect(await relocateProject(f.project.id, f.deps)).toBeNull();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
});

it("refus pendant un tour : ni racine, ni modale, ni déplacement", async () => {
  const f = await fixture();
  await expect(relocateProject(f.project.id, { ...f.deps, busy: () => true })).rejects.toThrow();
  expect(f.root).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
});

it("tour démarré pendant la modale : rien n'est déplacé", async () => {
  const f = await fixture();
  let busy = false;
  f.confirm.mockImplementationOnce(async () => {
    busy = true;
    return true;
  });
  await expect(relocateProject(f.project.id, { ...f.deps, busy: () => busy })).rejects.toThrow();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect((await readProjects(f.config))?.projects[0]?.workspace).toBe(f.workspace);
});

it("projet absent : refus sans demander la racine", async () => {
  const f = await fixture();
  await expect(
    relocateProject("11111111-1111-4111-8111-111111111111", f.deps),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(f.root).not.toHaveBeenCalled();
});

it("projet déjà sous <racine>/projets : refus sans modale ni écriture", async () => {
  const f = await fixture();
  await relocateProject(f.project.id, f.deps);
  f.confirm.mockClear();
  const move = vi.fn();
  const before = await readProjects(f.config);
  await expect(relocateProject(f.project.id, { ...f.deps, move })).rejects.toThrow();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
  expect(await readProjects(f.config)).toEqual(before);
});

it("racine invalide (relative, lien symbolique) : le cœur refuse, rien n'est déplacé", async () => {
  const f = await fixture();
  const target = await temp();
  const link = join(await temp(), "lien");
  await symlink(target, link);
  const bad = { ...f.common, projects: link };
  await expect(
    relocateProject(f.project.id, { ...f.deps, root: async () => bad }),
  ).rejects.toBeDefined();
  const relative = { ...f.common, projects: "relatif/projets" };
  await expect(
    relocateProject(f.project.id, { ...f.deps, root: async () => relative }),
  ).rejects.toBeDefined();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect((await readProjects(f.config))?.projects[0]?.workspace).toBe(f.workspace);
});

it("destination exposant un chemin sensible (dossier personnel) : refusée par le cœur, rien n'est déplacé", async () => {
  const f = await fixture();
  const sensitive = { ...f.common, projects: homedir() };
  await expect(
    relocateProject(f.project.id, { ...f.deps, root: async () => sensitive }),
  ).rejects.toMatchObject({ code: expect.stringMatching(/^project\./) });
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect((await readProjects(f.config))?.projects[0]?.workspace).toBe(f.workspace);
});
