import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  createProjectDirectory,
  projectDataDir,
  readProjects,
  registerImportedProject,
} from "@warband/core";
import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import {
  exportProjectArchive,
  importProjectArchive,
  PROJECT_ARCHIVE_MANIFEST,
} from "../src/logic/project-archive.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rwproj-"));
  roots.push(dir);
  return dir;
}

/** Un « poste » : configDir et dossier parent propres, avec un projet source prêt à exporter. */
async function machine() {
  const root = await tmp();
  const configDir = join(root, "config");
  const parent = join(root, "parent");
  await mkdir(configDir, { recursive: true });
  await mkdir(parent, { recursive: true });
  return { root, configDir, parent };
}

async function sourceProject(m: { configDir: string; parent: string }, name = "Mon Projet") {
  const workspace = await createProjectDirectory(name, m.parent);
  const id = randomUUID();
  await registerImportedProject(m.configDir, { id, name, workspace });
  await writeFile(join(workspace, "notes", "a.md"), "bonjour\n");
  await mkdir(join(workspace, "scans", "deep"), { recursive: true });
  await writeFile(join(workspace, "scans", "deep", "b.bin"), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(workspace, ".redwidow-share-abc"), "marqueur");
  await symlink("/etc/passwd", join(workspace, "lien"));
  const data = projectDataDir(m.configDir, id);
  await mkdir(join(data, "audit"), { recursive: true });
  await writeFile(join(data, "audit", "j.jsonl"), '{"k":1}\n');
  return { id, workspace, name };
}

interface RawEntry {
  name: string;
  data?: Buffer | string;
  mode?: number;
}
type ManifestFile = { path: string; size: number; sha256: string };

/** Zip bâti à la main, avec un manifeste dérivé des entrées sauf indication contraire. */
async function makeZip(
  file: string,
  entries: RawEntry[],
  options: {
    manifest?: Record<string, unknown> | null;
    files?: (derived: ManifestFile[]) => ManifestFile[];
    id?: string;
    name?: string;
  } = {},
) {
  const zip = new ZipFile();
  // yazl refuse `..` et les chemins absolus : on écrit un nom de même longueur, remplacé ensuite.
  const patches: [string, string][] = [];
  const derived: ManifestFile[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const safe = e.name.replace(/\.\./g, "__").replace(/^\//, "_");
    if (safe !== e.name) patches.push([safe, e.name]);
    zip.addBuffer(data, safe, { mode: e.mode ?? 0o100600 });
    if (!e.name.endsWith("/") && e.mode !== 0o120777)
      derived.push({ path: e.name, size: data.length, sha256: sha(data) });
  }
  if (options.manifest !== null) {
    const manifest = options.manifest ?? {
      format: "redwidow-project",
      version: 1,
      project: { id: options.id ?? randomUUID(), name: options.name ?? "Importé" },
      exportedAt: new Date().toISOString(),
      files: options.files ? options.files(derived) : derived,
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), PROJECT_ARCHIVE_MANIFEST);
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(file));
  if (patches.length > 0) {
    let bytes = await readFile(file);
    for (const [safe, real] of patches)
      bytes = Buffer.from(bytes.toString("latin1").split(safe).join(real), "latin1");
    await writeFile(file, bytes);
  }
}

async function residue(dir: string) {
  return (await readdir(dir)).sort();
}

const registryOf = async (configDir: string) => JSON.stringify(await readProjects(configDir));

async function expectRefusal(
  m: { configDir: string; parent: string },
  archive: string,
  code: string,
  parent: string = m.parent,
) {
  const before = await registryOf(m.configDir);
  const parentBefore = await residue(m.parent);
  const projectsDir = join(m.configDir, "projects");
  const projectsBefore = await readdir(projectsDir).catch(() => []);
  await expect(importProjectArchive(m.configDir, archive, parent)).rejects.toMatchObject({ code });
  expect(await registryOf(m.configDir)).toBe(before);
  expect(await residue(m.parent)).toEqual(parentBefore);
  expect(await readdir(projectsDir).catch(() => [])).toEqual(projectsBefore);
}

describe("archive de projet .rwproj", () => {
  it("aller-retour : contenu et noms identiques, id conservé sur un autre poste", async () => {
    const a = await machine();
    const src = await sourceProject(a);
    const file = join(a.root, "p.rwproj");
    const out = await exportProjectArchive(a.configDir, src.id, file);
    expect(out.files).toBe(3);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await readdir(a.root)).filter((n) => n.endsWith(".tmp"))).toEqual([]);

    const b = await machine();
    const result = await importProjectArchive(b.configDir, file, b.parent);
    expect(result.idChanged).toBe(false);
    expect(result.project.id).toBe(src.id);
    expect(result.project.name).toBe("Mon Projet");
    expect(result.project.workspace.endsWith("mon-projet")).toBe(true);
    const ws = result.project.workspace;
    expect(await readFile(join(ws, "notes", "a.md"), "utf8")).toBe("bonjour\n");
    expect(await readFile(join(ws, "scans", "deep", "b.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
    // Ni lien ni marqueur de partage ne voyagent.
    expect(await lstat(join(ws, "lien")).catch(() => null)).toBeNull();
    expect(await lstat(join(ws, ".redwidow-share-abc")).catch(() => null)).toBeNull();
    expect(
      await readFile(join(projectDataDir(b.configDir, src.id), "audit", "j.jsonl"), "utf8"),
    ).toBe('{"k":1}\n');
    expect((await stat(join(ws, "notes", "a.md"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(ws, "scans", "deep"))).mode & 0o777).toBe(0o700);
    expect(await residue(b.parent)).toEqual(["mon-projet"]);
    expect((await readProjects(b.configDir))?.projects.map((p) => p.id)).toEqual([src.id]);
  });

  it("id changé quand il est déjà pris dans le registre", async () => {
    const a = await machine();
    const src = await sourceProject(a);
    const file = join(a.root, "p.rwproj");
    await exportProjectArchive(a.configDir, src.id, file);
    const second = join(a.root, "autre");
    await mkdir(second);
    const result = await importProjectArchive(a.configDir, file, second);
    expect(result.idChanged).toBe(true);
    expect(result.project.id).not.toBe(src.id);
    expect(
      await readFile(
        join(projectDataDir(a.configDir, result.project.id), "audit", "j.jsonl"),
        "utf8",
      ),
    ).toBe('{"k":1}\n');
    expect((await readProjects(a.configDir))?.projects).toHaveLength(2);
  });

  it("export refusé sous configDir, sous le dossier du projet ou sur un fichier existant", async () => {
    const a = await machine();
    const src = await sourceProject(a);
    await expect(
      exportProjectArchive(a.configDir, src.id, join(a.configDir, "x.rwproj")),
    ).rejects.toMatchObject({ code: "project.parentInvalid" });
    await expect(
      exportProjectArchive(a.configDir, src.id, join(src.workspace, "notes", "x.rwproj")),
    ).rejects.toMatchObject({ code: "project.parentInvalid" });
    const file = join(a.root, "p.rwproj");
    await writeFile(file, "x");
    await expect(exportProjectArchive(a.configDir, src.id, file)).rejects.toMatchObject({
      code: "project.destinationExists",
    });
    await expect(
      exportProjectArchive(a.configDir, randomUUID(), join(a.root, "q")),
    ).rejects.toMatchObject({
      code: "project.absent",
    });
  });

  it("refuse un parent invalide", async () => {
    const m = await machine();
    const file = join(m.root, "ok.rwproj");
    await makeZip(file, [{ name: "workspace/a.txt", data: "a" }]);
    await expectRefusal(m, file, "project.parentInvalid", "relatif/chemin");
    await expectRefusal(m, file, "project.parentInvalid", join(m.root, "absent"));
  });

  describe("refus", () => {
    const cases: [string, RawEntry[], Parameters<typeof makeZip>[2], string][] = [
      [
        "manifeste absent",
        [{ name: "workspace/a.txt", data: "a" }],
        { manifest: null },
        "project.archiveInvalid",
      ],
      [
        "format faux",
        [{ name: "workspace/a.txt", data: "a" }],
        {
          manifest: {
            format: "autre",
            version: 1,
            project: { id: "x", name: "n" },
            exportedAt: "",
            files: [],
          },
        },
        "project.archiveInvalid",
      ],
      ["entrée ../x", [{ name: "workspace/../x", data: "a" }], {}, "project.archiveEntryRejected"],
      ["entrée ../ en tête", [{ name: "../x", data: "a" }], {}, "project.archiveEntryRejected"],
      ["chemin absolu", [{ name: "/etc/x", data: "a" }], {}, "project.archiveEntryRejected"],
      ["mauvais préfixe", [{ name: "autre/x", data: "a" }], {}, "project.archiveEntryRejected"],
      [
        "lien symbolique",
        [
          { name: "workspace/a.txt", data: "a" },
          { name: "workspace/lien", data: "/etc/passwd", mode: 0o120777 },
        ],
        {},
        "project.archiveEntryRejected",
      ],
      [
        "entrée hors manifeste",
        [
          { name: "workspace/a.txt", data: "a" },
          { name: "workspace/b.txt", data: "b" },
        ],
        { files: (d) => d.slice(0, 1) },
        "project.archiveEntryRejected",
      ],
      [
        "taille fausse",
        [{ name: "workspace/a.txt", data: "abc" }],
        { files: (d) => d.map((f) => ({ ...f, size: 2 })) },
        "project.archiveEntryRejected",
      ],
      [
        "sha faux",
        [{ name: "workspace/a.txt", data: "abc" }],
        { files: (d) => d.map((f) => ({ ...f, sha256: sha("autre") })) },
        "project.archiveChecksum",
      ],
      [
        "fichier manquant",
        [{ name: "workspace/a.txt", data: "a" }],
        {
          files: (d) => [...d, { path: "workspace/absent.txt", size: 1, sha256: sha("z") }],
        },
        "project.archiveInvalid",
      ],
      [
        "doublon",
        [
          { name: "workspace/a.txt", data: "a" },
          { name: "workspace/a.txt", data: "a" },
        ],
        { files: (d) => d.slice(0, 1) },
        "project.archiveEntryRejected",
      ],
      [
        "fichier utilisé comme dossier",
        [
          { name: "workspace/a", data: "a" },
          { name: "workspace/a/b", data: "b" },
        ],
        {},
        "project.archiveEntryRejected",
      ],
    ];
    for (const [label, entries, options, code] of cases) {
      it(`${label} : ${code}, aucun résidu`, async () => {
        const m = await machine();
        const file = join(m.root, "bad.rwproj");
        await makeZip(file, entries, options);
        await expectRefusal(m, file, code);
      });
    }

    it("fichier qui n'est pas un zip : project.archiveInvalid", async () => {
      const m = await machine();
      const file = join(m.root, "texte.rwproj");
      await writeFile(file, "pas un zip");
      await expectRefusal(m, file, "project.archiveInvalid");
    });

    it("destination existante : project.destinationExists, rien n'est touché", async () => {
      const m = await machine();
      const file = join(m.root, "p.rwproj");
      await makeZip(file, [{ name: "workspace/a.txt", data: "a" }], { name: "Importé" });
      await mkdir(join(m.parent, "importe"));
      await writeFile(join(m.parent, "importe", "garde.txt"), "x");
      await expectRefusal(m, file, "project.destinationExists");
      expect(await readFile(join(m.parent, "importe", "garde.txt"), "utf8")).toBe("x");
    });

    it("fichier déclaré trop gros : project.archiveTooLarge", async () => {
      const m = await machine();
      const file = join(m.root, "big.rwproj");
      await makeZip(file, [{ name: "workspace/a.txt", data: "a" }], {
        files: (d) => d.map((f) => ({ ...f, size: 3 * 1024 ** 3 })),
      });
      await expectRefusal(m, file, "project.archiveTooLarge");
    });
  });
});
