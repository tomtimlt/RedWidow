import type { LabelPrefixContainer } from "@warband/core";
import { expect, it, vi } from "vitest";
import { awaitCreatedContainer } from "../src/logic/created-container-link.js";

function fixture() {
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
  const deps = {
    signal: abort.signal,
    list: async () => rows,
    start: vi.fn(async () => {
      rows = [row];
    }),
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    timeoutMs: 5000,
  };
  return {
    row,
    deps,
    abort,
    rows: (next: LabelPrefixContainer[]) => {
      rows = next;
    },
  };
}

it("attend le conteneur en état running puis renvoie son nom", async () => {
  const f = fixture();
  expect(await awaitCreatedContainer("lab", f.deps)).toBe("exegol-lab");
  expect(f.deps.start).toHaveBeenCalledOnce();
});

it("conteneur absent jusqu'au délai : project.notRunning", async () => {
  const f = fixture();
  f.deps.start = vi.fn(async () => {});
  await expect(awaitCreatedContainer("lab", f.deps)).rejects.toMatchObject({
    code: "project.notRunning",
  });
});

it("l'annulation interrompt l'attente", async () => {
  const f = fixture();
  f.deps.start = vi.fn(async () => {});
  f.deps.sleep = async () => f.abort.abort();
  await expect(awaitCreatedContainer("lab", f.deps)).rejects.toThrow();
});

it("un nom déjà pris est refusé avant tout démarrage", async () => {
  const f = fixture();
  f.rows([f.row]);
  await expect(awaitCreatedContainer("lab", f.deps)).rejects.toMatchObject({
    code: "project.notFound",
  });
  expect(f.deps.start).not.toHaveBeenCalled();
});
