import { createHash, randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { PassThrough, type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CodedError,
  checkRelativePath,
  prepareProjectWorkspace,
  projectDataDir,
  readProjects,
  registerImportedProject,
  type StoredProject,
  validateProjectFolder,
} from "@warband/core";
import { type Entry, open as openZip, type ZipFile as UnzipFile } from "yauzl";
import { ZipFile } from "yazl";
import { z } from "zod";

/** Plafonds de l'archive de projet (ADR 0052, point 8), appliqués à l'export comme à l'import. */
export const PROJECT_ARCHIVE_MAX_ENTRIES = 20_000;
export const PROJECT_ARCHIVE_MAX_FILE_BYTES = 2 * 1024 ** 3;
export const PROJECT_ARCHIVE_MAX_TOTAL_BYTES = 8 * 1024 ** 3;
/** Taux de compression maximal (taille décompressée / taille compressée) d'une entrée. */
export const PROJECT_ARCHIVE_MAX_RATIO = 200;
/** En dessous de ce seuil, le taux n'est pas contrôlé (petits fichiers très répétitifs). */
export const PROJECT_ARCHIVE_RATIO_FLOOR = 1024 * 1024;
export const PROJECT_ARCHIVE_MANIFEST = "redwidow-project.json";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_PATH = 1024;
const SHARE_MARKER = /^\.redwidow-share-/;
const NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

const manifestSchema = z.object({
  format: z.literal("redwidow-project"),
  version: z.literal(1),
  project: z.object({ id: z.string().max(64), name: z.string().min(1).max(200) }),
  exportedAt: z.string().max(64),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_PATH),
        size: z.number().int().min(0),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(PROJECT_ARCHIVE_MAX_ENTRIES),
});
type Manifest = z.infer<typeof manifestSchema>;

const invalid = (detail: string) => new CodedError("project.archiveInvalid", { detail });
const rejected = (path: string, detail: string) =>
  new CodedError("project.archiveEntryRejected", { path, detail });
const tooLarge = (detail: string) => new CodedError("project.archiveTooLarge", { detail });

/** Même règle que le dossier créé par le cœur : nom ASCII minuscule, 48 caractères, jamais réservé. */
function slugOf(name: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .toLowerCase() || "project";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug) ? `project-${slug}` : slug;
}

/** Chemin d'entrée canonique : relatif, sans `..`, sans `.` ni double séparateur, `/` seulement. */
function canonicalEntryPath(path: string): string[] {
  let segments: string[];
  try {
    segments = checkRelativePath(path);
  } catch {
    throw rejected(path, "path");
  }
  if (segments.join("/") !== path) throw rejected(path, "path");
  return segments;
}

function splitArchivePath(path: string): { root: "workspace" | "data"; rel: string[] } {
  const [root, ...rel] = canonicalEntryPath(path);
  if ((root !== "workspace" && root !== "data") || rel.length === 0) throw rejected(path, "prefix");
  return { root, rel };
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

interface SourceFile {
  archivePath: string;
  real: string;
}

/** Fichiers réguliers sous `root` : liens, autres types et marqueurs de partage sont ignorés. */
async function listRegularFiles(root: string, prefix: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const stack: { dir: string; rel: string[] }[] = [{ dir: root, rel: [] }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let names: string[];
    try {
      names = await readdir(current.dir);
    } catch (error) {
      if (current.rel.length === 0 && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names.sort()) {
      if (SHARE_MARKER.test(name)) continue;
      const real = join(current.dir, name);
      const info = await lstat(real);
      const rel = [...current.rel, name];
      if (info.isDirectory()) stack.push({ dir: real, rel });
      else if (info.isFile()) {
        const archivePath = `${prefix}/${rel.join("/")}`;
        canonicalEntryPath(archivePath);
        if (archivePath.length > MAX_PATH) throw rejected(archivePath, "path");
        out.push({ archivePath, real });
        if (out.length > PROJECT_ARCHIVE_MAX_ENTRIES) throw tooLarge("entries");
      }
    }
  }
  return out;
}

/** Hash et comptage d'un flux ; refuse un fichier qui dépasse le plafond en cours de lecture. */
class Tap extends Transform {
  readonly hash = createHash("sha256");
  size = 0;
  constructor(
    private readonly onBytes: (n: number) => void,
    private readonly limit: number,
  ) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: (e?: Error | null) => void) {
    this.size += chunk.length;
    try {
      if (this.size > this.limit) throw tooLarge("file");
      this.onBytes(chunk.length);
    } catch (error) {
      done(error as Error);
      return;
    }
    this.hash.update(chunk);
    this.push(chunk);
    done();
  }
}

/**
 * Exporte un projet en `.rwproj` (ADR 0052, point 7). Une seule lecture par fichier : la taille et
 * l'empreinte du manifeste sont celles des octets réellement écrits. Écriture atomique.
 */
export async function exportProjectArchive(
  configDir: string,
  projectId: string,
  destinationFile: string,
): Promise<{ files: number; bytes: number }> {
  const stored = (await readProjects(configDir))?.projects.find((p) => p.id === projectId);
  if (stored === undefined) throw new CodedError("project.absent");
  if (!isAbsolute(destinationFile)) throw new CodedError("project.parentInvalid");
  const parent = await realpath(dirname(destinationFile));
  const workspace = await realpath(stored.workspace);
  for (const forbidden of [await realpath(configDir), workspace]) {
    const rel = relative(forbidden, parent);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
      throw new CodedError("project.parentInvalid");
  }
  const destination = join(parent, basename(destinationFile));
  const exists = await lstat(destination).then(
    () => true,
    () => false,
  );
  if (exists) throw new CodedError("project.destinationExists", { path: destination });

  const sources = [
    ...(await listRegularFiles(workspace, "workspace")),
    ...(await listRegularFiles(projectDataDir(configDir, projectId), "data")),
  ];
  if (sources.length + 1 > PROJECT_ARCHIVE_MAX_ENTRIES) throw tooLarge("entries");

  // Les types de yazl 2 omettent son héritage EventEmitter.
  const archive = new ZipFile() as ZipFile & EventEmitter;
  const temporary = join(parent, `.rwproj-${randomUUID()}.tmp`);
  const output = archive.outputStream as Readable;
  archive.on("error", (error: Error) => output.destroy(error));
  const writing = pipeline(output, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
  void writing.catch(() => undefined);
  try {
    // Une PassThrough par fichier : aucun descripteur n'est ouvert avant son tour.
    const inputs = sources.map((source) => {
      const stream = new PassThrough();
      archive.addReadStream(stream, source.archivePath, { mode: 0o100600 });
      return stream;
    });
    const files: Manifest["files"] = [];
    let total = 0;
    for (const [index, source] of sources.entries()) {
      const input = inputs[index] as PassThrough;
      try {
        const handle = await open(source.real, NOFOLLOW);
        try {
          const info = await handle.stat();
          if (!info.isFile()) throw rejected(source.archivePath, "type");
          const tap = new Tap((n) => {
            total += n;
            if (total > PROJECT_ARCHIVE_MAX_TOTAL_BYTES) throw tooLarge("total");
          }, PROJECT_ARCHIVE_MAX_FILE_BYTES);
          await pipeline(handle.createReadStream({ autoClose: false }), tap, input);
          files.push({
            path: source.archivePath,
            size: tap.size,
            sha256: tap.hash.digest("hex"),
          });
        } finally {
          await handle.close();
        }
      } catch (error) {
        input.destroy(error as Error);
        throw error;
      }
    }
    const manifest: Manifest = {
      format: "redwidow-project",
      version: 1,
      project: { id: stored.id, name: stored.name },
      exportedAt: new Date().toISOString(),
      files,
    };
    archive.addBuffer(
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      PROJECT_ARCHIVE_MANIFEST,
      {
        mode: 0o100600,
      },
    );
    archive.end();
    await writing;
    await rename(temporary, destination);
    return { files: files.length, bytes: total };
  } catch (error) {
    output.destroy();
    await writing.catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

const ID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Erreur de lecture du zip : tout ce qui n'est pas déjà codé ni une erreur disque devient « archive invalide ». */
function asArchiveError(error: unknown): unknown {
  if (error instanceof CodedError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && /^E[A-Z0-9]+$/.test(code)) return error;
  return invalid("zip");
}

const openArchive = (file: string) =>
  new Promise<UnzipFile>((resolve, reject) =>
    openZip(file, { lazyEntries: true, autoClose: false, decodeStrings: false }, (error, zip) =>
      error || !zip ? reject(asArchiveError(error ?? invalid("zip"))) : resolve(zip),
    ),
  );

const collectEntries = (zip: UnzipFile) =>
  new Promise<Entry[]>((resolve, reject) => {
    const list: Entry[] = [];
    zip.on("error", (error) => reject(asArchiveError(error)));
    zip.on("end", () => resolve(list));
    zip.on("entry", (entry: Entry) => {
      list.push(entry);
      zip.readEntry();
    });
    zip.readEntry();
  });

const entryStream = (zip: UnzipFile, entry: Entry) =>
  new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error || !stream ? reject(asArchiveError(error ?? invalid("zip"))) : resolve(stream),
    ),
  );

/** `fileName` est un Buffer : on décode nous-mêmes (UTF-8) pour produire nos propres codes de refus. */
const nameOf = (entry: Entry) => (entry.fileName as unknown as Buffer).toString("utf8");

async function readManifest(zip: UnzipFile, entry: Entry): Promise<Manifest> {
  if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw tooLarge("manifest");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of await entryStream(zip, entry)) {
      size += (chunk as Buffer).length;
      if (size > MAX_MANIFEST_BYTES) throw tooLarge("manifest");
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    throw asArchiveError(error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalid("manifest");
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw invalid("manifest");
  return result.data;
}

/** Contrôle d'une entrée avant toute extraction ; renvoie `null` pour un dossier. */
function checkEntry(entry: Entry, name: string, manifest: Map<string, Manifest["files"][number]>) {
  if (entry.isEncrypted()) throw rejected(name, "encrypted");
  if (entry.versionMadeBy >>> 8 === 3) {
    const type = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (type === 0o120000) throw rejected(name, "symlink");
    if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw rejected(name, "type");
  }
  if (name.endsWith("/")) {
    const [root] = canonicalEntryPath(name.slice(0, -1));
    if (root !== "workspace" && root !== "data") throw rejected(name, "prefix");
    if (entry.uncompressedSize !== 0) throw rejected(name, "directory");
    return null;
  }
  const split = splitArchivePath(name);
  if (entry.uncompressedSize > PROJECT_ARCHIVE_MAX_FILE_BYTES) throw tooLarge("file");
  if (
    entry.uncompressedSize > PROJECT_ARCHIVE_RATIO_FLOOR &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > PROJECT_ARCHIVE_MAX_RATIO)
  )
    throw tooLarge("ratio");
  const listed = manifest.get(name);
  if (listed === undefined) throw rejected(name, "unlisted");
  if (listed.size !== entry.uncompressedSize) throw rejected(name, "size");
  return { ...split, listed };
}

/** Extrait une entrée : taille et SHA-256 calculés en flux, fichier créé en exclusif (0o600). */
async function extractEntry(
  zip: UnzipFile,
  entry: Entry,
  target: string,
  listed: Manifest["files"][number],
) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const tap = new Tap(() => undefined, listed.size);
  try {
    await pipeline(
      await entryStream(zip, entry),
      tap,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    if (error instanceof CodedError && error.code === "project.archiveTooLarge")
      throw rejected(listed.path, "size");
    throw asArchiveError(error);
  }
  if (tap.size !== listed.size) throw rejected(listed.path, "size");
  if (tap.hash.digest("hex") !== listed.sha256)
    throw new CodedError("project.archiveChecksum", { path: listed.path });
}

/**
 * Importe un `.rwproj` sous `parent` (ADR 0052, point 8). Extraction dans un dossier temporaire
 * voisin puis `rename` ; le registre n'est modifié qu'en dernier. Tout échec défait ce qui a été créé.
 */
export async function importProjectArchive(
  configDir: string,
  archiveFile: string,
  parentFolder: unknown,
): Promise<{ project: StoredProject; idChanged: boolean }> {
  const parent = await validateProjectFolder(parentFolder);
  const zip = await openArchive(archiveFile);
  const token = randomUUID();
  const workStage = join(parent, `.rwproj-import-${token}`);
  const projectsDir = join(configDir, "projects");
  const dataStage = join(projectsDir, `.rwproj-import-${token}`);
  const created: string[] = [];
  try {
    if (zip.entryCount > PROJECT_ARCHIVE_MAX_ENTRIES) throw tooLarge("entries");
    const entries = await collectEntries(zip);
    const manifestEntry = entries.find((e) => nameOf(e) === PROJECT_ARCHIVE_MANIFEST);
    if (manifestEntry === undefined) throw invalid("manifest");
    const manifest = await readManifest(zip, manifestEntry);

    const listed = new Map<string, Manifest["files"][number]>();
    let declared = 0;
    for (const file of manifest.files) {
      splitArchivePath(file.path);
      if (listed.has(file.path)) throw invalid("manifest");
      if (file.size > PROJECT_ARCHIVE_MAX_FILE_BYTES) throw tooLarge("file");
      declared += file.size;
      if (declared > PROJECT_ARCHIVE_MAX_TOTAL_BYTES) throw tooLarge("total");
      listed.set(file.path, file);
    }
    const seen = new Set<string>();
    const todo: {
      entry: Entry;
      root: "workspace" | "data";
      rel: string[];
      file: (typeof manifest.files)[number];
    }[] = [];
    for (const entry of entries) {
      const name = nameOf(entry);
      if (name === PROJECT_ARCHIVE_MANIFEST) continue;
      if (seen.has(name)) throw rejected(name, "duplicate");
      seen.add(name);
      const checked = checkEntry(entry, name, listed);
      if (checked !== null)
        todo.push({ entry, root: checked.root, rel: checked.rel, file: checked.listed });
    }
    for (const path of listed.keys()) if (!seen.has(path)) throw invalid("missing");
    // Un fichier ne peut pas aussi servir de dossier à un autre.
    for (const path of listed.keys()) {
      const parts = path.split("/");
      for (let i = 2; i < parts.length; i++)
        if (listed.has(parts.slice(0, i).join("/"))) throw rejected(path, "conflict");
    }

    const destination = join(parent, slugOf(manifest.project.name));
    const free = async (path: string) =>
      lstat(path).then(
        () => false,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return true;
          throw error;
        },
      );
    if (!(await free(destination)))
      throw new CodedError("project.destinationExists", { path: destination });

    await mkdir(workStage, { mode: 0o700 });
    created.push(workStage);
    const hasData = todo.some((t) => t.root === "data");
    if (hasData) {
      await mkdir(projectsDir, { recursive: true, mode: 0o700 });
      await mkdir(dataStage, { mode: 0o700 });
      created.push(dataStage);
    }
    for (const item of todo) {
      const base = item.root === "workspace" ? workStage : dataStage;
      await extractEntry(zip, item.entry, join(base, ...item.rel), item.file);
    }
    await prepareProjectWorkspace(workStage);

    // Identité : l'id d'origine si le registre et le disque le laissent libre, sinon un id neuf.
    const registry = await readProjects(configDir);
    const wanted = manifest.project.id;
    const keep =
      ID_V4.test(wanted) &&
      !(registry?.projects.some((p) => p.id === wanted) ?? false) &&
      (await free(projectDataDir(configDir, wanted)));
    const id = keep ? wanted : randomUUID();
    if (hasData) {
      const finalData = projectDataDir(configDir, id);
      await rename(dataStage, finalData);
      created.splice(created.indexOf(dataStage), 1, finalData);
    }
    if (!(await free(destination)))
      throw new CodedError("project.destinationExists", { path: destination });
    await rename(workStage, destination);
    created.splice(created.indexOf(workStage), 1, destination);

    const { project } = await registerImportedProject(configDir, {
      id,
      name: manifest.project.name,
      workspace: destination,
    });
    return { project, idChanged: project.id !== wanted };
  } catch (error) {
    for (const path of created.reverse()) await rm(path, { recursive: true, force: true });
    throw error;
  } finally {
    zip.close();
  }
}
