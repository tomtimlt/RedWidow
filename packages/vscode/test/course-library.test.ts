import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listCourseDocuments,
  listCourseSources,
  readCourseDocument,
  readSelectedCourseDocument,
  restoreCourseSection,
} from "../src/logic/course-library.js";

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cours-local-"));
  outside = mkdtempSync(join(tmpdir(), "cours-externe-"));
  mkdirSync(join(root, "source"));
  writeFileSync(join(root, "source", "lecon.md"), "# Un\nTexte\n# Deux\nSuite");
  writeFileSync(join(outside, "secret.txt"), "DONNEE_FACTICE_EXTERNE");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
describe.skipIf(process.platform !== "linux")("bibliothèque locale confinée", () => {
  it("liste les documents et découpe les sections", async () => {
    const [source] = await listCourseSources(root);
    const [doc] = await listCourseDocuments(root, source!.id);
    expect(doc?.name).toBe("lecon.md");
    expect((await readCourseDocument(root, source!.id, doc!.id))?.sections).toEqual([
      "# Un\nTexte\n",
      "# Deux\nSuite",
    ]);
  });
  it("refuse chemins, liens, fichiers supprimés et fichiers trop grands", async () => {
    symlinkSync(outside, join(root, "lien"), "dir");
    symlinkSync(join(outside, "secret.txt"), join(root, "source", "lien.txt"));
    const sources = await listCourseSources(root);
    expect(sources.map((s) => s.name)).toEqual(["source"]);
    const source = sources[0]!;
    const docs = await listCourseDocuments(root, source.id);
    expect(docs.map((d) => d.name)).toEqual(["lecon.md"]);
    expect(await listCourseDocuments(root, "../source")).toEqual([]);
    expect(await readCourseDocument(root, source.id, "../../secret.txt")).toBeNull();
    rmSync(join(root, "source", "lecon.md"));
    expect(await readCourseDocument(root, source.id, docs[0]!.id)).toBeNull();
    writeFileSync(join(root, "source", "large.txt"), "x".repeat(128 * 1024 + 1));
    const [large] = await listCourseDocuments(root, source.id);
    expect(await readCourseDocument(root, source.id, large!.id)).toBeNull();
  });
});

it("restaure une section valide et borne les anciennes positions", () => {
  expect(restoreCourseSection(1, 3)).toBe(1);
  expect(restoreCourseSection(20, 3)).toBe(2);
  expect(restoreCourseSection("1", 3)).toBe(0);
  expect(restoreCourseSection(-1, 3)).toBe(0);
});

it.each(["win32", "darwin"])("désactive toutes les lectures externes sur %s", async (platform) => {
  vi.stubGlobal("process", { platform });
  try {
    expect(await listCourseSources(root)).toEqual([]);
    expect(await listCourseDocuments(root, "a".repeat(64))).toEqual([]);
    expect(await readCourseDocument(root, "a".repeat(64), "b".repeat(64))).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("lit uniquement un fichier sélectionné valide et borné", async () => {
  expect(
    (await readSelectedCourseDocument(join(root, "source", "lecon.md")))?.sections,
  ).toHaveLength(2);
  expect(await readSelectedCourseDocument("relative.md")).toBeNull();
  expect(await readSelectedCourseDocument(join(outside, "absent.txt"))).toBeNull();
  writeFileSync(join(outside, "non.md.exe"), "texte");
  expect(await readSelectedCourseDocument(join(outside, "non.md.exe"))).toBeNull();
  writeFileSync(join(outside, "gros.txt"), "x".repeat(128 * 1024 + 1));
  expect(await readSelectedCourseDocument(join(outside, "gros.txt"))).toBeNull();
});

it.skipIf(process.platform !== "linux")("refuse un lien symbolique choisi", async () => {
  symlinkSync(join(outside, "secret.txt"), join(root, "source", "lien.txt"));
  expect(await readSelectedCourseDocument(join(root, "source", "lien.txt"))).toBeNull();
});
