import { createRecorder, createSandboxContext } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { sandboxToolset } from "../src/index.js";

describe("sandboxToolset", () => {
  it("expose le serveur « sandbox » avec l'unique outil exec, sans paramètre de conteneur", () => {
    const recorder = createRecorder({ runId: "r" });
    const context = createSandboxContext({ recorder });
    const set = sandboxToolset({ context });
    expect(set.name).toBe("sandbox");
    const tools = set.create({
      recorder,
      resolveParent: () => null,
      resolveCall: () => ({ parentId: null, correlation: "none" }),
    });
    expect(tools.map((t) => t.name)).toEqual(["exec"]);
    expect(Object.keys(tools[0]?.inputSchema ?? {}).sort()).toEqual(["argv", "cwd", "timeoutSec"]);
  });
});
