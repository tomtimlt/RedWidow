import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { terminalLaunch } from "../src/logic/cockpit.js";
import { parseStudioMessage } from "../src/logic/studio.js";
import {
  TERMINAL_PROMPTS,
  type TerminalPrompt,
  terminalPromptOf,
  terminalShell,
} from "../src/logic/terminal-prompt.js";
import { capturedShell, readableTerminal } from "../src/logic/termlog.js";

it("le réglage et la webview n'acceptent qu'un choix fermé", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../extension.manifest.json", import.meta.url), "utf8"),
  );
  const setting = manifest.contributes.configuration.properties["warband.terminalPrompt"];
  expect(setting.enum).toEqual(TERMINAL_PROMPTS);
  expect(setting.default).toBe("native");
  expect(setting.scope).toBe("machine");
  for (const value of TERMINAL_PROMPTS) {
    expect(terminalPromptOf(value)).toBe(value);
    expect(parseStudioMessage({ type: "setTerminalPrompt", value })).toEqual({
      type: "setTerminalPrompt",
      value,
    });
  }
  for (const value of ["$(touch /tmp/injected)", "compact;id", "", null, {}, []]) {
    expect(terminalPromptOf(value)).toBe("native");
    expect(parseStudioMessage({ type: "setTerminalPrompt", value })).toBeNull();
    expect(() => terminalShell(value as TerminalPrompt)).toThrow();
  }
  expect(parseStudioMessage({ type: "setTerminalPrompt", value: "compact", rc: "id" })).toBeNull();
  expect(terminalShell()).toEqual(["/bin/bash"]);
});

it.each(TERMINAL_PROMPTS)(
  "%s : argv sans guillemet double ni retour à la ligne, scripts décodables",
  (style) => {
    const log = "/tmp/warband-terminals/test-0a1b2c3d.log";
    for (const program of [terminalShell(style), capturedShell(log, style)]) {
      for (const workspace of ["/workspace", "/redwidow/Workspace/projet"]) {
        const launch = terminalLaunch("exegol-test", "/usr/bin/docker", program, workspace);
        for (const arg of launch.shellArgs) expect(arg).not.toMatch(/[\r\n"]/);
        for (const arg of launch.shellArgs) {
          for (const match of arg.matchAll(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d/g)) {
            const script = Buffer.from(match[1] as string, "base64").toString("utf8");
            expect(script.length).toBeGreaterThan(0);
            if (existsSync("/bin/bash")) {
              const syntax = spawnSync("/bin/bash", ["-n"], { input: script, encoding: "utf8" });
              expect(syntax.status, syntax.stderr).toBe(0);
            }
          }
        }
      }
    }
  },
);

describe.skipIf(!existsSync("/bin/bash"))("prompt dans un vrai Bash interactif", () => {
  const input = [
    "printf '__PS1__%s\\n' \"$PS1\"",
    "false",
    "printf '__STATUS__%s\\n' \"$?\"",
    "printf '__CUSTOM__%s\\n' \"${CUSTOM_RC:-absent}\"",
    "declare -p PROMPT_COMMAND",
    "exit",
    "",
  ].join("\n");

  function run(style: TerminalPrompt, rc?: string, capture = false, fallback = false) {
    const root = mkdtempSync(join(tmpdir(), "redwidow-prompt-"));
    try {
      if (rc !== undefined) writeFileSync(join(root, ".bashrc"), rc);
      let path = "/usr/bin:/bin";
      if (fallback) {
        // PATH sans script : les utilitaires du wrapper restent accessibles.
        for (const name of ["mkdir", "chmod", "base64"])
          symlinkSync(`/bin/${name}`, join(root, name));
        path = root;
      }
      const log = `/tmp/warband-terminals/p2-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}.log`;
      const argv = capture ? capturedShell(log, style) : terminalShell(style);
      const child = spawnSync(argv[0] as string, argv.slice(1), {
        input,
        cwd: root,
        env: { HOME: root, SHELL: "/bin/sh", TERM: "xterm", PATH: path, LANG: "C.UTF-8" },
        encoding: "utf8",
        timeout: 5000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      if (rc !== undefined) expect(readFileSync(join(root, ".bashrc"), "utf8")).toBe(rc);
      else expect(existsSync(join(root, ".bashrc"))).toBe(false);
      const transcript =
        capture && !fallback ? readFileSync(log, "utf8") : child.stdout + child.stderr;
      rmSync(log, { force: true });
      return { stdout: child.stdout, transcript: readableTerminal(transcript) };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it.each(["redwidow", "compact", "minimal"] as const)(
    "%s : plusieurs invites, statut et rc sans écriture de configuration",
    (style) => {
      const result = run(style, "CUSTOM_RC=loaded\nPS1='old-prompt> '\n");
      expect(result.stdout).toContain("__STATUS__1");
      expect(result.stdout).toContain("__CUSTOM__loaded");
      expect(result.stdout).toContain(style === "redwidow" ? "[RedWidow]" : "\\w\\$");
      expect(result.transcript).not.toContain("old-prompt>");
    },
  );

  it("conserve les hooks chaîne et tableau qui remplacent eux-mêmes PS1", () => {
    for (const hook of [
      "PROMPT_COMMAND='PS1=overridden; CUSTOM_RC=hook'",
      "PROMPT_COMMAND=('PS1=overridden' 'CUSTOM_RC=hook')",
    ]) {
      const result = run("redwidow", `${hook}\n`);
      expect(result.stdout).toContain("__PS1__\\[\\e[31m\\]┌─[RedWidow]");
      expect(result.stdout).toContain("__CUSTOM__hook");
      expect(result.stdout).toContain("__STATUS__1");
      expect(result.stdout).toContain("PS1=overridden");
    }
  });

  it("fonctionne sans bashrc et sans script avec le même prompt", () => {
    expect(run("minimal").stdout).toContain("__PS1__\\w\\$ ");
    const fallback = run("redwidow", undefined, true, true);
    expect(fallback.transcript).toContain("[RedWidow]");
    expect(fallback.stdout).toContain("__STATUS__1");
  });

  it.skipIf(!existsSync("/usr/bin/script"))(
    "conserve la capture util-linux malgré SHELL=/bin/sh",
    () => {
      const result = run("redwidow", undefined, true);
      expect(result.transcript).toContain("[RedWidow]");
      expect(result.transcript).toContain("__STATUS__1");
      expect(result.transcript).not.toContain("Syntax error");
    },
  );
  it.each(TERMINAL_PROMPTS)("capture %s : journal utilisable avec le style choisi", (style) => {
    const result = run(style, "CUSTOM_RC=loaded\n", true);
    expect(result.transcript).toContain("__CUSTOM__loaded");
    expect(result.transcript).toContain("__STATUS__1");
    expect(result.transcript).not.toContain("syntax error");
  });
});
