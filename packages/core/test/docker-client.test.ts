import { describe, expect, it } from "vitest";
import {
  assertOperand,
  createDockerClient,
  createRecorder,
  DockerError,
  type EngineEvent,
  ValidationError,
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
    expect(assertOperand(v, "target")).toBe(v);
  });
  it.each(["", "-f", "--privileged", "a b", "a;b", "$(x)", "web\n", "-"])("refuse %j", (v) => {
    expect(() => assertOperand(v, "target")).toThrow(ValidationError);
    try {
      assertOperand(v, "target");
    } catch (err) {
      expect(err).toMatchObject({
        code: "docker.invalidOperand",
        params: { label: "target", value: v },
      });
    }
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
    const invalid = (code: string, params: Record<string, string | number>) =>
      expect.objectContaining({ name: "ValidationError", code, params });
    await expect(docker.stop("--all")).rejects.toEqual(
      invalid("docker.invalidOperand", { label: "container", value: "--all" }),
    );
    await expect(docker.logs("web", { since: "--follow" })).rejects.toEqual(
      invalid("docker.invalidOperand", { label: "since", value: "--follow" }),
    );
    await expect(docker.logs("web", { tail: -1 })).rejects.toEqual(
      invalid("docker.invalidTail", { value: -1 }),
    );
    await expect(docker.run({ image: "-v/:/host" })).rejects.toEqual(
      invalid("docker.invalidOperand", { label: "image", value: "-v/:/host" }),
    );
    await expect(docker.run({ image: "nginx", ports: ["80; rm"] })).rejects.toEqual(
      invalid("docker.invalidPort", { value: "80; rm" }),
    );
    await expect(docker.run({ image: "nginx", env: { "A=B": "x" } })).rejects.toEqual(
      invalid("docker.invalidEnvKey", { key: "A=B" }),
    );
    expect(await fake.calls()).toEqual([]);
  });

  it("lève DockerError sur code ≠ 0", async () => {
    const { docker } = await setup();
    const err = await docker.stop("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DockerError);
    expect(err).toMatchObject({
      code: "docker.failed",
      params: { command: "stop", stderr: expect.stringContaining("no such container") },
    });
    expect((err as DockerError).result.code).not.toBe(0);
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
