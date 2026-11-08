import { isSupervisionLevel, type SupervisionLevel } from "@warband/core";
import { InvalidArgumentError } from "commander";
import type { Translator } from "./locale.js";

/** Valeur de `run --supervision` : `light`, `standard`, `strict` ou `relentless`. */
export function parseSupervisionArg(value: string, t: Translator): SupervisionLevel {
  if (!isSupervisionLevel(value)) {
    throw new InvalidArgumentError(
      t(
        "light, standard, strict ou relentless attendu",
        "expected light, standard, strict or relentless",
      ),
    );
  }
  return value;
}
