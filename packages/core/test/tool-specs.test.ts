import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createDockerClient,
  createRecorder,
  DOCKER_TOOL_PREFIX,
  dockerToolSpecs,
  type EngineEvent,
} from "../src/index.js";
import { fakeDocker } from "./helpers.js";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const docker = createDockerClient({ recorder, binary: fake.bin });
  return { fake, docker, events };
};

const ctx = { parentId: "p1", correlation: "exact" as const, signal: undefined };

describe("dockerToolSpecs", () => {
  it("décrit un outil par commande, avec indices de lecture seule / destructif", async () => {
    const { docker } = await setup();
    const specs = dockerToolSpecs(docker);
    expect(specs.map((s) => s.name)).toEqual([
      "ps",
      "images",
      "logs",
      "inspect",
      "run",
      "start",
      "stop",
      "rm",
    ]);
    expect(specs.filter((s) => s.readOnly).map((s) => s.name)).toEqual([
      "ps",
      "images",
      "logs",
      "inspect",
    ]);
    expect(specs.filter((s) => s.destructive).map((s) => s.name)).toEqual(["rm"]);
    expect(DOCKER_TOOL_PREFIX).toBe("mcp__docker__");
    for (const s of specs) expect(z.object(s.input)).toBeDefined();
  });

  it("exécute la commande, rattachée au parent et à la corrélation du contexte", async () => {
    const { docker, events, fake } = await setup();
    const ps = dockerToolSpecs(docker).find((s) => s.name === "ps");
    const out = await ps?.run({ all: true }, ctx);
    expect(JSON.parse(out ?? "[]")).toMatchObject([{ name: "web" }]);
    expect(events.find((e) => e.kind === "process.started")).toMatchObject({
      parentId: "p1",
      correlation: "exact",
    });
    expect(await fake.calls()).toEqual(["ps|--all|--format|{{json .}}|"]);
  });

  it("valide les arguments avant toute exécution", async () => {
    const { docker, fake } = await setup();
    const stop = dockerToolSpecs(docker).find((s) => s.name === "stop");
    await expect(stop?.run({}, ctx)).rejects.toThrow();
    await expect(stop?.run({ container: "--all" }, ctx)).rejects.toMatchObject({
      code: "docker.invalidOperand",
    });
    expect(await fake.calls()).toEqual([]);
  });

  it("tronque les longues sorties aux dernières lignes", async () => {
    const { docker } = await setup();
    const spy = { ...docker, logs: async () => Array.from({ length: 500 }, (_, i) => `l${i}`) };
    const logs = dockerToolSpecs(spy).find((s) => s.name === "logs");
    const lines = (await logs?.run({ container: "web" }, ctx))?.split("\n") ?? [];
    expect(lines[0]).toMatch(/300 lignes tronquées/);
    expect(lines).toHaveLength(201);
    expect(lines.at(-1)).toBe("l499");
  });
});
