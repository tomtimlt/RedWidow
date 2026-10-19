import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CodedError, checkRelativePath, confinePath, isInside } from "../src/index.js";

let base: string;
let root: string;
let canLink = true;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "cours-confine-"));
  root = join(base, "cours");
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "a.md"), "a");
  await writeFile(join(root, "sub", "b.md"), "b");
  // Voisins sensibles : fichier de politique et dossier frère au préfixe commun.
  await writeFile(join(base, "policy.json"), "{}");
  await mkdir(join(base, "cours-secret"));
  await writeFile(join(base, "cours-secret", "s.md"), "secret");
  try {
    await symlink(join(base, "policy.json"), join(root, "lien-fichier"));
    await symlink(base, join(root, "lien-dossier"), "dir");
    await symlink(join(base, "cours-secret"), join(root, "lien-frere"), "dir");
    await symlink(join(root, "sub"), join(root, "lien-interne"), "dir");
  } catch {
    canLink = false;
  }
});
afterAll(() => rm(base, { recursive: true, force: true }));

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof CodedError ? e.code : `autre:${String(e)}`;
  }
  return "ok";
};

describe("checkRelativePath (pur)", () => {
  it.each([
    ["..", "path.outside"],
    ["a/../../x", "path.outside"],
    ["a\\..\\..\\x", "path.outside"],
    ["/etc/passwd", "path.outside"],
    ["C:\\x", "path.outside"],
    ["\\x", "path.outside"],
    ["\\\\srv\\x", "path.unsupported"],
    ["a\0b", "path.unsupported"],
    ["a/b:c", "path.unsupported"],
    ["a.md:flux", "path.unsupported"],
    ["", "path.unsupported"],
  ])("refuse %j", (rel, expected) => {
    try {
      checkRelativePath(rel);
      expect.unreachable();
    } catch (e) {
      expect((e as CodedError).code).toBe(expected);
    }
  });

  it("accepte et normalise un chemin ordinaire", () => {
    expect(checkRelativePath("sub\\./b.md")).toEqual(["sub", "b.md"]);
  });
});

describe("isInside", () => {
  it("exige le séparateur et ignore la casse sous win32", () => {
    expect(isInside("/c/cours", "/c/cours-secret/x", "linux")).toBe(false);
    expect(isInside("/c/cours", "/c/cours/x", "linux")).toBe(true);
    expect(isInside("/c/cours", "/c/Cours/x", "linux")).toBe(false);
    expect(isInside("C:\\Cours", "c:\\cours\\x", "win32")).toBe(true);
    expect(isInside("C:\\Cours", "C:\\Cours-secret\\x", "win32")).toBe(false);
  });
});

describe("confinePath", () => {
  it("accepte un fichier de la racine", async () => {
    const r = await confinePath(root, "sub/b.md");
    expect(r.real.endsWith("b.md")).toBe(true);
  });

  it("refuse le parent policy.json", async () => {
    expect(await code(confinePath(root, "../policy.json"))).toBe("path.outside");
  });

  it("racine absente : cours.absent (aucun cours installé)", async () => {
    expect(await code(confinePath(join(base, "absent"), "a.md"))).toBe("cours.absent");
  });

  it("fichier absent : refusé", async () => {
    expect(await code(confinePath(root, "nope.md"))).toBe("path.unsupported");
  });

  it("préfixe frère refusé (realpath injecté)", async () => {
    const real = async (p: string) => (p === "/r/cours" ? p : "/r/cours-secret/s.md");
    expect(await code(confinePath("/r/cours", "x.md", { realpath: real, platform: "linux" }))).toBe(
      "path.outside",
    );
  });

  it("casse indifférente sous win32 (realpath injecté)", async () => {
    const real = async (p: string) => (p === "C:\\Cours" ? p : "c:\\cours\\x.md");
    expect(
      await code(confinePath("C:\\Cours", "x.md", { realpath: real, platform: "win32" })),
    ).toBe("ok");
  });

  it("liens sortants refusés, lien interne accepté", async (t) => {
    if (!canLink) return t.skip();
    expect(await code(confinePath(root, "lien-fichier"))).toBe("path.outside");
    expect(await code(confinePath(root, "lien-dossier/policy.json"))).toBe("path.outside");
    expect(await code(confinePath(root, "lien-frere/s.md"))).toBe("path.outside");
    expect(await code(confinePath(root, "lien-interne/b.md"))).toBe("ok");
  });

  it("racine liée : on confine sur sa cible", async (t) => {
    if (!canLink) return t.skip();
    const lien = join(base, "racine-liee");
    await symlink(root, lien, "dir");
    expect(await code(confinePath(lien, "a.md"))).toBe("ok");
    expect(await code(confinePath(lien, "../policy.json"))).toBe("path.outside");
  });
});
