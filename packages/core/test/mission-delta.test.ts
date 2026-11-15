import { expect, it } from "vitest";
import { createMissionContextDelta } from "../src/index.js";

it("l'empreinte ne signale que l'identité avec le dernier bloc envoyé", () => {
  const delta = createMissionContextDelta();
  expect(delta.unchanged("A")).toBe(false);
  expect(delta.unchanged("A")).toBe(true);
  expect(delta.unchanged("B")).toBe(false);
  // Revenir à un ancien bloc : il diffère du dernier envoyé, donc complet.
  expect(delta.unchanged("A")).toBe(false);
});

it("chaque instance part vide (nouveau run ou reprise : bloc complet)", () => {
  createMissionContextDelta().unchanged("A");
  expect(createMissionContextDelta().unchanged("A")).toBe(false);
});
