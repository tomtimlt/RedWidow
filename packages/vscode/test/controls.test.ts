import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { ModelOption } from "@warband/core";
import { describe, expect, it } from "vitest";
import { buildControls, DEFAULT_PREFS, parsePrefs } from "../src/logic/controls.js";
import {
  clampEffort,
  EFFORT_LEVELS,
  levelsFor,
  parseEffort,
  parseEffortChoice,
  resolveEffort,
  ultracodeTip,
} from "../src/logic/effort.js";
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
  it("6 crans : 5 niveaux du SDK en 1:1 (Extra = xhigh) puis le préréglage Ultracode (Claude seul)", () => {
    expect(EFFORT_LEVELS.map((l) => [l.label, l.value])).toEqual([
      ["Low", "low"],
      ["Medium", "medium"],
      ["High", "high"],
      ["Extra", "xhigh"],
      ["Max", "max"],
      ["Ultracode", "ultracode"],
    ]);
    expect(levelsFor("claude").at(-1)?.providers).toEqual(["claude"]);
    // Ultracode s'exécute en `max` et n'est jamais transmis tel quel au SDK.
    expect(resolveEffort("ultracode", { maxTurns: 90 })).toEqual({
      effort: "max",
      limits: { maxTurns: 90 },
    });
    expect(resolveEffort("high", { maxTurns: 90 })).toEqual({ effort: "high", limits: undefined });
    expect(parseEffort("ultracode")).toBeNull();
    expect(parseEffortChoice("ultracode")).toBe("ultracode");
    expect(parseEffortChoice("ultra")).toBeNull();
    expect(ultracodeTip({ maxTurns: 90, maxBudgetUsd: 5 })).toContain("90 tours");
    expect(ultracodeTip(undefined)).toContain("sans plafond de tours");
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
  it("variantes strictes : noms réels conservés, doublons et entrées hostiles refusés", () => {
    const model = { ...A, reasoningVariants: ["low", "vendor.custom-2", "HIGH"] };
    expect(parseModelOptions([model])).toEqual([model]);
    for (const reasoningVariants of [
      ["low", "low"],
      [""],
      ["a b"],
      ["high\n"],
      ["a\u202e"],
      ["x".repeat(65)],
      [42],
      "high",
      Array.from({ length: 65 }, (_, i) => String(i)),
    ]) {
      expect(parseModelOptions([{ ...A, reasoningVariants }])).toBeNull();
    }
  });
});

describe("contrôles", () => {
  const base = { status: "ready" as const, defaultModel: undefined, busy: false };
  it("niveaux grisés selon le modèle", () => {
    const c = buildControls({
      ...base,
      prefs: { ...DEFAULT_PREFS, model: "a", effort: "high" },
      models: [A, B],
    });
    expect(c.levels.map((l) => l.enabled)).toEqual([true, true, true, false, false, false]);
    expect(c.effortLabel).toBe("High");
  });
  it("effort affiché ramené, modèle sans effort grisé, gel pendant un tour", () => {
    const c = buildControls({
      ...base,
      prefs: { ...DEFAULT_PREFS, model: "a", effort: "max" },
      models: [A],
    });
    expect(c.effort).toBe("high");
    const d = buildControls({
      ...base,
      busy: true,
      prefs: { ...DEFAULT_PREFS, model: "b", effort: "low" },
      models: [B],
    });
    expect(d.effortDisabled).toBe(true);
    expect(d.locked).toBe(true);
  });
  it("apprentissage : faux par défaut, vrai seulement si demandé, gelé comme le reste", () => {
    const off = buildControls({ ...base, prefs: DEFAULT_PREFS, models: null });
    expect(off.learning).toBe(false);
    const on = buildControls({ ...base, prefs: DEFAULT_PREFS, models: null, learning: true });
    expect(on.learning).toBe(true);
    expect(on.locked).toBe(false);
    const busy = buildControls({
      ...base,
      busy: true,
      prefs: DEFAULT_PREFS,
      models: null,
      learning: true,
    });
    expect(busy).toMatchObject({ learning: true, locked: true });
  });
  it("liste inconnue : saisie libre, tous les crans permis", () => {
    const c = buildControls({ ...base, prefs: DEFAULT_PREFS, models: null });
    expect(c.models).toBeNull();
    expect(c.levels.every((l) => l.enabled)).toBe(true);
  });
  it("préférences stockées revalidées", () => {
    expect(parsePrefs({ model: "a b", effort: "ultra" })).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ model: "a", effort: "max" })).toEqual({
      ...DEFAULT_PREFS,
      model: "a",
      effort: "max",
    });
    expect(parsePrefs({ effort: "ultracode" }).effort).toBe("ultracode");
  });
  it("par défaut : Auto, aucun effort transmis tant que le curseur n'est pas touché", () => {
    expect(DEFAULT_PREFS.effort).toBeNull();
    const c = buildControls({ ...base, prefs: DEFAULT_PREFS, models: null });
    expect(c.effort).toBeNull();
    expect(c.effortLabel).toBe("Auto");
    expect(c.effortTip).toContain("aucun niveau d'effort n'est transmis");
  });
  it("Ultracode grisé si le modèle ne supporte pas max, infobulle avec les valeurs réelles", () => {
    const withMax: ModelOption = {
      value: "m",
      displayName: "M",
      supportedEffortLevels: ["high", "max"],
    };
    const c = buildControls({
      ...base,
      prefs: { ...DEFAULT_PREFS, effort: "ultracode" },
      models: [withMax],
      defaultModel: "m",
      ultracode: { maxTurns: 80 },
    });
    expect(c.effort).toBe("ultracode");
    expect(c.effortTip).toContain("80 tours");
    const d = buildControls({
      ...base,
      prefs: { ...DEFAULT_PREFS, effort: "ultracode" },
      models: [A],
      defaultModel: "a",
    });
    expect(d.levels.at(-1)?.enabled).toBe(false);
    expect(d.effort).toBe("high");
  });
});

describe("fournisseur de la conversation", () => {
  it("persiste seulement les identifiants de fournisseur autorisés", () => {
    for (const provider of ["claude", "openai", "opencode"]) {
      expect(parsePrefs({ provider }).provider).toBe(provider);
    }
    for (const provider of ["OpenAI", "<script>", "claude\n", null, {}, 42]) {
      expect(parsePrefs({ provider }).provider).toBe("claude");
    }
  });
  it("conserve les modèles découverts et ne propose pas un effort sans backend", () => {
    for (const provider of ["openai", "opencode"] as const) {
      const controls = buildControls({
        prefs: { ...DEFAULT_PREFS, provider, effort: "ultracode" },
        models: [A],
        status: "ready",
        defaultModel: undefined,
        busy: true,
      });
      expect(controls.provider).toBe(provider);
      expect(controls.models?.map((model) => model.value)).toEqual(["a"]);
      expect(controls.locked).toBe(true);
      expect(controls.effort).toBeNull();
      expect(controls.effortDisabled).toBe(true);
      expect(controls.levels).toEqual([]);
      expect(levelsFor(provider)).toEqual([]);
    }
  });
  it("variantes du modèle sélectionné : aucun alias ni niveau inventé entre deux modèles", () => {
    const models: ModelOption[] = [
      { value: "one", displayName: "Un", reasoningVariants: ["low", "custom.full"] },
      { value: "two", displayName: "Deux", reasoningVariants: ["minimal", "max"] },
    ];
    for (const provider of ["openai", "opencode"] as const) {
      const prefs = { ...DEFAULT_PREFS, provider, model: "one", variant: "custom.full" };
      const input = {
        prefs,
        models,
        status: "ready" as const,
        defaultModel: undefined,
        busy: false,
      };
      const first = buildControls(input);
      expect(first.reasoningVariants).toEqual([
        { value: "low", label: "low" },
        { value: "custom.full", label: "custom.full" },
      ]);
      expect(first).toMatchObject({
        variant: "custom.full",
        effort: null,
        effortLabel: "custom.full",
        effortDisabled: false,
        levels: [],
      });
      const second = buildControls({ ...input, prefs: { ...prefs, model: "two" } });
      expect(second.reasoningVariants.map((v) => v.value)).toEqual(["minimal", "max"]);
      expect(second).toMatchObject({ variant: null, effortLabel: "Auto", effortDisabled: false });
      for (const model of ["missing", null]) {
        const unknown = buildControls({
          ...input,
          models: model === null ? null : models,
          prefs: { ...prefs, model },
        });
        expect(unknown).toMatchObject({
          variant: null,
          reasoningVariants: [],
          effortDisabled: true,
        });
      }
    }
  });
  it("ancien cache sans variantes : Auto hors Claude, sans migration de l'effort", () => {
    const models = parseModelCache({ sdk: "legacy", models: [A] }, "legacy");
    const controls = buildControls({
      prefs: parsePrefs({ provider: "openai", model: "a", effort: "high" }),
      models,
      status: "ready",
      defaultModel: undefined,
      busy: false,
    });
    expect(controls).toMatchObject({
      variant: null,
      effort: null,
      reasoningVariants: [],
      effortLabel: "Auto",
      effortDisabled: true,
    });
  });
  it("préférences : variante opaque bornée et indépendante de l'effort Claude", () => {
    expect(parsePrefs({ effort: "ultracode", variant: "custom.high" })).toMatchObject({
      effort: "ultracode",
      variant: "custom.high",
    });
    for (const variant of ["", "a b", "high\n", "x".repeat(65), {}, 1, null]) {
      expect(parsePrefs({ variant }).variant).toBeNull();
    }
  });
});

describe("curseur de raisonnement de la webview", () => {
  it("reconfigure les crans et envoie leur valeur exacte, Auto, clavier et gel compris", () => {
    const js = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");
    const renderStart = js.indexOf("  function renderControls(c) {");
    const render = js.slice(renderStart, js.indexOf("\n  }", renderStart) + 4);
    const handlers = js.slice(
      js.indexOf("  function postReasoningChoice(value) {"),
      js.indexOf("\n  // --- Historique"),
    );
    const nodes = new Map<string, ReturnType<typeof node>>();
    function node() {
      return {
        value: "",
        textContent: "",
        disabled: false,
        hidden: false,
        max: "",
        title: "",
        events: new Map<string, () => void>(),
        attrs: new Map<string, string>(),
        addEventListener(type: string, handler: () => void) {
          this.events.set(type, handler);
        },
        setAttribute(name: string, value: string) {
          this.attrs.set(name, value);
        },
        matches: () => false,
        classList: { toggle() {}, remove() {} },
        style: { setProperty() {} },
      };
    }
    const $ = (id: string) => {
      let found = nodes.get(id);
      if (!found) {
        found = node();
        nodes.set(id, found);
      }
      return found;
    };
    const sent: unknown[] = [];
    const context = {
      $,
      ctl: null,
      levels: [],
      ctlGroup: $("ctl-group"),
      modelChip: $("model-chip"),
      cfgBtn: $("cfg-btn"),
      modelPop: $("model-pop"),
      cfgPop: $("cfg-pop"),
      modelFilter: $("model-filter"),
      modelList: $("model-list"),
      modelInput: $("model-input"),
      effortInput: $("effort"),
      learningSwitch: $("learning-switch"),
      document: { body: { classList: { toggle() {}, remove() {} } } },
      renderBypass() {},
      vscode: { postMessage: (message: unknown) => sent.push(message) },
    };
    const renderControls = runInNewContext(`${render}\n${handlers}\nrenderControls`, context) as (
      controls: ReturnType<typeof buildControls>,
    ) => void;
    const input = {
      prefs: { ...DEFAULT_PREFS, provider: "openai" as const, model: "a" },
      models: [{ ...A, reasoningVariants: ["low", "custom.full", "high"] }],
      status: "ready" as const,
      defaultModel: undefined,
      busy: false,
    };
    renderControls(buildControls(input));
    expect($("effort").max).toBe("3");
    expect($("effort").disabled).toBe(false);
    // Les flèches, Home et End natifs du range déclenchent input puis change.
    $("effort").value = "3";
    $("effort").events.get("input")?.();
    expect($("effort").attrs.get("aria-valuetext")).toBe("high");
    $("effort").events.get("change")?.();
    expect(sent.pop()).toEqual({ type: "setVariant", variant: "high" });
    $("effort-auto").events.get("click")?.();
    expect(sent.pop()).toEqual({ type: "setVariant", variant: null });
    $("effort").value = "0";
    $("effort").events.get("change")?.();
    expect(sent.pop()).toEqual({ type: "setVariant", variant: null });
    renderControls(
      buildControls({ ...input, models: [{ ...A, reasoningVariants: ["other.exact"] }] }),
    );
    expect($("effort").max).toBe("1");
    $("effort").value = "1";
    $("effort").events.get("change")?.();
    expect(sent.pop()).toEqual({ type: "setVariant", variant: "other.exact" });
    renderControls(buildControls({ ...input, busy: true }));
    $("effort-auto").events.get("click")?.();
    $("effort").events.get("change")?.();
    expect(sent).toEqual([]);
    renderControls(buildControls({ ...input, prefs: { ...DEFAULT_PREFS, effort: "low" } }));
    $("effort-auto").events.get("click")?.();
    expect(sent.pop()).toEqual({ type: "setEffort", effort: null });
  });
});
