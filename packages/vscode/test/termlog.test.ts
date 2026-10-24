import {
  createExegolTargets,
  KALI_SERVER_INSTRUCTIONS,
  resolveExegolContainer,
  resolveKaliContainer,
  TERMINAL_CONTEXT_MARK,
} from "@warband/core";
import { formatReason } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { terminalLaunch } from "../src/logic/cockpit.js";
import {
  CONTAINER_LOG_DIR,
  capturedShell,
  classifyMessageHashes,
  containerLogPath,
  lastCommand,
  mentionToken,
  parseHashes,
  readableTerminal,
  removeLogCommand,
  shellToken,
  TERMINAL_TAIL_CHARS,
  tailCommand,
  withTerminalContext,
} from "../src/logic/termlog.js";

describe("journal de terminal", () => {
  it("journal dans le conteneur : chemin validé, jamais construit à partir d'une saisie libre", () => {
    expect(containerLogPath("htb1", "0a1b2c3d")).toBe(`${CONTAINER_LOG_DIR}/htb1-0a1b2c3d.log`);
    expect(containerLogPath("htb1-2", "deadbeef")).toBe(
      "/tmp/warband-terminals/htb1-2-deadbeef.log",
    );
    expect(containerLogPath("../x", "0a1b2c3d")).toBeNull();
    expect(containerLogPath("a/b", "0a1b2c3d")).toBeNull();
    expect(containerLogPath("htb1", "zz")).toBeNull();
    expect(containerLogPath("htb1", "0A1B2C3D")).toBeNull();
  });

  it("shell capturé : script constant, chemin en argument positionnel", () => {
    const log = "/tmp/warband-terminals/htb1-0a1b2c3d.log";
    const argv = capturedShell(log);
    expect(argv[0]).toBe("/bin/bash");
    expect(argv[1]).toBe("-c");
    expect(argv[2]).toContain('exec script -q -f -c /bin/bash "$1"');
    expect(argv[2]).toContain("exec /bin/bash");
    expect(argv[2]).not.toContain(log);
    expect(argv.slice(3)).toEqual(["warband", log]);
    expect(() => capturedShell("/etc/passwd")).toThrow();
    expect(() => capturedShell("/tmp/warband-terminals/x-0a1b2c3d.log; rm -rf /")).toThrow();
  });

  it("lecture et suppression : argv direct, chemin validé", () => {
    const log = "/tmp/warband-terminals/htb1-0a1b2c3d.log";
    expect(tailCommand(log)).toEqual(["tail", "-c", "65536", log]);
    expect(removeLogCommand(log)).toEqual(["rm", "-f", log]);
    expect(() => tailCommand("/root/.ssh/id_rsa")).toThrow();
    expect(() => removeLogCommand("/")).toThrow();
  });

  it("docker exec : le shell capturé remplace /bin/bash, options figées", () => {
    const log = "/tmp/warband-terminals/htb1-0a1b2c3d.log";
    const { shellPath, shellArgs } = terminalLaunch(
      "exegol-htb1",
      "/usr/bin/docker",
      capturedShell(log),
    );
    expect(shellPath).toBe("/usr/bin/docker");
    expect(shellArgs.slice(0, 6)).toEqual([
      "exec",
      "--interactive",
      "--tty",
      "--workdir",
      "/workspace",
      "exegol-htb1",
    ]);
    expect(shellArgs.slice(6)).toEqual(capturedShell(log));
    expect(() => terminalLaunch("exegol-htb1", "/usr/bin/docker", ["bash"])).toThrow();
  });

  it("nomme le premier shell par le court, le suivant avec un indice", () => {
    expect(shellToken("htb1", 1)).toBe("htb1");
    expect(shellToken("htb1", 2)).toBe("htb1-2");
    expect(shellToken("htb1", 5)).toBeNull();
    expect(shellToken("mauvais/nom", 1)).toBeNull();
    expect(mentionToken("exegol-htb1", "Warband : exegol-htb1", "htb1")).toBe("htb1");
    expect(mentionToken("exegol-htb1", "Warband : exegol-htb1 (2)", "htb1")).toBe("htb1-2");
    expect(mentionToken("exegol-htb1", "Warband : autre", "htb1")).toBeNull();
  });

  it("extrait les # et nettoie la fin du tampon", () => {
    expect(parseHashes("vois #htb1 puis #lab et encore #htb1")).toEqual(["htb1", "lab"]);
    expect(parseHashes("port #80 collé#htb1")).toEqual(["80"]);
    expect(parseHashes("rien")).toEqual([]);
    const raw = "Script started on 2026\n\u001B[31m80/tcp\u001B[0m open\r\n";
    expect(readableTerminal(raw)).toBe("80/tcp open");
    expect(readableTerminal("   \n")).toBe("Tampon vide.");
    expect(lastCommand("root@box:/workspace# nmap -sV 10.10.10.1\n80/tcp open")).toBe(
      "nmap -sV 10.10.10.1",
    );
    expect(lastCommand("80/tcp open http")).toBe("80/tcp open http");
    expect(readableTerminal("x".repeat(TERMINAL_TAIL_CHARS + 10))).toHaveLength(
      TERMINAL_TAIL_CHARS,
    );
  });

  it("classe un # : shell ouvert, conteneur de la liste, ou inconnu", () => {
    const listed = [{ name: "frosty_margulis" }];
    const shells = new Set(["frosty_margulis-2"]);
    expect(classifyMessageHashes(["frosty_margulis-2"], (token) => shells.has(token), [])).toEqual({
      open: ["frosty_margulis-2"],
      designated: [],
      unknown: [],
    });
    expect(classifyMessageHashes(["frosty_margulis"], () => false, listed)).toEqual({
      open: [],
      designated: ["frosty_margulis"],
      unknown: [],
    });
    expect(classifyMessageHashes(["inconnu"], () => false, listed).unknown).toEqual(["inconnu"]);
  });

  it("colle les extraits après le marqueur, ou rien", () => {
    expect(withTerminalContext("vois #htb1", [])).toBe("vois #htb1");
    expect(withTerminalContext("vois #htb1", [{ token: "htb1", text: "80/tcp" }])).toBe(
      `vois #htb1${TERMINAL_CONTEXT_MARK}Terminal #htb1.\n80/tcp`,
    );
  });

  it("un # joint le ping et autorise le Kali cité, pas l'Exegol", () => {
    const user = "fait un scan nmap rapide sur la cible #frosty_margulis-2";
    const prompt = withTerminalContext(user, [
      {
        token: "frosty_margulis-2",
        container: "frosty_margulis",
        text: "PING google.com (142.250.185.78)",
      },
    ]);
    expect(prompt.startsWith(`${user}${TERMINAL_CONTEXT_MARK}`)).toBe(true);
    expect(prompt).toContain("Terminal #frosty_margulis-2, shell du conteneur frosty_margulis.");
    expect(prompt).toContain("PING google.com (142.250.185.78)");
    expect(prompt).not.toContain("@frosty_margulis");
    expect(prompt).not.toMatch(/remplacer #/);
    const targets = createExegolTargets();
    // L'allowlist du projet reste l'autorité : le # désigne, il n'autorise pas seul.
    targets.note(prompt, ["frosty_margulis"], null);
    expect(targets.current().hashes).toEqual(["frosty_margulis-2"]);
    const kali = [{ name: "frosty_margulis", family: "kali" as const }];
    const exegol = [{ name: "frosty_margulis", family: "exegol" as const }];
    expect(resolveKaliContainer(targets.current(), "frosty_margulis", kali)).toBe(
      "frosty_margulis",
    );
    expect(resolveKaliContainer(targets.current(), "frosty_margulis-2", kali)).toBe(
      "frosty_margulis",
    );
    const sansAllowlist = createExegolTargets();
    sansAllowlist.note(prompt, [], null);
    expect(() =>
      resolveExegolContainer(sansAllowlist.current(), "frosty_margulis", exegol),
    ).toThrow(expect.objectContaining({ code: "exegol.containerDenied" }));
    expect(KALI_SERVER_INSTRUCTIONS).not.toMatch(/remplacer #/);
    expect(KALI_SERVER_INSTRUCTIONS).toContain("désigné par #");
    const denied = formatReason({
      code: "exegol.containerDenied",
      params: { name: "frosty_margulis-2" },
    });
    expect(denied).toContain("désigné par #");
    expect(denied).not.toMatch(/remplacer #/);
  });

  it("classe un # de terminal ouvert et un # de conteneur listé", () => {
    const listed = [{ name: "frosty_margulis" }];
    const shells = new Set(["frosty_margulis-2"]);
    const open = classifyMessageHashes(["frosty_margulis-2"], (token) => shells.has(token), []);
    expect(open.open).toEqual(["frosty_margulis-2"]);
    const container = classifyMessageHashes(["frosty_margulis"], () => false, listed);
    expect(container.designated).toEqual(["frosty_margulis"]);
    expect(container.unknown).toEqual([]);
  });
});
