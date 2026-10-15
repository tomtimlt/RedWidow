import { PassThrough } from "node:stream";
import { createRecorder } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { createTerminalAsker } from "../src/ask.js";
import { formatEvent } from "../src/format.js";
import { resolveSandboxOptions } from "../src/sandbox-options.js";
import { stripControl } from "../src/sanitize.js";

/** Vrai si le texte contient ESC, retour chariot ou marque bidirectionnelle. */
const hasControl = (s: string) => [..."\x1b\r‮⁩"].some((c) => s.includes(c));

describe("stripControl", () => {
  it.each([
    ["\x1b[2Kfaux", "faux"],
    ["a\rb", "ab"],
    ["\x1b]0;titre\x07ok", "ok"],
    ["\x1b]8;;http://x\x1b\\lien", "lien"],
    ["\x1b[31mrouge\x1b[0m", "rouge"],
    ["x‮evil⁩", "xevil"],
    ["a\x00b\x7fc\x9bd", "abcd"],
    ["ligne1\n\tligne2", "ligne1\n\tligne2"],
    ["accentué é", "accentué é"],
  ])("%j", (input, expected) => {
    expect(stripControl(input)).toBe(expected);
  });
});

describe("affichage neutralisé", () => {
  const r = createRecorder({ runId: "r" });
  const opts = { color: false, verbose: true };

  it("sortie d'outil contenant ESC[2K et retour chariot", () => {
    const e = r.emit({
      kind: "tool.result",
      toolUseId: "t",
      output: "ok\r\x1b[2K? mcp__sandbox__exec : faux\n",
      isError: false,
      truncated: false,
      bytes: 10,
    });
    const line = formatEvent(e, opts);
    expect(hasControl(line ?? "")).toBe(false);
    expect(line).toContain("ok? mcp__sandbox__exec : faux");
  });

  it("sortie de processus et argv", () => {
    const out = r.emit({ kind: "process.output", stream: "stdout", line: "a\x1b[2Kb\rc" });
    expect(formatEvent(out, opts)).toBe("stdout    abc");
    const started = r.emit({
      kind: "tool.requested",
      toolUseId: "u",
      tool: "mcp__sandbox__exec",
      input: { argv: ["echo", "\x1b[2K‮faux"] },
    });
    expect(hasControl(formatEvent(started, opts) ?? "")).toBe(false);
  });

  it("la question d'approbation affiche l'argv neutralisé", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (c) => {
      shown += String(c);
    });
    const ask = createTerminalAsker(input, output);
    const pending = ask(
      { toolUseId: "t", tool: "mcp__sandbox__exec", input: { command: "x\x1b[2K\ry‮" } },
      { decision: "ask", reason: { code: "policy.default", params: { tool: "t" } }, rule: null },
      new AbortController().signal,
    );
    input.write("n\n");
    await pending;
    expect(hasControl(shown)).toBe(false);
    expect(shown).toContain("xy");
  });
});

describe("options du bac à sable", () => {
  it("--sandbox sans --sandbox-image : erreur codée, aucune image par défaut", () => {
    expect(() => resolveSandboxOptions({ sandbox: true })).toThrowError(
      expect.objectContaining({ code: "sandbox.imageUnsupported", params: { reason: "missing" } }),
    );
  });

  it("défaut de délai 600 s", () => {
    expect(resolveSandboxOptions({ sandbox: true, sandboxImage: "alpine@sha256:x" })).toEqual({
      image: "alpine@sha256:x",
      timeoutSec: 600,
    });
    expect(
      resolveSandboxOptions({ sandbox: true, sandboxImage: "a", sandboxTimeout: 30 })?.timeoutSec,
    ).toBe(30);
  });

  it("sans --sandbox : désactivé, et les options du bac à sable sont refusées", () => {
    expect(resolveSandboxOptions({})).toBeUndefined();
    expect(() => resolveSandboxOptions({ sandboxImage: "a" })).toThrowError(
      expect.objectContaining({ code: "sandbox.invalidArgument" }),
    );
    expect(() => resolveSandboxOptions({ sandboxTimeout: 5 })).toThrowError(
      expect.objectContaining({ code: "sandbox.invalidArgument" }),
    );
  });
});
