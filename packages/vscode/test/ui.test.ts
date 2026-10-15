import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface UiApi {
  listboxKey(s: { active: number }, key: string, o: { disabled?: boolean }[]): { active: number };
  filterModels<T extends { label: string; value: string | null; description: string }>(
    m: T[],
    q: string,
  ): T[];
  placePopover(
    a: { left: number; top: number; bottom: number },
    s: { width: number; height: number },
    v: { width: number; height: number },
    margin?: number,
  ): { x: number; y: number; side: string; maxHeight: number; width: number };
  effortPct(i: number, n: number): number;
  tabTarget(count: number, current: number, shift: boolean): number;
  bodyClasses(
    v: { busy: boolean; approvals: unknown[]; readonly: unknown },
    e: { hidden: boolean; reducedMotion: boolean },
  ): string[];
  activityLabel(v: { busy: boolean; approvals: unknown[]; items: unknown[] }): string;
  shouldSweep(prev: string | null | undefined, next: string | null): boolean;
}
// Le paquet est « type: module » : ui.js est évalué comme script sans `module`, il se publie donc sur globalThis (comme dans la webview).
createRequire(import.meta.url)("../media/ui.js");
const ui = (globalThis as unknown as { JohnUI: UiApi }).JohnUI;

const opts = (...disabled: boolean[]) => disabled.map((d) => ({ disabled: d }));

describe("listboxKey : navigation clavier", () => {
  it("flèches : saute les options désactivées et boucle", () => {
    const o = opts(false, true, false, false);
    expect(ui.listboxKey({ active: 0 }, "ArrowDown", o).active).toBe(2);
    expect(ui.listboxKey({ active: 3 }, "ArrowDown", o).active).toBe(0);
    expect(ui.listboxKey({ active: 0 }, "ArrowUp", o).active).toBe(3);
    expect(ui.listboxKey({ active: 2 }, "ArrowUp", o).active).toBe(0);
  });
  it("depuis « aucune » : bas = première, haut = dernière activable", () => {
    const o = opts(true, false, false, true);
    expect(ui.listboxKey({ active: -1 }, "ArrowDown", o).active).toBe(1);
    expect(ui.listboxKey({ active: -1 }, "ArrowUp", o).active).toBe(2);
  });
  it("Début / Fin ignorent les désactivées", () => {
    const o = opts(true, false, false, true);
    expect(ui.listboxKey({ active: 2 }, "Home", o).active).toBe(1);
    expect(ui.listboxKey({ active: 1 }, "End", o).active).toBe(2);
  });
  it("liste vide ou entièrement désactivée : aucune option active", () => {
    expect(ui.listboxKey({ active: 0 }, "ArrowDown", []).active).toBe(-1);
    expect(ui.listboxKey({ active: 1 }, "End", opts(true, true)).active).toBe(-1);
  });
  it("autre touche : état conservé ; actif devenu désactivé : ramené à aucun", () => {
    expect(ui.listboxKey({ active: 1 }, "a", opts(false, false)).active).toBe(1);
    expect(ui.listboxKey({ active: 1 }, "a", opts(false, true)).active).toBe(-1);
  });
});

describe("filterModels", () => {
  const models = [
    { value: "modele-a", label: "Modèle A", description: "Rapide" },
    { value: "autre", label: "Autre", description: "Pensif .*(" },
    { value: null, label: "Défaut", description: "" },
  ];
  it("sous-chaîne insensible à la casse sur libellé, valeur et description", () => {
    expect(ui.filterModels(models, "MODÈLE").map((m) => m.label)).toEqual(["Modèle A"]);
    expect(ui.filterModels(models, "autre").map((m) => m.label)).toEqual(["Autre"]);
    expect(ui.filterModels(models, "rapide")).toHaveLength(1);
    expect(ui.filterModels(models, "  ")).toHaveLength(3);
  });
  it("jamais de RegExp : « .*( » est littéral", () => {
    expect(ui.filterModels(models, ".*(").map((m) => m.label)).toEqual(["Autre"]);
    expect(ui.filterModels(models, "(")).toHaveLength(1);
    expect(ui.filterModels(models, "[")).toHaveLength(0);
  });
});

describe("placePopover", () => {
  const vp = { width: 800, height: 600 };
  it("au-dessus de l'ancre par défaut", () => {
    const p = ui.placePopover(
      { left: 100, top: 500, bottom: 528 },
      { width: 300, height: 200 },
      vp,
    );
    expect(p.side).toBe("above");
    expect(p.y + 200).toBeLessThanOrEqual(500);
    expect(p.x).toBe(100);
  });
  it("bascule dessous si la place manque au-dessus", () => {
    const p = ui.placePopover({ left: 10, top: 40, bottom: 68 }, { width: 300, height: 200 }, vp);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThanOrEqual(68);
  });
  it("recale aux deux bords horizontaux", () => {
    const right = ui.placePopover(
      { left: 700, top: 500, bottom: 528 },
      { width: 300, height: 100 },
      vp,
    );
    expect(right.x + 300).toBeLessThanOrEqual(792);
    const left = ui.placePopover(
      { left: -50, top: 500, bottom: 528 },
      { width: 300, height: 100 },
      vp,
    );
    expect(left.x).toBe(8);
  });
  it("viewport de 280 px plus étroit que le popover : largeur réduite, jamais hors écran", () => {
    const p = ui.placePopover(
      { left: 200, top: 400, bottom: 428 },
      { width: 560, height: 300 },
      { width: 280, height: 500 },
    );
    expect(p.width).toBe(264);
    expect(p.x).toBe(8);
    expect(p.x + p.width).toBeLessThanOrEqual(272);
  });
  it("trop haut des deux côtés : côté le plus spacieux, hauteur plafonnée", () => {
    const p = ui.placePopover(
      { left: 8, top: 300, bottom: 328 },
      { width: 300, height: 900 },
      { width: 400, height: 600 },
    );
    expect(p.maxHeight).toBeLessThan(900);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + Math.min(900, p.maxHeight)).toBeLessThanOrEqual(592);
  });
});

describe("autres utilitaires", () => {
  it("effortPct", () => {
    expect(ui.effortPct(0, 6)).toBe(0);
    expect(ui.effortPct(5, 6)).toBe(100);
    expect(ui.effortPct(1, 6)).toBe(20);
    expect(ui.effortPct(3, 1)).toBe(0);
  });
  it("tabTarget cycle dans les deux sens", () => {
    expect(ui.tabTarget(3, 2, false)).toBe(0);
    expect(ui.tabTarget(3, 0, true)).toBe(2);
    expect(ui.tabTarget(3, -1, false)).toBe(0);
    expect(ui.tabTarget(3, -1, true)).toBe(2);
    expect(ui.tabTarget(0, 0, false)).toBe(-1);
  });
});

describe("états -> classes de body", () => {
  const idle = { busy: false, approvals: [], readonly: null, items: [] };
  const env = { hidden: false, reducedMotion: false };
  it("repos : aucune classe", () => expect(ui.bodyClasses(idle, env)).toEqual([]));
  it("run actif", () => expect(ui.bodyClasses({ ...idle, busy: true }, env)).toEqual(["running"]));
  it("approbation en attente : figé", () => {
    const v = { ...idle, busy: true, approvals: [{}] };
    expect(ui.bodyClasses(v, env)).toEqual(["running", "waiting"]);
  });
  it("vue cachée et mouvement réduit s'ajoutent", () => {
    expect(ui.bodyClasses({ ...idle, busy: true }, { hidden: true, reducedMotion: true })).toEqual([
      "running",
      "paused",
      "reduce-motion",
    ]);
  });
  it("lecture seule : jamais running", () => {
    expect(ui.bodyClasses({ ...idle, busy: true, readonly: { title: "x" } }, env)).toEqual([
      "readonly",
    ]);
  });
});

describe("libellé du thinking", () => {
  const base = { busy: true, approvals: [], items: [] as unknown[] };
  it("repos : vide", () => expect(ui.activityLabel({ ...base, busy: false })).toBe(""));
  it("réflexion par défaut", () => expect(ui.activityLabel(base)).toBe("Réflexion"));
  it("dernier outil en attente", () => {
    const items = [
      { kind: "tool", status: "pending", label: "Lecture" },
      { kind: "tool", status: "ok", label: "Glob" },
      { kind: "tool", status: "pending", label: "Commande" },
    ];
    expect(ui.activityLabel({ ...base, items })).toBe("Outil : Commande");
  });
  it("approbation en attente : prioritaire", () => {
    expect(ui.activityLabel({ ...base, approvals: [{}] })).toBe("En attente de votre accord");
  });
});

describe("balayage de changement de modèle", () => {
  it("première vue : pas de balayage", () => expect(ui.shouldSweep(undefined, null)).toBe(false));
  it("valeur inchangée (choix refusé par l'extension) : pas de balayage", () => {
    expect(ui.shouldSweep("a", "a")).toBe(false);
    expect(ui.shouldSweep(null, null)).toBe(false);
  });
  it("valeur acceptée : balayage", () => {
    expect(ui.shouldSweep("a", "b")).toBe(true);
    expect(ui.shouldSweep(null, "b")).toBe(true);
    expect(ui.shouldSweep("a", null)).toBe(true);
  });
});
