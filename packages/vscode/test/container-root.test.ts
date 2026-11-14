import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInReservedFolder,
  DEFAULT_ROOT_NAME,
  ensureContainersRoot,
  planContainer,
  type RootDeps,
  removeReservedFolder,
  suggestName,
} from "../src/logic/container-root.js";

let base: string;
let home: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "warband-root-")));
  home = join(base, "home");
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const rootDeps = (over: Partial<RootDeps> = {}) => {
  const saved: string[] = [];
  const deps: RootDeps = {
    readSetting: () => undefined,
    saveSetting: async (path) => {
      saved.push(path);
    },
    home: () => home,
    confirmDefault: vi.fn(async () => "use" as const),
    pickFolder: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, saved };
};

describe("ensureContainersRoot", () => {
  it("réglage vide : la proposition acceptée est créée en 0o700 puis enregistrée", async () => {
    const { deps, saved } = rootDeps();
    const root = await ensureContainersRoot(deps);
    const expected = join(realpathSync.native(home), DEFAULT_ROOT_NAME);
    expect(root).toBe(expected);
    expect(deps.confirmDefault).toHaveBeenCalledWith(join(home, DEFAULT_ROOT_NAME));
    expect(statSync(expected).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(statSync(expected).mode & 0o777).toBe(0o700);
    expect(saved).toEqual([expected]);
  });

  it("réglage vide : « autre dossier » valide le dossier choisi et l'enregistre", async () => {
    const chosen = join(base, "ailleurs");
    mkdirSync(chosen);
    const { deps, saved } = rootDeps({
      confirmDefault: vi.fn(async () => "other" as const),
      pickFolder: vi.fn(async () => chosen),
    });
    await expect(ensureContainersRoot(deps)).resolves.toBe(chosen);
    expect(saved).toEqual([chosen]);
    expect(existsSync(join(home, DEFAULT_ROOT_NAME))).toBe(false);
  });

  it("annulation de la modale ou du sélecteur : rien n'est créé ni enregistré", async () => {
    const cancelled = rootDeps({ confirmDefault: vi.fn(async () => undefined) });
    await expect(ensureContainersRoot(cancelled.deps)).resolves.toBeUndefined();
    expect(cancelled.saved).toEqual([]);
    expect(existsSync(join(home, DEFAULT_ROOT_NAME))).toBe(false);
    const noPick = rootDeps({
      confirmDefault: vi.fn(async () => "other" as const),
      pickFolder: vi.fn(async () => undefined),
    });
    await expect(ensureContainersRoot(noPick.deps)).resolves.toBeUndefined();
    expect(noPick.saved).toEqual([]);
    expect(existsSync(join(home, DEFAULT_ROOT_NAME))).toBe(false);
  });

  it("réglage déjà posé : aucune modale, le chemin est revalidé", async () => {
    const root = join(base, "racine");
    mkdirSync(root);
    const { deps, saved } = rootDeps({ readSetting: () => root });
    await expect(ensureContainersRoot(deps)).resolves.toBe(root);
    expect(deps.confirmDefault).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("racine invalide : relative, absente, fichier ou lien symbolique → container.rootInvalid", async () => {
    const file = join(base, "fichier");
    writeFileSync(file, "x");
    const real = join(base, "reel");
    mkdirSync(real);
    const link = join(base, "lien");
    symlinkSync(real, link);
    for (const bad of ["relatif", join(base, "absent"), file, link, "/"]) {
      const configured = rootDeps({ readSetting: () => bad });
      await expect(ensureContainersRoot(configured.deps)).rejects.toMatchObject({
        code: "container.rootInvalid",
      });
      const picked = rootDeps({
        confirmDefault: vi.fn(async () => "other" as const),
        pickFolder: vi.fn(async () => bad),
      });
      await expect(ensureContainersRoot(picked.deps)).rejects.toMatchObject({
        code: "container.rootInvalid",
      });
      expect(picked.saved).toEqual([]);
    }
  });

  it("proposition dont le parent est absent : refusée sans rien créer", async () => {
    const { deps, saved } = rootDeps({ home: () => join(base, "sans-home") });
    await expect(ensureContainersRoot(deps)).rejects.toMatchObject({
      code: "container.rootInvalid",
    });
    expect(saved).toEqual([]);
    expect(existsSync(join(base, "sans-home"))).toBe(false);
  });
});

describe("nom automatique", () => {
  it("prend le plus petit numéro libre malgré les trous", () => {
    expect(suggestName("kali", [])).toBe("kali-1");
    expect(suggestName("kali", ["kali-1", "kali-3"])).toBe("kali-2");
    expect(suggestName("kali", ["kali-1", "kali-2", "kali-4"])).toBe("kali-3");
    expect(suggestName("exegol", ["exegol-1", "exegol-3", "kali-2"])).toBe("2");
  });

  it("tient compte des conteneurs Docker (tous états) et des dossiers de la racine", async () => {
    const deps = {
      listContainerNames: async () => ["kali-1", "exegol-1"],
      listRootFolders: async () => ["kali-2", "exegol-2", "autre"],
    };
    await expect(planContainer("kali", undefined, "/r", deps)).resolves.toEqual({
      name: "kali-3",
      folder: "kali-3",
    });
    await expect(planContainer("exegol", "", "/r", deps)).resolves.toEqual({
      name: "3",
      folder: "exegol-3",
    });
  });

  it("garde le nom valide de la webview et le met en minuscules pour le dossier", async () => {
    const deps = { listContainerNames: async () => [], listRootFolders: async () => [] };
    await expect(planContainer("kali", "Lab", "/r", deps)).resolves.toEqual({
      name: "Lab",
      folder: "lab",
    });
    await expect(planContainer("exegol", "htb1", "/r", deps)).resolves.toEqual({
      name: "htb1",
      folder: "exegol-htb1",
    });
    // Nom invalide : jamais utilisé comme chemin, retour au nom automatique.
    await expect(planContainer("kali", "../evil", "/r", deps)).resolves.toEqual({
      name: "kali-1",
      folder: "kali-1",
    });
  });
});

describe("createInReservedFolder", () => {
  let root: string;
  beforeEach(() => {
    root = join(base, "racine");
    mkdirSync(root);
  });

  it("réserve le dossier, prépare RedWidow et le fournit à la création", async () => {
    const seen: string[] = [];
    const folder = await createInReservedFolder(root, "kali-1", async (path) => {
      seen.push(path);
      return path;
    });
    expect(folder).toBe(join(root, "kali-1"));
    expect(seen).toEqual([folder]);
    for (const dir of ["evidence", "notes", "payloads", "reports", "scans", "scripts", "projects"])
      expect(statSync(join(folder, "RedWidow", dir)).isDirectory()).toBe(true);
  });

  it("échec de la création Docker : le dossier réservé est supprimé, l'erreur remontée", async () => {
    mkdirSync(join(root, "voisin"));
    await expect(
      createInReservedFolder(root, "kali-1", async () => {
        throw new Error("docker en échec");
      }),
    ).rejects.toThrow("docker en échec");
    expect(existsSync(join(root, "kali-1"))).toBe(false);
    expect(existsSync(join(root, "voisin"))).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  it("un fichier de l'utilisateur ou un conteneur existant empêche la suppression", async () => {
    await expect(
      createInReservedFolder(root, "kali-1", async (path) => {
        writeFileSync(join(path, "RedWidow", "notes", "n.md"), "x");
        throw new Error("échec");
      }),
    ).rejects.toThrow("échec");
    expect(existsSync(join(root, "kali-1", "RedWidow", "notes", "n.md"))).toBe(true);
    await expect(
      createInReservedFolder(
        root,
        "kali-2",
        async () => {
          throw new Error("échec");
        },
        { containerExists: async () => true },
      ),
    ).rejects.toThrow("échec");
    expect(existsSync(join(root, "kali-2"))).toBe(true);
  });

  it("dossier déjà présent ou racine invalide : refus sans rien toucher", async () => {
    mkdirSync(join(root, "kali-1"));
    writeFileSync(join(root, "kali-1", "mien.txt"), "x");
    const create = vi.fn(async () => 1);
    await expect(createInReservedFolder(root, "kali-1", create)).rejects.toMatchObject({
      code: "project.destinationExists",
    });
    expect(create).not.toHaveBeenCalled();
    expect(existsSync(join(root, "kali-1", "mien.txt"))).toBe(true);
    await expect(
      createInReservedFolder(join(base, "absent"), "kali-1", create),
    ).rejects.toMatchObject({ code: "container.rootInvalid" });
    await expect(createInReservedFolder("relatif", "kali-1", create)).rejects.toMatchObject({
      code: "container.rootInvalid",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("removeReservedFolder", () => {
  let root: string;
  beforeEach(() => {
    root = join(base, "racine");
    mkdirSync(root);
  });

  it("ne supprime jamais hors de la racine, la racine elle-même ni un sous-dossier profond", async () => {
    const outside = join(base, "dehors");
    mkdirSync(outside);
    expect(await removeReservedFolder(root, outside)).toBe(false);
    expect(existsSync(outside)).toBe(true);
    expect(await removeReservedFolder(root, root)).toBe(false);
    expect(existsSync(root)).toBe(true);
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(await removeReservedFolder(root, join(root, "a", "b"))).toBe(false);
    expect(existsSync(join(root, "a", "b"))).toBe(true);
  });

  it("refuse un lien symbolique vers l'extérieur, sans suivre ni supprimer la cible", async () => {
    const outside = join(base, "dehors");
    mkdirSync(outside);
    symlinkSync(outside, join(root, "kali-1"));
    expect(await removeReservedFolder(root, join(root, "kali-1"))).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("refuse un contenu étranger ou un lien dans l'arborescence RedWidow", async () => {
    mkdirSync(join(root, "kali-1", "RedWidow", "scans"), { recursive: true });
    mkdirSync(join(root, "kali-1", "RedWidow", "perso"));
    expect(await removeReservedFolder(root, join(root, "kali-1"))).toBe(false);
    mkdirSync(join(root, "kali-2", "autre"), { recursive: true });
    expect(await removeReservedFolder(root, join(root, "kali-2"))).toBe(false);
    expect(existsSync(join(root, "kali-1"))).toBe(true);
    expect(existsSync(join(root, "kali-2"))).toBe(true);
  });
});
