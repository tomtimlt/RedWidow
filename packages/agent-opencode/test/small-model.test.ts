import { describe, expect, it } from "vitest";
import { buildConfig } from "../src/config.js";
import { smallModelOf } from "../src/runner.js";

describe("petit modèle d'OpenCode (small_model)", () => {
  it("prend le modèle du run, au format fournisseur/modèle", () => {
    expect(smallModelOf("opencode/modele-gratuit")).toBe("opencode/modele-gratuit");
    expect(smallModelOf("modele-gratuit", "opencode")).toBe("opencode/modele-gratuit");
  });

  it("sans modèle : rien n'est imposé", () => {
    expect(smallModelOf(undefined)).toBeUndefined();
  });

  it("la configuration forcée écrase le small_model de l'utilisateur", () => {
    const config = buildConfig({
      user: { small_model: "autre/modele-payant" },
      enabledTools: new Set(),
      mcp: {},
      maxTurns: undefined,
      smallModel: "opencode/modele-gratuit",
    });
    expect(config.small_model).toBe("opencode/modele-gratuit");
  });

  it("sans smallModel, la configuration de l'utilisateur est conservée", () => {
    const config = buildConfig({
      user: { small_model: "autre/modele" },
      enabledTools: new Set(),
      mcp: {},
      maxTurns: undefined,
    });
    expect(config.small_model).toBe("autre/modele");
  });
});
