import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDockerClient,
  createRecorder,
  DOCKER_LABEL_PREFIX_INSPECT_FORMAT,
  type EngineEvent,
  type LabelPrefixContainer,
} from "../src/index.js";
import { FAKE_EXEGOL_DESK_URL, FAKE_EXEGOL_LABEL_LEAK, fakeDocker } from "./helpers.js";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const docker = createDockerClient({ recorder, binary: fake.bin, argsPrefix: fake.argsPrefix });
  return { fake, docker, events };
};

const leakFree = (payload: string) => {
  expect(payload).not.toContain(FAKE_EXEGOL_LABEL_LEAK);
  expect(payload).not.toContain(FAKE_EXEGOL_DESK_URL);
};

describe("DockerClient.listLabelPrefix", () => {
  it("enchaîne ps --all --quiet puis inspect --format attendu", async () => {
    const { fake, docker } = await setup();
    await docker.listLabelPrefix();
    expect(await fake.calls()).toEqual([
      "ps|--all|--quiet|",
      `inspect|--format|${DOCKER_LABEL_PREFIX_INSPECT_FORMAT}|keep-ws|keep-nows|skip-nolabel|keep-stopped|`,
    ]);
  });

  it("projette les conteneurs filtrés sans fuite de label ni d'URL bureau", async () => {
    const { docker, events, fake } = await setup();
    const rows = await docker.listLabelPrefix();
    expect(rows).toEqual([
      { state: "running", name: "with-ws", image: "img:1", workspace: "/host/ws" },
      { state: "running", name: "no-ws", image: "img:2" },
      { state: "stopped", name: "paused", image: "img:3" },
    ] satisfies LabelPrefixContainer[]);
    leakFree(JSON.stringify(rows));
    leakFree(JSON.stringify(await fake.calls()));
    leakFree(JSON.stringify(events));
  });

  it("zéro conteneur : pas d'appel inspect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "john-fake-docker-empty-"));
    const script = join(dir, "docker.mjs");
    const log = join(dir, "calls.log");
    await writeFile(
      script,
      `import { appendFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "|\\n");
if (argv[0] === "ps" && argv.includes("--quiet")) process.exit(0);
`,
    );
    const recorder = createRecorder();
    const docker = createDockerClient({
      recorder,
      binary: process.execPath,
      argsPrefix: [script],
    });
    expect(await docker.listLabelPrefix()).toEqual([]);
    expect((await readFile(log, "utf8")).trim()).toBe("ps|--all|--quiet|");
  });

  it("ligne ps invalide → docker.unexpectedOutput sans le texte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "john-fake-docker-badps-"));
    const script = join(dir, "docker.mjs");
    await writeFile(
      script,
      `const [, , ...argv] = process.argv;
if (argv[0] === "ps") process.stdout.write("bad id\\n");
`,
    );
    const docker = createDockerClient({
      recorder: createRecorder(),
      binary: process.execPath,
      argsPrefix: [script],
    });
    try {
      await docker.listLabelPrefix();
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        code: "docker.unexpectedOutput",
        params: { command: "ps", line: 1 },
      });
      expect(JSON.stringify((err as { params: unknown }).params)).not.toContain("bad id");
    }
  });

  it("ligne inspect hors allowlist → docker.unexpectedOutput sans le corps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "john-fake-docker-bad-insp-"));
    const script = join(dir, "docker.mjs");
    const leak = FAKE_EXEGOL_LABEL_LEAK;
    const desk = FAKE_EXEGOL_DESK_URL;
    await writeFile(
      script,
      `const [, , ...argv] = process.argv;
const out = (s) => process.stdout.write(s + "\\n");
if (argv[0] === "ps") out("cid1");
else if (argv[0] === "inspect") {
  out(JSON.stringify({
    state: "running",
    name: "n",
    image: "i",
    extra: ${JSON.stringify(leak)},
    desk: ${JSON.stringify(desk)},
  }));
}
`,
    );
    const docker = createDockerClient({
      recorder: createRecorder(),
      binary: process.execPath,
      argsPrefix: [script],
    });
    try {
      await docker.listLabelPrefix();
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        code: "docker.unexpectedOutput",
        params: { command: "inspect", line: 1 },
      });
      expect(JSON.stringify((err as { params: unknown }).params)).not.toContain(leak);
      expect(JSON.stringify((err as { params: unknown }).params)).not.toContain(desk);
    }
  });

  it("argv inspect incorrect : le faux binaire fuit les valeurs sensibles", async () => {
    const { fake } = await setup();
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [...fake.argsPrefix, "inspect", "--format", "{{json .}}", "keep-ws"],
      { encoding: "utf8" },
    );
    expect(r.stdout).toContain(FAKE_EXEGOL_LABEL_LEAK);
    expect(r.stdout).toContain(FAKE_EXEGOL_DESK_URL);
  });
});
