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
    expect(parseMentions("scan sur #frosty_margulis-2")).toEqual([]);
  });

  const boxes = [{ name: "lab" }, { name: "htb1" }, { name: "htb2" }, { name: "exegol-htb1" }];
  const exegol = (name: string) => ({ name, family: "exegol" as const });
  const target = (allowed: string[], mentions: string[] = []) => ({
    allowed,
    mentions,
    projectId: null as string | null,
  });

  it("borne le conteneur à l'allowlist et aux @ de la liste Exegol", () => {
    const listed = [exegol("lab"), exegol("htb1"), exegol("htb2")];
    const denied = { code: "exegol.containerDenied" };
    expect(resolveExegolContainer(target(["lab"]), "lab", listed)).toBe("lab");
    expect(() => resolveExegolContainer(target(["lab"]), "autre", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(resolveExegolContainer(target(["lab", "htb2"], ["htb1", "htb2"]), "htb2", listed)).toBe(
      "htb2",
    );
    expect(() => resolveExegolContainer(target(["lab", "htb1"], ["htb1"]), "lab", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(target(["lab"], ["htb1"]), "htb1", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(target(["lab", "htb1"]), "lab", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(target(["lab", "htb1"]), "htb1", listed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("résout le court vers le nom Docker de la liste, sans concaténer", () => {
    expect(shortContainerName("exegol-htb1")).toBe("htb1");
    expect(shortContainerName("htb1")).toBe("htb1");
    expect(shortContainerName("exegol-exegol-htb1")).toBe("exegol-htb1");
    const listed = [exegol("exegol-htb1")];
    expect(lookupContainer("htb1", listed)).toBe("exegol-htb1");
    expect(lookupContainer("htb1", [])).toBeNull();
    expect(lookupContainer("exegol-htb1", [{ name: "htb1" }])).toBeNull();
    expect(resolveExegolContainer(target(["exegol-htb1"], ["htb1"]), "htb1", listed)).toBe(
      "exegol-htb1",
    );
    expect(resolveExegolContainer(target(["exegol-htb1"]), "htb1", listed)).toBe("exegol-htb1");
    expect(() =>
      resolveExegolContainer(target(["exegol-htb1"], ["htb1"]), "exegol-exegol-htb1", listed),
    ).toThrow(expect.objectContaining({ code: "exegol.containerDenied" }));
    expect(lookupContainer("htb1", boxes)).toBeNull();
  });

  it("refuse un Kali même quand le nom demandé est le bon", () => {
    const kali = [{ name: "frosty_margulis", family: "kali" as const }];
    const denied = { code: "exegol.containerDenied", params: { name: "frosty_margulis" } };
    expect(() =>
      resolveExegolContainer(target(["frosty_margulis"]), "frosty_margulis", kali),
    ).toThrow(expect.objectContaining(denied));
    expect(() =>
      resolveExegolContainer(
        { ...target(["frosty_margulis"], ["frosty_margulis"]), hashes: ["frosty_margulis"] },
        "frosty_margulis",
        kali,
      ),
    ).toThrow(expect.objectContaining(denied));
    expect(() =>
      resolveExegolContainer(
        target(["frosty_margulis"], ["frosty_margulis"]),
        "@frosty_margulis",
        kali,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "exegol.containerDenied",
        params: { name: "@frosty_margulis" },
      }),
    );
  });

  it("refuse une entrée sans family, allowlistée ou citée", () => {
    const bare = [{ name: "lab" }];
    const denied = { code: "exegol.containerDenied" };
    expect(() => resolveExegolContainer(target(["lab"]), "lab", bare)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(target(["lab"], ["lab"]), "lab", bare)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("refuse un court nom ambigu sur la liste Exegol même si un seul est allowlisté", () => {
    const listed = [exegol("exegol-htb1"), exegol("htb1")];
    const denied = { code: "exegol.containerDenied" };
    expect(() => resolveExegolContainer(target(["exegol-htb1"]), "htb1", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(target(["exegol-htb1"], ["htb1"]), "htb1", listed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("refuse un Exegol, un nom hors liste, un @ non cité et un allowlisté qui n'est pas ce Kali", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const listed = [kali("k1"), kali("k2"), exegol("lab")];
    const denied = { code: "exegol.containerDenied" };
    expect(resolveKaliContainer(target(["k1"]), "k1", listed)).toBe("k1");
    expect(() => resolveKaliContainer(target(["lab"]), "lab", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer(target(["k1"]), "absent", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer(target(["k1", "k2"], ["k2"]), "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(resolveKaliContainer(target(["k1", "k2"], ["k2"]), "k2", listed)).toBe("k2");
    expect(() => resolveKaliContainer(target(["k1"]), "k2", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveKaliContainer(target(["lab"]), "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("note la cible du message et copie l'allowlist", () => {
    const targets = createExegolTargets();
    const allowed = ["lab"];
    targets.note("nmap @htb1", allowed, "pid");
    allowed.push("autre");
    expect(targets.current()).toEqual({
      allowed: ["lab"],
      mentions: ["htb1"],
      projectId: "pid",
      hashes: [],
    });
  });

  it("un # de shell ou de nom autorise le Kali, pas l'Exegol", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const box = kali("frosty_margulis");
    const named = kali("frosty_margulis-2");
    const allowed = ["frosty_margulis", "frosty_margulis-2"];
    const targets = createExegolTargets();
    const user = "fait un scan nmap rapide sur la cible #frosty_margulis-2";
    const prompt = `${user}${TERMINAL_CONTEXT_MARK}frosty_margulis-2\nPING 10.10.11.2`;
    targets.note(prompt, allowed, null);
    expect(targets.current()).toEqual({
      allowed,
      mentions: [],
      projectId: null,
      hashes: ["frosty_margulis-2"],
    });
    expect(prompt).toContain("PING 10.10.11.2");
    const denied = { code: "exegol.containerDenied" };
    expect(resolveKaliContainer(targets.current(), "frosty_margulis-2", [box])).toBe(
      "frosty_margulis",
    );
    expect(resolveKaliContainer(targets.current(), "frosty_margulis", [box])).toBe(
      "frosty_margulis",
    );
    expect(resolveKaliContainer(targets.current(), "frosty_margulis-2", [named])).toBe(
      "frosty_margulis-2",
    );
    expect(() => resolveKaliContainer(targets.current(), "#frosty_margulis", [box])).toThrow(
      expect.objectContaining(denied),
    );
    // Deux Exegol allowlistés : le # n'en désigne aucun, sans @ l'Exegol reste refusé.
    const asExegol = [exegol("frosty_margulis"), exegol("frosty_margulis-2")];
    expect(() => resolveExegolContainer(targets.current(), "frosty_margulis", asExegol)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(targets.current(), "frosty_margulis", [box])).toThrow(
      expect.objectContaining(denied),
    );
    expect(
      resolveKaliContainer(target(["frosty_margulis"], ["frosty_margulis"]), "frosty_margulis", [
        box,
      ]),
    ).toBe("frosty_margulis");
    expect(() =>
      resolveKaliContainer({ ...target(["frosty_margulis"]), hashes: ["autre"] }, "autre", [
        box,
        kali("autre-kali"),
      ]),
    ).toThrow(expect.objectContaining(denied));
    const both = [box, named];
    expect(() =>
      resolveKaliContainer(
        { ...target(allowed), hashes: ["frosty_margulis-2"] },
        "frosty_margulis",
        both,
      ),
    ).toThrow(expect.objectContaining(denied));
  });

  it("un # ne remplace pas un @ du même message", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const listed = [kali("k1"), kali("k2")];
    const denied = { code: "exegol.containerDenied" };
    const both = createExegolTargets();
    both.note("scan @k1 et aussi #k2", ["k1", "k2"], null);
    expect(resolveKaliContainer(both.current(), "k1", listed)).toBe("k1");
    expect(() => resolveKaliContainer(both.current(), "k2", listed)).toThrow(
      expect.objectContaining(denied),
    );
    expect(() => resolveExegolContainer(both.current(), "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("un suivi sans @ ni # réutilise le dernier Kali désigné", () => {
    const box = { name: "frosty_margulis", family: "kali" as const };
    const allowed = ["frosty_margulis", "autre"];
    const targets = createExegolTargets();
    targets.note("essaie #frosty_margulis", allowed, null);
    targets.note("vasy", allowed, null);
    expect(targets.current()).toEqual({
      allowed,
      mentions: [],
      projectId: null,
      hashes: [],
      recall: [{ sigil: "#", token: "frosty_margulis" }],
    });
    expect(resolveKaliContainer(targets.current(), "frosty_margulis", [box])).toBe(
      "frosty_margulis",
    );
    const denied = { code: "exegol.containerDenied" };
    expect(() => resolveExegolContainer(targets.current(), "frosty_margulis", [box])).toThrow(
      expect.objectContaining(denied),
    );
    // Deux Exegol allowlistés : le rappel n'en désigne aucun.
    const asExegol = [exegol("frosty_margulis"), exegol("autre")];
    expect(() => resolveExegolContainer(targets.current(), "frosty_margulis", asExegol)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("un nouveau @ ou # remplace le Kali retenu et tient lieu du dédié", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const listed = [kali("frosty_margulis"), kali("autre")];
    const allowed = ["frosty_margulis", "autre"];
    const denied = { code: "exegol.containerDenied" };
    const targets = createExegolTargets();
    targets.note("vois @frosty_margulis", allowed, null);
    targets.note("vasy", allowed, null);
    expect(resolveKaliContainer(targets.current(), "frosty_margulis", listed)).toBe(
      "frosty_margulis",
    );
    targets.note("plutôt #autre", allowed, null);
    targets.note("vasy", allowed, null);
    expect(resolveKaliContainer(targets.current(), "autre", listed)).toBe("autre");
    expect(() => resolveKaliContainer(targets.current(), "frosty_margulis", listed)).toThrow(
      expect.objectContaining(denied),
    );
    const order = createExegolTargets();
    order.note("d'abord #frosty_margulis puis #autre", allowed, null);
    order.note("vasy", allowed, null);
    expect(resolveKaliContainer(order.current(), "autre", listed)).toBe("autre");
    expect(() => resolveKaliContainer(order.current(), "frosty_margulis", listed)).toThrow(
      expect.objectContaining(denied),
    );
    // Deux Exegol allowlistés : un @ du fil n'en désigne aucun.
    const exegolTargets = createExegolTargets();
    exegolTargets.note("scan @lab", ["lab", "autre-exegol"], null);
    exegolTargets.note("vasy", ["lab", "autre-exegol"], null);
    const labs = [exegol("lab"), exegol("autre-exegol")];
    expect(() => resolveExegolContainer(exegolTargets.current(), "lab", labs)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("sans désignation, le suivi reste le Kali allowlisté ; la sortie collée ne change pas le rappel", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const plain = createExegolTargets();
    plain.note("bonjour", ["k1"], null);
    plain.note("vasy", ["k1"], null);
    expect(plain.current().recall).toBeUndefined();
    expect(resolveKaliContainer(plain.current(), "k1", [kali("k1"), kali("k2")])).toBe("k1");
    expect(() => resolveKaliContainer(plain.current(), "k2", [kali("k1"), kali("k2")])).toThrow(
      expect.objectContaining({ code: "exegol.containerDenied" }),
    );
    const targets = createExegolTargets();
    targets.note("essaie #frosty_margulis-2", ["frosty_margulis"], null);
    targets.note(`vasy${TERMINAL_CONTEXT_MARK}#evil`, ["frosty_margulis"], null);
    expect(targets.current().recall).toEqual([{ sigil: "#", token: "frosty_margulis-2" }]);
    expect(
      resolveKaliContainer(targets.current(), "frosty_margulis", [kali("frosty_margulis")]),
    ).toBe("frosty_margulis");
  });

  it("un jeton qui ne désigne pas un Kali ne remplace pas le précédent", () => {
    const kali = (name: string) => ({ name, family: "kali" as const });
    const listed = [kali("frosty_margulis"), kali("k1")];
    const allowed = ["k1", "frosty_margulis"];
    const denied = { code: "exegol.containerDenied" };
    const targets = createExegolTargets();
    targets.note("essaie #frosty_margulis", allowed, null);
    targets.note("vois #pas-un-conteneur", allowed, null);
    targets.note("vasy", allowed, null);
    expect(resolveKaliContainer(targets.current(), "frosty_margulis", listed)).toBe(
      "frosty_margulis",
    );
    expect(() => resolveKaliContainer(targets.current(), "k1", listed)).toThrow(
      expect.objectContaining(denied),
    );
    const only = createExegolTargets();
    only.note("scan @lab", ["k1"], null);
    only.note("vasy", ["k1"], null);
    const mixed = [kali("k1"), exegol("lab")];
    expect(resolveKaliContainer(only.current(), "k1", mixed)).toBe("k1");
    expect(() => resolveExegolContainer(only.current(), "lab", mixed)).toThrow(
      expect.objectContaining(denied),
    );
  });

  it("ignore les @ collés après la sortie d'un terminal", () => {
    const targets = createExegolTargets();
    const text = `scan @htb1${TERMINAL_CONTEXT_MARK}nmap @evil`;
    expect(promptForTargets(text)).toBe("scan @htb1");
    expect(promptForTargets("sans marqueur @htb1")).toBe("sans marqueur @htb1");
    targets.note(text, ["lab"], null);
    expect(targets.current()).toEqual({
      allowed: ["lab"],
      mentions: ["htb1"],
      projectId: null,
      hashes: [],
    });
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
