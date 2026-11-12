/**
 * Messages client → serveur de l'API Fichiers (vue `shell`). Entrée non fiable : clés exactes, types et
 * bornes de forme vérifiés ici ; le contenu des chemins l'est par `files-guard.ts` à chaque opération.
 */
import { FS_MAX_PATH } from "./files-guard.js";

/** Plafond du texte d'une écriture (octets) et de la lecture en texte ; base64 (aperçus d'images). */
export const FS_MAX_TEXT = 1024 * 1024;
export const FS_MAX_BASE64 = 5 * 1024 * 1024;
const MAX_ETAG = 80;

export type FsControl =
  | {
      type: "fsList" | "fsStat" | "fsMkdir" | "fsDelete" | "fsDownload" | "fsCaptureEvidence";
      path: string;
    }
  | { type: "fsRead"; path: string; as: "text" | "base64" }
  | { type: "fsWrite"; path: string; text: string; etag: string | null }
  | { type: "fsRename"; from: string; to: string }
  | { type: "fsUpload"; dir: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const only = (m: Record<string, unknown>, ...keys: string[]) =>
  Object.keys(m).length === keys.length && keys.every((k) => k in m);

/** Chaîne de forme plausible d'un chemin (la validation fine est celle de la garde). */
const pathLike = (v: unknown): v is string => typeof v === "string" && v.length <= FS_MAX_PATH;

export const FS_TYPES = [
  "fsList",
  "fsStat",
  "fsRead",
  "fsWrite",
  "fsMkdir",
  "fsRename",
  "fsDelete",
  "fsUpload",
  "fsDownload",
  "fsCaptureEvidence",
] as const;

/** `true` si le type désigne un message de l'API Fichiers. */
export const isFsType = (type: unknown): boolean =>
  typeof type === "string" && (FS_TYPES as readonly string[]).includes(type);

export function parseFsControl(m: Record<string, unknown>): FsControl | null {
  if (!isRecord(m)) return null;
  switch (m.type) {
    case "fsList":
    case "fsStat":
    case "fsMkdir":
    case "fsDelete":
    case "fsDownload":
    case "fsCaptureEvidence":
      return only(m, "type", "path") && pathLike(m.path) ? { type: m.type, path: m.path } : null;
    case "fsRead":
      return only(m, "type", "path", "as") &&
        pathLike(m.path) &&
        (m.as === "text" || m.as === "base64")
        ? { type: "fsRead", path: m.path, as: m.as }
        : null;
    case "fsWrite":
      return only(m, "type", "path", "text", "etag") &&
        pathLike(m.path) &&
        typeof m.text === "string" &&
        m.text.length <= FS_MAX_TEXT &&
        (m.etag === null || (typeof m.etag === "string" && m.etag.length <= MAX_ETAG))
        ? { type: "fsWrite", path: m.path, text: m.text, etag: m.etag }
        : null;
    case "fsRename":
      return only(m, "type", "from", "to") && pathLike(m.from) && pathLike(m.to)
        ? { type: "fsRename", from: m.from, to: m.to }
        : null;
    case "fsUpload":
      return only(m, "type", "dir") && pathLike(m.dir) ? { type: "fsUpload", dir: m.dir } : null;
    default:
      return null;
  }
}
