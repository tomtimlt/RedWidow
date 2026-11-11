import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { EngineEvent } from "@warband/core";
import { MITRE_TACTICS as CORE_TACTICS } from "@warband/core";
import { createUiTranslator } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { studioHtml } from "../src/logic/html.js";
import {
  observeMission,
  parseStudioMessage,
  STUDIO_PAGES,
  studioGroup,
  studioLabel,
} from "../src/logic/studio.js";
import { readCss } from "./css.js";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  current: boolean;
  count?: number;
  action?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface StudioApi {
  COVERAGE_STATES: string[];
  coverageModel(
    coverage: unknown,
    filter: unknown,
  ): {
    total: number;
    percent: number;
    counts: Record<string, number>;
    filter: string | null;
    rows: { surface: string; state: string }[];
  };
  STUDIO_GROUPS: { label: string; pages: [string, string, string, string?][] }[];
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
  KC_PAD: number;
  KC_MINIMAP: { maxW: number; maxH: number; minViewportW: number };
  killchainMinimap(
    graph: { nodes: unknown[]; width: number; height: number },
    viewport: { width: number; height: number },
    view: { scale: number; tx: number; ty: number },
  ): {
    visible: boolean;
    width: number;
    height: number;
    ratio: number;
    rects: { id: string; state: string; x: number; y: number; w: number; h: number }[];
    zone: { x: number; y: number; w: number; h: number } | null;
  };
  killchainMinimapRecenter(
    minimap: unknown,
    viewport: { width: number; height: number },
    view: { scale: number; tx: number; ty: number },
    px: number,
    py: number,
  ): { tx: number; ty: number };
  killchainLegend(findings: unknown): {
    label: string;
    entries: { kind?: string; state?: string; label: string; count: number }[];
  }[];
}

const studioJs = fileURLToPath(new URL("../media/studio.js", import.meta.url));
createRequire(import.meta.url)(studioJs);
const studio = (globalThis as unknown as { WarbandStudio: StudioApi }).WarbandStudio;
const read = (p: string) => readFileSync(p, "utf8");

const FINDING = { kind: "host", state: "confirmed" };
const findings = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, label: `Nœud ${i}`, ...FINDING }));

describe("réglages", () => {
  it("traduit les indications d'état des conteneurs", () => {
    const english = createUiTranslator(() => "en");
    expect(english("Mise à jour des conteneurs…")).toBe("Updating containers…");
    expect(english("État des conteneurs indisponible.")).toBe("Container status unavailable.");
  });
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

  it("openCockpit ouvre la vue de gestion sans accepter de commande arbitraire", () => {
    expect(parseStudioMessage({ type: "openCockpit" })).toEqual({ type: "openCockpit" });
    expect(parseStudioMessage({ type: "openCockpit", command: "docker stop" })).toBeNull();
  });

  it("openCours : sans aucun champ (le chemin vient de l'hôte)", () => {
    expect(parseStudioMessage({ type: "openCours" })).toEqual({ type: "openCours" });
    expect(parseStudioMessage({ type: "openCours", path: "/etc" })).toBeNull();
    expect(parseStudioMessage({ type: "openCours", enabled: true })).toBeNull();
  });

  it("comptes : accepte uniquement un compte borné du projet actif", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const message = {
      type: "saveTestAccount",
      projectId,
      account: {
        label: "A",
        host: "",
        identifier: "alice@example.com",
        secret: "xy",
        kind: "password",
      },
    };
    expect(parseStudioMessage(message)).toEqual(message);
    expect(
      parseStudioMessage({ ...message, account: { ...message.account, extra: "refus" } }),
    ).toBeNull();
    expect(parseStudioMessage({ ...message, projectId: "../autre" })).toBeNull();
  });

  it("résumé : id canonique, taille UTF-8 bornée et aucun champ supplémentaire", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const message = { type: "saveSummary", projectId, text: "é".repeat(4096) };
    expect(parseStudioMessage(message)).toEqual(message);
    expect(parseStudioMessage({ ...message, text: "é".repeat(4097) })).toBeNull();
    expect(parseStudioMessage({ ...message, text: "" })).toEqual({ ...message, text: "" });
    expect(parseStudioMessage({ ...message, projectId: "../autre" })).toBeNull();
    expect(parseStudioMessage({ ...message, path: "/tmp" })).toBeNull();
    expect(parseStudioMessage({ ...message, text: null })).toBeNull();
  });

  it("projets : nom borné et id canonique, aucun chemin accepté de la webview", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(parseStudioMessage({ type: "activateProject", projectId })).toEqual({
      type: "activateProject",
      projectId,
    });
    expect(parseStudioMessage({ type: "activateProject", projectId: "../autre" })).toBeNull();
    expect(parseStudioMessage({ type: "activateProject", projectId, extra: true })).toBeNull();
    expect(parseStudioMessage({ type: "createProject", name: " Mission " })).toEqual({
      type: "createProject",
      name: "Mission",
    });
    for (const name of ["", "  ", "x".repeat(81), "a\nb", "a\0b"]) {
      expect(parseStudioMessage({ type: "createProject", name })).toBeNull();
    }
    expect(
      parseStudioMessage({ type: "createProject", name: "Mission", workspace: "/etc" }),
    ).toBeNull();
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

describe("navigation en deux rubriques", () => {
  it("Projet puis Global, avec le contenu exact", () => {
    expect(studio.STUDIO_GROUPS.map((g) => g.label)).toEqual(["Projet", "Global"]);
    const [project, global] = studio.STUDIO_GROUPS;
    expect(project?.pages.map((p) => p[0])).toEqual([
      "project",
      "accounts",
      "program",
      "engagement",
      "containers",
      "audit",
      "integrations",
    ]);
    expect(global?.pages.map((p) => p[0])).toEqual(["appearance", "providers", "system", "atlas"]);
  });

  it("la rubrique de chaque page suit studioGroup, et la fiche programme ouvre la page existante", () => {
    for (const [index, group] of studio.STUDIO_GROUPS.entries()) {
      for (const [key, , , action] of group.pages) {
        if (action !== undefined) {
          expect(["openProgram", "openEngagement"]).toContain(action);
          continue;
        }
        expect(studioGroup(key as (typeof STUDIO_PAGES)[number])).toBe(
          index === 0 ? "project" : "global",
        );
      }
    }
    expect(parseStudioMessage({ type: "openProgram" })).toEqual({ type: "openProgram" });
    expect(parseStudioMessage({ type: "open", page: "providers" })).toEqual({
      type: "open",
      page: "providers",
    });
  });

  it("chaque page existante apparaît une seule fois, avec son libellé d'origine", () => {
    const entries = studio.STUDIO_GROUPS.flatMap((g) => g.pages).filter((p) => p[3] === undefined);
    // La Kill chain a son propre panneau : elle reste un type de page mais n'est plus dans la nav.
    expect([...entries.map((p) => p[0])].sort()).toEqual(
      STUDIO_PAGES.filter((page) => page !== "killchain").sort(),
    );
    for (const [key, label, icon] of entries) {
      expect(label).toBe(studioLabel(key as (typeof STUDIO_PAGES)[number]));
      expect([
        "project",
        "shield",
        "container",
        "graph",
        "book",
        "server",
        "palette",
        "history",
        "sliders",
        "settings",
      ]).toContain(icon);
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
        [
          ...(item.count === undefined ? [] : ["count"]),
          ...(item.action === undefined ? [] : ["action"]),
          "current",
          "icon",
          "id",
          "label",
        ].sort(),
      );
    }
    expect(read(studioJs)).not.toMatch(/licen[cs]e/i);
  });

  it("libellés en textContent (jamais de HTML), sans icône dans la nav", () => {
    expect(read(studioJs)).not.toMatch(/studio-ico/);
    expect(read(studioJs)).toMatch(/el\("span", "btn-text", item\.label\)/);
    expect(read(studioJs)).toMatch(/el\("span", "kc-node-ico"/);
  });
});

describe("Kill chain hors des réglages", () => {
  it("compte les trouvailles pour le panneau autonome", () => {
    expect(studio.killchainCount(findings(3))).toBe(3);
    expect(studio.killchainCount([])).toBeNull();
    expect(studio.killchainCount(undefined)).toBeNull();
    expect(studio.killchainCount(null)).toBeNull();
  });

  it("la navigation des réglages n'a plus d'entrée ni de compteur Kill chain", () => {
    const items = studio.navModel("project", findings(5)).flatMap((g) => g.items);
    expect(items.some((i) => i.id === "killchain")).toBe(false);
    expect(items.filter((i) => i.count !== undefined)).toEqual([]);
  });
});

describe("feuille des réglages", () => {
  const css = readCss();

  it("groupes en capitales, sélection neutre et indicateur d’entrée courante", () => {
    expect(css).toMatch(/\.studio-group-title[\s\S]*?text-transform: uppercase/);
    expect(css).toMatch(/\.studio-nav-btn\.is-current[\s\S]*?var\(--jn-sig/);
    expect(css).toContain("--vscode-list-activeSelectionForeground");
  });

  it("cartes au rayon lg, navigation en rangée sous 640 px", () => {
    expect(css).toMatch(/\.studio-card \{[^}]*border-radius: var\(--jn-r-lg\)/);
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*#studio-nav \{\s*flex-direction: row;/,
    );
  });

  it("les libellés des réglages restent visibles sous 360 px malgré le mode compact du chat", () => {
    const body = /\.studio-shell \.btn-text\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(body).toBeDefined();
    for (const declaration of [
      "position: static",
      "width: auto",
      "height: auto",
      "overflow: visible",
      "clip-path: none",
      "white-space: normal",
    ])
      expect(body).toContain(declaration);
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

describe("killchainMinimap (géométrie pure)", () => {
  const f = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: "step",
    state: "confirmed",
    label: id,
    ...over,
  });
  const graph = () =>
    studio.killchainGraph([f("a"), f("b", { from: ["a"] }), f("c", { from: ["b"] })]);
  const gw = () => graph().width + studio.KC_PAD * 2;
  const gh = () => graph().height + studio.KC_PAD * 2;

  it("masquée si le graphe tient entièrement dans le viewport", () => {
    const m = studio.killchainMinimap(
      graph(),
      { width: 1200, height: 800 },
      { scale: 1, tx: 0, ty: 0 },
    );
    expect(m.visible).toBe(false);
    expect(m.rects).toEqual([]);
  });

  it("masquée si le viewport fait moins de 640 px de large, ou si le graphe est vide", () => {
    const view = { scale: 2, tx: 0, ty: 0 };
    expect(studio.killchainMinimap(graph(), { width: 639, height: 300 }, view).visible).toBe(false);
    expect(studio.killchainMinimap(graph(), { width: 640, height: 300 }, view).visible).toBe(true);
    const empty = studio.killchainGraph([]);
    expect(studio.killchainMinimap(empty, { width: 900, height: 600 }, view).visible).toBe(false);
  });

  it("un rectangle par nœud avec son état, dans le gabarit maximal", () => {
    const m = studio.killchainMinimap(
      graph(),
      { width: 700, height: 200 },
      { scale: 1, tx: 0, ty: 0 },
    );
    expect(m.visible).toBe(true);
    expect(m.rects.map((r) => r.id)).toEqual(graph().nodes.map((n) => n.id));
    expect(m.rects[0]?.state).toBe("confirmed");
    expect(m.width).toBeLessThanOrEqual(studio.KC_MINIMAP.maxW + 1e-9);
    expect(m.height).toBeLessThanOrEqual(studio.KC_MINIMAP.maxH + 1e-9);
  });

  it("la zone visible suit le zoom et le déplacement", () => {
    const vp = { width: 700, height: 200 };
    const base = studio.killchainMinimap(graph(), vp, { scale: 1, tx: 0, ty: 0 });
    const zoomed = studio.killchainMinimap(graph(), vp, { scale: 2, tx: 0, ty: 0 });
    expect(zoomed.zone?.w).toBeLessThan(base.zone?.w ?? 0);
    // Déplacé vers la droite (tx négatif) : la zone avance, bornée au canevas.
    const panned = studio.killchainMinimap(graph(), vp, { scale: 2, tx: -400, ty: 0 });
    expect(panned.zone?.x).toBeGreaterThan(zoomed.zone?.x ?? 0);
    const far = studio.killchainMinimap(graph(), vp, { scale: 2, tx: -1e6, ty: 0 });
    expect(far.zone?.w).toBe(0);
    expect((panned.zone?.x ?? 0) + (panned.zone?.w ?? 0)).toBeLessThanOrEqual(
      gw() * panned.ratio + 1e-9,
    );
    expect(gh()).toBeGreaterThan(0);
  });

  it("clic : recentre le viewport sur le point, borné à la minimap", () => {
    const vp = { width: 700, height: 200 };
    const view = { scale: 2, tx: 0, ty: 0 };
    const m = studio.killchainMinimap(graph(), vp, view);
    // Milieu de la minimap : le centre du viewport tombe au milieu du canevas.
    const mid = studio.killchainMinimapRecenter(m, vp, view, m.width / 2, m.height / 2);
    expect(mid.tx).toBeCloseTo(vp.width / 2 - (gw() / 2) * view.scale);
    expect(mid.ty).toBeCloseTo(vp.height / 2 - (gh() / 2) * view.scale);
    // Hors minimap : borné au bord, jamais plus loin que le canevas.
    const out = studio.killchainMinimapRecenter(m, vp, view, 1e6, -1e6);
    expect(out.tx).toBeCloseTo(vp.width / 2 - gw() * view.scale);
    expect(out.ty).toBeCloseTo(vp.height / 2);
    // Minimap masquée : translation inchangée.
    const hidden = studio.killchainMinimap(graph(), { width: 100, height: 100 }, view);
    expect(studio.killchainMinimapRecenter(hidden, vp, view, 5, 5)).toEqual({ tx: 0, ty: 0 });
  });
});

describe("killchainLegend (panneau légende, deux groupes avec compteurs)", () => {
  it("deux groupes, Type puis État, dans l'ordre attendu", () => {
    const groups = studio.killchainLegend([]);
    expect(groups.map((g) => g.label)).toEqual(["Type", "État"]);
    expect(groups[0]?.entries.map((e) => e.kind)).toEqual([
      "host",
      "credential",
      "site",
      "step",
      "loot",
    ]);
    expect(groups[1]?.entries.map((e) => e.state)).toEqual(["confirmed", "hypothesis", "failed"]);
  });

  it("compte exactement par entrée, sur les deux groupes", () => {
    const groups = studio.killchainLegend([
      { kind: "host", state: "confirmed" },
      { kind: "host", state: "confirmed" },
      { kind: "site", state: "hypothesis" },
      { kind: "loot", state: "failed" },
    ]);
    const kinds = Object.fromEntries(groups[0]?.entries.map((e) => [e.kind, e.count]) ?? []);
    expect(kinds).toEqual({ host: 2, credential: 0, site: 1, step: 0, loot: 1 });
    const states = Object.fromEntries(groups[1]?.entries.map((e) => [e.state, e.count]) ?? []);
    expect(states).toEqual({ confirmed: 2, hypothesis: 1, failed: 1 });
  });

  it("entrée non tableau : tous les compteurs à zéro", () => {
    for (const bad of [undefined, null, "x", 3, {}]) {
      const groups = studio.killchainLegend(bad);
      for (const g of groups) for (const e of g.entries) expect(e.count).toBe(0);
    }
  });

  it("kind/state inconnu : ignoré, ne fausse aucun autre compteur", () => {
    const groups = studio.killchainLegend([
      { kind: "inconnu", state: "aussi-inconnu" },
      { kind: "host", state: "confirmed" },
    ]);
    const kinds = Object.fromEntries(groups[0]?.entries.map((e) => [e.kind, e.count]) ?? []);
    expect(kinds).toEqual({ host: 1, credential: 0, site: 0, step: 0, loot: 0 });
    const states = Object.fromEntries(groups[1]?.entries.map((e) => [e.state, e.count]) ?? []);
    expect(states).toEqual({ confirmed: 1, hypothesis: 0, failed: 0 });
  });

  it("entrée non objet dans la liste : ignorée sans faire échouer le calcul", () => {
    const groups = studio.killchainLegend([null, "x", 3, { kind: "step", state: "failed" }]);
    const kinds = Object.fromEntries(groups[0]?.entries.map((e) => [e.kind, e.count]) ?? []);
    expect(kinds.step).toBe(1);
    const states = Object.fromEntries(groups[1]?.entries.map((e) => [e.state, e.count]) ?? []);
    expect(states.failed).toBe(1);
  });
});

// DOM minimal : exerce le vrai script, les saisies et le protocole sans dépendance de navigateur.
class StudioNode {
  children: StudioNode[] = [];
  parent: StudioNode | undefined;
  listeners = new Map<string, (event: Record<string, unknown>) => void>();
  id = "";
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  title = "";
  className = "";
  dataset: Record<string, string> = {};
  styles = new Map<string, string>();
  style = { setProperty: (key: string, value: string) => this.styles.set(key, value) };
  classList = {
    contains: (name: string) => this.className.split(" ").includes(name),
    toggle: (name: string, on?: boolean) => {
      const set = new Set(this.className.split(" ").filter(Boolean));
      const next = on ?? !set.has(name);
      if (next) set.add(name);
      else set.delete(name);
      this.className = [...set].join(" ");
    },
    add: (...names: string[]) => {
      for (const name of names) this.classList.toggle(name, true);
    },
    remove: (...names: string[]) => {
      for (const name of names) this.classList.toggle(name, false);
    },
  };
  getBoundingClientRect() {
    return { width: 900, height: 600, left: 0, top: 0 };
  }
  constructor(readonly tag: string) {}
  get firstChild() {
    return this.children[0];
  }
  get lastChild() {
    return this.children.at(-1);
  }
  get isConnected(): boolean {
    return this.parent?.isConnected ?? ["main", "body", "nav"].includes(this.tag);
  }
  append(...nodes: StudioNode[]) {
    for (const node of nodes) {
      node.parent?.removeChild(node);
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: StudioNode[]) {
    for (const node of [...nodes].reverse()) {
      node.parent?.removeChild(node);
      node.parent = this;
      this.children.unshift(node);
    }
  }
  after(...nodes: StudioNode[]) {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      for (const node of nodes) node.parent = this.parent;
      this.parent.children.splice(i + 1, 0, ...nodes);
    }
  }
  replaceWith(...nodes: StudioNode[]) {
    this.after(...nodes);
    this.parent?.removeChild(this);
  }
  replaceChildren(...nodes: StudioNode[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...nodes);
  }
  closest(selector: string): StudioNode | undefined {
    if (selector.split(",").some((tag) => tag.trim() === this.tag)) return this;
    return this.parent?.closest(selector);
  }
  querySelector(selector: string) {
    return this.find((node) =>
      selector.startsWith(".")
        ? node.className.split(" ").includes(selector.slice(1))
        : node.id === selector.slice(1),
    );
  }
  removeChild(node: StudioNode) {
    this.children = this.children.filter((n) => n !== node);
    node.parent = undefined;
  }
  attributes = new Map<string, string>();
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key === "class") this.className = value;
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
    const previous = this.listeners.get(type);
    this.listeners.set(type, (event) => {
      previous?.(event);
      listener(event);
    });
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    this.listeners.get(type)?.(event);
  }
  find(predicate: (node: StudioNode) => boolean): StudioNode | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
}

it("fournisseurs : choix optimiste verrouillé jusqu'à l'accusé, puis reprise ou retour en erreur", () => {
  const main = new StudioNode("main");
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const view = {
    type: "view",
    page: "providers",
    capabilities: { providers: [] },
    providerCatalog: [{ id: "exemple", label: "Exemple" }],
  };
  const toggle = () => {
    const node = main.find((item) => item.id === "capability-provider-exemple");
    if (!node) throw new Error("Fournisseur introuvable");
    return node;
  };
  receive({ data: view });
  const initial = toggle();
  initial.fire("click");
  receive({ data: { ...view, containers: [{ name: "autre" }] } });
  expect(toggle()).toBe(initial);
  expect(toggle().attributes.get("aria-checked")).toBe("true");
  toggle().fire("click");
  expect(sent).toHaveLength(3);
  receive({ data: { ...view, providerCatalogStatus: "loading" } });
  expect(toggle().attributes.get("aria-checked")).toBe("true");
  toggle().fire("click");
  expect(sent).toHaveLength(3);
  receive({ data: { type: "capabilityState", id: "exemple", enabled: true, error: false } });
  receive({ data: view });
  expect(toggle().attributes.get("aria-checked")).toBe("true");
  toggle().fire("click");
  expect(sent.at(-1)).toEqual({
    type: "setCapability",
    kind: "provider",
    id: "exemple",
    enabled: false,
  });
  receive({ data: { type: "capabilityState", id: "exemple", enabled: false, error: true } });
  expect(toggle().attributes.get("aria-checked")).toBe("true");
  expect(toggle().attributes.get("aria-disabled")).toBe("false");
  expect(
    main.find((item) => item.textContent.includes("Impossible d’enregistrer ce fournisseur")),
  ).toBeDefined();
  toggle().fire("click");
  expect(sent).toHaveLength(5);
  const test = main.find((item) => item.dataset.provider === "exemple");
  if (!test) throw new Error("Test de connexion introuvable");
  test.fire("click");
  expect(sent.at(-1)).toEqual({ type: "testProviderConnection", id: "exemple" });
  expect(test.disabled).toBe(true);
  const count = sent.length;
  test.fire("click");
  expect(sent).toHaveLength(count);
  receive({
    data: {
      type: "providerConnectionResult",
      id: "exemple",
      pending: false,
      text: "Catalogue indisponible",
      error: true,
    },
  });
  expect(test.disabled).toBe(false);
  expect(main.find((item) => item.textContent === "Catalogue indisponible")).toBeDefined();
});

it("fournisseurs : carte gratuite à quatre options, ouverture selon la connexion, actions", () => {
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  const main = new StudioNode("main");
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const view = (providerCatalog: unknown[]) => ({
    type: "view",
    page: "providers",
    capabilities: { providers: [] },
    providerCatalog,
  });
  const card = () => {
    const node = main.find((n) => n.className === "free-guide");
    if (!node) throw new Error("Carte introuvable");
    return node as StudioNode & { open: boolean };
  };
  const rows = ["oc-opencode", "oc-github-copilot", "google", "oc-openrouter"];
  receive({
    data: view([
      { id: "oc-opencode", label: "OpenCode", runtimeId: "opencode", connected: false },
      { id: "oc-github-copilot", label: "Copilot", runtimeId: "github-copilot" },
      { id: "oc-openrouter", label: "OpenRouter", runtimeId: "openrouter" },
    ]),
  });
  expect(card().open).toBe(true);
  const options: StudioNode[] = [];
  const collect = (n: StudioNode) => {
    if (n.dataset.free) options.push(n);
    for (const c of n.children) collect(c);
  };
  collect(card());
  expect(options.map((n: StudioNode) => n.dataset.free)).toEqual([
    "zen",
    "copilot",
    "gemini",
    "openrouter",
  ]);
  const button = (i: number, cls: string) => options[i]?.find((c) => c.className.includes(cls));
  (button(0, "free-guide-configure") as StudioNode).fire("click");
  expect(sent.at(-1)).toEqual({ type: "configureProvider", id: rows[0] });
  (button(1, "free-guide-configure") as StudioNode).fire("click");
  expect(sent.at(-1)).toEqual({ type: "configureProvider", id: rows[1] });
  (button(3, "free-guide-configure") as StudioNode).fire("click");
  expect(sent.at(-1)).toEqual({ type: "configureProvider", id: rows[3] });
  expect(button(2, "free-guide-configure")).toBeUndefined();
  (button(2, "free-guide-refresh") as StudioNode).fire("click");
  expect(sent.at(-1)).toEqual({ type: "refreshProviderCatalog" });
  (button(0, "free-guide-link") as StudioNode).fire("click");
  expect(sent.at(-1)).toEqual({ type: "openFreeGuideLink", key: "zen" });
  receive({
    data: view([{ id: "google", label: "Google", runtimeId: "google", connected: true }]),
  });
  expect(card().open).toBe(false);
});

it("valide le sondage d'un fournisseur sans accepter une consigne ni des identifiants", () => {
  expect(parseStudioMessage({ type: "testProviderConnection", id: "opencode" })).toEqual({
    type: "testProviderConnection",
    id: "opencode",
  });
  expect(parseStudioMessage({ type: "testProviderConnection", id: "../cache" })).toBeNull();
  expect(
    parseStudioMessage({ type: "testProviderConnection", id: "opencode", prompt: "mission" }),
  ).toBeNull();
  expect(
    parseStudioMessage({ type: "testProviderConnection", id: "opencode", token: "cle-factice" }),
  ).toBeNull();
});

it("projet : le bandeau de mise à jour disparaît lorsque la sonde vide se termine", () => {
  const main = new StudioNode("main");
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage() {} }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (type: string, fn: typeof receive) => {
        if (type === "message") receive = fn;
      },
    },
  });
  const view = { type: "view", page: "project", linkedBanner: null };
  receive({ data: { ...view, dockerLoading: true } });
  expect(main.find((node) => node.textContent === "Mise à jour des conteneurs…")).toBeDefined();
  receive({ data: { ...view, dockerLoading: false } });
  expect(main.find((node) => node.textContent === "Mise à jour des conteneurs…")).toBeUndefined();
  expect(main.find((node) => node.textContent.includes("Aucun conteneur affiché"))).toBeDefined();
});

it("mémoire : saisie, plafond multioctet, conservation du brouillon et accusé de sauvegarde", () => {
  const main = new StudioNode("main");
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const projectId = "11111111-1111-4111-8111-111111111111";
  const view = { type: "view", page: "project", projectSummary: { projectId, text: "ancien" } };
  const find = (predicate: (node: StudioNode) => boolean) => {
    const node = main.find(predicate);
    if (!node) throw new Error("Élément du résumé introuvable");
    return node;
  };
  const input = () => find((n) => n.id === "project-summary");
  const save = () => find((n) => n.textContent === "Enregistrer le résumé");
  receive({ data: view });
  expect(input().value).toBe("ancien");
  expect(
    find(
      (n) =>
        n.textContent ===
        "Notes privées du projet. Non transmises automatiquement aux conversations.",
    ),
  ).toBeDefined();
  input().value = "é".repeat(4097);
  input().fire("input");
  expect(save().disabled).toBe(true);
  save().fire("click");
  expect(sent).toEqual([{ type: "ready" }, { type: "rendered" }]);
  input().value = "<texte non interprété>";
  input().fire("input");
  receive({ data: view });
  expect(input().value).toBe("<texte non interprété>");
  save().fire("click");
  expect(sent.at(-1)).toEqual({ type: "saveSummary", projectId, text: "<texte non interprété>" });
  receive({ data: { ...view, page: "atlas", summarySaved: projectId } });
  receive({ data: { ...view, projectSummary: { projectId, text: "masqué" } } });
  expect(input().value).toBe("masqué");
  expect(input().disabled).toBe(false);
  input().value = "brouillon à conserver";
  input().fire("input");
  save().fire("click");
  const other = "22222222-2222-4222-8222-222222222222";
  receive({
    data: {
      ...view,
      projectSummary: { projectId: other, text: "autre" },
      summaryFailed: projectId,
      summaryError: "Projet changé",
    },
  });
  receive({ data: view });
  expect(input().value).toBe("brouillon à conserver");
  expect(input().disabled).toBe(false);
  expect(save().disabled).toBe(false);
});

it("projets : choisir un projet réel et créer avec le nom seul, dossier laissé à l'hôte", () => {
  const main = new StudioNode("main");
  const nav = new StudioNode("nav");
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) =>
        id === "studio-main" ? main : id === "studio-nav" ? nav : null,
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  receive({
    data: {
      type: "view",
      page: "project",
      projectChoices: {
        activeId: first,
        projects: [
          { id: first, name: "Premier", workspace: "/mission" },
          { id: second, name: "Second", workspace: "/autre" },
        ],
      },
    },
  });
  const find = (predicate: (node: StudioNode) => boolean) => {
    const node = main.find(predicate);
    if (!node) throw new Error("Contrôle projet introuvable");
    return node;
  };
  expect(nav.find((n) => n.className === "studio-nav-project-name")?.textContent).toBe("Premier");
  const choosePanel = find((n) => n.id === "project-choose-panel");
  const createPanel = find((n) => n.id === "project-create-panel");
  const chooseTab = find((n) => n.id === "project-choose-tab");
  const createTab = find((n) => n.id === "project-create-tab");
  expect(choosePanel.hidden).toBe(false);
  expect(createPanel.hidden).toBe(true);
  expect(chooseTab.attributes.get("aria-pressed")).toBe("true");
  expect(find((n) => n.className === "studio-project-active-name").textContent).toBe("Premier");
  const choose = find((n) => n.id === "project-choice");
  const activate = find((n) => n.textContent === "Activer le projet");
  expect(activate.disabled).toBe(true);
  choose.value = second;
  choose.fire("change");
  expect(activate.disabled).toBe(false);
  activate.fire("click");
  expect(sent.at(-1)).toEqual({ type: "activateProject", projectId: second });
  createTab.fire("click");
  expect(choosePanel.hidden).toBe(true);
  expect(createPanel.hidden).toBe(false);
  expect(createTab.attributes.get("aria-pressed")).toBe("true");
  const create = find((n) => n.textContent === "Créer le projet");
  expect(create.disabled).toBe(true);
  const name = find((n) => n.id === "project-name");
  name.value = " Nouvelle mission ";
  name.fire("input");
  chooseTab.fire("click");
  createTab.fire("click");
  expect(name.value).toBe(" Nouvelle mission ");
  create.fire("click");
  expect(sent.at(-1)).toEqual({ type: "createProject", name: "Nouvelle mission" });
  receive({
    data: {
      type: "view",
      page: "project",
      projectBusy: true,
      projectChoices: {
        activeId: first,
        projects: [{ id: first, name: "Premier", workspace: "/mission" }],
      },
    },
  });
  expect(find((n) => n.id === "project-name").value).toBe(" Nouvelle mission ");
  expect(find((n) => n.id === "project-create-panel").hidden).toBe(false);
  expect(find((n) => n.id === "project-choice").disabled).toBe(true);
  expect(find((n) => n.id === "project-name").disabled).toBe(true);
  expect(find((n) => n.textContent === "Activer le projet").disabled).toBe(true);
  expect(find((n) => n.textContent === "Créer le projet").disabled).toBe(true);
  const before = sent.length;
  find((n) => n.textContent === "Activer le projet").fire("click");
  find((n) => n.textContent === "Créer le projet").fire("click");
  expect(sent).toHaveLength(before);
  receive({
    data: { type: "view", page: "project", projectChoices: { activeId: null, projects: [] } },
  });
  expect(find((n) => n.id === "project-create-panel").hidden).toBe(false);
  expect(find((n) => n.id === "project-choose-tab").disabled).toBe(true);
  receive({
    data: {
      type: "view",
      page: "project",
      projectCreated: first,
      projectChoices: {
        activeId: first,
        projects: [{ id: first, name: "Premier", workspace: "/mission" }],
      },
      linkedBanner: { name: "exegol-lab", workspace: "/mission" },
    },
  });
  expect(find((n) => n.id === "project-create-panel").hidden).toBe(true);
  expect(find((n) => n.id === "project-name").value).toBe("");
  const rename = find((n) => n.id === "project-rename");
  rename.fire("click");
  expect(sent.at(-1)).toEqual({ type: "renameProject", projectId: first });
  // Une nouvelle vue réactive les contrôles après le dialogue natif.
  receive({
    data: {
      type: "view",
      page: "project",
      projectChoices: {
        activeId: first,
        projects: [{ id: first, name: "Premier", workspace: "/mission" }],
      },
    },
  });
  const remove = find((n) => n.id === "project-delete");
  remove.fire("click");
  expect(sent.at(-1)).toEqual({ type: "deleteProject", projectId: first });
  expect(main.find((n) => n.textContent === "Délier le conteneur affiché")).toBeUndefined();
});

it("graphe : conserve la caméra, libère les observateurs et signale une erreur sans vider les trouvailles", () => {
  const main = new StudioNode("main");
  const body = new StudioNode("body");
  body.classList.contains = () => true;
  const observers: { callback: () => void; disconnected: boolean }[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: () => {} }),
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class {
      entry: { callback: () => void; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, disconnected: false };
        observers.push(this.entry);
      }
      observe() {
        this.entry.callback();
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
    document: {
      addEventListener() {},
      body,
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
      createElementNS: (_ns: string, tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const a = {
    id: "a",
    kind: "step",
    state: "confirmed",
    label: "Une étiquette complète et consultable",
  };
  const view = { type: "view", projectId: "projet-a", findings: [a] };
  const find = (cls: string) => {
    const node = main.find((n) => n.className.split(" ").includes(cls));
    if (!node) throw Error(`Élément absent : ${cls}`);
    return node;
  };
  receive({ data: { type: "findingsError", message: "Première lecture impossible" } });
  expect(find("kc-live-status").textContent).toBe("Première lecture impossible");
  receive({ data: { ...view, findings: [] } });
  receive({ data: { type: "findingsError", message: "Erreur sur graphe vide" } });
  expect(find("kc-live-status").textContent).toBe("Erreur sur graphe vide");
  receive({ data: view });
  const initial = find("kc-canvas");
  const zoom = main.find((n) => n.attributes.get("aria-label") === "Zoomer");
  zoom?.fire("click");
  const pose = initial.styles.get("transform");
  const added = {
    ...view,
    findings: [a, { id: "b", kind: "site", state: "hypothesis", label: "Deuxième", from: ["a"] }],
  };
  receive({ data: added });
  expect(find("kc-canvas").styles.get("transform")).toBe(pose);
  expect(observers[0]?.disconnected).toBe(true);
  const current = find("kc-canvas");
  receive({ data: added });
  expect(find("kc-canvas")).toBe(current);
  receive({
    data: { type: "findingsError", projectId: "projet-a", message: "Lecture impossible" },
  });
  expect(find("kc-live-status").textContent).toBe("Lecture impossible");
  expect(find("kc-canvas")).toBe(current);
  receive({ data: added });
  expect(find("kc-live-status").hidden).toBe(true);
  receive({ data: { ...view, projectId: "projet-b" } });
  expect(find("kc-canvas").styles.get("transform")).not.toBe(pose);
  expect(observers[1]?.disconnected).toBe(true);
});

function killchainDom(i18n?: ReturnType<typeof localeService>, fullKillchain = true) {
  const main = new StudioNode("main");
  const body = new StudioNode("body");
  body.classList.contains = () => fullKillchain;
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    WarbandI18n: i18n,
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body,
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
      createElementNS: (_ns: string, tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  return {
    main,
    sent,
    receive: (data: unknown) => receive({ data }),
    find: (className: string) => {
      const node = main.find((n) => n.className.split(" ").includes(className));
      if (!node) throw Error(`Élément absent : ${className}`);
      return node;
    },
  };
}

const deleteProject = "11111111-1111-4111-8111-111111111111";
const deleteOtherProject = "22222222-2222-4222-8222-222222222222";
const deleteFindingView = {
  type: "view",
  projectId: deleteProject,
  findings: [{ id: "trouvaille-a", kind: "host", state: "confirmed", label: "<Serveur>" }],
};

it("suppression : sélection accessible, action unique et cible du projet affiché", () => {
  const { find, sent, receive } = killchainDom();
  receive(deleteFindingView);
  const node = find("kc-node");
  const selection = find("kc-node-card");
  const remove = find("kc-delete");
  expect(selection.hidden).toBe(true);
  expect(remove.disabled).toBe(true);
  expect(node.attributes.get("role")).toBe("button");
  expect(node.attributes.get("aria-pressed")).toBe("false");
  let stopped = false;
  node.fire("pointerdown", {
    stopPropagation: () => {
      stopped = true;
    },
  });
  expect(stopped).toBe(true);
  expect(selection.hidden).toBe(true);
  node.fire("click");
  expect(selection.hidden).toBe(false);
  expect(find("kc-card-title").textContent).toBe("<Serveur>");
  expect(node.attributes.get("aria-pressed")).toBe("true");
  expect(remove.disabled).toBe(false);
  expect(remove.children[0]?.tag).toBe("svg");
  expect(node.find((n) => n.className.split(" ").includes("kc-delete"))).toBeUndefined();
  remove.fire("click");
  expect(sent.at(-1)).toEqual({
    type: "deleteFinding",
    projectId: deleteProject,
    id: "trouvaille-a",
  });
  expect(remove.disabled).toBe(true);
  const count = sent.length;
  remove.fire("click");
  expect(sent).toHaveLength(count);
});

it("suppression : Entrée et Espace sélectionnent, les projets inconnus désactivent l’action", () => {
  for (const key of ["Enter", " "]) {
    const { find, receive, sent } = killchainDom();
    receive({ ...deleteFindingView, projectId: "projet-inconnu" });
    let prevented = false;
    find("kc-node").fire("keydown", {
      key,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
    expect(find("kc-delete").disabled).toBe(true);
    find("kc-delete").fire("click");
    expect(sent).toEqual([{ type: "ready" }, { type: "rendered" }]);
  }
});

it("suppression : attente sans doublon, annulation, erreur visible et accusés filtrés", () => {
  const { find, sent, receive } = killchainDom();
  receive(deleteFindingView);
  find("kc-node").fire("click");
  const remove = find("kc-delete");
  const state = { type: "findingDeleteState", projectId: deleteProject, id: "trouvaille-a" };
  remove.fire("click");
  receive({ ...state, busy: true });
  receive({ ...state, projectId: deleteOtherProject, busy: false });
  receive({ ...state, id: "autre", busy: false });
  expect(remove.disabled).toBe(true);
  remove.fire("click");
  expect(
    sent.filter((message) => (message as { type: string }).type === "deleteFinding"),
  ).toHaveLength(1);
  receive({ ...state, busy: false });
  expect(remove.disabled).toBe(false);
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
  remove.fire("click");
  receive({ ...state, busy: false, error: "Suppression impossible" });
  expect(find("kc-live-status").textContent).toBe("Suppression impossible");
  expect(find("kc-live-status").hidden).toBe(false);
  expect(remove.disabled).toBe(false);
  remove.fire("click");
  expect(find("kc-live-status").hidden).toBe(true);
  expect(remove.disabled).toBe(true);
});

it("suppression : sélection conservée au rafraîchissement puis effacée après disparition ou changement de projet", () => {
  const { find, receive, sent } = killchainDom();
  receive(deleteFindingView);
  find("kc-node").fire("click");
  receive({
    ...deleteFindingView,
    findings: [{ ...deleteFindingView.findings[0], label: "Renommé" }],
  });
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
  expect(find("kc-card-title").textContent).toBe("Renommé");
  find("kc-delete").fire("click");
  receive({ ...deleteFindingView, findings: [] });
  expect(find("kc-empty")).toBeDefined();
  receive(deleteFindingView);
  expect(find("kc-node-card").hidden).toBe(true);
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("false");
  find("kc-node").fire("click");
  receive({ ...deleteFindingView, projectId: deleteOtherProject });
  expect(find("kc-node-card").hidden).toBe(true);
  find("kc-node").fire("click");
  find("kc-delete").fire("click");
  expect(sent.at(-1)).toEqual({
    type: "deleteFinding",
    projectId: deleteOtherProject,
    id: "trouvaille-a",
  });
  receive({
    type: "findingDeleteState",
    projectId: deleteProject,
    id: "trouvaille-a",
    busy: false,
    error: "Ancien projet",
  });
  expect(find("kc-delete").disabled).toBe(true);
});

it("graphe : clic dans le vide et Échap désélectionnent sans supprimer", () => {
  const { main, find, receive, sent } = killchainDom();
  receive(deleteFindingView);
  find("kc-node").fire("click");
  expect(find("kc-node-card").hidden).toBe(false);
  main.fire("click");
  expect(find("kc-node-card").hidden).toBe(true);
  find("kc-node").fire("click");
  main.fire("keydown", { key: "Escape", preventDefault: () => {} });
  expect(find("kc-node-card").hidden).toBe(true);
  expect(sent).toEqual([{ type: "ready" }, { type: "rendered" }]);
});
it("légende : repli réel, filtres combinés, reset et conservation au rafraîchissement", () => {
  const { main, find, receive } = killchainDom();
  const findings = [
    { id: "a", kind: "host", state: "confirmed", label: "Serveur" },
    { id: "b", kind: "loot", state: "hypothesis", label: "Butin", from: ["a"] },
  ];
  receive({ ...deleteFindingView, findings });
  find("kc-legend-toggle").fire("click");
  expect(find("kc-legend-body").hidden).toBe(true);
  const loot = main.find((n) => n.dataset.filterValue === "loot")!;
  loot.fire("click");
  expect(loot.attributes.get("aria-pressed")).toBe("true");
  expect(
    main.find((n) => n.className.includes("kc-node") && n.className.includes("kind-host"))
      ?.className,
  ).toContain("is-dimmed");
  const failed = main.find((n) => n.dataset.filterValue === "failed")!;
  failed.fire("click");
  expect(failed.attributes.get("aria-pressed")).toBe("true");
  receive({
    ...deleteFindingView,
    findings: [...findings, { id: "c", kind: "site", state: "confirmed", label: "Site" }],
  });
  expect(find("kc-legend-body").hidden).toBe(true);
  expect(main.find((n) => n.dataset.filterValue === "loot")?.attributes.get("aria-pressed")).toBe(
    "true",
  );
  find("kc-filter-reset").fire("click");
  expect(find("kc-filter-reset").disabled).toBe(true);
});
it("liens : sélection clavier, annotation sans optimisme, acquittement et export ciblé", () => {
  const { find, receive, sent } = killchainDom();
  const findings = [
    { id: "a", kind: "host", state: "confirmed", label: "Serveur" },
    { id: "b", kind: "step", state: "confirmed", label: "Accès", from: ["a"] },
  ];
  receive({ ...deleteFindingView, findings });
  find("kc-edge-hit").fire("keydown", { key: "Enter", preventDefault: () => {} });
  expect(find("kc-edge-selection").hidden).toBe(false);
  find("kc-mark-path").fire("click");
  expect(sent.at(-1)).toEqual({
    type: "setPathEdge",
    projectId: deleteProject,
    from: "a",
    to: "b",
    retained: true,
  });
  expect(find("kc-mark-path").disabled).toBe(true);
  expect(find("kc-edge").className).not.toContain("is-path");
  receive({ ...deleteFindingView, findings: [findings[0], { ...findings[1], pathFrom: ["a"] }] });
  receive({ type: "pathEdgeState", projectId: deleteProject, from: "a", to: "b" });
  expect(find("kc-edge").className).toContain("is-path");
  expect(find("kc-mark-path").disabled).toBe(false);
  find("kc-mark-path").fire("click");
  expect(sent.at(-1)).toMatchObject({ retained: false });
  find("kc-report").fire("click");
  expect(sent.at(-1)).toEqual({ type: "exportReport", projectId: deleteProject });
});

describe("actions de projet et connexion Burp", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  it.each(["renameProject", "deleteProject"])(
    "valide %s sans accepter un nom ou un chemin fournis par la webview",
    (type) => {
      expect(parseStudioMessage({ type, projectId })).toEqual({ type, projectId });
      expect(parseStudioMessage({ type, projectId, path: "/tmp/projet" })).toBeNull();
      expect(parseStudioMessage({ type, projectId: "../projet" })).toBeNull();
      expect(parseStudioMessage({ type, projectId, name: "Nom hostile" })).toBeNull();
    },
  );
  it.each(["configureBurp", "testBurp"])("valide %s sans argument exécutable ni URL", (type) => {
    expect(parseStudioMessage({ type })).toEqual({ type });
    expect(parseStudioMessage({ type, url: "http://evil" })).toBeNull();
    expect(parseStudioMessage({ type, command: "java" })).toBeNull();
  });
});

describe("lecture de preuve", () => {
  it("refuse les chemins, clés supplémentaires et identifiants malformés", () => {
    const valid = {
      type: "openEvidence",
      projectId: "11111111-1111-4111-8111-111111111111",
      id: "preuve-1",
    };
    expect(parseStudioMessage(valid)).toEqual(valid);
    for (const raw of [
      { ...valid, path: "/etc/passwd" },
      { ...valid, projectId: "../autre" },
      { ...valid, id: "a\n" },
      { ...valid, id: "" },
    ])
      expect(parseStudioMessage(raw)).toBeNull();
  });
});

it("isole et borne les observations du run courant, puis les efface", () => {
  const event = (raw: object) => raw as EngineEvent;
  let snapshot = observeMission(
    undefined,
    event({ kind: "run.started", runId: "a", prompt: "objectif" }),
  );
  snapshot = observeMission(
    snapshot,
    event({ kind: "tool.result", runId: "autre", output: "ancien" }),
  );
  expect(snapshot?.results).toEqual([]);
  for (let i = 0; i < 15; i++)
    snapshot = observeMission(
      snapshot,
      event({
        kind: "tool.result",
        runId: "a",
        toolUseId: String(i),
        output: "x".repeat(3000),
        isError: true,
        truncated: true,
        bytes: 4000,
      }),
    );
  expect(snapshot?.results).toHaveLength(12);
  expect(snapshot?.results[0]?.output).toHaveLength(2048);
  expect(snapshot?.results[0]).toMatchObject({
    reference: "3",
    isError: true,
    truncated: true,
    aperçuTronqué: true,
  });
  expect(
    observeMission(snapshot, event({ kind: "run.started", runId: "b", prompt: "nouveau" })),
  ).toEqual({ runId: "b", objective: "nouveau", results: [] });
  expect(observeMission(snapshot, null)).toBeUndefined();
});

function localeService() {
  let locale: "fr" | "en" = "fr";
  return {
    t: createUiTranslator(() => locale),
    getLocale: () => locale,
    setLocale: (next: "fr" | "en") => {
      locale = next;
    },
    applyStatic() {},
  };
}

it("traduit les commandes du graphe en conservant cadrage, filtre et sélection", () => {
  const { main, find, receive } = killchainDom(localeService());
  receive(deleteFindingView);
  main.find((node) => node.dataset.filterValue === "loot")?.fire("click");
  find("kc-node").fire("click");
  const zoom = find("kc-zoom");
  zoom.fire("click");
  // Le navigateur propage ce clic depuis le pictogramme jusqu’au main.
  main.fire("click", { target: zoom.children[0] });
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
  const pose = find("kc-canvas").styles.get("transform");
  receive({ type: "locale", locale: "en" });
  expect(find("kc-report-preview").children.at(-1)?.textContent).toBe("Report preview");
  expect(find("kc-node").attributes.get("aria-label")).toContain("Host");
  expect(find("kc-node").className).toContain("is-dimmed");
  expect(
    main.find((node) => node.dataset.filterValue === "loot")?.attributes.get("aria-pressed"),
  ).toBe("true");
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
  expect(find("kc-canvas").styles.get("transform")).toBe(pose);
  expect(find("kc-node-label").textContent).toBe("<Serveur>");
  receive({ type: "locale", locale: "fr" });
  expect(find("kc-report-preview").children.at(-1)?.textContent).toBe("Aperçu du rapport");
  expect(find("kc-node").attributes.get("aria-pressed")).toBe("true");
});

it("Réglages : sélecteur FR/EN, mémoire privée et création conservées pendant la traduction", () => {
  const main = new StudioNode("main");
  const nav = new StudioNode("nav");
  const sent: unknown[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    WarbandI18n: localeService(),
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) =>
        id === "studio-main"
          ? main
          : id === "studio-nav"
            ? nav
            : (main.find((node) => node.id === id) ?? nav.find((node) => node.id === id)),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  const view = {
    type: "view",
    page: "project",
    projectChoices: { projects: [], activeId: null },
    projectSummary: { projectId: deleteProject, text: "Mémoire française" },
  };
  const field = (id: string) => {
    const node = main.find((entry) => entry.id === id) ?? nav.find((entry) => entry.id === id);
    if (!node) throw Error(id);
    return node;
  };
  receive({ data: view });
  expect(field("studio-locale").children.map((node) => [node.value, node.textContent])).toEqual([
    ["fr", "FR"],
    ["en", "EN"],
  ]);
  field("studio-locale").value = "en";
  field("studio-locale").fire("change");
  expect(sent.at(-1)).toEqual({ type: "setLocale", locale: "en" });
  field("project-name").value = "Projet personnel";
  field("project-name").fire("input");
  field("project-summary").value = "Résumé privé";
  field("project-summary").fire("input");
  receive({ data: { type: "locale", locale: "en" } });
  expect(field("studio-locale").value).toBe("en");
  expect(main.find((node) => node.textContent === "Save summary")).toBeDefined();
  expect(field("project-name").value).toBe("Projet personnel");
  expect(field("project-summary").value).toBe("Résumé privé");
  receive({ data: { type: "locale", locale: "fr" } });
  expect(main.find((node) => node.textContent === "Enregistrer le résumé")).toBeDefined();
  expect(field("project-summary").value).toBe("Résumé privé");
});

describe("page Audit : couverture", () => {
  const cell = (surface: string, state: string) => ({ surface, testClass: "sqli", state });
  const coverage = {
    cells: [cell("/login", "untested"), cell("/api", "confirmed"), cell("/admin", "untested")],
    total: 3,
    counts: { untested: 2, negative: 0, blocked: 0, prerequisite: 0, confirmed: 1 },
    coveredPercent: 33,
  };

  it("construit le modèle : pourcentage, comptes et toutes les lignes sans filtre", () => {
    const model = studio.coverageModel(coverage, "all");
    expect(model.percent).toBe(33);
    expect(model.total).toBe(3);
    expect(model.counts.untested).toBe(2);
    expect(model.filter).toBeNull();
    expect(model.rows).toHaveLength(3);
  });

  it("filtre par état (non testé) ; un filtre inconnu montre tout", () => {
    expect(studio.coverageModel(coverage, "untested").rows.map((r) => r.surface)).toEqual([
      "/login",
      "/admin",
    ]);
    expect(studio.coverageModel(coverage, "negative").rows).toEqual([]);
    expect(studio.coverageModel(coverage, "<img onerror=x>").rows).toHaveLength(3);
  });

  it("tolère une vue absente ou malformée sans lever", () => {
    for (const bad of [undefined, null, 3, {}, { cells: "x", counts: [], coveredPercent: "9" }]) {
      const model = studio.coverageModel(bad, "all");
      expect(model).toMatchObject({ total: 0, percent: 0, rows: [] });
    }
    expect(
      studio.coverageModel({ cells: [cell("a", "untested")], coveredPercent: 250 }, "all").percent,
    ).toBe(100);
  });

  it("le rendu de la couverture n'utilise que textContent pour les données de l'agent", () => {
    const src = read(studioJs);
    const start = src.indexOf("function coverageSection");
    const end = src.indexOf("function auditPage");
    const section = src.slice(start, end);
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\.append\(\s*cell/);
    expect(section).toContain("cell.note");
  });

  it("affiche les pastilles, les colonnes et le bandeau seulement si une faille est confirmée", () => {
    const main = new StudioNode("main");
    let receive: (event: { data: unknown }) => void = () => {};
    runInNewContext(read(studioJs), {
      TextEncoder,
      setTimeout,
      clearTimeout,
      acquireVsCodeApi: () => ({ postMessage() {} }),
      document: {
        addEventListener() {},
        body: new StudioNode("body"),
        getElementById: (id: string) => (id === "studio-main" ? main : null),
        createElement: (tag: string) => new StudioNode(tag),
      },
      window: {
        WarbandIcons: { create: () => new StudioNode("svg") },
        addEventListener: (_type: string, listener: typeof receive) => {
          receive = listener;
        },
      },
    });
    const show = (confirmed: number) =>
      receive({
        data: {
          type: "view",
          page: "audit",
          projectId: "projet",
          audit: {
            enabled: true,
            health: {},
            tests: [],
            coverage: {
              cells: studio.COVERAGE_STATES.map((state) => cell("surface", state)),
              total: 5,
              counts: { ...coverage.counts, confirmed },
              coveredPercent: 80,
            },
          },
        },
      });
    show(1);
    expect(main.find((node) => node.className === "coverage-banner")?.textContent).toBe(
      "1 faille confirmée",
    );
    for (const state of studio.COVERAGE_STATES) {
      expect(main.find((node) => node.classList.contains(`is-${state}`))).toBeDefined();
    }
    expect(main.find((node) => node.tag === "colgroup")?.children).toHaveLength(5);
    show(2);
    expect(main.find((node) => node.className === "coverage-banner")?.textContent).toBe(
      "2 failles confirmées",
    );
    show(0);
    expect(main.find((node) => node.className === "coverage-banner")).toBeUndefined();
  });

  it("chaque état et chaque libellé de la section a une traduction anglaise", () => {
    const en = createUiTranslator(() => "en");
    for (const label of [
      "Couverture",
      "1 faille confirmée",
      "{0} failles confirmées",
      "Non testé",
      "Négatif",
      "Bloqué",
      "Prérequis manquant",
      "Filtrer par état",
      "Tous les états",
      "Aucune case de couverture enregistrée.",
      "Aucune case dans cet état.",
    ])
      expect(en(label), label).not.toBe(label);
  });
});

it("avertit pendant la saisie d’une valeur de compte de moins de six caractères", () => {
  const main = new StudioNode("main");
  let receive: (event: { data: unknown }) => void = () => {};
  runInNewContext(read(studioJs), {
    TextEncoder,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({ postMessage() {} }),
    document: {
      addEventListener() {},
      body: new StudioNode("body"),
      getElementById: (id: string) => (id === "studio-main" ? main : null),
      createElement: (tag: string) => new StudioNode(tag),
    },
    window: {
      WarbandIcons: { create: () => new StudioNode("svg") },
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
    },
  });
  receive({
    data: { type: "view", page: "accounts", projectId: "11111111-1111-4111-8111-111111111111" },
  });
  const warning = main.find(
    (node) => node.textContent === "Valeur trop courte pour être masquée dans les journaux.",
  );
  const identifier = main.find(
    (node) => (node as StudioNode & { name?: string }).name === "identifier",
  );
  const secret = main.find((node) => (node as StudioNode & { name?: string }).name === "secret");
  if (!warning || !identifier || !secret) throw new Error("Formulaire des comptes absent");
  expect(warning.hidden).toBe(true);
  identifier.value = "admin";
  identifier.fire("input");
  expect(warning.hidden).toBe(false);
  identifier.value = "admin+";
  identifier.fire("input");
  expect(warning.hidden).toBe(true);
  secret.value = "a1";
  secret.fire("input");
  expect(warning.hidden).toBe(false);
  secret.value = "a1/b2?";
  secret.fire("input");
  expect(warning.hidden).toBe(true);
});

it("le réglage de racine appartient au Système et envoie uniquement une valeur machine", () => {
  const h = killchainDom(undefined, false);
  h.receive({
    type: "view",
    page: "system",
    projectWorkspaceRoot: "/home/demo/.exegol/workspaces",
  });
  const input = h.main.find((node) => node.id === "project-workspace-root");
  const save = h.main.find((node) => node.id === "project-workspace-root-save");
  if (!input || !save) throw Error("Réglage de racine absent");
  expect(input.value).toBe("/home/demo/.exegol/workspaces");
  input.value = "/home/demo/missions";
  save.fire("click");
  expect(h.sent.at(-1)).toEqual({ type: "setWorkspaceRoot", value: "/home/demo/missions" });
  expect(parseStudioMessage({ type: "setWorkspaceRoot", value: "/home/demo/missions" })).toEqual({
    type: "setWorkspaceRoot",
    value: "/home/demo/missions",
  });
  expect(parseStudioMessage({ type: "setWorkspaceRoot", value: "bad\0path" })).toBeNull();
  expect(
    parseStudioMessage({ type: "createProject", name: "Projet", workspaceRoot: "/autre" }),
  ).toBeNull();
});

it("la création de projet n’ouvre plus de choix de dossier", () => {
  const source = read(fileURLToPath(new URL("../src/extension/extension.ts", import.meta.url)));
  const start = source.indexOf(
    'if (message.type === "activateProject" || message.type === "createProject")',
  );
  const handler = source.slice(start, source.indexOf("if (projectSelected)", start));
  expect(handler).toContain("createManagedSelectedProject");
  expect(handler).not.toContain("showOpenDialog");
});
