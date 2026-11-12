/**
 * Import d'un fichier JSON par dialogue de téléversement (ADR 0055) : équivalent web de `pickJson` de
 * l'extension. Le client ne fournit jamais un chemin : `ui.file` renvoie un identifiant d'upload que le
 * serveur reprend (`uploads.take`), lit, puis supprime dans tous les cas. Le contenu est rendu tel quel au
 * contrôleur du cœur, qui le valide ; un import n'approuve jamais rien.
 */
import { readFile } from "node:fs/promises";
import { CodedError } from "@warband/core";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";

/** Taille permise au téléversement (plafond de la route d'upload) ; la limite d'une fiche est plus basse. */
export const IMPORT_UPLOAD_BYTES = 1024 * 1024;

/**
 * Fichier JSON choisi par l'humain, ou `null` s'il annule (ou ne répond pas : la promesse reste alors en
 * attente). `limit` : taille maximale du texte (octets), au-delà `import.tooLarge`. Fichier non UTF-8 :
 * `import.badFile`. Le fichier téléversé est supprimé après lecture, succès ou non.
 */
export async function readJsonUpload(
  ctx: Pick<BridgeContext, "ui" | "uploads">,
  sink: Sink,
  options: { title: string; limit: number },
): Promise<string | null> {
  const id = await ctx.ui.file(
    { title: options.title, accept: [".json"], maxBytes: IMPORT_UPLOAD_BYTES },
    sink,
  );
  if (id === null) return null;
  const taken = ctx.uploads.take(id);
  if (taken === undefined) return null;
  try {
    if (taken.size > options.limit) throw new CodedError("import.tooLarge");
    const bytes = await readFile(taken.path);
    if (bytes.length > options.limit) throw new CodedError("import.tooLarge");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CodedError("import.badFile");
    }
  } finally {
    await taken.release();
  }
}
