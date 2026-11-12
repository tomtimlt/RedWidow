/**
 * Pièces jointes du chat web par dialogue de téléversement (lot M4, décision 2). Le serveur ouvre un
 * dialogue `file` (HostUi) chez l'émetteur ; sans réponse humaine, rien n'est lu ni transmis. Le fichier
 * téléversé est lu une seule fois (`uploads.take`), contrôlé par les routines de `logic/attachments` (texte)
 * ou `parsePromptImages` du cœur (images : signature, taille), puis supprimé (`release`) quoi qu'il arrive.
 * Le contenu est renvoyé à la page, qui l'inclut dans un `send` ordinaire : ses bornes (nombre, taille
 * totale) sont alors réappliquées par `parseWebviewMessage`. Le client ne fournit jamais un chemin.
 *
 * PDF : accepté nulle part. `parseAttachments` refuse les PDF (pas de lecture de contenu binaire).
 */
import { readFile } from "node:fs/promises";
import { MAX_IMAGE_BYTES, type PromptImage, parsePromptImages } from "@warband/core";
import {
  type Attachment,
  MAX_ATTACHMENT_BYTES,
  parseAttachments,
} from "@warband/vscode/logic/attachments";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";

export const IMAGE_TYPES: Readonly<Record<string, PromptImage["mimeType"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
export const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".log"] as const;
/** Extensions proposées par le dialogue. */
export const ATTACH_ACCEPT: readonly string[] = [...Object.keys(IMAGE_TYPES), ...TEXT_EXTENSIONS];
/** Taille maximale du dialogue : celle d'une image (le texte est plafonné plus bas, à 64 Kio). */
export const ATTACH_MAX_BYTES = MAX_IMAGE_BYTES;

export type AttachRefusal = "cancelled" | "missing" | "type" | "size" | "binary" | "empty";
export type AttachResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: AttachRefusal };

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/** Dialogue puis lecture : l'attachement validé, ou le motif du refus (code seulement, jamais de chemin). */
export async function pickAttachment(ctx: BridgeContext, to: Sink): Promise<AttachResult> {
  const id = await ctx.ui.file(
    { title: "Joindre un fichier", accept: ATTACH_ACCEPT, maxBytes: ATTACH_MAX_BYTES },
    to,
  );
  if (id === null) return { ok: false, reason: "cancelled" };
  const taken = ctx.uploads.take(id);
  if (taken === undefined) return { ok: false, reason: "missing" };
  try {
    const ext = extensionOf(taken.name);
    const mimeType = IMAGE_TYPES[ext];
    if (mimeType === undefined && !(TEXT_EXTENSIONS as readonly string[]).includes(ext))
      return { ok: false, reason: "type" };
    if (taken.size === 0) return { ok: false, reason: "empty" };
    if (taken.size > (mimeType ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES))
      return { ok: false, reason: "size" };
    const bytes = await readFile(taken.path);
    if (mimeType !== undefined) {
      const image: PromptImage = { name: taken.name, mimeType, data: bytes.toString("base64") };
      return parsePromptImages([image]) === null
        ? { ok: false, reason: "binary" }
        : { ok: true, attachment: image };
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, reason: "binary" };
    }
    if (text.trim() === "") return { ok: false, reason: "empty" };
    const parsed = parseAttachments([{ name: taken.name, text }]);
    const first = parsed?.[0];
    return first === undefined ? { ok: false, reason: "binary" } : { ok: true, attachment: first };
  } catch {
    return { ok: false, reason: "missing" };
  } finally {
    await taken.release();
  }
}
