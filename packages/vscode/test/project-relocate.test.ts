import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, type LabelPrefixContainer, readProjects } from "@warband/core";
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

const row = (name: string, workspace?: string): LabelPrefixContainer => ({
  name,
  family: "exegol",
  state: "stopped",
  image: "img",
  ...(workspace !== undefined && { workspace }),
});

/** Projet « non associé » : dossier hors de tout partage, lié à un ancien conteneur. */
async function fixture() {
  const config = await temp();
  const share = await temp();
  const oldShare = await temp();
  const outside = await temp();
  const workspace = join(outside, "mission");
  await mkdir(workspace);
  await writeFile(join(workspace, "notes.txt"), "données");
  const project = await createProject(config, {
    name: "Mission",
    workspace,
    containers: ["exegol-old"],
    primary: "exegol-old",
  });
  const rows = [row("exegol-new", share), row("exegol-old", oldShare)];
  const confirm = vi.fn(async (_info: unknown) => true);
  const deps = {
    configDir: config,
    busy: () => false,
    listContainers: async () => rows,
    confirm,
  };
  return { config, share, workspace, project, deps, confirm };
}

it("confirmation donnée : projet déplacé sous le partage, conteneur lié et affiché, ancien lien retiré", async () => {
  const f = await fixture();
  const result = await relocateProject(f.project.id, "exegol-new", f.deps);
  const expected = join(f.share, "RedWidow", "projects", "mission");
  expect(result).toEqual({ workspace: expected });
  expect(f.confirm).toHaveBeenCalledWith({
    name: "Mission",
    workspace: f.workspace,
    container: "exegol-new",
    destination: join(f.share, "RedWidow", "projects"),
  });
  expect(existsSync(join(expected, "notes.txt"))).toBe(true);
  expect(existsSync(f.workspace)).toBe(false);
  const stored = (await readProjects(f.config))?.projects.find((p) => p.id === f.project.id);
  expect(stored?.workspace).toBe(expected);
  expect(stored?.containers).toEqual(["exegol-new"]);
  expect(stored?.primary).toBe("exegol-new");
});

it("confirmation refusée : rien n'est déplacé ni modifié", async () => {
  const f = await fixture();
  f.confirm.mockResolvedValueOnce(false);
  const before = await readProjects(f.config);
  expect(await relocateProject(f.project.id, "exegol-new", f.deps)).toBeNull();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect(existsSync(join(f.share, "RedWidow"))).toBe(false);
  expect(await readProjects(f.config)).toEqual(before);
});

it("refus pendant un tour : ni modale, ni déplacement", async () => {
  const f = await fixture();
  await expect(
    relocateProject(f.project.id, "exegol-new", { ...f.deps, busy: () => true }),
  ).rejects.toThrow();
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
  await expect(
    relocateProject(f.project.id, "exegol-new", { ...f.deps, busy: () => busy }),
  ).rejects.toThrow();
  expect(existsSync(join(f.workspace, "notes.txt"))).toBe(true);
  expect((await readProjects(f.config))?.projects[0]?.workspace).toBe(f.workspace);
});

it("conteneur inconnu ou sans partage, projet absent : refus sans modale", async () => {
  const f = await fixture();
  await expect(relocateProject(f.project.id, "inconnu", f.deps)).rejects.toMatchObject({
    code: "project.containerRequired",
  });
  await expect(
    relocateProject(f.project.id, "exegol-new", {
      ...f.deps,
      listContainers: async () => [row("exegol-new")],
    }),
  ).rejects.toMatchObject({ code: "project.containerRequired" });
  await expect(
    relocateProject("11111111-1111-4111-8111-111111111111", "exegol-new", f.deps),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(f.confirm).not.toHaveBeenCalled();
});

it("projet déjà sous le partage : seulement lié, aucun déplacement", async () => {
  const f = await fixture();
  await relocateProject(f.project.id, "exegol-new", f.deps);
  const move = vi.fn();
  const result = await relocateProject(f.project.id, "exegol-new", { ...f.deps, move });
  expect(move).not.toHaveBeenCalled();
  expect(result?.workspace).toBe(join(f.share, "RedWidow", "projects", "mission"));
});
