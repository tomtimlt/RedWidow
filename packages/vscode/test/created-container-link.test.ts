import { CodedError, type LabelPrefixContainer, type StoredProject } from "@warband/core";
import { expect, it, vi } from "vitest";
import { createAndLinkContainer } from "../src/logic/created-container-link.js";

function fixture() {
  const project: StoredProject = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Laboratoire",
    workspace: "/projet",
    containers: [],
  };
  let current = { ...project };
  const row: LabelPrefixContainer = {
    name: "exegol-lab",
    family: "exegol",
    state: "running",
    image: "laboratoire",
    workspace: "/projet",
  };
  let rows: LabelPrefixContainer[] = [];
  let clock = 0;
  const abort = new AbortController();
  const link = vi.fn(async (_name: string, _id: string, verify: () => Promise<void>) => {
    await verify();
  });
  const deps = {
    signal: abort.signal,
    read: async () => ({ activeId: current.id, projects: [current] }),
    list: async () => rows,
    identity: vi.fn(async () => "a".repeat(64)),
    start: vi.fn(async () => {
      rows = [row];
    }),
    link,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    timeoutMs: 5000,
  };
  return {
    project,
    row,
    deps,
    link,
    abort,
    rows: (next: LabelPrefixContainer[]) => {
      rows = next;
    },
    current: (next: StoredProject) => {
      current = next;
    },
  };
}

it("attend le conteneur créé puis passe par la liaison vérifiée du projet capturé", async () => {
  const f = fixture();
  expect(await createAndLinkContainer(f.project, "lab", f.deps)).toBe("exegol-lab");
  expect(f.deps.start).toHaveBeenCalledOnce();
  expect(f.link).toHaveBeenCalledWith("exegol-lab", f.project.id, expect.any(Function));
  expect(f.link).toHaveBeenCalledOnce();
  expect(f.deps.identity.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it("ne traite jamais un conteneur préexistant comme une création réussie", async () => {
  const f = fixture();
  f.rows([f.row]);
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toThrow();
  expect(f.deps.start).not.toHaveBeenCalled();
  expect(f.link).not.toHaveBeenCalled();
});

it("un nom court ambigu ne prouve jamais l’absence du conteneur avant création", async () => {
  const f = fixture();
  f.rows([f.row, { ...f.row, name: "kali-lab", family: "kali" }]);
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toThrow();
  expect(f.deps.start).not.toHaveBeenCalled();
  expect(f.link).not.toHaveBeenCalled();
});

it.each(["id", "workspace"])("invalide l’intention si le %s du projet change", async (field) => {
  const f = fixture();
  f.deps.start = vi.fn(async () => {
    f.current({ ...f.project, [field]: "autre" });
  });
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toMatchObject({
    code: "project.absent",
  });
  expect(f.link).not.toHaveBeenCalled();
});

it("refuse une identité Docker remplacée avant la liaison", async () => {
  const f = fixture();
  f.deps.identity.mockResolvedValueOnce("a".repeat(64)).mockResolvedValue("b".repeat(64));
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toMatchObject({
    code: "project.notFound",
  });
  expect(f.link).not.toHaveBeenCalled();
});

it("ne relance pas une liaison dont le marqueur est refusé", async () => {
  const f = fixture();
  f.link.mockRejectedValue(new CodedError("project.workspaceNotMounted"));
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toMatchObject({
    code: "project.workspaceNotMounted",
  });
  expect(f.link).toHaveBeenCalledOnce();
});

it.each(["absent", "kali"])("borne l’observation sans lier un conteneur %s", async (state) => {
  const f = fixture();
  f.deps.start = vi.fn(async () => {
    f.rows(state === "kali" ? [{ ...f.row, family: "kali" }] : []);
  });
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toMatchObject({
    code: "project.notRunning",
  });
  expect(f.link).not.toHaveBeenCalled();
});

it("l’annulation désarme l’auto-liaison, même pendant l’attente de création", async () => {
  const f = fixture();
  f.deps.start = vi.fn(async () => undefined);
  f.deps.sleep = async () => {
    f.abort.abort();
  };
  await expect(createAndLinkContainer(f.project, "lab", f.deps)).rejects.toThrow();
  expect(f.link).not.toHaveBeenCalled();
});
