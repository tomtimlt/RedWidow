import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const model = await load("../web/lib/containers-model.js");
const reasons = await load("../web/lib/reasons.js");

const ready = {
  docker: { present: true, daemon: true },
  kali: { image: "warband/kali:complete-1", installed: false },
  exegol: { cli: true, eulaAccepted: true, installed: [], available: ["free", "full"] },
};

describe("lecture des messages du serveur", () => {
  it("containers : dossier partagé, projets, valeurs bornées", () => {
    const items = model.parseContainers({
      items: [
        {
          id: "a",
          name: "kali-1",
          image: "i",
          state: "running",
          kind: "kali",
          folder: "kali-1",
          projects: [{ id: "p1", name: "Acme" }, { id: "" }, "x"],
        },
        { id: "b", name: "x", folder: "../etc" },
      ],
    });
    expect(items[0]).toMatchObject({ folder: "kali-1", projects: [{ id: "p1", name: "Acme" }] });
    expect(items[1]?.folder).toBe("");
    expect(items[1]?.projects).toEqual([]);
  });

  it("projects : lié ou à lier", () => {
    const list = model.parseProjectList({
      items: [
        { id: "p1", name: "Acme", linked: true, container: "kali-1" },
        { id: "p2", name: "Vieux", linked: false },
        { id: "", name: "x" },
        7,
      ],
    });
    expect(list).toEqual([
      { id: "p1", name: "Acme", linked: true, container: "kali-1" },
      { id: "p2", name: "Vieux", linked: false, container: "" },
    ]);
    expect(model.parseProjectList(null)).toEqual([]);
  });

  it("images : état, étiquettes valides seulement", () => {
    const img = model.parseImages({
      docker: { present: true, daemon: false },
      kali: { image: "k", installed: true, size: 100 },
      exegol: {
        cli: true,
        eulaAccepted: false,
        installed: [{ tag: "free", size: 5 }, { tag: "BAD TAG" }],
        available: ["free", "web", "x y", 3],
      },
    });
    expect(img.docker).toEqual({ present: true, daemon: false });
    expect(img.kali).toEqual({ image: "k", installed: true, size: 100 });
    expect(img.exegol.installed).toEqual([{ tag: "free", size: 5 }]);
    expect(img.exegol.available).toEqual(["free", "web"]);
    expect(model.parseImages("x")).toBeNull();
  });

  it("imageProgress : couches, fin, erreur ; message illisible écarté", () => {
    const p = model.parseImageProgress({
      id: "0123456789abcdef",
      kind: "exegol",
      phase: "pull",
      stage: "Téléchargement",
      layers: [
        {
          id: "l1",
          status: "Downloading",
          phase: "download",
          current: 5,
          total: 10,
          speedBytesPerSecond: 2,
        },
        { id: 3 },
      ],
      busy: true,
    });
    expect(p).toMatchObject({ kind: "exegol", phase: "pull", busy: true, done: false });
    expect(p.layers).toEqual([
      { id: "l1", status: "Downloading", phase: "download", current: 5, total: 10, speed: 2 },
    ]);
    const err = model.parseImageProgress({
      id: "x",
      kind: "kali",
      busy: false,
      error: "boom",
      code: "image.rateLimited",
    });
    expect(err).toMatchObject({ busy: false, code: "image.rateLimited" });
    expect(model.parseImageProgress({ id: "x", kind: "autre" })).toBeNull();
    expect(model.parseImageProgress({ kind: "kali" })).toBeNull();
  });
});

describe("pourcentages et formats", () => {
  it("couche et total", () => {
    expect(model.layerPercent({ current: 5, total: 10 })).toBe(50);
    expect(model.layerPercent({ current: 50, total: 10 })).toBe(100);
    expect(model.layerPercent({})).toBeNull();
    expect(
      model.overallPercent([
        { phase: "download", current: 10, total: 100 },
        { phase: "download", current: 90, total: 100 },
        { phase: "extract", current: 1, total: 1 },
      ]),
    ).toBe(50);
    expect(model.overallPercent([])).toBeNull();
  });

  it("tailles", () => {
    expect(model.formatBytes(512)).toBe("512 o");
    expect(model.formatBytes(1536)).toBe("1,5 Ko");
    expect(model.formatBytes(3 * 1024 ** 3)).toBe("3,0 Go");
    expect(model.formatBytes(undefined)).toBe("—");
    expect(model.formatSpeed(undefined)).toBe("");
  });
});

describe("regroupement des projets", () => {
  it("par conteneur, projets à lier à part", () => {
    const containers = [{ name: "kali-1" }, { name: "exegol-1" }, { name: "vide" }];
    const g = model.groupProjects(
      [
        { id: "1", name: "a", linked: true, container: "exegol-1" },
        { id: "2", name: "b", linked: true, container: "kali-1" },
        { id: "3", name: "c", linked: false, container: "" },
        { id: "4", name: "d", linked: true, container: "disparu" },
        { id: "5", name: "e", linked: true, container: "kali-1" },
      ],
      containers,
    );
    expect(g.groups.map((x: { container: string }) => x.container)).toEqual([
      "kali-1",
      "exegol-1",
      "disparu",
    ]);
    expect(g.groups[0].items).toHaveLength(2);
    expect(g.groups[2].known).toBe(false);
    expect(g.toLink.map((p: { id: string }) => p.id)).toEqual(["3"]);
  });

  it("nombre de projets d'un conteneur", () => {
    const grouped = model.groupProjects(
      [{ id: "1", name: "a", linked: true, container: "k" }],
      [{ name: "k" }],
    );
    expect(model.projectCount({ name: "k", projects: [] }, grouped)).toBe(1);
    expect(model.projectCount({ name: "k", projects: [{}, {}] }, grouped)).toBe(2);
    expect(model.projectCount({ name: "z", projects: [] }, grouped)).toBe(0);
  });
});

describe("noms saisis", () => {
  it("conteneur et projet", () => {
    expect(model.checkContainerName("kali-1")).toBeNull();
    expect(model.checkContainerName("")).not.toBeNull();
    expect(model.checkProjectName("Mon projet")).toBeNull();
    for (const bad of ["", "  ", "x".repeat(81), "a\u0000b"])
      expect(model.checkProjectName(bad)).not.toBeNull();
  });
});

describe("disponibilité des boutons", () => {
  const idle = { online: true, images: ready, progress: null, pending: false };

  it("rien n'est possible hors ligne", () => {
    const a = model.installAvailability({ ...idle, online: false });
    expect(a).toMatchObject({
      kaliInstall: false,
      kaliRebuild: false,
      exegolInstall: false,
      exegolEula: false,
      cancel: false,
    });
  });

  it("au repos : installer Kali (absente) et un tag Exegol", () => {
    const a = model.installAvailability(idle);
    expect(a).toMatchObject({
      busy: false,
      kaliInstall: true,
      kaliRebuild: false,
      exegolInstall: true,
    });
    const b = model.installAvailability({
      ...idle,
      images: { ...ready, kali: { ...ready.kali, installed: true } },
    });
    expect(b).toMatchObject({ kaliInstall: false, kaliRebuild: true });
  });

  it("un seul install à la fois : en cours ou demandé, tout est désactivé, Annuler actif", () => {
    const progress = { id: "0123456789abcdef", kind: "kali", busy: true };
    const run = model.installAvailability({ ...idle, progress });
    expect(run).toMatchObject({
      busy: true,
      kaliInstall: false,
      kaliRebuild: false,
      exegolInstall: false,
      cancel: true,
    });
    const asked = model.installAvailability({ ...idle, pending: true });
    expect(asked).toMatchObject({ busy: true, exegolInstall: false, cancel: false });
    const finished = model.installAvailability({ ...idle, progress: { ...progress, busy: false } });
    expect(finished.exegolInstall).toBe(true);
  });

  it("démon injoignable ou contrat refusé : pas d'installation", () => {
    const down = model.installAvailability({
      ...idle,
      images: { ...ready, docker: { present: true, daemon: false } },
    });
    expect(down).toMatchObject({ kaliInstall: false, exegolInstall: false });
    const noEula = model.installAvailability({
      ...idle,
      images: { ...ready, exegol: { ...ready.exegol, eulaAccepted: false } },
    });
    expect(noEula).toMatchObject({ exegolInstall: false, exegolEula: true });
    const noCli = model.installAvailability({
      ...idle,
      images: { ...ready, exegol: { ...ready.exegol, cli: false } },
    });
    expect(noCli).toMatchObject({ exegolInstall: false, exegolEula: false });
    expect(model.installAvailability({ ...idle, images: null }).kaliInstall).toBe(false);
  });
});

describe("catalogue de raisons", () => {
  it("libelle les codes connus, affiche les inconnus tels quels", () => {
    expect(reasons.reasonText("image.rateLimited")).toContain("Réessayez plus tard");
    expect(reasons.reasonText("project.noContainer")).toContain("Créez d'abord un conteneur");
    expect(reasons.reasonText("zzz.inconnu")).toBe("Refusé (zzz.inconnu)");
    expect(reasons.reasonText(undefined)).toBe("Refusé ()");
  });
});
