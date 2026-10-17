import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COURS_SERVER_NAME,
  COURS_TOOL_PREFIX,
  type CoursLimits,
  coursToolSpecs,
  type DockerToolSpec,
} from "../src/index.js";

let base: string;
let root: string;
let canLink = true;

const ctx = { parentId: null, correlation: undefined, signal: undefined };
const tool = (specs: DockerToolSpec[], name: string) =>
  specs.find((s) => s.name === name) as DockerToolSpec;
const specs = (limits: Partial<CoursLimits> = {}) => coursToolSpecs(root, limits);
const chercher = (q: string, limits: Partial<CoursLimits> = {}) =>
  tool(specs(limits), "chercher").run({ requete: q }, ctx);
const lire = (chemin: string, debut?: number, limits: Partial<CoursLimits> = {}) =>
  tool(specs(limits), "lire").run({ chemin, ...(debut && { debut }) }, ctx);

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "cours-tools-"));
  root = join(base, "cours");
  await mkdir(join(root, "net", "deep"), { recursive: true });
  await writeFile(join(root, "net", "tcp.md"), "# TCP\nLe Handshake a trois temps.\nfin\n");
  await writeFile(join(root, "net", "deep", "x.txt"), "handshake profond\n");
  await writeFile(join(root, "note.bin"), "handshake binaire\n");
  await writeFile(join(root, "regex.md"), "a.*b\nacb\n");
  await writeFile(join(root, "gros.md"), `${"x".repeat(1000)}\n`.repeat(50));
  await writeFile(join(base, "secret.md"), "handshake secret\n");
  try {
    await symlink(join(base, "secret.md"), join(root, "lien.md"));
    await symlink(base, join(root, "lien-dir"), "dir");
  } catch {
    canLink = false;
  }
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("coursToolSpecs", () => {
  it("expose deux outils en lecture seule", () => {
    const s = specs();
    expect(s.map((x) => x.name)).toEqual(["chercher", "lire"]);
    expect(s.every((x) => x.readOnly && !x.destructive)).toBe(true);
    expect(COURS_TOOL_PREFIX).toBe(`mcp__${COURS_SERVER_NAME}__`);
  });
});

describe("chercher", () => {
  it("insensible à la casse, .md et .txt seulement, ni lien suivi", async () => {
    const out = await chercher("HANDSHAKE");
    expect(out).toContain("net/tcp.md:2: Le Handshake a trois temps.");
    expect(out).toContain("net/deep/x.txt:1: handshake profond");
    expect(out).not.toContain("note.bin");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("lien");
  });

  it("traite .* littéralement", async () => {
    const out = await chercher("a.*b");
    expect(out).toContain("regex.md:1: a.*b");
    expect(out).not.toContain("regex.md:2");
  });

  it("aucun résultat", async () => {
    expect(await chercher("introuvable-zzz")).toBe("aucun résultat");
  });

  it("plafond de résultats", async () => {
    const out = await chercher("handshake", { maxResults: 1 });
    expect(out.split("\n").filter((l) => l.includes(":"))).toHaveLength(2);
    expect(out).toContain("plafond atteint : résultats");
  });

  it("plafond de fichiers, de profondeur et d'octets", async () => {
    expect(await chercher("handshake", { maxFiles: 1 })).toContain("fichiers");
    const shallow = await chercher("handshake", { maxDepth: 1 });
    expect(shallow).not.toContain("x.txt");
    expect(shallow).toContain("profondeur");
    expect(await chercher("x", { maxTotalBytes: 10 })).toContain("octets");
  });

  it("plafonne l'extrait", async () => {
    const out = await chercher("xxx", { maxExcerpt: 20, maxResults: 1 });
    expect(out.split("\n")[0]?.length).toBeLessThan("gros.md:1: ".length + 25);
  });

  it("refuse une requête vide", async () => {
    await expect(chercher("")).rejects.toThrow();
  });

  it("racine absente : erreur", async () => {
    await expect(
      tool(coursToolSpecs(join(base, "absent")), "chercher").run({ requete: "x" }, ctx),
    ).rejects.toMatchObject({ code: "path.unsupported" });
  });
});

describe("lire", () => {
  it("lit à partir d'une ligne, numérotée", async () => {
    expect(await lire("net/tcp.md", 2)).toBe("2: Le Handshake a trois temps.\n3: fin\n4: ");
    expect((await lire("net\\tcp.md")).startsWith("1: # TCP")).toBe(true);
  });

  it("plafonne la sortie avec un marqueur", async () => {
    const out = await lire("gros.md", 1, { maxOutputBytes: 100 });
    expect(out).toContain("sortie tronquée à 100 octets");
  });

  it("lecture bornée sur un fichier plus grand que le plafond", async () => {
    const out = await lire("gros.md", 1, { maxReadBytes: 2000 });
    expect(out).toContain("fichier lu partiellement : 2000 octets sur 50050");
    expect(out.split("\n").length).toBeLessThan(5);
  });

  it("refuse ce qui sort de la racine", async () => {
    await expect(lire("../secret.md")).rejects.toMatchObject({ code: "path.outside" });
    await expect(lire("/etc/hostname")).rejects.toMatchObject({ code: "path.outside" });
  });

  it("refuse un lien sortant", async (t) => {
    if (!canLink) return t.skip();
    await expect(lire("lien.md")).rejects.toMatchObject({ code: "path.outside" });
    await expect(lire("lien-dir/secret.md")).rejects.toMatchObject({ code: "path.outside" });
  });

  it("refuse un dossier", async () => {
    await expect(lire("net")).rejects.toMatchObject({ code: "path.unsupported" });
  });

  it.skipIf(process.platform === "win32")("refuse un FIFO sans bloquer", async () => {
    execFileSync("mkfifo", [join(root, "tube.md")]);
    await expect(lire("tube.md")).rejects.toMatchObject({ code: "path.unsupported" });
  });
});
