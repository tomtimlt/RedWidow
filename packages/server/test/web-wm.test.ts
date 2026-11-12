import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const geo = await load("../web/wm/geometry.js");
const stackMod = await load("../web/wm/stack.js");
const types = await load("../web/wm/types.js");
const frames = await load("../web/lib/frames.js");

const DESK = { w: 1440, h: 800 };

describe("géométrie : tuiles", () => {
  it("moitiés et quarts exacts, sans trou ni recouvrement, même sur taille impaire", () => {
    for (const desk of [DESK, { w: 1001, h: 603 }]) {
      const px = (k: string) => geo.toPixels(geo.tileFractions(k), desk);
      const [tl, tr, bl, br] = ["tl", "tr", "bl", "br"].map(px);
      expect(tl).toEqual({ x: 0, y: 0, w: tr.x, h: bl.y });
      expect(tr.x).toBe(tl.w);
      expect(tr.x + tr.w).toBe(desk.w);
      expect(bl.y + bl.h).toBe(desk.h);
      expect(br).toEqual({ x: tr.x, y: bl.y, w: desk.w - tr.x, h: desk.h - bl.y });
      expect(px("left").w + px("right").w).toBe(desk.w);
      expect(px("full")).toEqual({ x: 0, y: 0, w: desk.w, h: desk.h });
    }
    expect(geo.toPixels(geo.tileFractions("tl"), DESK)).toEqual({ x: 0, y: 0, w: 720, h: 400 });
    expect(geo.tileFractions("nimporte")).toBeNull();
    expect(geo.tileFractions("__proto__")).toBeNull();
  });

  it("aller-retour fractions / pixels", () => {
    const rect = { x: 144, y: 80, w: 720, h: 400 };
    expect(geo.toPixels(geo.toFractions(rect, DESK), DESK)).toEqual(rect);
    expect(geo.toFractions(rect, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("refuse des fractions illisibles", () => {
    expect(geo.sanitizeFractions(null)).toBeNull();
    expect(geo.sanitizeFractions({ x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(geo.sanitizeFractions({ x: Number.NaN, y: 0, w: 1, h: 1 })).toBeNull();
    expect(geo.sanitizeFractions({ x: 0.1, y: 0.1, w: 5, h: 0.5 })).toEqual({
      x: 0.1,
      y: 0.1,
      w: 1,
      h: 0.5,
    });
  });
});

describe("géométrie : bornage", () => {
  it("taille minimale 320x200, maximale le bureau", () => {
    const r = geo.clampRect({ x: 10, y: 10, w: 50, h: 50 }, DESK);
    expect(r.w).toBe(320);
    expect(r.h).toBe(200);
    const big = geo.clampRect({ x: 0, y: 0, w: 9999, h: 9999 }, DESK);
    expect(big).toEqual({ x: 0, y: 0, w: DESK.w, h: DESK.h });
  });

  it("ramène une fenêtre sortie du bureau : la barre de titre reste atteignable", () => {
    const right = geo.clampRect({ x: 5000, y: 5000, w: 400, h: 300 }, DESK);
    expect(right.x).toBe(DESK.w - geo.REACH);
    expect(right.y).toBe(DESK.h - geo.TITLE_H);
    const left = geo.clampRect({ x: -5000, y: -40, w: 400, h: 300 }, DESK);
    expect(left.x + left.w).toBe(geo.REACH);
    expect(left.y).toBe(0);
  });

  it("bureau plus petit que le minimum : la fenêtre épouse le bureau", () => {
    expect(geo.clampRect({ x: 0, y: 0, w: 500, h: 500 }, { w: 300, h: 180 })).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 180,
    });
  });
});

describe("géométrie : aimantation à 12 px", () => {
  const rect = (x: number, y: number) => ({ x, y, w: 400, h: 300 });

  it("colle au bord du bureau à 12 px, pas à 13", () => {
    expect(geo.snapRect(rect(12, 100), [], DESK).x).toBe(0);
    expect(geo.snapRect(rect(13, 100), [], DESK).x).toBe(13);
    expect(geo.snapRect(rect(100, 12), [], DESK).y).toBe(0);
    // Bord droit et bas.
    expect(geo.snapRect(rect(DESK.w - 400 - 12, 100), [], DESK).x).toBe(DESK.w - 400);
    expect(geo.snapRect(rect(100, DESK.h - 300 - 13), [], DESK).y).toBe(DESK.h - 313);
  });

  it("colle au bord d'une autre fenêtre (accolée ou alignée)", () => {
    const other = { x: 600, y: 100, w: 300, h: 300 };
    expect(geo.snapRect(rect(210, 100), [other], DESK).x).toBe(200); // bord droit contre bord gauche
    expect(geo.snapRect(rect(905, 100), [other], DESK).x).toBe(900); // bord gauche contre bord droit
    expect(geo.snapRect(rect(595, 100), [other], DESK).x).toBe(600); // alignée à gauche
  });

  it("ignore une fenêtre qui ne partage aucune bande avec elle", () => {
    const far = { x: 600, y: 700, w: 300, h: 90 };
    expect(geo.snapRect(rect(210, 100), [far], DESK).x).toBe(210);
  });

  it("ne change pas la taille", () => {
    const snapped = geo.snapRect(rect(5, 5), [], DESK);
    expect([snapped.w, snapped.h]).toEqual([400, 300]);
  });
});

describe("géométrie : zones de dépôt", () => {
  it("bords, coins et haut", () => {
    expect(geo.dropZone({ x: 5, y: 400 }, DESK)).toBe("left");
    expect(geo.dropZone({ x: DESK.w - 5, y: 400 }, DESK)).toBe("right");
    expect(geo.dropZone({ x: 700, y: 3 }, DESK)).toBe("full");
    expect(geo.dropZone({ x: 4, y: 20 }, DESK)).toBe("tl");
    expect(geo.dropZone({ x: DESK.w - 4, y: 30 }, DESK)).toBe("tr");
    expect(geo.dropZone({ x: 4, y: DESK.h - 20 }, DESK)).toBe("bl");
    expect(geo.dropZone({ x: DESK.w - 4, y: DESK.h - 4 }, DESK)).toBe("br");
    expect(geo.dropZone({ x: 40, y: 3 }, DESK)).toBe("tl");
    expect(geo.dropZone({ x: 700, y: 400 }, DESK)).toBeNull();
    expect(geo.dropZone({ x: 700, y: DESK.h - 3 }, DESK)).toBeNull();
  });
});

describe("géométrie : redimensionnement", () => {
  const start = { x: 100, y: 100, w: 500, h: 400 };

  it("garde le bord opposé en place", () => {
    expect(geo.resizeRect(start, "e", 50, 0, DESK)).toEqual({ ...start, w: 550 });
    const west = geo.resizeRect(start, "w", 40, 0, DESK);
    expect(west.x + west.w).toBe(600);
    expect(west.x).toBe(140);
    const north = geo.resizeRect(start, "n", 0, -30, DESK);
    expect(north.y + north.h).toBe(500);
  });

  it("respecte la taille minimale par chaque poignée", () => {
    const sw = geo.resizeRect(start, "sw", 9999, -9999, DESK);
    expect(sw.w).toBe(320);
    expect(sw.h).toBe(200);
    expect(sw.x + sw.w).toBe(600);
    const ne = geo.resizeRect(start, "ne", -9999, 9999, DESK);
    expect(ne.w).toBe(320);
    expect(ne.h).toBe(200);
    expect(ne.y + ne.h).toBe(500);
  });

  it("ne dépasse pas le bureau", () => {
    const se = geo.resizeRect(start, "se", 99999, 99999, DESK);
    expect(se.x + se.w).toBe(DESK.w);
    expect(se.y + se.h).toBe(DESK.h);
    const nw = geo.resizeRect(start, "nw", -99999, -99999, DESK);
    expect(nw.x).toBe(0);
    expect(nw.y).toBe(0);
  });
});

describe("géométrie : cascade", () => {
  it("décale chaque nouvelle fenêtre et reste dans le bureau", () => {
    const a = geo.cascadeFractions(0);
    const b = geo.cascadeFractions(1);
    expect(b.x).toBeGreaterThan(a.x);
    for (let i = 0; i < 20; i += 1) {
      const f = geo.cascadeFractions(i);
      expect(f.x + f.w).toBeLessThanOrEqual(1);
      expect(f.y + f.h).toBeLessThanOrEqual(1);
    }
  });
});

describe("empilement et focus", () => {
  const open = (s: ReturnType<typeof stackMod.createStack>, key: string, iframe = true) =>
    s.open({ key, iframe });

  it("une seule instance par identité", () => {
    const s = stackMod.createStack();
    expect(open(s, "chat:m1").created).toBe(true);
    const again = open(s, "chat:m1");
    expect(again.created).toBe(false);
    expect(s.size()).toBe(1);
    expect(open(s, "viewer:m1").created).toBe(true);
    expect(s.size()).toBe(2);
  });

  it("le focus renumérote : la dernière focalisée est devant", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c"]) open(s, k);
    expect(s.order()).toEqual(["a", "b", "c"]);
    s.focus("a");
    expect(s.order()).toEqual(["b", "c", "a"]);
    expect(s.top()).toBe("a");
  });

  it("minimiser passe la main à la suivante ; focaliser restaure", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c"]) open(s, k);
    s.minimize("c");
    expect(s.top()).toBe("b");
    s.focus("c");
    expect(s.get("c").minimized).toBe(false);
    expect(s.top()).toBe("c");
    s.minimize("a");
    s.minimize("b");
    s.minimize("c");
    expect(s.top()).toBeNull();
  });

  it("fermer retire la fenêtre ; « suivante » vise la moins récemment focalisée", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c"]) open(s, k);
    expect(s.cycleTarget()).toBe("a");
    s.close("a");
    expect(s.has("a")).toBe(false);
    expect(s.cycleTarget()).toBe("b");
  });

  const visibleUnlessMin = (rec: { minimized: boolean }) => !rec.minimized;

  it("budget : décharge la minimisée la moins récemment focalisée", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c", "d"]) open(s, k);
    s.minimize("a");
    s.minimize("b");
    s.focus("a"); // a redevient récente, puis on la minimise de nouveau
    s.minimize("a");
    // Ordre de focus : b (ancienne) < c < d ... a la plus récente. Budget 3 → une éviction : b.
    expect(s.evictions(3, visibleUnlessMin)).toEqual(["b"]);
    expect(s.evictions(2, visibleUnlessMin)).toEqual(["b", "a"]);
  });

  it("budget : jamais une fenêtre visible, même au-delà du budget", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c", "d", "e"]) open(s, k);
    expect(s.evictions(2, visibleUnlessMin)).toEqual([]);
    s.minimize("b");
    expect(s.evictions(2, visibleUnlessMin)).toEqual(["b"]);
  });

  it("budget : seules les iframes vivantes comptent", () => {
    const s = stackMod.createStack();
    open(s, "n1", false);
    open(s, "n2", false);
    open(s, "f1");
    s.minimize("n1");
    s.minimize("f1");
    expect(s.aliveCount()).toBe(1);
    expect(s.evictions(1, visibleUnlessMin)).toEqual([]);
    expect(s.evictions(0, visibleUnlessMin)).toEqual(["f1"]);
    s.setAlive("f1", false);
    expect(s.aliveCount()).toBe(0);
    s.setAlive("n1", true); // un écran natif n'a pas de page à décharger
    expect(s.aliveCount()).toBe(0);
  });

  it("mode pile : seule la fenêtre active est visible, les autres sont éligibles", () => {
    const s = stackMod.createStack();
    for (const k of ["a", "b", "c", "d"]) open(s, k);
    const top = s.top();
    const evicted = s.evictions(stackMod.BUDGET_PHONE, (rec: { key: string }) => rec.key === top);
    expect(evicted).toEqual(["a"]);
    expect(stackMod.BUDGET_PHONE).toBe(3);
    expect(stackMod.BUDGET_DESKTOP).toBe(8);
  });
});

describe("types de fenêtres", () => {
  it("l'identité d'une iframe est (vue, cadre), comme celle de l'hôte de cadres", () => {
    expect(types.iframeSpec("mission", "m1")).toMatchObject({
      key: "chat:m1",
      view: "chat",
      frame: "m1",
      kind: "iframe",
    });
    expect(types.iframeSpec("monitor", "r1")).toMatchObject({ key: "viewer:r1", mode: "monitor" });
    expect(types.iframeSpec("output", "r1")).toMatchObject({ key: "viewer:r1", mode: "watch" });
    expect(types.iframeSpec("report", "m1")).toMatchObject({ key: "viewer:m1", mode: "report" });
    expect(types.iframeSpec("graph", "m1")?.view).toBe("killchain");
    expect(types.iframeSpec("mission", "a/b")).toBeNull();
    expect(types.iframeSpec("inconnu", "m1")).toBeNull();
    expect(types.iframeSpec("__proto__", "m1")).toBeNull();
  });

  it("écrans natifs uniques", () => {
    expect(types.nativeSpec("approvals")).toMatchObject({
      key: "native:approvals",
      kind: "native",
    });
    expect(types.nativeSpec("terminal")).toBeNull();
    expect(types.NATIVE_SCREENS.map((s: { name: string }) => s.name)).toContain("settings");
  });

  it("nouvelle mission : identifiant m-<6 base36>, fenêtre de chat, menu en trois groupes", () => {
    const id = types.newMissionId();
    expect(id).toMatch(/^m-[0-9a-z]{6}$/);
    expect(types.newMissionId()).not.toBe(id);
    expect(types.iframeSpec("mission", id)).toMatchObject({ key: `chat:${id}`, view: "chat" });
    expect(types.MENU_GROUPS.map((g: { title: string }) => g.title)).toEqual([
      "Mission",
      "Outils",
      "Écrans",
    ]);
    const actions = types.MENU_GROUPS.flatMap((g: { entries: { action: string }[] }) =>
      g.entries.map((e) => e.action),
    );
    for (const a of [
      "newMission",
      "fixed:cockpit",
      "fixed:studio",
      "forMission:graph",
      "terminal",
    ]) {
      expect(actions).toContain(a);
    }
    expect(types.iframeSpec("studio", "main")?.title).toBe("Projets et réglages");
  });

  it("lien profond → fenêtre", () => {
    const spec = (hash: string) => types.specFromRoute(frames.parseDeepLink(hash));
    expect(spec("#w=approbations")?.key).toBe("native:approvals");
    expect(spec("#w=mission:m1")?.key).toBe("chat:m1");
    expect(spec("#w=monitor:r_2")?.key).toBe("viewer:r_2");
    expect(spec("#w=graphe:m1")?.key).toBe("killchain:m1");
    expect(spec("#w=killchain:m1")?.key).toBe("killchain:m1");
    expect(spec("#w=cockpit")?.key).toBe("cockpit:main");
    expect(spec("#w=studio")?.key).toBe("studio:main");
    expect(spec("#w=sessions")?.key).toBe("sessions:main");
    expect(spec("#w=programme:p1")?.key).toBe("program:p1");
    expect(spec("#w=conteneurs")?.key).toBe("native:containers");
    expect(spec("#w=reglages")?.key).toBe("native:settings");
    for (const bad of ["#w=terminal", "#w=monitor:", "#w=constructor", "#w=__proto__:x", ""]) {
      expect(spec(bad)).toBeNull();
    }
    expect(types.specFromRoute(null)).toBeNull();
  });

  it("titre court d'onglet", () => {
    expect(types.shortTitle("Mission m1")).toBe("Mission m1");
    expect(types.shortTitle("x".repeat(40)).length).toBe(22);
  });
});
