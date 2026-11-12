import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  adoptProjectDirectory,
  createManagedProject,
  createProject,
  moveDirectory,
  moveProjectWorkspace,
  PROJECT_WORKSPACE_FOLDERS,
  projectDataDir,
  readProjects,
  registerImportedProject,
} from "../src/index.js";

const dirs: string[] = [];
const fixture = async () => {
  const base = await mkdtemp(join(tmpdir(), "project-folders-"));
  dirs.push(base);
  const config = join(base, "config");
  const a = join(base, "a");
  const b = join(base, "b");
  await mkdir(a);
  await mkdir(b);
  return { base, config, a, b };
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const refused = (code: string) => expect.objectContaining({ code });

it("adoption : crée seulement les sous-dossiers manquants sans rien écraser", async () => {
  const { config, a } = await fixture();
  const folder = join(a, "existant");
  await mkdir(join(folder, "notes"), { recursive: true });
  await writeFile(join(folder, "notes", "garde.txt"), "intact");
  await writeFile(join(folder, "autre.txt"), "intact");
  const project = await adoptProjectDirectory(config, "Repris", folder);
  expect(project.workspace).toBe(folder);
  expect(project.containers).toEqual([]);
  expect((await readdir(folder)).sort()).toEqual(
    [...PROJECT_WORKSPACE_FOLDERS, "autre.txt"].sort(),
  );
  expect(await readFile(join(folder, "notes", "garde.txt"), "utf8")).toBe("intact");
  expect((await readProjects(config))?.projects).toHaveLength(1);
});

it("adoption : dossier absent, relatif, lien symbolique ou déjà enregistré refusés", async () => {
  const { config, a, base } = await fixture();
  const folder = join(a, "p");
  await mkdir(folder);
  const link = join(base, "lien");
  await symlink(folder, link, process.platform === "win32" ? "junction" : "dir");
  for (const bad of [join(a, "absent"), "relatif", link])
    await expect(adoptProjectDirectory(config, "X", bad)).rejects.toMatchObject({
      code: "project.parentInvalid",
    });
  await adoptProjectDirectory(config, "Premier", folder);
  await expect(adoptProjectDirectory(config, "Second", folder)).rejects.toEqual(
    refused("project.folderAlreadyProject"),
  );
  expect((await readProjects(config))?.projects).toHaveLength(1);
});

it("adoption : refuse un dossier sensible", async () => {
  if (process.platform === "win32") return;
  const { config } = await fixture();
  await expect(adoptProjectDirectory(config, "X", "/etc")).rejects.toMatchObject({
    code: "project.parentInvalid",
  });
});

it("déplacement sur le même volume : rename, registre mis à jour, conteneurs conservés", async () => {
  const { config, a, b } = await fixture();
  const created = await createManagedProject(config, "Mon projet", a);
  await writeFile(join(created.workspace, "notes", "n.txt"), "contenu");
  const file = await readProjects(config);
  expect(file).not.toBeNull();
  const moved = await moveProjectWorkspace(config, created.id, b);
  expect(moved.workspace).toBe(join(b, basename(created.workspace)));
  expect(moved.id).toBe(created.id);
  expect(await readFile(join(moved.workspace, "notes", "n.txt"), "utf8")).toBe("contenu");
  await expect(stat(created.workspace)).rejects.toThrow();
  expect((await readProjects(config))?.projects[0]?.workspace).toBe(moved.workspace);
});

it("déplacement : destination existante, parent invalide, destination dans la source, id inconnu", async () => {
  const { config, a, b } = await fixture();
  const created = await createManagedProject(config, "Projet", a);
  await mkdir(join(b, basename(created.workspace)));
  await expect(moveProjectWorkspace(config, created.id, b)).rejects.toEqual(
    refused("project.destinationExists"),
  );
  await expect(moveProjectWorkspace(config, created.id, join(b, "absent"))).rejects.toEqual(
    refused("project.parentInvalid"),
  );
  await expect(
    moveProjectWorkspace(config, created.id, join(created.workspace, "notes")),
  ).rejects.toEqual(refused("project.moveFailed"));
  await expect(moveProjectWorkspace(config, created.id, created.workspace)).rejects.toEqual(
    refused("project.moveFailed"),
  );
  await expect(
    moveProjectWorkspace(config, "00000000-0000-4000-8000-000000000000", b),
  ).rejects.toEqual(refused("project.absent"));
  expect((await readProjects(config))?.projects[0]?.workspace).toBe(created.workspace);
  expect((await stat(created.workspace)).isDirectory()).toBe(true);
});

const exdev = async () => {
  throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
};

it("déplacement inter-volumes simulé : copie, vérification, suppression de la source", async () => {
  const { config, a, b } = await fixture();
  const created = await createManagedProject(config, "Projet", a);
  await writeFile(join(created.workspace, "scans", "s.txt"), "scan");
  const moved = await moveProjectWorkspace(config, created.id, b, { rename: exdev });
  expect(await readFile(join(moved.workspace, "scans", "s.txt"), "utf8")).toBe("scan");
  expect((await readdir(moved.workspace)).sort()).toEqual([...PROJECT_WORKSPACE_FOLDERS].sort());
  await expect(stat(created.workspace)).rejects.toThrow();
  expect((await readProjects(config))?.projects[0]?.workspace).toBe(moved.workspace);
});

it("copie inter-volumes : un lien symbolique est refusé, la copie partielle disparaît, la source reste", async () => {
  if (process.platform === "win32") return;
  const { config, a, b } = await fixture();
  const created = await createManagedProject(config, "Projet", a);
  await writeFile(join(created.workspace, "notes", "n.txt"), "x");
  await symlink("/etc/hostname", join(created.workspace, "scripts", "lien"));
  await expect(moveProjectWorkspace(config, created.id, b, { rename: exdev })).rejects.toEqual(
    refused("project.moveFailed"),
  );
  expect(await readdir(b)).toEqual([]);
  expect(await readFile(join(created.workspace, "notes", "n.txt"), "utf8")).toBe("x");
  expect((await readProjects(config))?.projects[0]?.workspace).toBe(created.workspace);
});

it("moveDirectory : une erreur autre qu'EXDEV remonte telle quelle", async () => {
  const { a, b } = await fixture();
  await expect(
    moveDirectory(a, join(b, "x"), {
      rename: async () => {
        throw Object.assign(new Error("refus"), { code: "EACCES" });
      },
    }),
  ).rejects.toMatchObject({ code: "EACCES" });
  expect((await stat(a)).isDirectory()).toBe(true);
});

it("import : id conservé s'il est libre, remplacé s'il est pris ou invalide", async () => {
  const { config, a } = await fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  const one = join(a, "un");
  const two = join(a, "deux");
  const three = join(a, "trois");
  for (const d of [one, two, three]) await mkdir(d);
  const first = await registerImportedProject(config, { id, name: "Importé", workspace: one });
  expect(first).toMatchObject({ idChanged: false, project: { id, containers: [] } });
  const second = await registerImportedProject(config, { id, name: "Importé", workspace: two });
  expect(second.idChanged).toBe(true);
  expect(second.project.id).not.toBe(id);
  const third = await registerImportedProject(config, {
    id: "../evasion",
    name: "Importé",
    workspace: three,
  });
  expect(third.idChanged).toBe(true);
  expect(third.project.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(registerImportedProject(config, { id, name: "X", workspace: one })).rejects.toEqual(
    refused("project.folderAlreadyProject"),
  );
  await expect(
    registerImportedProject(config, { id, name: "X", workspace: join(a, "absent") }),
  ).rejects.toEqual(refused("project.parentInvalid"));
  expect((await readProjects(config))?.projects).toHaveLength(3);
});

it("MAX_PROJECTS : adoption et import refusés au-delà de 32 projets", async () => {
  const { config, a } = await fixture();
  for (let i = 0; i < 32; i++) await createProject(config, { name: `p${i}`, workspace: a });
  const extra = join(a, "extra");
  await mkdir(extra);
  await expect(adoptProjectDirectory(config, "X", extra)).rejects.toMatchObject({
    code: "project.invalid",
  });
  await expect(
    registerImportedProject(config, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "X",
      workspace: extra,
    }),
  ).rejects.toMatchObject({ code: "project.invalid" });
  expect(await readdir(extra)).toEqual([]);
});

it("projectDataDir : dossier de données, id contrôlé", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  expect(projectDataDir("/cfg", id)).toBe(join("/cfg", "projects", id));
  expect(() => projectDataDir("/cfg", "../x")).toThrow();
});
