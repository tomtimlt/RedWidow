import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodedError,
  prepareContainerProjectWorkspace,
  resolveExegolContainer,
  resolveKaliContainer,
  type StoredProject,
} from "@warband/core";
import { expect, it, vi } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";
import {
  linkWithProjectWorkspace,
  recoverWorkspaceLink,
  unlinkedContainerMentions,
} from "../src/logic/project-container-link.js";

it("une mention existante non liée propose la liaison sans autoriser l’exécution", () => {
  const rows = [
    { name: "kali-1", family: "kali" },
    { name: "exegol-lab", family: "exegol" },
  ];
  expect(
    unlinkedContainerMentions("tester @kali-1 @lab @inexistant", rows, ["exegol-lab"]),
  ).toEqual(["kali-1"]);
  const target = { allowed: [], mentions: ["kali-1"], projectId: randomUUID() };
  expect(() => resolveKaliContainer(target, "kali-1", rows)).toThrow();
});

it("un conteneur lié est utilisable sans mention, pour les deux familles", () => {
  const rows = [
    { name: "kali-1", family: "kali" },
    { name: "exegol-lab", family: "exegol" },
  ];
  const target = { allowed: rows.map((row) => row.name), mentions: [], projectId: randomUUID() };
  expect(resolveKaliContainer(target, "kali-1", rows)).toBe("kali-1");
  expect(resolveExegolContainer(target, "exegol-lab", rows)).toBe("exegol-lab");
});

it("la carte et le cockpit partagent le même parcours vérifié, avant et après liaison", async () => {
  const project: StoredProject = {
    id: randomUUID(),
    name: "Démo",
    workspace: "/projet",
    containers: [],
  };
  const read = async () => ({ activeId: project.id, projects: [project] });
  const prepare = vi.fn(async () => undefined);
  const link = vi.fn(async () => {
    project.containers = [...project.containers, "kali-1"];
    return "lié";
  });
  expect(
    await linkWithProjectWorkspace("kali-1", {
      read,
      prepare,
      prepareRuntime: async () => undefined,
      link,
    }),
  ).toBe("lié");
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(link).toHaveBeenCalledOnce();
});

it("refuse un montage divergent avant de modifier l’allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "link-chat-"));
  try {
    const project: StoredProject = {
      id: randomUUID(),
      name: "Démo",
      workspace: join(root, "projet"),
      containers: [],
    };
    const { mkdir } = await import("node:fs/promises");
    await mkdir(project.workspace);
    await mkdir(join(root, "autre"));
    const link = vi.fn(async () => undefined);
    await expect(
      linkWithProjectWorkspace("kali-1", {
        read: async () => ({ activeId: project.id, projects: [project] }),
        prepare: (candidate, name) =>
          prepareContainerProjectWorkspace(candidate, name, {
            listLabelPrefix: async () => [
              {
                name,
                family: "kali",
                state: "running",
                image: "kali",
                workspace: join(root, "autre"),
              },
            ],
            execWorkspace: async () => [],
          }),
        prepareRuntime: async () => undefined,
        link,
      }),
    ).rejects.toMatchObject({ code: "project.workspaceNotMounted" });
    expect(link).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuse une liaison si le projet change pendant la préparation", async () => {
  const project: StoredProject = {
    id: randomUUID(),
    name: "Démo",
    workspace: "/projet",
    containers: [],
  };
  let activeId = project.id;
  const link = vi.fn(async () => undefined);
  await expect(
    linkWithProjectWorkspace("kali-1", {
      read: async () => ({ activeId, projects: [project] }),
      prepare: async () => {
        activeId = randomUUID();
      },
      prepareRuntime: async () => undefined,
      link,
    }),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(link).not.toHaveBeenCalled();
});

it("vérifie l’identité de la proposition avant toute préparation", async () => {
  const project: StoredProject = {
    id: randomUUID(),
    name: "Démo",
    workspace: "/projet",
    containers: [],
  };
  const prepare = vi.fn(async () => undefined);
  const link = vi.fn(async () => undefined);
  await expect(
    linkWithProjectWorkspace("kali-1", {
      expectedProjectId: randomUUID(),
      read: async () => ({ activeId: project.id, projects: [project] }),
      prepare,
      prepareRuntime: async () => undefined,
      link,
    }),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(prepare).not.toHaveBeenCalled();
  expect(link).not.toHaveBeenCalled();
});

it("revalide les messages de la carte et du bandeau", () => {
  expect(parseWebviewMessage({ type: "openCockpit" })).toEqual({ type: "openCockpit" });
  expect(parseWebviewMessage({ type: "linkMention", name: "kali-1" })).toEqual({
    type: "linkMention",
    name: "kali-1",
  });
  expect(parseWebviewMessage({ type: "linkMention", name: "../../secret" })).toBeNull();
  expect(
    parseWebviewMessage({ type: "linkMention", name: "kali-1", projectId: "forgé" }),
  ).toBeNull();
});

it("un changement de dossier sous le même id annule la liaison avant l’allowlist", async () => {
  const project: StoredProject = {
    id: randomUUID(),
    name: "Démo",
    workspace: "/projet",
    containers: [],
  };
  let current = project;
  const link = vi.fn(async () => undefined);
  await expect(
    linkWithProjectWorkspace("kali-1", {
      read: async () => ({ activeId: project.id, projects: [current] }),
      prepare: async () => {
        current = { ...project, workspace: "/autre" };
      },
      prepareRuntime: async () => undefined,
      link,
    }),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect(link).not.toHaveBeenCalled();
});

it("l’auto-liaison ne récupère jamais une erreur de montage en choisissant une autre cible", async () => {
  const error = new CodedError("project.workspaceNotMounted");
  const recover = vi.fn(async () => "autre-conteneur");
  await expect(recoverWorkspaceLink(error, true, recover)).rejects.toBe(error);
  expect(recover).not.toHaveBeenCalled();
  expect(await recoverWorkspaceLink(error, false, recover)).toBe("autre-conteneur");
  expect(recover).toHaveBeenCalledOnce();
});
