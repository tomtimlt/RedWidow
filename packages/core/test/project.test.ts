import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CodedError,
  createDockerClient,
  createRecorder,
  link,
  readProject,
  status,
  USER_PROJECT_FILE,
} from "../src/index.js";
import { fakeDocker } from "./helpers.js";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const docker = createDockerClient({ recorder, binary: fake.bin, argsPrefix: fake.argsPrefix });
  const configDir = await mkdtemp(join(tmpdir(), "john-project-"));
  return { fake, docker, configDir };
};

describe("link", () => {
  it("écrit project.json pour un conteneur en cours avec workspace", async () => {
    const { docker, configDir } = await setup();
    await link(configDir, "with-ws", docker);
    const text = await readFile(join(configDir, USER_PROJECT_FILE), "utf8");
    expect(JSON.parse(text)).toEqual({ container: "with-ws", workspace: "/host/ws" });
  });

  it("refuse un conteneur arrêté", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "paused", docker)).rejects.toMatchObject({
      code: "project.notRunning",
      params: { name: "paused" },
    });
  });

  it("refuse un conteneur sans workspace", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "no-ws", docker)).rejects.toMatchObject({
      code: "project.noWorkspace",
      params: { name: "no-ws" },
    });
  });

  it("refuse un nom inconnu", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "missing", docker)).rejects.toMatchObject({
      code: "project.notFound",
      params: { name: "missing" },
    });
  });

  it("remplace un lien existant", async () => {
    const { docker, configDir } = await setup();
    await link(configDir, "with-ws", docker);
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      JSON.stringify({ container: "old", workspace: "/old" }),
      "utf8",
    );
    await link(configDir, "with-ws", docker);
    expect(await readProject(configDir)).toEqual({ container: "with-ws", workspace: "/host/ws" });
  });
});

describe("readProject", () => {
  it("renvoie null si le fichier est absent", async () => {
    const { configDir } = await setup();
    expect(await readProject(configDir)).toBeNull();
  });

  it.each([
    ["{pas json", "json invalide"],
    ['{"container":"","workspace":"/x"}', "container vide"],
    ['{"container":"a","workspace":""}', "workspace vide"],
    ['{"container":"a"}', "clé manquante"],
    ['{"container":"a","workspace":"/w","extra":1}', "clé en trop"],
  ])("project.invalid pour %s", async (body) => {
    const { configDir } = await setup();
    await writeFile(join(configDir, USER_PROJECT_FILE), body, "utf8");
    await expect(readProject(configDir)).rejects.toMatchObject({
      code: "project.invalid",
      params: { reason: "json" },
    });
  });
});

describe("status", () => {
  it("refuse si aucun projet", async () => {
    const { docker, configDir } = await setup();
    await expect(status(configDir, docker)).rejects.toMatchObject({ code: "project.absent" });
  });

  it("reflète un conteneur en cours", async () => {
    const { docker, configDir } = await setup();
    await link(configDir, "with-ws", docker);
    expect(await status(configDir, docker)).toEqual({
      container: "with-ws",
      workspace: "/host/ws",
      image: "img:1",
      state: "running",
    });
  });

  it("signale absent si le conteneur n'est plus listé", async () => {
    const { docker, configDir } = await setup();
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      `${JSON.stringify({ container: "gone", workspace: "/host/ws" }, null, 2)}\n`,
      "utf8",
    );
    expect(await status(configDir, docker)).toEqual({
      container: "gone",
      workspace: "/host/ws",
      image: null,
      state: "absent",
    });
  });

  it("reflète un conteneur arrêté encore listé", async () => {
    const { docker, configDir } = await setup();
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      `${JSON.stringify({ container: "paused", workspace: "/host/ws" }, null, 2)}\n`,
      "utf8",
    );
    expect(await status(configDir, docker)).toEqual({
      container: "paused",
      workspace: "/host/ws",
      image: "img:3",
      state: "stopped",
    });
  });
});

describe("link erreurs typées", () => {
  it("lève CodedError", async () => {
    const { docker, configDir } = await setup();
    try {
      await link(configDir, "missing", docker);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CodedError);
    }
  });
});
