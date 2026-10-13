import { describe, expect, it } from "vitest";
import {
  assertOperand,
  createDockerClient,
  createDockerTools,
  createRecorder,
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

describe("assertOperand", () => {
  it.each(["web", "nginx:1.27", "reg.io:5000/a/b@sha256:abc", "a_b-c.d"])("accepte %s", (v) => {
    expect(assertOperand(v, "x")).toBe(v);
  });
  it.each(["", "-f", "--privileged", "a b", "a;b", "$(x)", "web\n", "-"])("refuse %j", (v) => {
    expect(() => assertOperand(v, "x")).toThrow(/invalide/);
  });
});

describe("DockerClient", () => {
  it("construit l'argv attendu pour chaque commande", async () => {
    const { fake, docker } = await setup();
    await docker.ps({ all: true });
    await docker.images();
    expect(await docker.logs("web", { tail: 50, since: "10m" })).toEqual(["out-line", "err-line"]);
    expect(await docker.inspect("web")).toEqual([{ Id: "abc" }]);
    expect(
      await docker.run({
        image: "nginx:1.27",
        name: "web",
        ports: ["8080:80"],
        env: { MODE: "a b" },
        command: ["-g", "daemon off;"],
      }),
    ).toBe("cid123");
    await docker.start("web");
    await docker.stop("web");
    await docker.rm("web", { force: true });
    expect(await fake.calls()).toEqual([
      "ps|--all|--format|{{json .}}|",
      "images|--format|{{json .}}|",
      "logs|--tail|50|--since|10m|web|",
      "inspect|web|",
      "run|--detach|--name|web|--publish|8080:80|--env|MODE=a b|nginx:1.27|-g|daemon off;|",
      "start|web|",
      "stop|web|",
      "rm|--force|web|",
    ]);
  });

  it("refuse l'injection d'options avant tout lancement", async () => {
    const { fake, docker } = await setup();
    await expect(docker.stop("--all")).rejects.toThrow(/invalide/);
    await expect(docker.logs("web", { since: "--follow" })).rejects.toThrow(/invalide/);
    await expect(docker.logs("web", { tail: -1 })).rejects.toThrow(/tail/);
    await expect(docker.run({ image: "-v/:/host" })).rejects.toThrow(/invalide/);
    await expect(docker.run({ image: "nginx", ports: ["80; rm"] })).rejects.toThrow(/port/);
    await expect(docker.run({ image: "nginx", env: { "A=B": "x" } })).rejects.toThrow(/variable/);
    expect(await fake.calls()).toEqual([]);
  });

  it("lève DockerError sur code ≠ 0", async () => {
    const { docker } = await setup();
    await expect(docker.stop("nope")).rejects.toThrow(/no such container/);
  });

  it("parentId par appel prime sur celui de la factory", async () => {
    const fake = await fakeDocker();
    const recorder = createRecorder();
    const events: EngineEvent[] = [];
    recorder.subscribe((e) => events.push(e));
    const docker = createDockerClient({ recorder, binary: fake.bin, parentId: "default" });
    await docker.ps();
    await docker.ps({ parentId: "call" });
    await docker.ps({ parentId: null });
    expect(events.filter((e) => e.kind === "process.started").map((e) => e.parentId)).toEqual([
      "default",
      "call",
      null,
    ]);
  });
});

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
    expect((bad.content[0] as { text: string }).text).toMatch(/invalide/);
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
