import type { ModelOption } from "@john-studio/core";
import { describe, expect, it } from "vitest";
import { buildControls, DEFAULT_PREFS, parsePrefs } from "../src/logic/controls.js";
import { clampEffort, EFFORT_LEVELS, parseEffort } from "../src/logic/effort.js";
import {
  parseModelCache,
  parseModelOptions,
  usableModels,
  validateModelChoice,
} from "../src/logic/models.js";

const A: ModelOption = {
  value: "a",
  displayName: "A",
  supportedEffortLevels: ["low", "medium", "high"],
};
const B: ModelOption = { value: "b", displayName: "B", supportedEffortLevels: [] };

describe("effort", () => {
  it("5 crans, correspondance 1:1 (Extra = xhigh)", () => {
    expect(EFFORT_LEVELS.map((l) => [l.label, l.value])).toEqual([
      ["Low", "low"],
      ["Medium", "medium"],
      ["High", "high"],
      ["Extra", "xhigh"],
      ["Max", "max"],
    ]);
  });
  it("énumération stricte", () => {
    expect(parseEffort("xhigh")).toBe("xhigh");
    for (const bad of ["ultra", "ultracode", "", 3, null, undefined, "HIGH"]) {
      expect(parseEffort(bad)).toBeNull();
    }
  });
  it("niveau non supporté ramené au plus haut niveau inférieur permis", () => {
    expect(clampEffort("max", ["low", "medium", "high"])).toEqual({
      effort: "high",
      clamped: true,
    });
    expect(clampEffort("low", ["high", "max"])).toEqual({ effort: "high", clamped: true });
    expect(clampEffort("high", undefined)).toEqual({ effort: "high", clamped: false });
    expect(clampEffort("high", [])).toEqual({ effort: null, clamped: true });
  });
});

describe("modèles", () => {
  it("choix hostiles refusés", () => {
    expect(validateModelChoice("a", [A])).toEqual({ ok: true, model: "a" });
    expect(validateModelChoice(null, [A])).toEqual({ ok: true, model: null });
    expect(validateModelChoice("inconnu", [A])).toEqual({ ok: false });
    expect(validateModelChoice("a b", null)).toEqual({ ok: false });
    expect(validateModelChoice("a\nb", null)).toEqual({ ok: false });
    expect(validateModelChoice("x".repeat(201), null)).toEqual({ ok: false });
    expect(validateModelChoice(42, null)).toEqual({ ok: false });
    expect(validateModelChoice("libre-1", null)).toEqual({ ok: true, model: "libre-1" });
  });
  it("liste mal formée rejetée", () => {
    expect(parseModelOptions([A, B])).not.toBeNull();
    expect(parseModelOptions("x")).toBeNull();
    expect(parseModelOptions([{ value: "a" }])).toBeNull();
    expect(parseModelOptions([{ ...A, extra: 1 }])).toBeNull();
    expect(parseModelOptions([{ ...A, supportedEffortLevels: ["ultra"] }])).toBeNull();
    expect(parseModelOptions(Array.from({ length: 101 }, () => A))).toBeNull();
  });
  it("entrées inutilisables écartées, textes neutralisés", () => {
    const list = usableModels([
      { value: "bon", displayName: "Bon‮" },
      { value: "mauvais id", displayName: "X" },
    ]);
    expect(list.map((m) => m.value)).toEqual(["bon"]);
    expect(list[0]?.displayName).not.toContain("‮");
  });
  it("cache invalidé si la version du SDK change", () => {
    const raw = { sdk: "1", models: [A] };
    expect(parseModelCache(raw, "1")).toHaveLength(1);
    expect(parseModelCache(raw, "2")).toBeNull();
    expect(parseModelCache({ sdk: "1", models: [] }, "1")).toBeNull();
    expect(parseModelCache("poison", "1")).toBeNull();
  });
});

describe("contrôles", () => {
  const base = { status: "ready" as const, defaultModel: undefined, busy: false };
  it("niveaux grisés selon le modèle", () => {
    const c = buildControls({ ...base, prefs: { model: "a", effort: "high" }, models: [A, B] });
    expect(c.levels.map((l) => l.enabled)).toEqual([true, true, true, false, false]);
    expect(c.effortLabel).toBe("High");
  });
  it("effort affiché ramené, modèle sans effort grisé, gel pendant un tour", () => {
    const c = buildControls({ ...base, prefs: { model: "a", effort: "max" }, models: [A] });
    expect(c.effort).toBe("high");
    const d = buildControls({
      ...base,
      busy: true,
      prefs: { model: "b", effort: "low" },
      models: [B],
    });
    expect(d.effortDisabled).toBe(true);
    expect(d.locked).toBe(true);
  });
  it("liste inconnue : saisie libre, tous les crans permis", () => {
    const c = buildControls({ ...base, prefs: DEFAULT_PREFS, models: null });
    expect(c.models).toBeNull();
    expect(c.levels.every((l) => l.enabled)).toBe(true);
  });
  it("préférences stockées revalidées", () => {
    expect(parsePrefs({ model: "a b", effort: "ultra" })).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ model: "a", effort: "max" })).toEqual({ model: "a", effort: "max" });
  });
});
