import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  projectInSharedFolder,
  resolveCreationFolder,
  resolveCreationShare,
  validateSharedFolder,
} from "../src/logic/shared-folder.js";

let base: string;
let home: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "warband-shared-")));
  home = join(base, "home");
  mkdirSync(join(home, ".ssh"), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const dir = (...parts: string[]) => {
  const path = join(base, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

it("accepte un dossier ordinaire et renvoie son chemin réel", async () => {
  const shared = dir("partage");
  await expect(validateSharedFolder(shared, { home })).resolves.toBe(shared);
});

it("refuse un chemin relatif, absent, un fichier et un lien symbolique", async () => {
  await expect(validateSharedFolder("partage", { home })).rejects.toThrow(/absolu/);
  await expect(validateSharedFolder(join(base, "absent"), { home })).rejects.toThrow(/introuvable/);
  const file = join(base, "fichier");
  writeFileSync(file, "x");
  await expect(validateSharedFolder(file, { home })).rejects.toThrow(/dossier/);
  const target = dir("cible");
  const link = join(base, "lien");
  symlinkSync(target, link);
  await expect(validateSharedFolder(link, { home })).rejects.toThrow(/lien symbolique/);
});

it("refuse un dossier qui expose un chemin sensible (dossier personnel, racine, /etc)", async () => {
  await expect(validateSharedFolder(home, { home })).rejects.toThrow(/sensibles/);
  await expect(validateSharedFolder(join(home, ".ssh"), { home })).rejects.toThrow(/sensibles/);
  await expect(validateSharedFolder("/", { home })).rejects.toThrow(/sensibles/);
  // Racine du disque du dossier de test (« D:\\ » sous Windows, « / » ailleurs).
  await expect(validateSharedFolder(parse(base).root, { home })).rejects.toThrow(/sensibles/);
  if (process.platform !== "win32")
    await expect(validateSharedFolder("/etc", { home })).rejects.toThrow(/sensibles/);
  // Le vrai dossier personnel de la machine de test est lui aussi refusé s'il contient des secrets.
  expect(homedir()).toBeTypeOf("string");
});

it("la création sans dossier choisi est refusée", async () => {
  const project = { workspace: dir("projet") };
  await expect(resolveCreationFolder(undefined, project, { home })).rejects.toThrow(
    "Choisissez le dossier partagé.",
  );
});

it("la source du montage est le dossier choisi, pas celui du projet", async () => {
  const shared = dir("partage");
  const project = { workspace: dir("ailleurs", "projet") };
  const plan = await resolveCreationFolder(shared, project, { home });
  expect(plan.source).toBe(shared);
  expect(plan.source).not.toBe(project.workspace);
});

it("la liaison est faite si le projet est dans le dossier partagé ou égal à lui", async () => {
  const shared = dir("partage");
  const inside = dir("partage", "sous", "projet");
  await expect(resolveCreationFolder(shared, { workspace: inside }, { home })).resolves.toEqual({
    source: shared,
    link: true,
  });
  await expect(resolveCreationFolder(shared, { workspace: shared }, { home })).resolves.toEqual({
    source: shared,
    link: true,
  });
});

it("la liaison est absente si le projet est hors du dossier partagé (sans erreur)", async () => {
  const shared = dir("partage");
  const outside = dir("partage-voisin", "projet");
  await expect(resolveCreationFolder(shared, { workspace: outside }, { home })).resolves.toEqual({
    source: shared,
    link: false,
  });
  // Un préfixe de nom identique ne vaut pas inclusion.
  expect(await projectInSharedFolder(shared, join(base, "partage-voisin"))).toBe(false);
  // Projet parent du dossier partagé : pas dans le montage.
  expect(await projectInSharedFolder(shared, base)).toBe(false);
  expect(await projectInSharedFolder(shared, join(base, "inexistant"))).toBe(false);
});

it("revalide le dossier mémorisé juste avant la création", async () => {
  const shared = dir("partage");
  rmSync(shared, { recursive: true });
  await expect(resolveCreationFolder(shared, { workspace: base }, { home })).rejects.toThrow(
    /introuvable/,
  );
  // Un chemin mémorisé qui n'est plus son propre chemin réel (remplacé par un lien) est refusé.
  const target = dir("cible");
  symlinkSync(target, shared);
  await expect(resolveCreationFolder(shared, { workspace: base }, { home })).rejects.toThrow(
    /lien symbolique/,
  );
});

it("sans projet actif : source validée, pas de liaison", async () => {
  const shared = dir("partage");
  await expect(resolveCreationFolder(shared, undefined, { home })).resolves.toEqual({
    source: shared,
    link: false,
  });
});

it("sans projet actif, le dossier partagé reste exigé", async () => {
  await expect(resolveCreationFolder(undefined, undefined, { home })).rejects.toThrow(
    "Choisissez le dossier partagé.",
  );
});

it("mode projet : la source est le dossier du projet actif, le dossier mémorisé est ignoré", async () => {
  const project = { workspace: dir("projets", "mission") };
  const remembered = dir("autre-partage");
  await expect(resolveCreationShare("project", remembered, project, { home })).resolves.toEqual({
    source: project.workspace,
    link: true,
  });
  await expect(resolveCreationShare("project", undefined, project, { home })).resolves.toEqual({
    source: project.workspace,
    link: true,
  });
});

it("mode projet : refus sans projet actif, dossier absent, lien symbolique ou racine d'un disque", async () => {
  await expect(resolveCreationShare("project", dir("p"), undefined, { home })).rejects.toThrow(
    "Choisissez un projet avant de créer son conteneur.",
  );
  await expect(
    resolveCreationShare("project", undefined, { workspace: join(base, "absent") }, { home }),
  ).rejects.toThrow(/introuvable/);
  const link = join(base, "lien-projet");
  symlinkSync(dir("cible-projet"), link);
  await expect(
    resolveCreationShare("project", undefined, { workspace: link }, { home }),
  ).rejects.toThrow(/lien symbolique/);
  await expect(
    resolveCreationShare("project", undefined, { workspace: parse(base).root }, { home }),
  ).rejects.toThrow(/données sensibles/);
});

it("mode multi : même comportement que resolveCreationFolder", async () => {
  const shared = dir("partage");
  const project = { workspace: dir("partage", "mission") };
  await expect(resolveCreationShare("multi", shared, project, { home })).resolves.toEqual({
    source: shared,
    link: true,
  });
  await expect(resolveCreationShare("multi", undefined, project, { home })).rejects.toThrow(
    "Choisissez le dossier partagé.",
  );
});
