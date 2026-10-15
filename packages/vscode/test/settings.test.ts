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
  it("défauts : rien, pas de bac à sable", () => {
    expect(resolveSettings(from({ model: "", maxTurns: 0, "sandbox.enabled": false }))).toEqual({});
  });
  it("modèle, tours et bac à sable", () => {
    expect(
      resolveSettings(
        from({
          model: " m ",
          maxTurns: 5,
          "sandbox.enabled": true,
          "sandbox.image": "alpine:3.20",
          "sandbox.timeoutSec": 30,
        }),
      ),
    ).toEqual({
      model: "m",
      maxTurns: 5,
      sandbox: {
        image: "alpine:3.20",
        timeoutSec: 30,
        network: "none",
        memory: "2g",
        cpus: 2,
      },
    });
  });
  it("défauts réseau, mémoire et CPU", () => {
    expect(
      resolveSettings(from({ "sandbox.enabled": true, "sandbox.image": "a:1" })).sandbox,
    ).toEqual({
      image: "a:1",
      timeoutSec: 600,
      network: "none",
      memory: "2g",
      cpus: 2,
    });
    expect(
      resolveSettings(
        from({
          "sandbox.enabled": true,
          "sandbox.image": "a:1",
          "sandbox.network": "bridge",
          "sandbox.memory": "4g",
          "sandbox.cpus": 3,
        }),
      ).sandbox,
    ).toEqual({
      image: "a:1",
      timeoutSec: 600,
      network: "bridge",
      memory: "4g",
      cpus: 3,
    });
  });
  it("valeur d'espace de travail ignorée : machineValue ne la lit pas", () => {
    const network = machineValue({
      workspaceValue: "bridge",
      defaultValue: "none",
    });
    expect(network).toBe("none");
    expect(
      resolveSettings((key) =>
        key === "sandbox.enabled"
          ? true
          : key === "sandbox.image"
            ? "a:1"
            : key === "sandbox.network"
              ? machineValue({ workspaceValue: "bridge", defaultValue: "none" })
              : undefined,
      ).sandbox?.network,
    ).toBe("none");
  });
  it("bac à sable activé sans image : refusé", () => {
    for (const image of [undefined, "", "  ", 3]) {
      expect(() =>
        resolveSettings(from({ "sandbox.enabled": true, "sandbox.image": image })),
      ).toThrow(expect.objectContaining({ code: "sandbox.imageUnsupported" }));
    }
  });
  it("valeurs hors bornes refusées", () => {
    const base = { "sandbox.enabled": true, "sandbox.image": "a:1" };
    for (const t of [0, 1801, 1.5, "10"]) {
      expect(() => resolveSettings(from({ ...base, "sandbox.timeoutSec": t }))).toThrow();
    }
    expect(() => resolveSettings(from({ ...base, "sandbox.network": "host" }))).toThrow();
    expect(() => resolveSettings(from({ ...base, "sandbox.memory": "512m" }))).toThrow();
    expect(() => resolveSettings(from({ ...base, "sandbox.cpus": 0 }))).toThrow();
    expect(() => resolveSettings(from({ maxTurns: -1 }))).toThrow();
    expect(() => resolveSettings(from({ maxTurns: 1.5 }))).toThrow();
  });
});
