import { isSupervisionLevel, type SupervisionLevel } from "@warband/core";
import { InvalidArgumentError } from "commander";
import type { Translator } from "./locale.js";

/** Valeur de `run --supervision` : `light`, `standard` ou `strict`. */
export function parseSupervisionArg(value: string, t: Translator): SupervisionLevel {
  if (!isSupervisionLevel(value)) {
    throw new InvalidArgumentError(
      t("light, standard ou strict attendu", "expected light, standard or strict"),
    );
  }
  return value;
}
