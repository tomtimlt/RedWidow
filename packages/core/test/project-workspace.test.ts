import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { StoredProject } from "../src/project.js";
import {
  containerProjectWorkspace,
  dockerHostWorkspace,
  PROJECT_WORKSPACE_FOLDERS,
  prepareContainerProjectWorkspace,
  prepareProjectWorkspace,
} from "../src/project-workspace.js";

const roots: string[] = [];
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
