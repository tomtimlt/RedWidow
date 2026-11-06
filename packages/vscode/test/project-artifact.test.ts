import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectFileSpecs } from "../src/engine/project-files.js";
import { terminalLaunch } from "../src/logic/cockpit.js";
import { prepareMissionFolder } from "../src/logic/mission-folder.js";

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "redwidow-artifact-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const ctx = { parentId: null, correlation: undefined, signal: undefined };
it("écrit un rapport lisible par les outils de projet et refuse tout écrasement", async () => {
  const root = await temp();
  const specs = projectFileSpecs(root);
  const tool = specs.find((s) => s.name === "write_project_artifact")!;
  expect(
    JSON.parse(
      await tool.run(
        { category: "reports", filename: "mission.md", content: "# Mission\nPreuve" },
        ctx,
      ),
    ),
  ).toMatchObject({ path: "reports/mission.md" });
  expect(await readFile(join(root, "reports", "mission.md"), "utf8")).toBe("# Mission\nPreuve");
  await expect(
    tool.run({ category: "reports", filename: "mission.md", content: "overwrite" }, ctx),
  ).rejects.toThrow();
  expect(JSON.parse(await specs[1]!.run({ path: "reports/mission.md" }, ctx)).text).toContain(
    "Preuve",
  );
});
it("refuse traversée, noms Windows dangereux, liens sortants, dépassement UTF-8 et annulation", async () => {
  const root = await temp(),
    outside = await temp();
  await prepareMissionFolder(root);
  const tool = projectFileSpecs(root).find((s) => s.name === "write_project_artifact")!;
  for (const filename of ["../escape.md", "/tmp/a", "C:\\file", "NUL.txt", "bad."])
    await expect(
      tool.run({ category: "payloads", filename, content: "test" }, ctx),
    ).rejects.toThrow();
  await expect(
    tool.run({ category: "payloads", filename: "large.txt", content: "é".repeat(200000) }, ctx),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    tool.run(
      { category: "payloads", filename: "stop.txt", content: "test" },
      { ...ctx, signal: controller.signal },
    ),
  ).rejects.toThrow();
  await rm(join(root, "payloads"), { recursive: true });
  await symlink(outside, join(root, "payloads"));
  await expect(
    tool.run({ category: "payloads", filename: "escape.txt", content: "test" }, ctx),
  ).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);
});
it("seul le backend choisit un répertoire de terminal nommé et sans option injectée", () => {
  expect(
    terminalLaunch(
      "kali-1",
      "/usr/bin/docker",
      ["/bin/bash"],
      "/redwidow/Workspace/Projet-12345678",
    ).shellArgs,
  ).toContain("/redwidow/Workspace/Projet-12345678");
  expect(() =>
    terminalLaunch("kali-1", "/usr/bin/docker", ["/bin/bash"], "/tmp/foreign"),
  ).toThrow();
});
