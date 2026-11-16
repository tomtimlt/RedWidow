import { open } from "node:fs/promises";
import { zenKeyFromAuthContent } from "@warband/agent-opencode";
import { CodedError } from "@warband/core";
import type { VaultStore } from "./vault-store.js";

/**
 * Import explicite de la clé OpenCode Zen (ADR 0056). Appelé SEULEMENT après le clic de l'utilisateur sur
 * « Importer la clé d'OpenCode » : le fichier `auth.json` n'est jamais lu autrement. Seule l'entrée `opencode`
 * de type `api` est extraite ; le reste du fichier n'est ni retenu ni renvoyé. La valeur ne sort pas d'ici
 * (ni message, ni journal, ni webview) : le résultat n'en porte aucune.
 */

export type VaultImportOutcome =
  | { kind: "added" }
  | { kind: "duplicate" }
  | { kind: "missingFile" }
  | { kind: "missingEntry" };

/** Lecture bornée (1 Mio) : un fichier plus gros est ignoré. */
const MAX_BYTES = 1024 * 1024;

async function readBounded(file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return length > MAX_BYTES ? "" : buffer.toString("utf8", 0, length);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Ajoute au coffre `opencode` la clé `opencode` de type `api` du `auth.json` donné. */
export async function importOpencodeKey(
  store: VaultStore,
  authFile: string,
): Promise<VaultImportOutcome> {
  const text = await readBounded(authFile);
  if (text === undefined) return { kind: "missingFile" };
  const value = zenKeyFromAuthContent(text);
  if (value === undefined) return { kind: "missingEntry" };
  try {
    await store.add("opencode", value);
  } catch (error) {
    if (error instanceof CodedError && error.code === "vault.duplicate")
      return { kind: "duplicate" };
    throw error;
  }
  return { kind: "added" };
}
