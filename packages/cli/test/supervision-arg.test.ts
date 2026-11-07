import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { parseSupervisionArg } from "../src/supervision-arg.js";

const t = (fr: string, _en: string) => fr;

describe("run --supervision", () => {
  it("accepte light, standard et strict", () => {
    for (const level of ["light", "standard", "strict"])
      expect(parseSupervisionArg(level, t)).toBe(level);
  });
  it("refuse une autre valeur", () => {
    expect(() => parseSupervisionArg("max", t)).toThrow(InvalidArgumentError);
  });
});
