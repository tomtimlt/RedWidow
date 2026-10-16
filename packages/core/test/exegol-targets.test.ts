import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDockerClient,
  createExegolTargets,
  createRecorder,
  parseMentions,
  parseSlashStart,
  resolveExegolContainer,
} from "../src/index.js";

describe("cibles Exegol", () => {
  it("extrait les @ sans doublon", () => {
    expect(parseMentions("fais un nmap dans @htb1 et un scan dans @htb2 puis @htb1")).toEqual([
      "htb1",
      "htb2",
    ]);
    expect(parseMentions("rien ici")).toEqual([]);
  });

  it("accepte /start nom et refuse les options", () => {
    expect(parseSlashStart("/start htb1")).toBe("htb1");
    expect(parseSlashStart("  /start htb-001  ")).toBe("htb-001");
    expect(parseSlashStart("/start htb1 --desktop")).toBeNull();
    expect(parseSlashStart("ping @htb1")).toBeNull();
  });

  it("borne le conteneur au dédié ou aux @", () => {
    expect(resolveExegolContainer({ dedicated: "lab", mentions: [] }, "lab")).toBe("lab");
    expect(() => resolveExegolContainer({ dedicated: "lab", mentions: [] }, "autre")).toThrow(
      expect.objectContaining({ code: "exegol.containerDenied" }),
    );
    expect(resolveExegolContainer({ dedicated: "lab", mentions: ["htb1", "htb2"] }, "htb2")).toBe(
      "htb2",
    );
    expect(() => resolveExegolContainer({ dedicated: "lab", mentions: ["htb1"] }, "lab")).toThrow(
      expect.objectContaining({ code: "exegol.containerDenied" }),
    );
  });

  it("note la cible du message", () => {
    const targets = createExegolTargets();
    targets.note("nmap @htb1", "lab");
    expect(targets.current()).toEqual({ dedicated: "lab", mentions: ["htb1"] });
  });
});

describe("docker execWorkspace", () => {
  it("lance un argv figé dans /workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "john-exec-"));
    const script = join(dir, "docker.mjs");
    const log = join(dir, "calls.log");
    await writeFile(
      script,
      `import { appendFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "\\n");
process.stdout.write("pong\\n");
`,
    );
    const docker = createDockerClient({
      recorder: createRecorder(),
      binary: process.execPath,
      argsPrefix: [script],
    });
    expect(await docker.execWorkspace("htb1", ["ping", "-c", "1", "127.0.0.1"])).toEqual(["pong"]);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(log, "utf8")).toBe(
      "exec|--interactive|--workdir|/workspace|htb1|ping|-c|1|127.0.0.1\n",
    );
  });

  it("refuse un programme qui est une option", async () => {
    const docker = createDockerClient({ recorder: createRecorder(), binary: "docker" });
    await expect(docker.execWorkspace("htb1", ["--privileged"])).rejects.toMatchObject({
      code: "docker.invalidArgument",
    });
  });
});
