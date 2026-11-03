import { describe, expect, it } from "vitest";
import { languageFromArgs } from "../src/locale.js";

describe("--lang", () => {
  it("utilise l’anglais par défaut et lit les deux syntaxes", () => {
    expect(languageFromArgs([])).toBe("en");
    expect(languageFromArgs(["--lang", "en", "run"])).toBe("en");
    expect(languageFromArgs(["graph", "run.jsonl", "--lang=en"])).toBe("en");
    expect(languageFromArgs(["--lang", "en", "--lang", "fr"])).toBe("fr");
    expect(languageFromArgs(["--lang", "de"])).toBe("en");
  });

  it("ne lit pas les données après le séparateur d’options", () => {
    expect(languageFromArgs(["run", "--", "--lang", "fr"])).toBe("en");
  });
});
