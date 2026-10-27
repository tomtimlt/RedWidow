import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  appendFinding,
  createApprovalGate,
  createRecorder,
  DEFAULT_POLICY,
  deleteFinding,
  projectFindingsPath,
  readFindings,
  setFindingPathEdge,
  updateFinding,
} from "../src/index.js";

const project = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "warband-path-"));
  dirs.push(dir);
  const a = await appendFinding(dir, project, { kind: "host", label: "A", state: "confirmed" });
  const b = await appendFinding(dir, project, { kind: "step", label: "B", state: "hypothesis" });
  const c = await appendFinding(dir, project, {
    kind: "loot",
    label: "C",
    state: "failed",
    from: [a.id, b.id],
  });
  return { dir, a, b, c };
}
it("fusionne les annotations concurrentes et conserve les états et les liens", async () => {
  const { dir, a, b, c } = await setup();
  await Promise.all([
    setFindingPathEdge(dir, project, a.id, c.id, true),
    setFindingPathEdge(dir, project, b.id, c.id, true),
  ]);
  const saved = (await readFindings(dir, project)).find((node) => node.id === c.id);
  expect(saved?.pathFrom?.sort()).toEqual([a.id, b.id].sort());
  expect(saved).toMatchObject({ state: "failed", from: [a.id, b.id], label: "C" });
  await setFindingPathEdge(dir, project, a.id, c.id, false);
  expect((await readFindings(dir, project)).find((node) => node.id === c.id)?.pathFrom).toEqual([
    b.id,
  ]);
});
it("refuse les liens inexistants et les annotations hors parents sans modifier le fichier", async () => {
  const { dir, a, b, c } = await setup();
  const path = projectFindingsPath(dir, project);
  const before = await readFile(path, "utf8");
  await expect(setFindingPathEdge(dir, project, a.id, b.id, true)).rejects.toMatchObject({
    code: "finding.notFound",
  });
  await expect(updateFinding(dir, project, c.id, { pathFrom: ["absent"] })).rejects.toMatchObject({
    code: "project.invalid",
  });
  expect(await readFile(path, "utf8")).toBe(before);
});
it("nettoie le marquage après modification des parents et suppression d'un parent", async () => {
  const { dir, a, b, c } = await setup();
  await updateFinding(dir, project, c.id, { pathFrom: [a.id, b.id] });
  await updateFinding(dir, project, c.id, { from: [b.id] });
  expect((await readFindings(dir, project)).find((node) => node.id === c.id)?.pathFrom).toEqual([
    b.id,
  ]);
  await deleteFinding(dir, project, b.id);
  expect((await readFindings(dir, project)).find((node) => node.id === c.id)).not.toHaveProperty(
    "pathFrom",
  );
});
it("refuse un marquage stocké invalide et honore la revalidation avant écriture", async () => {
  const { dir, a, c } = await setup();
  await expect(
    setFindingPathEdge(dir, project, a.id, c.id, true, {
      beforeCommit: () => {
        throw new Error("projet changé");
      },
    }),
  ).rejects.toThrow("projet changé");
  expect((await readFindings(dir, project)).find((node) => node.id === c.id)).not.toHaveProperty(
    "pathFrom",
  );
  const rows = await readFindings(dir, project);
  rows[0]!.pathFrom = [c.id];
  await writeFile(projectFindingsPath(dir, project), JSON.stringify(rows));
  await expect(readFindings(dir, project)).rejects.toMatchObject({ code: "project.invalid" });
});
it("la gate autorise l'annotation autonome mais conserve un refus explicite", async () => {
  const recorder = createRecorder();
  const gate = createApprovalGate({ policy: DEFAULT_POLICY, recorder });
  expect(
    (
      await gate.decide(
        { tool: "mcp__exegol__mark_path", toolUseId: "a", input: { id: "x", pathFrom: [] } },
        new AbortController().signal,
      )
    ).decision,
  ).toBe("allow");
  const denied = createApprovalGate({
    policy: {
      ...DEFAULT_POLICY,
      rules: [...DEFAULT_POLICY.rules, { tool: "mcp__exegol__mark_path", decision: "deny" }],
    },
    recorder,
  });
  expect(
    (
      await denied.decide(
        { tool: "mcp__exegol__mark_path", toolUseId: "b", input: { id: "x", pathFrom: [] } },
        new AbortController().signal,
      )
    ).decision,
  ).toBe("deny");
});

it("l'outil autonome ne prend ni projet ni patch de statut depuis le modèle", async () => {
  const { exegolToolSpecs, createExegolTargets } = await import("../src/index.js");
  const root = await mkdtemp(join(tmpdir(), "warband-path-tool-"));
  dirs.push(root);
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    const targets = createExegolTargets();
    targets.note("mission", [], project);
    const dir = join(root, "warband");
    const a = await appendFinding(dir, project, {
      kind: "host",
      label: "Hôte",
      state: "confirmed",
    });
    const b = await appendFinding(dir, project, {
      kind: "step",
      label: "Essai",
      state: "failed",
      from: [a.id],
    });
    const tool = exegolToolSpecs({} as import("../src/index.js").DockerClient, targets).find(
      (entry) => entry.name === "mark_path",
    )!;
    await tool.run(
      {
        id: b.id,
        pathFrom: [a.id],
        projectId: "22222222-2222-4222-8222-222222222222",
        state: "confirmed",
      },
      { parentId: null, signal: undefined, correlation: undefined },
    );
    expect((await readFindings(dir, project)).find((node) => node.id === b.id)).toMatchObject({
      pathFrom: [a.id],
      state: "failed",
    });
    targets.note("sans projet", [], null);
    await expect(
      tool.run(
        { id: b.id, pathFrom: [] },
        { parentId: null, signal: undefined, correlation: undefined },
      ),
    ).rejects.toMatchObject({ code: "project.absent" });
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
});
