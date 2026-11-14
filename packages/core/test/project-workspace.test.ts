import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectPlacement, type StoredProject } from "../src/project.js";
import {
  CONTAINER_ROOT_DIRS,
  containerProjectWorkspace,
  dockerHostWorkspace,
  isInsideShare,
  nextContainerName,
  PROJECT_WORKSPACE_FOLDERS,
  prepareContainerProjectWorkspace,
  prepareProjectWorkspace,
  prepareRedwidowRoot,
  projectsParent,
  reserveContainerFolder,
} from "../src/project-workspace.js";

const roots: string[] = [];
async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), "redwidow-container-"));
  roots.push(dir);
  return dir;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "redwidow-workspace-"));
  roots.push(root);
  const project: StoredProject = {
    id: randomUUID(),
    name: "Projet démo / $(id)",
    workspace: root,
    containers: ["kali-1"],
  };
  const calls: readonly string[][] = [];
  const argv: string[][] = calls as string[][];
  const docker = {
    listLabelPrefix: async () => [
      {
        name: "kali-1",
        workspace: root,
        state: "running" as const,
        family: "kali" as const,
        image: "kali",
      },
    ],
    execWorkspace: async (_container: string, command: readonly string[]) => {
      argv.push([...command]);
      return command[0] === "cat"
        ? [await readFile(join(root, basename(command[1] as string)), "utf8")]
        : [];
    },
  };
  return { root, project, docker, calls };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("crée six catégories sans écraser les données et refuse les liens de catégorie", async () => {
  const { root } = await fixture();
  await prepareProjectWorkspace(root);
  await writeFile(join(root, "reports", "existing.md"), "keep");
  await prepareProjectWorkspace(root);
  expect(await readFile(join(root, "reports", "existing.md"), "utf8")).toBe("keep");
  expect(await readdir(root)).toEqual([...PROJECT_WORKSPACE_FOLDERS].sort());
  const other = await fixture();
  await rm(join(root, "payloads"), { recursive: true });
  await symlink(other.root, join(root, "payloads"));
  await expect(prepareProjectWorkspace(root)).rejects.toThrow();
});
it("vérifie le partage réel et ne transmet le nom de projet que comme argument normalisé", async () => {
  const { root, project, docker, calls } = await fixture();
  const path = await prepareContainerProjectWorkspace(project, "kali-1", docker);
  expect(path).toMatch(/^\/redwidow\/Workspace\/[A-Za-z0-9_-]+$/);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.at(-2)).toBe(path);
  expect(calls[1]?.at(-1)).toBe("/workspace");
  expect(await readdir(root)).toEqual([...PROJECT_WORKSPACE_FOLDERS].sort());
  expect(containerProjectWorkspace({ ...project, id: randomUUID() })).not.toBe(path);
});
it("refuse un autre projet, un partage différent et une fausse preuve sans créer d’alias", async () => {
  const { project, docker, calls } = await fixture();
  const other = await fixture();
  await expect(prepareContainerProjectWorkspace(project, "foreign", docker)).rejects.toThrow();
  await expect(
    prepareContainerProjectWorkspace(project, "kali-1", {
      ...docker,
      listLabelPrefix: async () => [
        { name: "kali-1", workspace: other.root, state: "running", family: "kali", image: "kali" },
      ],
    }),
  ).rejects.toMatchObject({
    code: "project.workspaceNotMounted",
    params: {
      container: "kali-1",
      mounted: other.root,
      project: `${project.name} (${project.workspace})`,
    },
  });
  await expect(
    prepareContainerProjectWorkspace(project, "kali-1", {
      ...docker,
      execWorkspace: async () => ["fake"],
    }),
  ).rejects.toMatchObject({ code: "project.workspaceNotMounted" });
  expect(calls).toHaveLength(0);
});
it("adapte Docker Desktop sans transformer un chemin arbitraire ou distant", () => {
  expect(dockerHostWorkspace("/run/desktop/mnt/host/c/Users/Lab", "win32")).toBe("c:\\Users\\Lab");
  expect(dockerHostWorkspace("/host_mnt/C/Users/Lab", "linux")).toBe("/mnt/c/Users/Lab");
  expect(dockerHostWorkspace("/remote/project", "win32")).toBe("/remote/project");
});

it("accepte un sous-dossier réel et refuse une sortie par lien", async () => {
  const { root, project, docker, calls } = await fixture();
  const nested = join(root, "mission avec espaces");
  await mkdir(nested);
  const nestedDocker = {
    ...docker,
    execWorkspace: async (_container: string, command: readonly string[]) => {
      (calls as string[][]).push([...command]);
      return command[0] === "cat"
        ? [await readFile(join(nested, basename(command[1] as string)), "utf8")]
        : [];
    },
  };
  await prepareContainerProjectWorkspace({ ...project, workspace: nested }, "kali-1", nestedDocker);
  expect(calls[0]?.[1]).toContain("/workspace/mission avec espaces/");
  expect(calls[1]?.at(-1)).toBe("/workspace/mission avec espaces");
  const other = await fixture();
  await symlink(other.root, join(root, "escape"));
  await expect(
    prepareContainerProjectWorkspace(
      { ...project, workspace: join(root, "escape") },
      "kali-1",
      docker,
    ),
  ).rejects.toThrow();
});

const SYMLINK_TYPE = process.platform === "win32" ? "junction" : "dir";

it("nextContainerName : plus petit N libre, trous comblés, casse ignorée, familles séparées", () => {
  expect(nextContainerName("kali", [])).toBe("kali-1");
  expect(nextContainerName("kali", ["kali-1", "kali-2"])).toBe("kali-3");
  expect(nextContainerName("kali", ["kali-1", "kali-3"])).toBe("kali-2");
  expect(nextContainerName("kali", ["KALI-1", "Kali-2"])).toBe("kali-3");
  expect(nextContainerName("exegol", ["kali-1", "exegol-2"])).toBe("exegol-1");
  expect(nextContainerName("exegol", ["exegol-10"])).toBe("exegol-1");
});

it("reserveContainerFolder : crée <racine>/<nom> exclusif (0o700), refuse l'existant", async () => {
  const root = await fixtureDir();
  const path = await reserveContainerFolder(root, "Kali-1");
  expect(path).toBe(join(root, "kali-1"));
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o700);
  await expect(reserveContainerFolder(root, "kali-1")).rejects.toMatchObject({
    code: "project.destinationExists",
  });
  await writeFile(join(path, "garde.txt"), "intact");
  expect(await readFile(join(path, "garde.txt"), "utf8")).toBe("intact");
});

it("reserveContainerFolder : nom dangereux ou racine invalide refusés", async () => {
  const root = await fixtureDir();
  for (const bad of ["", ".", "..", "../x", "a/b", "-x", ".x", "a b", "x".repeat(64), "é"])
    await expect(reserveContainerFolder(root, bad)).rejects.toMatchObject({
      code: "project.parentInvalid",
    });
  expect(await readdir(root)).toEqual([]);
  for (const bad of ["relatif", join(root, "absent"), ""])
    await expect(reserveContainerFolder(bad, "kali-1")).rejects.toMatchObject({
      code: "container.rootInvalid",
    });
  const link = join(root, "lien");
  const real = await fixtureDir();
  await symlink(real, link, SYMLINK_TYPE);
  await expect(reserveContainerFolder(link, "kali-1")).rejects.toMatchObject({
    code: "container.rootInvalid",
  });
  expect(await readdir(real)).toEqual([]);
});

it("prepareRedwidowRoot : arborescence complète, idempotente, sans rien écraser", async () => {
  const share = await fixtureDir();
  const root = await prepareRedwidowRoot(share);
  expect(root).toBe(join(share, "RedWidow"));
  expect(projectsParent(share)).toBe(join(share, "RedWidow", "projects"));
  expect((await readdir(root)).sort()).toEqual([...CONTAINER_ROOT_DIRS, "projects"].sort());
  if (process.platform !== "win32") expect((await stat(root)).mode & 0o777).toBe(0o700);
  await writeFile(join(root, "notes", "garde.txt"), "intact");
  expect(await prepareRedwidowRoot(share)).toBe(root);
  expect(await readFile(join(root, "notes", "garde.txt"), "utf8")).toBe("intact");
});

it("prepareRedwidowRoot : lien symbolique rencontré, partage invalide ou fichier refusés", async () => {
  const share = await fixtureDir();
  const outside = await fixtureDir();
  await mkdir(join(share, "RedWidow"));
  await symlink(outside, join(share, "RedWidow", "notes"), SYMLINK_TYPE);
  await expect(prepareRedwidowRoot(share)).rejects.toMatchObject({ code: "path.outside" });
  expect(await readdir(outside)).toEqual([]);
  const other = await fixtureDir();
  await symlink(outside, join(other, "RedWidow"), SYMLINK_TYPE);
  await expect(prepareRedwidowRoot(other)).rejects.toMatchObject({ code: "path.outside" });
  expect(await readdir(outside)).toEqual([]);
  await expect(prepareRedwidowRoot(join(share, "absent"))).rejects.toMatchObject({
    code: "project.parentInvalid",
  });
  await writeFile(join(share, "fichier"), "x");
  await expect(prepareRedwidowRoot(join(share, "fichier"))).rejects.toMatchObject({
    code: "project.parentInvalid",
  });
});

it("isInsideShare : égal ou dedans, jamais un voisin au préfixe commun, faux si absent", async () => {
  const share = await fixtureDir();
  const dedans = join(share, "a", "b");
  await mkdir(dedans, { recursive: true });
  const voisin = `${share}-voisin`;
  await mkdir(voisin);
  roots.push(voisin);
  expect(await isInsideShare(share, share)).toBe(true);
  expect(await isInsideShare(share, dedans)).toBe(true);
  expect(await isInsideShare(share, voisin)).toBe(false);
  expect(await isInsideShare(share, join(share, "absent"))).toBe(false);
  const lien = join(share, "lien");
  await symlink(voisin, lien, SYMLINK_TYPE);
  expect(await isInsideShare(share, lien)).toBe(false);
});

it("projectPlacement : ok, noContainer, outsideShare", () => {
  const project = { workspace: "/partage/RedWidow/projects/p", containers: ["kali-1", "kali-2"] };
  const mounts = (entries: [string, string | undefined][]) => new Map(entries);
  expect(projectPlacement(project, mounts([["kali-1", "/partage"]]))).toBe("ok");
  expect(
    projectPlacement(
      project,
      mounts([
        ["kali-1", "/autre"],
        ["kali-2", "/partage/RedWidow"],
      ]),
    ),
  ).toBe("ok");
  expect(projectPlacement({ ...project, containers: [] }, mounts([["kali-1", "/partage"]]))).toBe(
    "noContainer",
  );
  expect(projectPlacement(project, mounts([["kali-1", "/autre"]]))).toBe("outsideShare");
  expect(projectPlacement(project, mounts([["kali-1", "/partage-voisin"]]))).toBe("outsideShare");
  expect(projectPlacement(project, mounts([["kali-1", undefined]]))).toBe("outsideShare");
  expect(projectPlacement(project, new Map())).toBe("outsideShare");
});
