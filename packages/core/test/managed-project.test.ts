import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createManagedProject,
  createProject,
  PROJECT_WORKSPACE_FOLDERS,
  projectWorkspacesRoot,
  readProjects,
} from "../src/index.js";

const dirs: string[] = [];
const fixture = async () => {
  const base = await mkdtemp(join(tmpdir(), "managed-project-"));
  dirs.push(base);
  return { base, config: join(base, "config"), root: join(base, "workspaces") };
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("racine par défaut dans le dossier Exegol et réglage absolu explicite", () => {
  expect(projectWorkspacesRoot(undefined, "/home/laboratoire")).toBe(
    join("/home/laboratoire", ".exegol", "workspaces"),
  );
  expect(() => projectWorkspacesRoot("../autre")).toThrow();
  expect(() => projectWorkspacesRoot({ root: "/autre" })).toThrow();
});

it("réserve automatiquement le slug, prépare les catégories et ne réutilise aucun dossier", async () => {
  const { config, root } = await fixture();
  const first = await createManagedProject(config, "Démo / Projet", root);
  expect(first.workspace).toBe(join(root, "demo-projet"));
  expect(await readdir(first.workspace)).toEqual([...PROJECT_WORKSPACE_FOLDERS].sort());
  await writeFile(join(first.workspace, "notes", "preuve.txt"), "à conserver");
  const second = await createManagedProject(config, "Démo / Projet", root);
  expect(second.workspace).toBe(join(root, "demo-projet-2"));
  expect(await readFile(join(first.workspace, "notes", "preuve.txt"), "utf8")).toBe("à conserver");
  if (process.platform !== "win32") expect((await stat(second.workspace)).mode & 0o777).toBe(0o700);
});

it.each(["CON", "NUL", "COM1", "LPT9", "...", "../../dossier"])(
  "nom %s : slug portable sans sortie de racine",
  async (name) => {
    const { config, root } = await fixture();
    const project = await createManagedProject(config, name, root);
    expect(project.workspace).toBe(join(root, basename(project.workspace)));
    expect(basename(project.workspace)).toMatch(/^[a-z0-9_-]{1,60}$/);
    expect(basename(project.workspace)).not.toMatch(/^(con|nul|com1|lpt9)$/i);
  },
);

it("un nom invalide ne crée pas la racine et les projets existants restent à leur place", async () => {
  const { config, root, base } = await fixture();
  await expect(createManagedProject(config, "", root)).rejects.toThrow();
  expect(await readdir(base)).toEqual([]);
  const legacy = await createProject(config, { name: "Existant", workspace: base });
  await createManagedProject(config, "Nouveau", root);
  expect(
    (await readProjects(config))?.projects.find((project) => project.id === legacy.id)?.workspace,
  ).toBe(base);
});

it("refuse une racine symbolique et un ancêtre symbolique sans écrire dans leur cible", async () => {
  const { config, base } = await fixture();
  const other = await fixture();
  const link = join(base, "raccourci");
  await symlink(other.base, link, process.platform === "win32" ? "junction" : "dir");
  await expect(createManagedProject(config, "Projet", link)).rejects.toMatchObject({
    code: "path.outside",
  });
  await expect(createManagedProject(config, "Projet", join(link, "nouveau"))).rejects.toMatchObject(
    { code: "path.outside" },
  );
  expect(await readdir(other.base)).toEqual([]);
});

it("un chemin de projet trop long ne crée aucun dossier", async () => {
  const { base, config } = await fixture();
  await expect(
    createManagedProject(config, "Projet", join(base, ...Array<string>(100).fill("long-segment"))),
  ).rejects.toMatchObject({ code: "project.invalid" });
  expect(await readdir(base)).toEqual([]);
});
