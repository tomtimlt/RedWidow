import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOperand,
  createDockerClient,
  createRecorder,
  type DockerClient,
  DockerError,
  type EngineEvent,
  parseDockerImages,
  parseDockerPs,
  ValidationError,
} from "../src/index.js";
import { fakeDocker } from "./helpers.js";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const docker = createDockerClient({ recorder, binary: fake.bin, argsPrefix: fake.argsPrefix });
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
    const docker = createDockerClient({
      recorder,
      binary: fake.bin,
      argsPrefix: fake.argsPrefix,
      parentId: "default",
    });
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

describe("DockerClient : surface publique", () => {
  it("n'expose pas exec", async () => {
    const { docker } = await setup();
    // @ts-expect-error exec est interne au client
    expect(docker.exec).toBeUndefined();
  });
});

describe("DockerClient : validation de run", () => {
  const rejects = async (options: Parameters<DockerClient["run"]>[0], expected: object) => {
    const { fake, docker } = await setup();
    await expect(docker.run(options)).rejects.toMatchObject(expected);
    expect(await fake.calls()).toEqual([]);
  };
  const arg = (field: string, reason: string) => ({
    name: "ValidationError",
    code: "docker.invalidArgument",
    params: { field, reason },
  });

  it("refuse une image '-v/:/h' ou vide", async () => {
    await rejects({ image: "-v/:/h" }, { code: "docker.invalidOperand" });
    await rejects({ image: "" }, { code: "docker.invalidOperand" });
  });
  it("refuse NUL dans command, trop d'éléments, trop volumineux", async () => {
    await rejects({ image: "nginx", command: ["a", "b\0c"] }, arg("command", "nul"));
    await rejects({ image: "nginx", command: Array(257).fill("x") }, arg("command", "tooMany"));
    await rejects(
      { image: "nginx", command: ["x".repeat(32 * 1024 + 1)] },
      arg("command", "tooLarge"),
    );
    await rejects(
      { image: "nginx", command: ["x".repeat(20000), "y".repeat(20000)] },
      arg("command", "tooLarge"),
    );
  });
  it("accepte 256 éléments et 32 Kio exactement", async () => {
    const { docker } = await setup();
    await docker.run({ image: "nginx", command: Array(256).fill("x") });
    const big = docker.run({ image: "nginx", command: ["x".repeat(32 * 1024)] });
    // Windows : CreateProcess limite la ligne entière à 32767 caractères → refus codé, sans spawn.
    if (process.platform === "win32")
      await expect(big).rejects.toMatchObject({ code: "process.commandTooLong" });
    else await big;
  });
  it("refuse NUL ou 32 Kio+ dans une valeur d'env, sans la recopier", async () => {
    await rejects({ image: "nginx", env: { K: "a\0b" } }, arg("env.K", "nul"));
    const big = `s3cret${"x".repeat(32 * 1024)}`;
    const { docker } = await setup();
    const err = await docker.run({ image: "nginx", env: { K: big } }).catch((e: unknown) => e);
    expect(err).toMatchObject(arg("env.K", "tooLarge"));
    expect(JSON.stringify((err as ValidationError).params)).not.toContain("s3cret");
    expect((err as ValidationError).message).not.toContain("s3cret");
  });
});

describe("createDockerClient : binary", () => {
  const make = (binary: string) => createDockerClient({ recorder: createRecorder(), binary });
  it.each(["./docker", "../docker", "sub/docker", "", "-docker", ".", ".."])("refuse %j", (b) => {
    expect(() => make(b)).toThrow(
      expect.objectContaining({ code: "docker.invalidBinary", params: { binary: b } }),
    );
  });
  it.each(["docker", "docker.exe", "/usr/bin/docker", "/opt/x/docker"])("accepte %s", (b) => {
    expect(() => make(b)).not.toThrow();
  });
});

describe("parsing de la sortie docker", () => {
  const ps = '{"ID":"1","Names":"web","Image":"nginx","State":"running","Status":"Up","Ports":""}';
  it("sortie vide ou lignes vides : []", () => {
    expect(parseDockerPs([])).toEqual([]);
    expect(parseDockerPs(["", "  "])).toEqual([]);
    expect(parseDockerImages([])).toEqual([]);
  });
  it("ligne valide inchangée", () => {
    expect(parseDockerPs(["", ps])).toEqual([
      { id: "1", name: "web", image: "nginx", state: "running", status: "Up", ports: "" },
    ]);
  });
  it.each([
    '[{"Names":["x"]}]',
    "WARNING: something",
    '{"ID":"1"}',
    '{"ID":"1","Names":["x"]}',
    "{pas du json",
    "42",
  ])("ps refuse %j sans recopier la ligne", (line) => {
    try {
      parseDockerPs([ps, line]);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        code: "docker.unexpectedOutput",
        params: { command: "ps", line: 2 },
      });
    }
  });
  it("images refuse une ligne inattendue", () => {
    expect(() => parseDockerImages(["oops"])).toThrow(
      expect.objectContaining({
        code: "docker.unexpectedOutput",
        params: { command: "images", line: 1 },
      }),
    );
    expect(() => parseDockerImages(['{"ID":"i"}'])).toThrow(
      expect.objectContaining({ code: "docker.unexpectedOutput" }),
    );
  });
  it("inspect : JSON invalide → docker.unexpectedOutput", async () => {
    const dir = await mkdtemp(join(tmpdir(), "john-bad-docker-"));
    const script = join(dir, "docker.mjs");
    await writeFile(script, 'console.log("not json");\n');
    const docker = createDockerClient({
      recorder: createRecorder(),
      binary: process.execPath,
      argsPrefix: [script],
    });
    await expect(docker.inspect("web")).rejects.toMatchObject({
      code: "docker.unexpectedOutput",
      params: { command: "inspect" },
    });
  });
});

describe("createDockerClient : argsPrefix (réservé au code)", () => {
  const make = (argsPrefix: readonly string[]) =>
    createDockerClient({ recorder: createRecorder(), binary: process.execPath, argsPrefix });
  const invalid = (reason: string) =>
    expect.objectContaining({
      code: "docker.invalidArgument",
      params: { field: "argsPrefix", reason },
    });

  it("applique les bornes : 8 éléments, 4 Kio chacun, sans \\0", () => {
    expect(() => make(Array(8).fill("x"))).not.toThrow();
    expect(() => make(["x".repeat(4096)])).not.toThrow();
    expect(() => make(Array(9).fill("x"))).toThrow(invalid("tooMany"));
    expect(() => make(["x".repeat(4097)])).toThrow(invalid("tooLarge"));
    expect(() => make(["a\0b"])).toThrow(invalid("nul"));
    expect(() => make([1 as unknown as string])).toThrow(invalid("notStrings"));
  });

  it("conserve la validation de binary", () => {
    expect(() =>
      createDockerClient({ recorder: createRecorder(), binary: "./docker", argsPrefix: ["x"] }),
    ).toThrow(expect.objectContaining({ code: "docker.invalidBinary" }));
  });
});
