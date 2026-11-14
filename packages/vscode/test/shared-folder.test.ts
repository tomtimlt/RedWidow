import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { projectInSharedFolder } from "../src/logic/shared-folder.js";

let base: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "warband-shared-")));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const dir = (...parts: string[]) => {
  const path = join(base, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

it("le dossier du projet dans le partage ou égal à lui est reconnu", async () => {
  const shared = dir("partage");
  const inside = dir("partage", "RedWidow", "projects", "p");
  expect(await projectInSharedFolder(shared, inside)).toBe(true);
  expect(await projectInSharedFolder(shared, shared)).toBe(true);
});

it("un dossier voisin, parent ou absent n'est pas dans le partage", async () => {
  const shared = dir("partage");
  dir("partage-voisin");
  expect(await projectInSharedFolder(shared, join(base, "partage-voisin"))).toBe(false);
  expect(await projectInSharedFolder(shared, base)).toBe(false);
  expect(await projectInSharedFolder(shared, join(base, "inexistant"))).toBe(false);
});

it("un lien symbolique est résolu avant la comparaison", async () => {
  const shared = dir("partage");
  const outside = dir("dehors");
  symlinkSync(outside, join(shared, "lien"));
  expect(await projectInSharedFolder(shared, join(shared, "lien"))).toBe(false);
});
