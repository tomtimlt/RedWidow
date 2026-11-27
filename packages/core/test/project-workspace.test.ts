import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  prepareCommonRoot,
  prepareContainerProjectWorkspace,
  prepareProjectWorkspace,
  prepareRedwidowRoot,
  projectContainerPath,
  projectsParent,
  reserveContainerFolder,
  visibleContainerNames,
} from "../src/project-workspace.js";

const roots: string[] = [];
async function fixtureDir() {
  // Chemin réel : sous Windows, le dossier temporaire peut s'écrire en 8.3 (RUNNER~1).
  const dir = await realpath(await mkdtemp(join(tmpdir(), "redwidow-container-")));
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

it("projectContainerPath : sous un montage, cible + chemin relatif POSIX ; sinon undefined", () => {
  const mounts = [{ source: "/racine/conteneurs/kali-1", target: "/workspace" }];
  expect(projectContainerPath("/racine/conteneurs/kali-1/p", mounts, "linux")).toBe("/workspace/p");
  expect(projectContainerPath("/racine/conteneurs/kali-1", mounts, "linux")).toBe("/workspace");
  expect(projectContainerPath("/racine/conteneurs/kali-10/p", mounts, "linux")).toBeUndefined();
  expect(projectContainerPath("/ailleurs/p", mounts, "linux")).toBeUndefined();
  expect(projectContainerPath("/racine/p", [], "linux")).toBeUndefined();
});

it("projectContainerPath : nouvelle racine (projets monté sous /workspace) et ancien partage", () => {
  const mounts = [
    { source: "/racine/conteneurs/kali-1", target: "/workspace" },
    { source: "/racine/projets", target: "/workspace/projets" },
    { source: "/racine/ressources", target: "/workspace/ressources" },
  ];
  expect(projectContainerPath("/racine/projets/client/scans", mounts, "linux")).toBe(
    "/workspace/projets/client/scans",
  );
  // Ancien partage (ADR 0053) : un seul montage /workspace.
  const ancien = [{ source: "/partage", target: "/workspace" }];
  expect(projectContainerPath("/partage/RedWidow/projects/p", ancien, "linux")).toBe(
    "/workspace/RedWidow/projects/p",
  );
});

it("projectContainerPath : la source la plus spécifique l'emporte, quel que soit l'ordre", () => {
  const large = { source: "/racine", target: "/racine-vue" };
  const fin = { source: "/racine/projets", target: "/p" };
  for (const mounts of [
    [large, fin],
    [fin, large],
  ])
    expect(projectContainerPath("/racine/projets/x", mounts, "linux")).toBe("/p/x");
  expect(projectContainerPath("/racine/autre/x", [large, fin], "linux")).toBe(
    "/racine-vue/autre/x",
  );
});

it("projectContainerPath : chemin Docker Desktop /host_mnt/c/... et Windows", () => {
  const desktop = [
    { source: "/host_mnt/c/Users/Lab/RedWidow/projets", target: "/workspace/projets" },
  ];
  expect(projectContainerPath("/mnt/c/Users/Lab/RedWidow/projets/p", desktop, "linux")).toBe(
    "/workspace/projets/p",
  );
  const windows = [{ source: "/run/desktop/mnt/host/c/Users/Lab/RedWidow", target: "/workspace" }];
  expect(projectContainerPath("C:\\Users\\Lab\\RedWidow\\projets\\p x", windows, "win32")).toBe(
    "/workspace/projets/p x",
  );
  // Casse ignorée sous Windows, voisin refusé.
  expect(
    projectContainerPath("c:\\users\\lab\\redwidow-autre\\p", windows, "win32"),
  ).toBeUndefined();
  const natif = [{ source: "D:\\Racine", target: "/workspace" }];
  expect(projectContainerPath("d:\\racine\\projets\\p", natif, "win32")).toBe(
    "/workspace/projets/p",
  );
});

it("prepareContainerProjectWorkspace : alias vers le chemin calculé (montage projets sous /workspace)", async () => {
  const { root, project, calls } = await fixture();
  // Le conteneur monte le dossier du projet sous /workspace/projets/<nom>.
  const docker = {
    listLabelPrefix: async () => [
      {
        name: "kali-1",
        state: "running" as const,
        family: "kali" as const,
        image: "kali",
        mounts: [{ source: root, target: "/workspace/projets/x", readonly: false }],
      },
    ],
    execWorkspace: async (_container: string, command: readonly string[]) => {
      (calls as string[][]).push([...command]);
      return command[0] === "cat"
        ? [await readFile(join(root, basename(command[1] as string)), "utf8")]
        : [];
    },
  };
  const target = await prepareContainerProjectWorkspace(project, "kali-1", docker);
  expect(calls[0]?.[1]).toContain("/workspace/projets/x/");
  expect(calls[1]?.at(-2)).toBe(target);
  expect(calls[1]?.at(-1)).toBe("/workspace/projets/x");
});

it("prepareContainerProjectWorkspace : conteneur qui ne voit pas le projet, même sans liste de conteneurs", async () => {
  const { project, docker } = await fixture();
  const other = await fixture();
  await expect(
    prepareContainerProjectWorkspace(project, "kali-1", {
      ...docker,
      listLabelPrefix: async () => [
        {
          name: "kali-1",
          state: "running",
          family: "kali",
          image: "kali",
          mounts: [{ source: other.root, target: "/workspace", readonly: false }],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "project.workspaceNotMounted" });
  await expect(
    prepareContainerProjectWorkspace(project, "kali-1", {
      ...docker,
      listLabelPrefix: async () => [
        {
          name: "kali-1",
          state: "stopped",
          family: "kali",
          image: "kali",
          workspace: project.workspace,
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "project.notRunning" });
});

it("projectPlacement : un conteneur qui ne voit pas le projet ne suffit plus, deux conteneurs oui", () => {
  const project = { workspace: "/racine/projets/p" };
  const mounts = (entries: [string, { source: string; target: string }[]][]) => new Map(entries);
  const voit = [{ source: "/racine/projets", target: "/workspace/projets" }];
  const nevoitpas = [{ source: "/autre", target: "/workspace" }];
  expect(projectPlacement(project, mounts([["kali-1", voit]]))).toBe("ok");
  expect(projectPlacement(project, mounts([["kali-1", nevoitpas]]))).toBe("noVisibleContainer");
  expect(
    projectPlacement(
      project,
      mounts([
        ["kali-1", nevoitpas],
        ["kali-2", voit],
      ]),
    ),
  ).toBe("ok");
  expect(
    projectPlacement(
      project,
      mounts([
        ["kali-1", voit],
        ["kali-2", voit],
      ]),
    ),
  ).toBe("ok");
  expect(
    projectPlacement(
      project,
      mounts([["kali-1", [{ source: "/racine/projets-voisin", target: "/x" }]]]),
    ),
  ).toBe("noVisibleContainer");
  expect(projectPlacement(project, mounts([["kali-1", []]]))).toBe("noVisibleContainer");
  expect(projectPlacement(project, new Map())).toBe("noVisibleContainer");
});

it("prepareCommonRoot : projets, conteneurs, ressources, idempotent, sans rien écraser", async () => {
  const root = await fixtureDir();
  const dirs = await prepareCommonRoot(root);
  expect(dirs).toEqual({
    root,
    projects: join(root, "projets"),
    containers: join(root, "conteneurs"),
    resources: join(root, "ressources"),
  });
  expect((await readdir(root)).sort()).toEqual(["conteneurs", "projets", "ressources"]);
  if (process.platform !== "win32") expect((await stat(dirs.projects)).mode & 0o777).toBe(0o700);
  await writeFile(join(dirs.projects, "garde.txt"), "intact");
  expect(await prepareCommonRoot(root)).toEqual(dirs);
  expect(await readFile(join(dirs.projects, "garde.txt"), "utf8")).toBe("intact");
});

it("prepareCommonRoot : lien symbolique, racine invalide ou fichier refusés", async () => {
  const root = await fixtureDir();
  const other = await fixtureDir();
  await symlink(other, join(root, "projets"), SYMLINK_TYPE);
  await expect(prepareCommonRoot(root)).rejects.toMatchObject({ code: "path.outside" });
  expect(await readdir(other)).toEqual([]);
  for (const bad of ["relatif", join(root, "absent"), ""])
    await expect(prepareCommonRoot(bad)).rejects.toMatchObject({ code: "project.parentInvalid" });
});

it("visibleContainerNames : démarré, famille connue et montage qui contient le projet (ADR 0054)", () => {
  const ws = "/racine/projets/mission";
  const sees = [{ source: "/racine/projets", target: "/workspace/projets" }];
  const rows = [
    { name: "a", state: "running", family: "exegol", mounts: sees },
    { name: "b", state: "running", family: "kali", mounts: sees },
    { name: "arrete", state: "stopped", family: "kali", mounts: sees },
    {
      name: "aveugle",
      state: "running",
      family: "kali",
      mounts: [{ source: "/ailleurs", target: "/workspace" }],
    },
    { name: "inconnu", state: "running", family: "autre", mounts: sees },
    { name: "ancien", state: "running", family: "exegol", workspace: "/racine" },
  ];
  expect(visibleContainerNames(ws, rows, "linux")).toEqual(["a", "b", "ancien"]);
  expect(visibleContainerNames("/autre/projet", rows, "linux")).toEqual([]);
});
