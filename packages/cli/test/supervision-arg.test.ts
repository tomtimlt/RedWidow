import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { parseSupervisionArg } from "../src/supervision-arg.js";

const t = (fr: string, _en: string) => fr;

describe("run --supervision", () => {
  it("accepte light, standard, strict et relentless", () => {
    for (const level of ["light", "standard", "strict", "relentless"])
      expect(parseSupervisionArg(level, t)).toBe(level);
  });
  it("refuse une autre valeur", () => {
    expect(() => parseSupervisionArg("max", t)).toThrow(InvalidArgumentError);
  });
});
