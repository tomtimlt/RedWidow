import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MITRE_TACTICS as CORE_TACTICS } from "@warband/core";
import { describe, expect, it } from "vitest";
import { studioHtml } from "../src/logic/html.js";
import { parseStudioMessage, STUDIO_PAGES, studioLabel } from "../src/logic/studio.js";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  current: boolean;
  count?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface StudioApi {
  STUDIO_GROUPS: { label: string; pages: [string, string, string][] }[];
  MITRE_TACTICS: [string, string][];
  killchainCount(findings: unknown): number | null;
  killchainModel(findings: unknown): {
    columns: { tactic: string | null; label: string; nodes: { id: string }[] }[];
    edges: { from: string; to: string }[];
  };
  navModel(current: string, findings: unknown): NavGroup[];
  killchainGraph(findings: unknown): {
    nodes: {
      id: string;
      kind: string;
      state: string;
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    edges: { from: string; to: string }[];
    width: number;
    height: number;
  };
}

const studioJs = fileURLToPath(new URL("../media/studio.js", import.meta.url));
const chatCss = fileURLToPath(new URL("../media/chat.css", import.meta.url));
createRequire(import.meta.url)(studioJs);
const studio = (globalThis as unknown as { WarbandStudio: StudioApi }).WarbandStudio;
const read = (p: string) => readFileSync(p, "utf8");

const FINDING = { kind: "host", state: "confirmed" };
const findings = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, label: `Nœud ${i}`, ...FINDING }));

describe("réglages", () => {
  it("accepte open, refresh, unlink et refuse le reste", () => {
    expect(parseStudioMessage({ type: "open", page: "project" })).toEqual({
      type: "open",
      page: "project",
    });
    expect(parseStudioMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(parseStudioMessage({ type: "unlink" })).toEqual({ type: "unlink" });
    expect(parseStudioMessage({ type: "openKillchain" })).toEqual({ type: "openKillchain" });
    expect(parseStudioMessage({ type: "open", page: "nope" })).toBeNull();
    expect(parseStudioMessage({ type: "send", text: "x" })).toBeNull();
  });

  it("openCours : sans aucun champ (le chemin vient de l'hôte)", () => {
    expect(parseStudioMessage({ type: "openCours" })).toEqual({ type: "openCours" });
    expect(parseStudioMessage({ type: "openCours", path: "/etc" })).toBeNull();
    expect(parseStudioMessage({ type: "openCours", enabled: true })).toBeNull();
  });

  it("HTML : nonce, pas de style inline", () => {
    const html = studioHtml({
      nonce: "abc",
      cspSource: "https://example.test",
      scriptUri: "https://example.test/studio.js",
      styleUri: "https://example.test/chat.css",
    });
    expect(html).toContain("nonce-abc");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("<style");
  });

  it("studio.js n'injecte pas de HTML", () => {
    const src = read(studioJs);
    expect(src).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|requestAnimationFrame|setInterval/,
    );
    expect(src).not.toMatch(/\.style\.(?!setProperty)/);
  });
});

describe("navigation en deux groupes", () => {
  it("Engagement puis Système, dans cet ordre, avec le contenu exact", () => {
    expect(studio.STUDIO_GROUPS.map((g) => g.label)).toEqual(["Engagement", "Système"]);
    const [engagement, system] = studio.STUDIO_GROUPS;
    expect(engagement?.pages.map((p) => p[0])).toEqual([
      "project",
      "containers",
      "providers",
      "personas",
      "approvals",
      "killchain",
    ]);
    expect(system?.pages.map((p) => p[0])).toEqual([
      "model",
      "harness",
      "mcp",
      "atlas",
      "layout",
      "modes",
      "system",
    ]);
  });

  it("chaque page existante apparaît une seule fois, avec son libellé d'origine", () => {
    const keys = studio.STUDIO_GROUPS.flatMap((g) => g.pages.map((p) => p[0]));
    expect([...keys].sort()).toEqual([...STUDIO_PAGES].sort());
    for (const [key, label, icon] of studio.STUDIO_GROUPS.flatMap((g) => g.pages)) {
      expect(label).toBe(studioLabel(key as (typeof STUDIO_PAGES)[number]));
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("navModel marque l'entrée courante seule", () => {
    const groups = studio.navModel("atlas", []);
    const current = groups.flatMap((g) => g.items).filter((i) => i.current);
    expect(current.map((i) => i.id)).toEqual(["atlas"]);
  });

  it("aucune entrée Licence, aucune pastille de statut", () => {
    const items = studio.navModel("project", findings(2)).flatMap((g) => g.items);
    for (const item of items) {
      expect(item.label).not.toMatch(/licen[cs]e/i);
      expect(Object.keys(item).sort()).toEqual(
        item.count === undefined
          ? ["current", "icon", "id", "label"]
          : ["count", "current", "icon", "id", "label"],
      );
    }
    expect(read(studioJs)).not.toMatch(/licen[cs]e/i);
  });

  it("libellés en textContent (jamais de HTML), sans icône de navigation", () => {
    expect(read(studioJs)).not.toMatch(/studio-ico/);
    expect(read(studioJs)).toMatch(/el\("span", "btn-text", item\.label\)/);
  });
});

describe("compteur Kill chain", () => {
  it("nombre réel de trouvailles, présent avec N", () => {
    expect(studio.killchainCount(findings(3))).toBe(3);
    const kill = studio
      .navModel("killchain", findings(3))
      .flatMap((g) => g.items)
      .find((i) => i.id === "killchain");
    expect(kill?.count).toBe(3);
  });

  it("absent à 0, sur une liste vide ou une donnée absente", () => {
    expect(studio.killchainCount([])).toBeNull();
    expect(studio.killchainCount(undefined)).toBeNull();
    expect(studio.killchainCount(null)).toBeNull();
    for (const f of [[], undefined]) {
      const kill = studio
        .navModel("project", f)
        .flatMap((g) => g.items)
        .find((i) => i.id === "killchain");
      expect(kill).toBeDefined();
      expect(kill && "count" in kill).toBe(false);
    }
  });

  it("aucun autre élément ne porte de compteur", () => {
    const counted = studio
      .navModel("project", findings(5))
      .flatMap((g) => g.items)
      .filter((i) => i.count !== undefined);
    expect(counted.map((i) => i.id)).toEqual(["killchain"]);
  });
});

describe("feuille des réglages", () => {
  const css = read(chatCss);

  it("groupes en capitales, teinte et filet d'accent sur l'entrée courante", () => {
    expect(css).toMatch(/\.studio-group-title \{[^}]*text-transform: uppercase/);
    expect(css).toMatch(/\.studio-nav-btn\.is-current,[^{]*\{[^}]*background: var\(--jn-tint\)/);
    expect(css).toMatch(
      /\.studio-nav-btn\.is-current,[^{]*\{[^}]*border-left-color: var\(--jn-accent\)/,
    );
  });

  it("cartes au rayon lg, navigation en rangée sous 640 px", () => {
    expect(css).toMatch(/\.studio-card \{[^}]*border-radius: var\(--jn-r-lg\)/);
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*#studio-nav \{\s*flex-direction: row;/,
    );
  });
});

describe("modèle du graphe Kill chain", () => {
  const f = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "step",
    label: id,
    state: "confirmed",
    ...extra,
  });

  it("MITRE_TACTICS de studio.js suit celui du cœur, dans l'ordre", () => {
    expect(studio.MITRE_TACTICS.map((t) => t[0])).toEqual([...CORE_TACTICS]);
    for (const [, name] of studio.MITRE_TACTICS) expect(name.length).toBeGreaterThan(0);
  });

  it("colonnes dans l'ordre ATT&CK, ordre d'arrivée conservé, aucune colonne vide", () => {
    const m = studio.killchainModel([
      f("a", { tactic: "TA0040" }),
      f("b", { tactic: "TA0001" }),
      f("c", { tactic: "TA0040" }),
    ]);
    expect(m.columns.map((c) => c.tactic)).toEqual(["TA0001", "TA0040"]);
    expect(m.columns[1]?.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(m.columns[0]?.label).toBe("Initial Access");
  });

  it("« Non classé » en dernier, seulement si nécessaire", () => {
    const m = studio.killchainModel([
      f("a"),
      f("b", { tactic: "TA9999" }),
      f("c", { tactic: "TA0001" }),
    ]);
    expect(m.columns.map((c) => c.tactic)).toEqual(["TA0001", null]);
    expect(m.columns[1]?.label).toBe("Non classé");
    expect(m.columns[1]?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(studio.killchainModel([f("c", { tactic: "TA0001" })]).columns).toHaveLength(1);
  });

  it("arêtes parent vers enfant, pendantes ignorées", () => {
    const m = studio.killchainModel([f("a"), f("b", { from: ["a", "disparu"] })]);
    expect(m.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("entrée invalide : rien", () => {
    for (const bad of [undefined, null, "x", 3, {}]) {
      expect(studio.killchainModel(bad)).toEqual({ columns: [], edges: [] });
    }
  });
});

describe("killchainGraph (disposition du graphe)", () => {
  const f = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: "step",
    state: "confirmed",
    label: id,
    ...over,
  });

  it("entrée non tableau : vide", () => {
    for (const bad of [null, undefined, 42, "x", {}]) {
      expect(studio.killchainGraph(bad)).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
    }
  });

  it("une chaîne a -> b -> c est mise en couches de gauche à droite", () => {
    const g = studio.killchainGraph([f("a"), f("b", { from: ["a"] }), f("c", { from: ["b"] })]);
    const x = new Map(g.nodes.map((n) => [n.id, n.x]));
    const at = (id: string) => x.get(id) ?? Number.NaN;
    expect(at("a")).toBeLessThan(at("b"));
    expect(at("b")).toBeLessThan(at("c"));
    expect(g.edges).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it("un enfant à deux parents est placé après les deux", () => {
    const g = studio.killchainGraph([f("a"), f("b"), f("c", { from: ["a", "b"] })]);
    const x = new Map(g.nodes.map((n) => [n.id, n.x]));
    const at = (id: string) => x.get(id) ?? Number.NaN;
    expect(at("c")).toBeGreaterThan(at("a"));
    expect(at("c")).toBeGreaterThan(at("b"));
  });

  it("arête vers un parent inconnu ignorée, arc arrière n'empêche pas la disposition", () => {
    const g = studio.killchainGraph([
      f("a", { from: ["zzz"] }),
      f("b", { from: ["a"] }),
      f("a2", { from: ["b"], id: "a2" }),
    ]);
    // Parent inconnu zzz absent des arêtes.
    expect(g.edges.some((e) => e.from === "zzz")).toBe(false);
    expect(g.nodes).toHaveLength(3);
    // Cycle (a -> b -> a) : ne boucle pas, tous les nœuds sont placés une fois.
    const cyc = studio.killchainGraph([f("a", { from: ["b"] }), f("b", { from: ["a"] })]);
    expect(cyc.nodes).toHaveLength(2);
    expect(cyc.edges).toHaveLength(2);
  });

  it("conserve kind/state/label et ignore les doublons d'id", () => {
    const g = studio.killchainGraph([
      f("a", { kind: "host", state: "failed", label: "cible" }),
      f("a", { label: "doublon" }),
    ]);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ id: "a", kind: "host", state: "failed", label: "cible" });
  });
});
