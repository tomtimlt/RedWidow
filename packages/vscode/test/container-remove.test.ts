import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, readProjects, removeContainerAssociations } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { removeListedContainer } from "../src/logic/container-remove.js";

async function setup(running = false) {
  const configDir = await mkdtemp(join(tmpdir(), "warband-remove-"));
  const row = {
    name: "kali-lab",
    family: "kali" as const,
    state: running ? ("running" as const) : ("stopped" as const),
    image: "kali",
  };
  const inspect = vi
    .fn()
    .mockResolvedValue([{ Id: "a".repeat(64), Name: "/kali-lab", State: { Running: running } }]);
  const docker = {
    listLabelPrefix: vi.fn().mockResolvedValue([row]),
    inspect,
    rm: vi.fn().mockResolvedValue(undefined),
  };
  const confirm = vi.fn().mockResolvedValue(true);
  return { configDir, docker, confirm, deps: { configDir, confirm, createDocker: () => docker } };
}

describe("suppression humaine d'un conteneur", () => {
  it("annuler pendant la revalidation empêche la suppression", async () => {
    const { deps, docker } = await setup();
    const abort = new AbortController();
    let inspections = 0;
    docker.inspect.mockImplementation(async () => {
      if (++inspections === 2) abort.abort();
      return [{ Id: "a".repeat(64), Name: "/kali-lab", State: { Running: false } }];
    });
    await expect(
      removeListedContainer("kali-lab", { ...deps, signal: abort.signal }),
    ).rejects.toThrow();
    expect(docker.rm).not.toHaveBeenCalled();
  });
  it("une annulation ne supprime rien", async () => {
    const { deps, docker, confirm } = await setup();
    confirm.mockResolvedValue(false);
    expect(await removeListedContainer("kali-lab", deps)).toEqual({
      status: "cancelled",
      name: "kali-lab",
    });
    expect(docker.rm).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "supprime par ID avec force seulement si confirmé actif : %s",
    async (running) => {
      const { deps, docker, confirm } = await setup(running);
      expect((await removeListedContainer("kali-lab", deps)).status).toBe("removed");
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ force: running, state: running ? "running" : "stopped" }),
      );
      expect(docker.rm).toHaveBeenCalledWith("a".repeat(64), running ? { force: true } : {});
    },
  );
  it("refuse un remplacement portant le même nom", async () => {
    const { deps, docker } = await setup();
    docker.inspect.mockResolvedValueOnce([
      { Id: "a".repeat(64), Name: "/kali-lab", State: { Running: false } },
    ]);
    docker.inspect.mockResolvedValue([
      { Id: "b".repeat(64), Name: "/kali-lab", State: { Running: false } },
    ]);
    await expect(removeListedContainer("kali-lab", deps)).rejects.toThrow("changé");
    expect(docker.rm).not.toHaveBeenCalled();
  });
  it("refuse un état devenu actif et une famille non autorisée", async () => {
    const { deps, docker } = await setup();
    docker.listLabelPrefix.mockResolvedValueOnce([
      { name: "kali-lab", family: "kali", state: "stopped", image: "kali" },
    ]);
    docker.listLabelPrefix.mockResolvedValue([
      { name: "kali-lab", family: "kali", state: "running", image: "kali" },
    ]);
    await expect(removeListedContainer("kali-lab", deps)).rejects.toThrow();
    expect(docker.rm).not.toHaveBeenCalled();
  });
  it("refuse une configuration invalide avant suppression", async () => {
    const { configDir, deps, docker } = await setup();
    await writeFile(join(configDir, "project.json"), "{}");
    await expect(removeListedContainer("kali-lab", deps)).rejects.toThrow();
    expect(docker.rm).not.toHaveBeenCalled();
  });
  it("conserve les associations lorsque Docker échoue", async () => {
    const { configDir, deps, docker } = await setup();
    await createProject(configDir, {
      containers: ["kali-1"],
      name: "Projet",
      workspace: "/tmp/work",
    });
    const before = await readFile(join(configDir, "project.json"), "utf8");
    docker.rm.mockRejectedValue(new Error("Docker indisponible"));
    await expect(removeListedContainer("kali-lab", deps)).rejects.toThrow("Docker indisponible");
    expect(await readFile(join(configDir, "project.json"), "utf8")).toBe(before);
  });
  it("signale explicitement le succès partiel du nettoyage", async () => {
    const { deps, docker } = await setup();
    const result = await removeListedContainer("kali-lab", {
      ...deps,
      cleanup: async () => {
        throw new Error("disque plein");
      },
    });
    expect(result).toMatchObject({ status: "partial", name: "kali-lab" });
    expect(docker.rm).toHaveBeenCalledOnce();
  });
  it("nettoie tous les projets et primary sans toucher aux workspaces, et reste idempotent", async () => {
    const { configDir, deps, confirm } = await setup();
    await createProject(configDir, { containers: ["kali-1"], name: "Un", workspace: "/tmp/un" });
    await createProject(configDir, {
      containers: ["kali-1"],
      name: "Deux",
      workspace: "/tmp/deux",
    });
    const file = await readProjects(configDir);
    if (file === null) throw new Error("projets absents");
    const projects = file.projects.map((p) => ({
      ...p,
      containers: ["kali-lab", "autre"],
      primary: "kali-lab",
    }));
    await writeFile(join(configDir, "project.json"), JSON.stringify({ ...file, projects }));
    await removeListedContainer("kali-lab", deps);
    expect(confirm.mock.calls[0]?.[0].projects).toHaveLength(2);
    const after = await readProjects(configDir);
    expect(after?.projects).toEqual(
      projects.map(({ primary: _primary, ...p }) => ({ ...p, containers: ["autre"] })),
    );
    await removeContainerAssociations(configDir, "kali-lab");
    expect(await readProjects(configDir)).toEqual(after);
  });
});
