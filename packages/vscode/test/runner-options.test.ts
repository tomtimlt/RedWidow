import { createExegolTargets } from "@warband/core";
import { describe, expect, it } from "vitest";
import { runnerOptions } from "../src/engine/runner-options.js";

describe("options du runner selon le mode (ADR 0010)", () => {
  const targets = createExegolTargets();

  it("apprentissage : un seul toolset cours, aucun outil natif, pas de bash", () => {
    const o = runnerOptions("learning", "/bin/claude", targets);
    expect(o.toolsets?.map((t) => t.name)).toEqual(["cours"]);
    expect(o.builtinTools).toEqual([]);
    expect(o).not.toHaveProperty("bash");
    expect(o.executable).toBe("/bin/claude");
  });

  it("sans mode : Exegol seul, options par défaut pour le reste", () => {
    const o = runnerOptions(undefined, "/bin/claude", targets);
    expect(o.toolsets?.map((t) => t.name)).toEqual(["exegol"]);
    expect(o).not.toHaveProperty("builtinTools");
    expect(o).not.toHaveProperty("bash");
  });
});
