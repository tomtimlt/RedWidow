import { describe, expect, it } from "vitest";
import { machineValue, resolveSettings } from "../src/logic/settings.js";

const from = (values: Record<string, unknown>) => (key: string) => values[key];

describe("machineValue", () => {
  it("ignore les valeurs d'espace de travail", () => {
    expect(
      machineValue({
        workspaceValue: "evil",
        workspaceFolderValue: "evil",
        globalValue: "ok",
        defaultValue: "d",
      }),
    ).toBe("ok");
    expect(machineValue({ workspaceValue: "evil", defaultValue: "d" })).toBe("d");
    expect(machineValue({ workspaceValue: "evil" })).toBeUndefined();
    expect(machineValue(undefined)).toBeUndefined();
  });
});

describe("resolveSettings", () => {
  it("défauts : rien", () => {
    expect(resolveSettings(from({ model: "", maxTurns: 0 }))).toEqual({});
  });
  it("modèle et tours", () => {
    expect(
      resolveSettings(
        from({
          model: " m ",
          maxTurns: 5,
        }),
      ),
    ).toEqual({
      model: "m",
      maxTurns: 5,
    });
  });
  it("valeurs hors bornes refusées", () => {
    expect(() => resolveSettings(from({ maxTurns: -1 }))).toThrow();
    expect(() => resolveSettings(from({ maxTurns: 1.5 }))).toThrow();
  });
});
