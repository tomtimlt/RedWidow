import { open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { isRunId, MAX_JOURNAL_BYTES } from "./history.js";

/** Accès disque aux journaux : les noms de fichier ne viennent que d'un `runId` validé (UUID). */
export interface JournalFiles {
  /** Dossier des journaux (transmis au moteur : `journalDir`). */
  dir: string;
  /** Texte du journal (au plus `MAX_JOURNAL_BYTES` octets), ou `null` s'il est absent ou invalide. */
  read(runId: string): Promise<string | null>;
  size(runId: string): Promise<number>;
  remove(runIds: readonly string[]): Promise<void>;
  /** Supprime tous les journaux `<uuid>.jsonl` du dossier (orphelins compris). */
  removeAll(): Promise<void>;
}

const fileOf = (dir: string, runId: string): string => join(dir, `${runId}.jsonl`);

export function createJournalFiles(dir: string): JournalFiles {
  const remove = async (runIds: readonly string[]) => {
    await Promise.all(
      runIds.filter(isRunId).map((id) => rm(fileOf(dir, id), { force: true }).catch(() => {})),
    );
  };
  return {
    dir,
    async read(runId) {
      if (!isRunId(runId)) return null;
      try {
        const handle = await open(fileOf(dir, runId), "r");
        try {
          const { size } = await handle.stat();
          const length = Math.min(size, MAX_JOURNAL_BYTES + 1);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, 0);
          return buffer.toString("utf8", 0, bytesRead);
        } finally {
          await handle.close();
        }
      } catch {
        return null;
      }
    },
    async size(runId) {
      if (!isRunId(runId)) return 0;
      try {
        return (await stat(fileOf(dir, runId))).size;
      } catch {
        return 0;
      }
    },
    remove,
    async removeAll() {
      const names = await readdir(dir).catch(() => [] as string[]);
      await remove(names.filter((n) => n.endsWith(".jsonl")).map((n) => n.slice(0, -6)));
    },
  };
}
