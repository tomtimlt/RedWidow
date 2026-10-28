import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DockerToolSpec } from "@warband/core";
import { z } from "zod";
/** Lecture bornée des preuves du projet, sans index global ni chargement du fichier complet. */
export function projectFileSpecs(root: string): DockerToolSpec[] {
  const bound = async (path: string) => {
    if (isAbsolute(path) || path.includes("\0")) throw Error("Chemin relatif au projet requis.");
    const base = await realpath(root);
    const target = await realpath(resolve(base, path));
    const rel = relative(base, target);
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel))
      throw Error("Chemin hors du projet refusé.");
    return { base, target };
  };
  const list = {
    path: z.string().max(1024).default("."),
    offset: z.number().int().min(0).max(100000).default(0),
  };
  const read = {
    path: z.string().max(1024),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    length: z.number().int().min(1).max(32768).default(16384),
  };
  return [
    {
      name: "list_project_files",
      description:
        "Lister les fichiers du projet ouvert, par pages de 100. Aucun accès hors du dossier approuvé.",
      input: list,
      readOnly: true,
      async run(raw) {
        const a = z.object(list).strict().parse(raw);
        const { target } = await bound(a.path);
        const entries = await readdir(target, { withFileTypes: true });
        return JSON.stringify({
          entries: entries.slice(a.offset, a.offset + 100).map((e) => ({
            name: e.name,
            directory: e.isDirectory(),
            symlink: e.isSymbolicLink(),
          })),
          nextOffset: a.offset + 100 < entries.length ? a.offset + 100 : null,
        });
      },
    },
    {
      name: "read_project_file",
      description:
        "Lire un extrait UTF-8 d’un fichier de preuve dans le projet. Offset et longueur en octets, 32 Kio maximum. Ne pas charger les gros fichiers en entier.",
      input: read,
      readOnly: true,
      async run(raw) {
        const a = z.object(read).strict().parse(raw);
        const { target } = await bound(a.path);
        const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const st = await file.stat();
          const again = await bound(a.path);
          if (again.target !== target || !st.isFile())
            throw Error("Fichier modifié ou non régulier.");
          const buffer = Buffer.alloc(a.length);
          const result = await file.read(buffer, 0, buffer.length, a.offset);
          return JSON.stringify({
            text: buffer.subarray(0, result.bytesRead).toString("utf8"),
            offset: a.offset,
            nextOffset: a.offset + result.bytesRead < st.size ? a.offset + result.bytesRead : null,
            totalBytes: st.size,
            note: "Les bornes UTF-8 peuvent traverser un caractère : lire avec chevauchement si nécessaire. Fichiers binaires à convertir avant analyse.",
          });
        } finally {
          await file.close();
        }
      },
    },
  ];
}
