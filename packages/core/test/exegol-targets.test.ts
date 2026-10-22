import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDockerClient,
  createExegolTargets,
  createRecorder,
  lookupContainer,
  parseMentions,
  promptForTargets,
  resolveExegolContainer,
  resolveKaliContainer,
  shortContainerName,
  TERMINAL_CONTEXT_MARK,
} from "../src/index.js";

describe("cibles Exegol", () => {
  it("extrait les @ sans doublon", () => {
    expect(parseMentions("fais un nmap dans @htb1 et un scan dans @htb2 puis @htb1")).toEqual([
      "htb1",
      "htb2",
    ]);
    expect(parseMentions("rien ici")).toEqual([]);
  });

  const boxes = [{ name: "lab" }, { name: "htb1" }, { name: "htb2" }, { name: "exegol-htb1" }];
  const exegol = (name: string) => ({ name, family: "exegol" as const });

  it("borne le conteneur au dédié ou aux @ présents dans la liste", () => {
    const listed = [exegol("lab"), exegol("htb1"), exegol("htb2")];
    expect(resolveExegolContainer({ dedicated: "lab", mentions: [] }, "lab", listed)).toBe("lab");
    expect(() =>
      resolveExegolContainer({ dedicated: "lab", mentions: [] }, "autre", listed),
    ).toThrow(expect.objectContaining({ code: "exegol.containerDenied" }));
    expect(
      resolveExegolContainer({ dedicated: "lab", mentions: ["htb1", "htb2"] }, "htb2", listed),
    ).toBe("htb2");
    expect(() =>
      resolveExegolContainer({ dedicated: "lab", mentions: ["htb1"] }, "lab", listed),
    ).toThrow(expect.objectContaining({ code: "exegol.containerDenied" }));
  });

  it("résout le court vers le nom Docker de la liste, sans concaténer", () => {
    expect(shortContainerName("exegol-htb1")).toBe("htb1");
    expect(shortContainerName("htb1")).toBe("htb1");
    expect(shortContainerName("exegol-exegol-htb1")).toBe("exegol-htb1");
    const listed = [exegol("exegol-htb1")];
    expect(lookupContainer("htb1", listed)).toBe("exegol-htb1");
    expect(lookupContainer("htb1", [])).toBeNull();
    expect(lookupContainer("exegol-htb1", [{ name: "htb1" }])).toBeNull();
    expect(resolveExegolContainer({ dedicated: null, mentions: ["htb1"] }, "htb1", listed)).toBe(
      "exegol-htb1",
    );
    expect(resolveExegolContainer({ dedicated: "exegol-htb1", mentions: [] }, "htb1", listed)).toBe(
      "exegol-htb1",
    );
    expect(() =>
      resolveExegolContainer({ dedicated: null, mentions: ["htb1"] }, "exegol-exegol-htb1", listed),
    ).toThrow(expect.objectContaining({ code: "exegol.containerDenied" }));
    expect(lookupContainer("htb1", boxes)).toBeNull();
  });

  it("refuse un Kali et une entrée sans family", () => {
    const kali = [{ name: "lab", family: "kali" as const }];
    const bare = [{ name: "lab" }];
    const denied = { code: "exegol.containerDenied" };
    expect(() => resolveExegolContainer({ dedicated: "lab", mentions: [] }, "lab", kali)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() =>
      resolveExegolContainer({ dedicated: null, mentions: ["lab"] }, "lab", kali),
    ).toThrow(expect.objectContaining(denied));
    expect(() => resolveExegolContainer({ dedicated: "lab", mentions: [] }, "lab", bare)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() =>
      resolveExegolContainer({ dedicated: null, mentions: ["lab"] }, "lab", bare),
    ).toThrow(expect.objectContaining(denied));
  });

  it("refuse un Exegol, un nom hors liste, un @ non cité et un dédié qui n'est pas ce Kali", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const listed = [kali("k1"), kali("k2"), exegol("lab")];
    const denied = { code: "exegol.containerDenied" };
    expect(resolveKaliContainer({ dedicated: "k1", mentions: [] }, "k1", listed)).toBe("k1");
    expect(() => resolveKaliContainer({ dedicated: "lab", mentions: [] }, "lab", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer({ dedicated: "k1", mentions: [] }, "absent", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer({ dedicated: "k1", mentions: ["k2"] }, "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(resolveKaliContainer({ dedicated: "k1", mentions: ["k2"] }, "k2", listed)).toBe("k2");
    expect(() => resolveKaliContainer({ dedicated: "k1", mentions: [] }, "k2", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer({ dedicated: "lab", mentions: [] }, "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("note la cible du message", () => {
    const targets = createExegolTargets();
    targets.note("nmap @htb1", "lab");
    expect(targets.current()).toEqual({ dedicated: "lab", mentions: ["htb1"] });
  });

  it("ignore les @ collés après la sortie d'un terminal", () => {
    const targets = createExegolTargets();
    const text = `scan @htb1${TERMINAL_CONTEXT_MARK}nmap @evil`;
    expect(promptForTargets(text)).toBe("scan @htb1");
    expect(promptForTargets("sans marqueur @htb1")).toBe("sans marqueur @htb1");
    targets.note(text, "lab");
    expect(targets.current()).toEqual({ dedicated: "lab", mentions: ["htb1"] });
  });
});

describe("docker execWorkspace", () => {
  it("lance un argv figé dans /workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-exec-"));
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
