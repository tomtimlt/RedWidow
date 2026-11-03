import { describe, expect, it, vi } from "vitest";
import { saveMachinePreference } from "../src/logic/machine-preference.js";

describe("réglage de langue pendant la mise à jour du registre VS Code", () => {
  it("conserve FR/EN sans écrire un réglage non enregistré", async () => {
    const update = vi.fn(async () => {});
    let stored: string | undefined;
    await saveMachinePreference("fr", {
      registered: false,
      update,
      fallback: async (value) => {
        stored = value;
      },
    });
    expect(update).not.toHaveBeenCalled();
    expect(stored).toBe("fr");
  });
  it("reproduit et absorbe l’erreur signalée par l’utilisateur", async () => {
    let stored: string | undefined;
    await expect(
      saveMachinePreference("fr", {
        registered: true,
        update: async () => {
          throw Error(
            "Unable to write to User Settings because warband.language is not a registered configuration.",
          );
        },
        fallback: async (value) => {
          stored = value;
        },
      }),
    ).resolves.toBeUndefined();
    expect(stored).toBe("fr");
  });
  it("utilise le registre et efface le repli quand le réglage est déclaré", async () => {
    const update = vi.fn(async () => {}),
      fallback = vi.fn(async (_value: string | undefined) => {});
    await saveMachinePreference("en", { registered: true, update, fallback });
    expect(update).toHaveBeenCalledWith("en");
    expect(fallback).toHaveBeenCalledWith(undefined);
  });
  it("ne masque pas une autre erreur d’écriture", async () => {
    const fallback = vi.fn(async (_v: string | undefined) => {});
    await expect(
      saveMachinePreference("fr", {
        registered: true,
        update: async () => {
          throw Error("disk failure");
        },
        fallback,
      }),
    ).rejects.toThrow("disk failure");
    expect(fallback).not.toHaveBeenCalled();
  });
});
