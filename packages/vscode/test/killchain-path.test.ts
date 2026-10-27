import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFinding, createProject, readFindings, setActiveProject } from "@warband/core";
import { afterEach, expect, it } from "vitest";
import { setSelectedPathEdge } from "../src/logic/killchain-path.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("valide le projet, les identifiants et le booléen sans accepter un chemin ou un état", () => {
  const message = {
    type: "setPathEdge",
    projectId: "11111111-1111-4111-8111-111111111111",
    from: "a",
    to: "b",
    retained: true,
  };
  expect(parseStudioMessage(message)).toEqual(message);
  for (const raw of [
    { ...message, path: "/tmp/x" },
    { ...message, state: "confirmed" },
    { ...message, projectId: ".." },
    { ...message, from: "a\n" },
    { ...message, to: "a" },
    { ...message, retained: "true" },
  ])
    expect(parseStudioMessage(raw)).toBeNull();
});
it("partage le marquage avec l'agent, refuse un panneau périmé et un autre projet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-ui-path-"));
  dirs.push(dir);
  const first = await createProject(dir, { name: "A", workspace: dir });
  const a = await appendFinding(dir, first.id, { kind: "host", label: "A", state: "confirmed" });
  const b = await appendFinding(dir, first.id, {
    kind: "step",
    label: "B",
    state: "confirmed",
    from: [a.id],
  });
  await setSelectedPathEdge(dir, first.id, a.id, b.id, true, () => true);
  expect((await readFindings(dir, first.id)).find((node) => node.id === b.id)?.pathFrom).toEqual([
    a.id,
  ]);
  await expect(
    setSelectedPathEdge(dir, first.id, a.id, b.id, false, () => false),
  ).rejects.toMatchObject({ code: "project.absent" });
  const other = await createProject(dir, { name: "B", workspace: dir });
  await setActiveProject(dir, other.id);
  await expect(
    setSelectedPathEdge(dir, first.id, a.id, b.id, false, () => true),
  ).rejects.toMatchObject({ code: "project.absent" });
  expect((await readFindings(dir, first.id)).find((node) => node.id === b.id)?.pathFrom).toEqual([
    a.id,
  ]);
});

it("l’export ne reçoit aucun chemin, contenu ou champ hérité de la webview", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  expect(parseStudioMessage({ type: "exportReport", projectId })).toEqual({
    type: "exportReport",
    projectId,
  });
  expect(
    parseStudioMessage({ type: "exportReport", projectId, path: "/tmp/rapport.md" }),
  ).toBeNull();
  expect(
    parseStudioMessage(
      Object.assign(Object.create({ projectId }), { type: "exportReport", extra: true }),
    ),
  ).toBeNull();
});
