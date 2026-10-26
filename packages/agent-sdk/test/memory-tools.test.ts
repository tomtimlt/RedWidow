import { createExegolTargets, createRecorder } from "@warband/core";
import { describe, expect, it } from "vitest";
import { exegolToolset, kaliToolset } from "../src/index.js";

describe.each([
  ["Exegol", exegolToolset],
  ["Kali", kaliToolset],
] as const)("mémoire du toolset %s", (name, toolset) => {
  const context = {
    recorder: createRecorder({ runId: "test" }),
    resolveParent: () => null,
    resolveCall: () => ({ parentId: null, correlation: "none" as const }),
  };
  const names = (includeMemory?: boolean) =>
    toolset({
      targets: createExegolTargets(),
      ...(includeMemory !== undefined && { includeMemory }),
    })
      .create(context)
      .map((tool) => tool.name);

  it("conserve remember par défaut et sur activation explicite pour la CLI", () => {
    if (name === "Exegol") {
      expect(names()).toContain("remember");
      expect(names()).toContain("delete_note");
    } else expect(names()).not.toContain("remember");
    expect(names(true)).toEqual(names());
  });

  it("retire uniquement remember quand la mémoire est désactivée", () => {
    expect(names(false)).toEqual(names().filter((name) => name !== "remember"));
    expect(names(false)).toContain(name === "Exegol" ? "exec" : "nmap_scan");
    for (const task of ["task_start", "task_list", "task_status", "task_cancel"])
      expect(names(false)).toContain(task);
  });
});
