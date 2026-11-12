import { describe, expect, it, vi } from "vitest";
import { validateLayout } from "../src/bridge/layout.js";
import { setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();

const win = (i: number, over: Record<string, unknown> = {}) => ({
  id: `w${i}`,
  view: "chat",
  x: 0,
  y: 0.5,
  w: 0.25,
  h: 1,
  ...over,
});
const layout = (over: Record<string, unknown> = {}) => ({
  windows: [win(1), win(2, { view: "cockpit", space: "s1" })],
  spaces: [{ id: "s1", name: "Reconnaissance" }],
  active: "s1",
  ...over,
});

describe("validateLayout", () => {
  it("accepte une disposition valide (copie normalisée)", () => {
    expect(validateLayout(layout())).toEqual(layout());
    expect(validateLayout({ windows: [], spaces: [] })).toEqual({ windows: [], spaces: [] });
  });

  it.each<[string, unknown]>([
    ["33 fenêtres", layout({ windows: Array.from({ length: 33 }, (_, i) => win(i)) })],
    [
      "21 espaces",
      layout({
        spaces: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: "n" })),
        active: undefined,
        windows: [],
      }),
    ],
    ["fraction 1.5", layout({ windows: [win(1, { w: 1.5 })] })],
    ["fraction négative", layout({ windows: [win(1, { x: -0.1 })] })],
    ["fraction NaN", layout({ windows: [win(1, { y: Number.NaN })] })],
    ["vue inconnue", layout({ windows: [win(1, { view: "terminal" })] })],
    ["id de fenêtre invalide", layout({ windows: [win(1, { id: "../x" })] })],
    ["même vue et même id", layout({ windows: [win(1), win(1)] })],
    ["état inconnu", layout({ windows: [win(1, { state: "hidden" })] })],
    ["état non textuel", layout({ windows: [win(1, { state: 1 })] })],
    ["mode invalide", layout({ windows: [win(1, { mode: "a b" })] })],
    ["mode vide", layout({ windows: [win(1, { mode: "" })] })],
    ["espace inconnu", layout({ windows: [win(1, { space: "zz" })] })],
    ["active inconnu", layout({ active: "zz" })],
    ["nom d'espace trop long", layout({ spaces: [{ id: "s1", name: "x".repeat(41) }] })],
    ["nom d'espace avec contrôle", layout({ spaces: [{ id: "s1", name: "a\nb" }] })],
    ["clé en plus (fenêtre)", layout({ windows: [win(1, { script: "x" })] })],
    ["clé en plus (racine)", layout({ extra: 1 })],
    ["fenêtres absentes", { spaces: [] }],
    ["tableau", []],
    ["null", null],
  ])("refuse : %s", (_name, raw) => {
    expect(validateLayout(raw)).toBeNull();
  });

  it("accepte `state` et `mode`, et un même identifiant dans deux vues", () => {
    const raw = layout({
      windows: [
        win(1, { state: "minimized", mode: "watch", view: "viewer" }),
        win(1, { state: "maximized" }),
        win(2, { view: "shell", mode: "findings" }),
      ],
      active: undefined,
      spaces: [],
    });
    expect(validateLayout(raw)).toEqual(raw);
  });

  it("accepte exactement 32 fenêtres et 20 espaces", () => {
    const spaces = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: "n" }));
    const windows = Array.from({ length: 32 }, (_, i) => win(i));
    expect(validateLayout({ windows, spaces })).not.toBeNull();
  });
});

describe("shell : dispositions", () => {
  it("layoutSave nommée et courante, layouts, diffusion, layoutDelete", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const other = shellOf(t);
    shell.say("shell", "shell", { type: "layoutSave", name: "Revue", layout: layout() });
    shell.say("shell", "shell", {
      type: "layoutSave",
      name: null,
      layout: layout({ active: undefined }),
    });
    await vi.waitFor(() => expect(other.of("shell", "layouts")).toHaveLength(2));
    shell.say("shell", "shell", { type: "layouts" });
    await vi.waitFor(() => expect(shell.of("shell", "layouts").length).toBeGreaterThan(2));
    const last = shell.of("shell", "layouts").at(-1)?.msg;
    expect(last?.saved).toEqual([{ name: "Revue", layout: layout() }]);
    expect(last?.current).toEqual(layout({ active: undefined }));
    shell.say("shell", "shell", { type: "layoutDelete", name: "Revue" });
    await vi.waitFor(() => expect(other.of("shell", "layouts").at(-1)?.msg.saved).toEqual([]));
  });

  it("layoutSave invalide (33 fenêtres, fraction 1.5, vue inconnue, nom trop long) : refusé, rien n'est écrit", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const bad = [
      { name: "a", layout: layout({ windows: Array.from({ length: 33 }, (_, i) => win(i)) }) },
      { name: "a", layout: layout({ windows: [win(1, { h: 1.5 })] }) },
      { name: "a", layout: layout({ windows: [win(1, { view: "inconnue" })] }) },
      { name: "x".repeat(41), layout: layout() },
      { name: "", layout: layout() },
      { name: 5, layout: layout() },
    ];
    for (const m of bad) shell.say("shell", "shell", { type: "layoutSave", ...m });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(bad.length));
    expect(ctx.storage.state.get("layouts")).toBeUndefined();
  });

  it("layoutDelete d'un nom inconnu : refusé", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "layoutDelete", name: "inconnu" });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
  });
});
