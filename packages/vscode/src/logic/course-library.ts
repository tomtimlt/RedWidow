import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Des identifiants opaques empêchent la webview de fournir des chemins. */
const id = (value: string) => createHash("sha256").update(value).digest("hex");
const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const maxBytes = 128 * 1024;
const maxEntries = 100;
const validName = (name: string) => name !== "." && name !== ".." && !/[\\/\0]/.test(name);
const fdPath = (fd: number) => `/proc/self/fd/${fd}`;

/** La lecture externe exige l’accès ancré aux descripteurs Linux. */
export const courseDocumentsAvailable = () => process.platform === "linux";

async function withRoot<T>(
  root: string,
  fallback: T,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  if (!courseDocumentsAvailable()) return fallback;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(root, dirFlags);
    if (!(await handle.stat()).isDirectory()) return fallback;
    return await fn(fdPath(handle.fd));
  } catch {
    return fallback;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function names(path: string, directory: boolean): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter(
      (entry) =>
        validName(entry.name) &&
        !entry.isSymbolicLink() &&
        (directory ? entry.isDirectory() : entry.isFile() && /\.(md|txt)$/i.test(entry.name)),
    )
    .map((entry) => entry.name)
    .sort()
    .slice(0, maxEntries);
}

export interface CourseEntry {
  id: string;
  name: string;
}
export interface CourseDocument {
  sections: string[];
}
export async function listCourseSources(root: string): Promise<CourseEntry[]> {
  return withRoot(root, [], async (path) =>
    (await names(path, true)).map((name) => ({ id: id(name), name })),
  );
}
async function sourceName(path: string, sourceId: string): Promise<string | undefined> {
  return (await names(path, true)).find((name) => id(name) === sourceId);
}
async function withSource<T>(
  root: string,
  sourceId: string,
  fallback: T,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  return withRoot(root, fallback, async (path) => {
    const name = await sourceName(path, sourceId);
    if (!name) return fallback;
    const handle = await open(join(path, name), dirFlags);
    try {
      if (!(await handle.stat()).isDirectory()) return fallback;
      return await fn(fdPath(handle.fd));
    } finally {
      await handle.close();
    }
  });
}
export async function listCourseDocuments(root: string, sourceId: string): Promise<CourseEntry[]> {
  return withSource(root, sourceId, [], async (path) =>
    (await names(path, false)).map((name) => ({ id: id(name), name })),
  );
}
export async function readCourseDocument(
  root: string,
  sourceId: string,
  documentId: string,
): Promise<CourseDocument | null> {
  return withSource(root, sourceId, null, async (path) => {
    const name = (await names(path, false)).find((entry) => id(entry) === documentId);
    if (!name) return null;
    return readSelectedCourseDocument(join(path, name));
  });
}

/** Lecture d’un fichier choisi par le sélecteur natif ; aucun chemin ne vient de la webview. */
export async function readSelectedCourseDocument(file: string): Promise<CourseDocument | null> {
  if (!isAbsolute(file) || !/\.(md|txt)$/i.test(file)) return null;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink()) return null;
    const handle = await open(file, fileFlags);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) return null;
      const after = await lstat(file);
      if (
        !after.isFile() ||
        after.isSymbolicLink() ||
        before.dev !== stat.dev ||
        before.ino !== stat.ino ||
        after.dev !== stat.dev ||
        after.ino !== stat.ino
      )
        return null;
      const text = buffer.toString("utf8", 0, bytesRead);
      const sections = text.split(/(?=^#{1,3}\s)/m).filter((part) => part.trim().length > 0);
      if (sections.length > 200)
        sections.splice(199, sections.length - 199, sections.slice(199).join(""));
      return { sections: sections.length ? sections : [""] };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Les données persistées peuvent être anciennes ou corrompues. */
export function restoreCourseSection(value: unknown, sectionCount: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, sectionCount - 1));
}
