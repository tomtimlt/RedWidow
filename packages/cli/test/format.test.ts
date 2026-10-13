import { createRecorder } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { formatEvent } from "../src/format.js";

describe("formatEvent", () => {
  const r = createRecorder({ runId: "r" });
  const opts = { color: false, verbose: false };

  it("rend une ligne par événement", () => {
    const e = r.emit({
      kind: "tool.requested",
      toolUseId: "t",
      tool: "Bash",
      input: { command: "docker ps" },
    });
    expect(formatEvent(e, opts)).toBe("tool      Bash docker ps");
  });

  it("masque la sortie des processus sauf en verbose", () => {
    const e = r.emit({ kind: "process.output", stream: "stdout", line: "hello" });
    expect(formatEvent(e, opts)).toBeNull();
    expect(formatEvent(e, { ...opts, verbose: true })).toBe("stdout    hello");
  });

  it("colore seulement si demandé", () => {
    const e = r.emit({ kind: "error", message: "boom" });
    expect(formatEvent(e, opts)).not.toContain("\x1b[");
    expect(formatEvent(e, { ...opts, color: true })).toContain("\x1b[31m");
  });
});
