import { describe, expect, it, vi } from "vitest";
import { validateLayout as serverValidate } from "../src/bridge/layout.js";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const lay = await load("../web/wm/layouts.js");
const types = await load("../web/wm/types.js");

const mission = (id: string, rect = { x: 0.1, y: 0.1, w: 0.4, h: 0.5 }, extra = {}) => ({
  key: `chat:${id}`,
  spec: types.iframeSpec("mission", id),
  rect,
  maximized: false,
  minimized: false,
  ...extra,
});
const native = (name: string, rect = { x: 0.5, y: 0, w: 0.5, h: 1 }) => ({
  key: `native:${name}`,
  spec: types.nativeSpec(name),
  rect,
  maximized: false,
  minimized: false,
});

describe("espaces : sérialisation", () => {
  it("aller-retour : ordre d'empilement, géométrie, natifs, maximisée", () => {
    const items = [
      native("approvals"),
      mission("m1"),
      { ...mission("m2"), maximized: true },
      {
        key: "killchain:g1",
        spec: types.iframeSpec("graph", "g1"),
        rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        maximized: false,
        minimized: false,
      },
    ];
    const layout = lay.serialize(items, "Recon");
    expect(layout.spaces).toEqual([{ id: "main", name: "Recon" }]);
    expect(layout.windows.map((w: { id: string }) => w.id)).toEqual([
      "approvals",
      "m1",
      "m2",
      "g1",
    ]);
    expect(layout.windows[0]).toMatchObject({ view: "shell", id: "approvals", mode: "approvals" });
    // Maximisée : champ `state`, la géométrie reste celle de la fenêtre restaurée.
    expect(layout.windows[2]).toMatchObject({ state: "maximized", x: 0.1, y: 0.1, w: 0.4, h: 0.5 });
    expect(layout.windows[1].state).toBeUndefined();
    // Le serveur accepte exactement ce que le client produit.
    expect(serverValidate(layout)).toEqual(layout);
    expect(lay.validateLayout(layout)).toEqual(layout);

    const plan = lay.planApply(layout, []);
    expect(plan.windows.map((w: { spec: { key: string } }) => w.spec.key)).toEqual([
      "native:approvals",
      "chat:m1",
      "chat:m2",
      "killchain:g1",
    ]);
    expect(plan.windows.map((w: { maximized: boolean }) => w.maximized)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(plan.windows[1].rect).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 });
  });

  it("deux vues au même identifiant : les deux gardées (identité = vue + identifiant)", () => {
    const items = [
      mission("m1"),
      {
        key: "killchain:m1",
        spec: types.iframeSpec("graph", "m1"),
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
        maximized: false,
        minimized: false,
      },
    ];
    const layout = lay.serialize(items);
    expect(layout.windows.map((w: { view: string }) => w.view)).toEqual(["chat", "killchain"]);
    expect(serverValidate(layout)).toEqual(layout);
    expect(lay.validateLayout(layout)).toEqual(layout);
  });

  it("minimisée, maximisée et mode monitor ou report : aller-retour par `state` et `mode`", () => {
    const items = [
      { ...mission("m1"), minimized: true },
      {
        key: "viewer:r1",
        spec: types.iframeSpec("monitor", "r1"),
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
        maximized: true,
        minimized: false,
      },
      {
        key: "viewer:r2",
        spec: types.iframeSpec("report", "r2"),
        rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        maximized: false,
        minimized: false,
      },
      native("findings"),
    ];
    const layout = lay.serialize(items);
    expect(layout.windows[0]).toMatchObject({ id: "m1", state: "minimized" });
    expect(layout.windows[1]).toMatchObject({ id: "r1", mode: "monitor", state: "maximized" });
    expect(layout.windows[2]).toMatchObject({ id: "r2", mode: "report" });
    expect(layout.windows[3]).toMatchObject({ view: "shell", id: "findings", mode: "findings" });
    expect(serverValidate(layout)).toEqual(layout);
    expect(lay.validateLayout(layout)).toEqual(layout);
    const plan = lay.planApply(layout, []);
    expect(plan.windows.map((w: { spec: { key: string } }) => w.spec.key)).toEqual([
      "chat:m1",
      "viewer:r1",
      "viewer:r2",
      "native:findings",
    ]);
    expect(plan.windows[0]).toMatchObject({ minimized: true, maximized: false });
    expect(plan.windows[1]).toMatchObject({ minimized: false, maximized: true });
    expect(plan.windows[2].spec).toMatchObject({ mode: "report" });
    expect(plan.windows[1].spec).toMatchObject({ mode: "monitor" });
  });

  it("au plus 32 fenêtres (les plus à l'avant)", () => {
    const items = Array.from({ length: 40 }, (_, i) => mission(`m${i}`));
    const layout = lay.serialize(items);
    expect(layout.windows).toHaveLength(32);
    expect(layout.windows.at(-1).id).toBe("m39");
    expect(serverValidate(layout)).not.toBeNull();
  });

  it("nom invalide : repli sur le nom par défaut", () => {
    expect(lay.serialize([], "x".repeat(41)).spaces[0].name).toBe(lay.DEFAULT_NAME);
    expect(lay.serialize([], " Recon").spaces[0].name).toBe(lay.DEFAULT_NAME);
  });
});

describe("espaces : refus au-delà des bornes (miroir du serveur)", () => {
  const ok = {
    windows: [{ id: "a", view: "chat", x: 0, y: 0, w: 1, h: 1 }],
    spaces: [{ id: "main", name: "Recon" }],
  };
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `w${i}`,
      view: "chat",
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    }));
  const cases: [string, unknown][] = [
    ["33 fenêtres", { ...ok, windows: many(33) }],
    [
      "21 espaces",
      { ...ok, spaces: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: "n" })) },
    ],
    ["fraction > 1", { ...ok, windows: [{ ...ok.windows[0], w: 1.2 }] }],
    ["fraction négative", { ...ok, windows: [{ ...ok.windows[0], x: -0.1 }] }],
    ["fraction NaN", { ...ok, windows: [{ ...ok.windows[0], x: Number.NaN }] }],
    ["vue inconnue", { ...ok, windows: [{ ...ok.windows[0], view: "evil" }] }],
    ["id invalide", { ...ok, windows: [{ ...ok.windows[0], id: "../x" }] }],
    ["même vue et même id", { ...ok, windows: [ok.windows[0], { ...ok.windows[0] }] }],
    ["état inconnu", { ...ok, windows: [{ ...ok.windows[0], state: "hidden" }] }],
    ["mode invalide", { ...ok, windows: [{ ...ok.windows[0], mode: "../x" }] }],
    ["nom de 41 caractères", { ...ok, spaces: [{ id: "main", name: "x".repeat(41) }] }],
    ["nom avec contrôle", { ...ok, spaces: [{ id: "main", name: "a\u0000b" }] }],
    ["nom vide", { ...ok, spaces: [{ id: "main", name: "" }] }],
    ["pas un objet", "x"],
    ["fenêtres absentes", { spaces: [] }],
  ];
  for (const [label, layout] of cases) {
    it(`refuse : ${label}`, () => {
      expect(lay.validateLayout(layout)).toBeNull();
      expect(serverValidate(layout)).toBeNull();
    });
  }

  it("même identifiant dans deux vues : accepté", () => {
    const layout = { ...ok, windows: [ok.windows[0], { ...ok.windows[0], view: "viewer" }] };
    expect(lay.validateLayout(layout)).not.toBeNull();
    expect(serverValidate(layout)).not.toBeNull();
  });

  it("32 fenêtres et 20 espaces passent", () => {
    const layout = {
      windows: many(32),
      spaces: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `n${i}` })),
    };
    expect(lay.validateLayout(layout)).not.toBeNull();
    expect(serverValidate(layout)).not.toBeNull();
  });

  it("une réponse du serveur illisible est écartée entrée par entrée", () => {
    const parsed = lay.parseLayouts({
      current: { windows: [], spaces: [{ id: "main", name: "Recon" }] },
      saved: [
        { name: "Bon", layout: ok },
        { name: "Mauvais", layout: { windows: many(99), spaces: [] } },
        { name: "", layout: ok },
        "x",
      ],
    });
    expect(parsed.current).not.toBeNull();
    expect(parsed.saved.map((s: { name: string }) => s.name)).toEqual(["Bon"]);
    expect(lay.parseLayouts(null)).toEqual({ current: null, saved: [] });
    expect(lay.spaceNameOf(parsed.current)).toBe("Recon");
  });

  it("nom saisi : espaces de bordure retirés, invalide refusé", () => {
    expect(lay.cleanName("  Recon  ")).toBe("Recon");
    expect(lay.cleanName("")).toBeNull();
    expect(lay.cleanName("x".repeat(41))).toBeNull();
    expect(lay.cleanName("a\nb")).toBeNull();
    expect(lay.cleanName(3)).toBeNull();
  });
});

describe("espaces : application différentielle", () => {
  const layout = lay.serialize([mission("m1"), native("journal")], "Exploitation");

  it("ferme ce qui n'est pas dans l'espace, garde le reste", () => {
    const plan = lay.planApply(layout, ["chat:m1", "chat:m9", "native:approvals"]);
    expect(plan.close).toEqual(["chat:m9", "native:approvals"]);
    expect(plan.minimize).toEqual([]);
  });

  it("ne ferme jamais un terminal actif : il est minimisé", () => {
    const plan = lay.planApply(layout, ["chat:m1", "term:t1", "chat:m9"], (k: string) =>
      k.startsWith("term:"),
    );
    expect(plan.close).toEqual(["chat:m9"]);
    expect(plan.minimize).toEqual(["term:t1"]);
  });

  it("restaure un terminal (vue `term`) sur le choix du conteneur", () => {
    const plan = lay.planApply(
      {
        windows: [{ id: "t1", view: "term", x: 0, y: 0, w: 1, h: 1 }],
        spaces: [{ id: "main", name: "x" }],
      },
      [],
    );
    expect(plan.windows.map((w: { spec: { key: string } }) => w.spec.key)).toEqual(["term:t1"]);
  });

  it("applyPlan : ferme, minimise, pose la géométrie des ouvertes, ouvre les absentes, dans l'ordre", () => {
    const calls: string[] = [];
    const open = new Set(["chat:m1", "chat:m9", "term:t1"]);
    const desktop = {
      has: (k: string) => open.has(k),
      close: (k: string) => calls.push(`close ${k}`),
      minimize: (k: string) => calls.push(`min ${k}`),
      focus: (k: string) => calls.push(`focus ${k}`),
      setGeometry: (k: string) => calls.push(`geo ${k}`),
      open: (spec: { key: string }) => calls.push(`open ${spec.key}`),
    };
    const plan = lay.planApply(layout, [...open], (k: string) => k.startsWith("term:"));
    lay.applyPlan(desktop, plan);
    expect(calls).toEqual([
      "close chat:m9",
      "min term:t1",
      "geo chat:m1",
      "focus chat:m1",
      "open native:journal",
    ]);
  });

  it("applyPlan : une fenêtre minimisée dans l'espace l'est après la pose des autres", () => {
    const calls: string[] = [];
    const desktop = {
      has: () => false,
      close: () => {},
      minimize: (k: string) => calls.push(`min ${k}`),
      focus: () => {},
      setGeometry: () => {},
      open: (spec: { key: string }) => calls.push(`open ${spec.key}`),
    };
    const saved = lay.serialize([{ ...mission("m1"), minimized: true }, native("journal")]);
    lay.applyPlan(desktop, lay.planApply(saved, []));
    expect(calls).toEqual(["open chat:m1", "open native:journal", "min chat:m1"]);
  });

  it("grille : sans trou ni recouvrement", () => {
    expect(lay.gridFractions(0)).toEqual([]);
    expect(lay.gridFractions(1)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
    const g = lay.gridFractions(3);
    expect(g).toHaveLength(3);
    // 3 fenêtres : deux en haut, une pleine largeur en bas.
    expect(g[2]).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
    for (const r of lay.gridFractions(7)) {
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe("espaces : enregistrement 1 s après le dernier changement", () => {
  const make = () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const saver = lay.createLayoutSaver({ send });
    saver.enable(true);
    return { send, saver };
  };
  const L = (n: number) => lay.serialize([mission("m1", { x: 0, y: 0, w: n / 10, h: 0.5 })]);

  it("un seul envoi, 1 s après le dernier changement", () => {
    const { send, saver } = make();
    saver.schedule(L(1));
    vi.advanceTimersByTime(900);
    saver.schedule(L(2));
    vi.advanceTimersByTime(900);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(L(2));
    vi.useRealTimers();
  });

  it("n'envoie rien si la disposition est celle déjà connue", () => {
    const { send, saver } = make();
    saver.setBaseline(L(3));
    saver.schedule(L(3));
    vi.advanceTimersByTime(1500);
    expect(send).not.toHaveBeenCalled();
    saver.schedule(L(4));
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("inactif avant la lecture initiale, et désactivable", () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const saver = lay.createLayoutSaver({ send });
    saver.schedule(L(1));
    vi.advanceTimersByTime(2000);
    expect(send).not.toHaveBeenCalled();
    saver.enable(true);
    saver.schedule(L(1));
    saver.enable(false);
    vi.advanceTimersByTime(2000);
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("hors ligne : rien n'est mémorisé comme envoyé, le prochain changement repart", () => {
    vi.useFakeTimers();
    let online = false;
    const send = vi.fn(() => online);
    const saver = lay.createLayoutSaver({ send });
    saver.enable(true);
    saver.schedule(L(1));
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    online = true;
    saver.schedule(L(1));
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
