import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
  await mkdir(join(base, "workspaces"));
  return { base, config: join(base, "config"), root: join(base, "workspaces") };
};
const target = (share: string) => ({ container: "kali-1", share });
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("réglage de racine : absolu explicite uniquement, plus de défaut Exegol", () => {
  expect(() => projectWorkspacesRoot(undefined)).toThrow();
  expect(() => projectWorkspacesRoot("")).toThrow();
  expect(() => projectWorkspacesRoot("../autre")).toThrow();
  expect(() => projectWorkspacesRoot({ root: "/autre" })).toThrow();
});

it("réserve automatiquement le slug, prépare les catégories et ne réutilise aucun dossier", async () => {
  const { config, root } = await fixture();
  const first = await createManagedProject(config, "Démo / Projet", target(root));
  expect(first.workspace).toBe(join(root, "RedWidow", "projects", "demo-projet"));
  expect(first).toMatchObject({ containers: ["kali-1"], primary: "kali-1" });
  expect(await readdir(first.workspace)).toEqual([...PROJECT_WORKSPACE_FOLDERS].sort());
  await writeFile(join(first.workspace, "notes", "preuve.txt"), "à conserver");
  const second = await createManagedProject(config, "Démo / Projet", target(root));
  expect(second.workspace).toBe(join(root, "RedWidow", "projects", "demo-projet-2"));
  expect(await readFile(join(first.workspace, "notes", "preuve.txt"), "utf8")).toBe("à conserver");
  if (process.platform !== "win32") expect((await stat(second.workspace)).mode & 0o777).toBe(0o700);
});

it.each(["CON", "NUL", "COM1", "LPT9", "...", "../../dossier"])(
  "nom %s : slug portable sans sortie de racine",
  async (name) => {
    const { config, root } = await fixture();
    const project = await createManagedProject(config, name, target(root));
    expect(project.workspace).toBe(join(root, "RedWidow", "projects", basename(project.workspace)));
    expect(basename(project.workspace)).toMatch(/^[a-z0-9_-]{1,60}$/);
    expect(basename(project.workspace)).not.toMatch(/^(con|nul|com1|lpt9)$/i);
  },
);

it("un nom invalide ne crée rien et les projets existants restent à leur place", async () => {
  const { config, root, base } = await fixture();
  await expect(createManagedProject(config, "", target(root))).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
  const legacy = await createProject(config, {
    containers: ["kali-1"],
    name: "Existant",
    workspace: base,
  });
  await createManagedProject(config, "Nouveau", target(root));
  expect(
    (await readProjects(config))?.projects.find((project) => project.id === legacy.id)?.workspace,
  ).toBe(base);
});

it("refuse une racine symbolique et un ancêtre symbolique sans écrire dans leur cible", async () => {
  const { config, base } = await fixture();
  const other = await fixture();
  const link = join(base, "raccourci");
  await symlink(other.base, link, process.platform === "win32" ? "junction" : "dir");
  await expect(createManagedProject(config, "Projet", target(link))).rejects.toMatchObject({
    code: "project.parentInvalid",
  });
  await expect(
    createManagedProject(config, "Projet", target(join(link, "nouveau"))),
  ).rejects.toMatchObject({ code: "project.parentInvalid" });
  expect(await readdir(other.base)).toEqual(["workspaces"]);
});

it("sans conteneur (vide, absent, invalide) : project.containerRequired, rien n'est créé", async () => {
  const { config, root } = await fixture();
  for (const container of ["", undefined, "a\0b"])
    await expect(
      createManagedProject(config, "Projet", { container, share: root } as never),
    ).rejects.toMatchObject({ code: "project.containerRequired" });
  await expect(createManagedProject(config, "Projet", undefined as never)).rejects.toMatchObject({
    code: "project.containerRequired",
  });
  expect(await readdir(root)).toEqual([]);
  expect(await readProjects(config)).toBeNull();
});

it("createProject bas niveau : refuse une liste de conteneurs vide", async () => {
  const { config, base } = await fixture();
  await expect(
    createProject(config, { name: "x", workspace: base, containers: [] }),
  ).rejects.toMatchObject({ code: "project.containerRequired" });
  expect(await readProjects(config)).toBeNull();
});

it("un parent trop long ne crée aucun dossier", async () => {
  const { base, root, config } = await fixture();
  await expect(
    createManagedProject(
      config,
      "Projet",
      target(join(base, ...Array<string>(100).fill("long-segment"))),
    ),
  ).rejects.toMatchObject({ code: "project.parentInvalid" });
  expect(await readdir(root)).toEqual([]);
});

it("parent absent, relatif, vide, fichier ou sensible : refusé sans rien créer", async () => {
  const { base, config, root } = await fixture();
  await writeFile(join(base, "fichier"), "x");
  const refused = [
    undefined,
    "",
    "relatif/dossier",
    join(base, "absent"),
    join(base, "fichier"),
    ...(process.platform === "win32" ? [] : ["/etc"]),
  ];
  for (const parent of refused)
    await expect(
      createManagedProject(config, "Projet", target(parent as string)),
    ).rejects.toMatchObject({
      code: "project.parentInvalid",
    });
  expect(await readdir(root)).toEqual([]);
  expect(await readProjects(config)).toBeNull();
});
