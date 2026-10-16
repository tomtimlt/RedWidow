import { TERMINAL_CONTEXT_MARK } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import {
  lastCommand,
  mentionToken,
  parseHashes,
  readableTerminal,
  scriptArgs,
  shellToken,
  TERMINAL_TAIL_CHARS,
  withTerminalContext,
} from "../src/logic/termlog.js";

describe("journal de terminal", () => {
  it("enveloppe docker exec dans script sans changer l'argv", () => {
    expect(
      scriptArgs("/usr/bin/docker", ["exec", "--tty", "exegol-htb1", "/bin/bash"], "/tmp/a.log"),
    ).toEqual([
      "-q",
      "-f",
      "-c",
      "'/usr/bin/docker' 'exec' '--tty' 'exegol-htb1' '/bin/bash'",
      "/tmp/a.log",
    ]);
    expect(scriptArgs("/bin/docker", ["exec", "a'b"], "/log")[3]).toBe(
      "'/bin/docker' 'exec' 'a'\\''b'",
    );
  });

  it("nomme le premier shell par le court, le suivant avec un indice", () => {
    expect(shellToken("htb1", 1)).toBe("htb1");
    expect(shellToken("htb1", 2)).toBe("htb1-2");
    expect(shellToken("htb1", 5)).toBeNull();
    expect(shellToken("mauvais/nom", 1)).toBeNull();
    expect(mentionToken("exegol-htb1", "John : exegol-htb1", "htb1")).toBe("htb1");
    expect(mentionToken("exegol-htb1", "John : exegol-htb1 (2)", "htb1")).toBe("htb1-2");
    expect(mentionToken("exegol-htb1", "John : autre", "htb1")).toBeNull();
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

  it("colle les extraits après le marqueur, ou rien", () => {
    expect(withTerminalContext("vois #htb1", [])).toBe("vois #htb1");
    expect(withTerminalContext("vois #htb1", [{ token: "htb1", text: "80/tcp" }])).toBe(
      `vois #htb1${TERMINAL_CONTEXT_MARK}htb1\n80/tcp`,
    );
  });
});
