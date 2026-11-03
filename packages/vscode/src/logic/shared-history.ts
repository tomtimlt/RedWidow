import { join } from "node:path";
import { type ConversationMeta, parseIndex, sortRecent } from "./history.js";
import { createJournalFiles, type JournalFiles } from "./historyStore.js";

export const SHARED_HISTORY_KEY = "warband.history.shared.v1";
export const SHARED_HISTORY_MAX_ENTRIES = 2000;
const CHAT = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const LEGACY_PREFIX = "warband.history.";
export interface SharedIndexHost {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  keys(): readonly string[];
}
/** Un index commun à la fenêtre ; les mutations d’une conversation ne remplacent jamais celles d’un autre chat. */
export function createSharedHistoryIndex(
  host: SharedIndexHost,
  onError: (error: unknown) => void = () => {},
) {
  const keys = host
    .keys()
    .filter(
      (key) =>
        key === "warband.history" ||
        (key.startsWith(LEGACY_PREFIX) && CHAT.test(key.slice(LEGACY_PREFIX.length))),
    );
  const legacyChats = keys
    .filter((key) => key.startsWith(LEGACY_PREFIX))
    .map((key) => key.slice(LEGACY_PREFIX.length))
    .filter((id) => id !== "sidebar");
  const stored = host.get(SHARED_HISTORY_KEY);
  let rows: ConversationMeta[];
  if (stored !== undefined) rows = parseIndex(stored, SHARED_HISTORY_MAX_ENTRIES);
  else {
    const merged = new Map<string, ConversationMeta>();
    for (const key of keys) {
      const owner = key === "warband.history" ? "sidebar" : key.slice(LEGACY_PREFIX.length);
      for (const item of parseIndex(host.get(key))) {
        const old = merged.get(item.id);
        if (!old) merged.set(item.id, { ...item, historyOwner: owner });
        else if ((old.projectId ?? null) === (item.projectId ?? null)) {
          const latest =
            Date.parse(item.updatedAt) > Date.parse(old.updatedAt)
              ? { ...item, historyOwner: owner }
              : old;
          merged.set(item.id, {
            ...latest,
            runIds: [...new Set([...old.runIds, ...item.runIds])].slice(-500),
          });
        }
      }
    }
    rows = sortRecent([...merged.values()]);
  }
  const listeners = new Set<() => void>();
  let writing = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(rows);
    writing = writing
      .catch(() => undefined)
      .then(async () => {
        await host.set(SHARED_HISTORY_KEY, snapshot);
      });
    void writing.catch(onError);
    return writing;
  };
  // Une liste vide est aussi une migration terminée : les suppressions ne doivent jamais ressusciter les anciens index.
  if (stored === undefined) void persist();
  const get = (_key: string) => structuredClone(rows);
  const update = (_key: string, change: (current: unknown) => unknown) => {
    rows = parseIndex(change(get(SHARED_HISTORY_KEY)), SHARED_HISTORY_MAX_ENTRIES);
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        onError(error);
      }
    }
    return persist();
  };
  return {
    legacyChats,
    index: {
      get,
      update,
      set: (key: string, value: unknown) => update(key, () => value),
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    flush: () => writing,
  };
}

/** Les anciens journaux restent à leur place ; les nouveaux sont écrits dans runs/, partagé. */
export function createSharedJournalFiles(
  root: string,
  legacyChats: readonly string[],
): JournalFiles {
  const primary = createJournalFiles(root);
  const sources = [
    primary,
    ...[...new Set(legacyChats.filter((id) => CHAT.test(id) && id !== "sidebar"))].map((id) =>
      createJournalFiles(join(root, id)),
    ),
  ];
  return {
    dir: root,
    async read(id) {
      for (const source of sources) {
        const text = await source.read(id);
        if (text !== null) return text;
      }
      return null;
    },
    async scan(id, visit) {
      for (const source of sources) {
        const result = await source.scan?.(id, visit);
        if (result && !result.missing) return result;
      }
      return { invalid: 0, missing: true };
    },
    async size(id) {
      for (const source of sources) {
        const bytes = await source.size(id);
        if (bytes > 0) return bytes;
      }
      return 0;
    },
    async remove(ids) {
      await Promise.all(sources.map((source) => source.remove(ids)));
    },
    async removeAll() {
      await Promise.all(sources.map((source) => source.removeAll()));
    },
  };
}
