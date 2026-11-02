import { describe, expect, it } from "vitest";
import { LEGACY_PRODUCT_NAME, PRODUCT_NAME, productTitleSuffix } from "../src/logic/brand.js";

describe("préfixe public des terminaux", () => {
  it.each([PRODUCT_NAME, LEGACY_PRODUCT_NAME])("reconnaît les créations sous %s", (name) => {
    expect(productTitleSuffix(`${name} : création lab`)).toBe("création lab");
    expect(productTitleSuffix(`${name} : lab (2)`)).toBe("lab (2)");
  });

  it.each([
    "Venator Ops bis : création lab",
    "Warband bis : création lab",
    "Autre Warband : création lab",
    "Venator Ops: création lab",
    "warband : création lab",
  ])("ignore un préfixe approchant : %s", (title) => {
    expect(productTitleSuffix(title)).toBeNull();
  });
});
