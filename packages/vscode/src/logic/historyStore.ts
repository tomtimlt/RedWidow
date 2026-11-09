import { constants } from "node:fs";
import { type FileHandle, lstat, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { type EngineEvent, validateEvent } from "@warband/core";
import { isRunId, MAX_JOURNAL_BYTES, MAX_LINE_CHARS } from "./history.js";

/** Accès disque aux journaux : les noms de fichier ne viennent que d'un `runId` validé (UUID). */
export interface JournalFiles {
  /** Dossier des journaux (transmis au moteur : `journalDir`). */
  dir: string;
  /** Texte du journal (au plus `MAX_JOURNAL_BYTES` octets), ou `null` s'il est absent ou invalide. */
  read(runId: string): Promise<string | null>;
  /** Lecture complète par blocs, sans conserver le journal en mémoire. false interrompt la lecture. */
  scan?(
    runId: string,
    visit: (event: EngineEvent) => boolean,
  ): Promise<{ invalid: number; missing: boolean }>;
  size(runId: string): Promise<number>;
  remove(runIds: readonly string[]): Promise<void>;
  /** Supprime tous les journaux `<uuid>.jsonl` du dossier (orphelins compris). */
  removeAll(): Promise<void>;
}

const fileOf = (dir: string, runId: string): string => join(dir, `${runId}.jsonl`);

export function createJournalFiles(dir: string): JournalFiles {
  const openJournal = async (id: string) => {
    const directory = await realpath(dir);
    if (!(await lstat(dir)).isDirectory()) throw Error("Répertoire de journaux symbolique.");
    const path = fileOf(directory, id);
    if (!(await lstat(path)).isFile()) throw Error("Journal non régulier.");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (
        !(await handle.stat()).isFile() ||
        (await realpath(path)) !== path ||
        (await realpath(dir)) !== directory
      )
        throw Error("Le journal a changé pendant la lecture.");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  };
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
        const handle = await openJournal(runId);
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
    async scan(runId, visit) {
      if (!isRunId(runId)) return { invalid: 0, missing: true };
      let handle: FileHandle;
      try {
        handle = await openJournal(runId);
      } catch {
        return { invalid: 0, missing: true };
      }
      let invalid = 0;
      try {
        // Instantané de taille : un journal vivant ne prolonge jamais cette lecture indéfiniment.
        const { size } = await handle.stat();
        if (size === 0) return { invalid, missing: false };
        const stream = handle.createReadStream({
          autoClose: false,
          highWaterMark: 64 * 1024,
          end: size - 1,
        });
        const decoder = new StringDecoder("utf8");
        let pending = "";
        let oversized = false;
        const consume = (line: string): boolean => {
          if (!line.trim()) return true;
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            invalid++;
            return true;
          }
          if (validateEvent(event) || (event as EngineEvent).runId !== runId) {
            invalid++;
            return true;
          }
          return visit(event as EngineEvent);
        };
        for await (const chunk of stream) {
          const parts = decoder.write(chunk as Buffer).split("\n");
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i] ?? "";
            if (!oversized) {
              if (pending.length + part.length > MAX_LINE_CHARS) {
                oversized = true;
                pending = "";
                invalid++;
              } else pending += part;
            }
            if (i < parts.length - 1) {
              if (!oversized && !consume(pending)) return { invalid, missing: false };
              pending = "";
              oversized = false;
            }
          }
        }
        pending += decoder.end();
        if (!oversized && pending) consume(pending);
        return { invalid, missing: false };
      } finally {
        await handle.close();
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
