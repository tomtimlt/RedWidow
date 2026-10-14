import { createDockerClient, createRecorder, type EngineEvent } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { createDockerTools } from "../src/index.js";
import { fakeDocker } from "./helpers.js";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const docker = createDockerClient({ recorder, binary: fake.bin, argsPrefix: fake.argsPrefix });
  return { fake, docker, events };
};

describe("createDockerTools", () => {
  it("expose un outil par commande, avec annotations", async () => {
    const { docker } = await setup();
    const tools = createDockerTools(docker, () => null);
    expect(tools.map((t) => t.name)).toEqual([
      "ps",
      "images",
      "logs",
      "inspect",
      "run",
      "start",
      "stop",
      "rm",
    ]);
    expect(tools.find((t) => t.name === "rm")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(tools.find((t) => t.name === "ps")?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("résout le parent par appel et renvoie isError plutôt que de lever", async () => {
    const { docker, events } = await setup();
    const seen: [string, unknown][] = [];
    const tools = createDockerTools(docker, (name, args) => {
      seen.push([name, args]);
      return "parent-1";
    });
    const handler = (name: string) =>
      (tools.find((t) => t.name === name) as NonNullable<(typeof tools)[number]>).handler;

    const ok = await handler("ps")({ all: true }, {});
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse((ok.content[0] as { text: string }).text)).toMatchObject([{ name: "web" }]);
    expect(events.find((e) => e.kind === "process.started")?.parentId).toBe("parent-1");

    const bad = await handler("stop")({ container: "--all" }, {});
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toBe("conteneur invalide : « --all »");
    expect(seen.map(([n]) => n)).toEqual(["ps", "stop"]);
  });

  it("tronque les longues sorties aux dernières lignes", async () => {
    const { docker } = await setup();
    const spy = {
      ...docker,
      logs: async () => Array.from({ length: 500 }, (_, i) => `l${i}`),
    };
    const tools = createDockerTools(spy, () => null);
    const res = await (tools.find((t) => t.name === "logs") as (typeof tools)[number]).handler(
      { container: "web" },
      {},
    );
    const text = (res.content[0] as { text: string }).text.split("\n");
    expect(text[0]).toMatch(/300 lignes tronquées/);
    expect(text).toHaveLength(201);
    expect(text.at(-1)).toBe("l499");
  });
});
