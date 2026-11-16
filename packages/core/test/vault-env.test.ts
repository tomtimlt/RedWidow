import { describe, expect, it } from "vitest";
import { CodedError, VAULT_ENV_NAME, vaultEnvName } from "../src/index.js";

describe("vaultEnvName", () => {
  it("claude et openai : variables fixes", () => {
    expect(vaultEnvName("claude")).toBe("ANTHROPIC_API_KEY");
    expect(vaultEnvName("openai")).toBe("OPENAI_API_KEY");
  });

  it("fournisseur OpenCode : identifiant en majuscules, tirets en soulignés, nom valide", () => {
    const name = vaultEnvName("venator-acme_2");
    expect(name).toBe("VENATOR_ACME_2_API_KEY");
    expect(VAULT_ENV_NAME.test(name)).toBe(true);
  });

  it.each(["", "Venator-A", "-a", "a b", "a;b", "a=b", "é", "x".repeat(65)])(
    "refuse l'identifiant %j (vault.invalid)",
    (id) => {
      expect(() => vaultEnvName(id)).toThrowError(CodedError);
      try {
        vaultEnvName(id);
      } catch (error) {
        expect((error as CodedError).code).toBe("vault.invalid");
      }
    },
  );

  it("refuse un identifiant dont le nom ne commence pas par une lettre", () => {
    expect(() => vaultEnvName("1abc")).toThrowError(CodedError);
    expect(() => vaultEnvName("_abc")).toThrowError(CodedError);
  });
});
