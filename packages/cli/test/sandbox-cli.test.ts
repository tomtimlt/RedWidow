import { PassThrough } from "node:stream";
import { createRecorder } from "@john-studio/core";
import { formatReason } from "@john-studio/messages";
import { describe, expect, it } from "vitest";
import { createTerminalAsker } from "../src/ask.js";
import { formatEvent } from "../src/format.js";
import { assertSandboxNetworkAllowed, resolveSandboxOptions } from "../src/sandbox-options.js";
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

  it("sandbox.started : image et identifiant d'un journal non fiable neutralisés", () => {
    const e = r.emit({
      kind: "sandbox.started",
      containerId: "a".repeat(64),
      image: "x[2K‮faux",
      network: "none",
      digest: null,
    } as never);
    const line = formatEvent(e, opts) ?? "";
    expect(hasControl(line)).toBe(false);
    expect(line).toContain("xfaux");
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

  it("question exec en bridge : littéral réseau activé ; none ou autre outil : absent", async () => {
    const run = async (network: "none" | "bridge" | undefined, tool: string): Promise<string> => {
      const input = new PassThrough();
      const output = new PassThrough();
      let shown = "";
      output.on("data", (c) => {
        shown += String(c);
      });
      const ask = createTerminalAsker(input, output, network);
      const pending = ask(
        { toolUseId: "t", tool, input: { command: "ls" } },
        { decision: "ask", reason: { code: "policy.default", params: { tool } }, rule: null },
        new AbortController().signal,
      );
      input.write("n\n");
      await pending;
      return shown;
    };
    expect(await run("bridge", "mcp__sandbox__exec")).toContain("réseau activé");
    expect(await run("none", "mcp__sandbox__exec")).not.toContain("réseau activé");
    expect(await run("bridge", "Bash")).not.toContain("réseau activé");
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

  it("défauts délai, réseau, mémoire et CPU", () => {
    expect(resolveSandboxOptions({ sandbox: true, sandboxImage: "alpine@sha256:x" })).toEqual({
      image: "alpine@sha256:x",
      timeoutSec: 600,
      network: "none",
      memory: "2g",
      cpus: 2,
    });
    expect(
      resolveSandboxOptions({ sandbox: true, sandboxImage: "a", sandboxTimeout: 30 })?.timeoutSec,
    ).toBe(30);
  });

  it("valeurs hors liste ou hors bornes", () => {
    const base = { sandbox: true, sandboxImage: "a" };
    expect(() => resolveSandboxOptions({ ...base, sandboxNetwork: "host" })).toThrowError(
      expect.objectContaining({
        code: "sandbox.invalidArgument",
        params: { field: "sandboxNetwork", reason: "format" },
      }),
    );
    expect(() => resolveSandboxOptions({ ...base, sandboxMemory: "2G" })).toThrowError(
      expect.objectContaining({
        code: "sandbox.invalidArgument",
        params: { field: "sandboxMemory", reason: "format" },
      }),
    );
    expect(() => resolveSandboxOptions({ ...base, sandboxCpus: 9 })).toThrowError(
      expect.objectContaining({
        code: "sandbox.invalidArgument",
        params: { field: "sandboxCpus", reason: "range" },
      }),
    );
  });

  it("sans --sandbox : désactivé, et les options du bac à sable sont refusées", () => {
    expect(resolveSandboxOptions({})).toBeUndefined();
    for (const o of [
      { sandboxImage: "a" },
      { sandboxTimeout: 5 },
      { sandboxNetwork: "bridge" },
      { sandboxMemory: "1g" },
      { sandboxCpus: 2 },
    ]) {
      expect(() => resolveSandboxOptions(o)).toThrowError(
        expect.objectContaining({ code: "sandbox.invalidArgument" }),
      );
    }
  });

  it("réseau bridge : OpenCode refusé, Claude autorisé", () => {
    expect(() => assertSandboxNetworkAllowed("opencode", "bridge")).toThrowError(
      expect.objectContaining({
        code: "sandbox.networkUnsafe",
        params: { reason: "adapterServer" },
      }),
    );
    expect(() => assertSandboxNetworkAllowed("claude", "bridge")).not.toThrow();
    expect(() => assertSandboxNetworkAllowed("opencode", "none")).not.toThrow();
  });

  it("formatReason : adaptateur et port 2375", () => {
    expect(
      formatReason({ code: "sandbox.networkUnsafe", params: { reason: "adapterServer" } }),
    ).toBe("réseau bridge refusé : serveur local de l'adaptateur joignable depuis le conteneur");
    expect(formatReason({ code: "sandbox.networkUnsafe", params: { port: 2375 } }, "en")).toContain(
      "127.0.0.1:2375",
    );
  });
});
