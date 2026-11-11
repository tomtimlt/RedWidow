import { join } from "node:path";
import { type ConversationMeta, parseIndex, sortRecent } from "./history.js";
import { createJournalFiles, type JournalFiles } from "./historyStore.js";

/** Index global (`globalState`) : commun à toutes les fenêtres et à tous les projets (ADR 0049). */
export const GLOBAL_HISTORY_KEY = "warband.history.global.v1";
/** Ancien index de la fenêtre (`workspaceState`) : lu pour la migration, jamais effacé. */
export const WORKSPACE_HISTORY_KEY = "warband.history.shared.v1";
/** Clé de l'index tel que les sessions le désignent (l'index ignore la clé : un seul index). */
export const SHARED_HISTORY_KEY = GLOBAL_HISTORY_KEY;
/** Marqueur posé dans l'ancien hôte : sa migration est faite, une suppression ne ressuscite plus. */
const MIGRATED_KEY = "warband.history.global-migrated.v1";
export const SHARED_HISTORY_MAX_ENTRIES = 2000;
const CHAT = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const LEGACY_PREFIX = "warband.history.";
export interface SharedIndexHost {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  keys(): readonly string[];
}
const MAX_RUNS = 500;
/** Fusionne par id sans doublon : garde la ligne la plus récente et réunit les runIds (jamais entre deux projets). */
function mergeRows(
  merged: Map<string, ConversationMeta>,
  items: readonly ConversationMeta[],
  owner?: string,
) {
  for (const item of items) {
    const old = merged.get(item.id);
    const tagged = owner === undefined ? item : { ...item, historyOwner: owner };
    if (!old) merged.set(item.id, tagged);
    else if ((old.projectId ?? null) === (item.projectId ?? null)) {
      const latest = Date.parse(item.updatedAt) > Date.parse(old.updatedAt) ? tagged : old;
      merged.set(item.id, {
        ...latest,
        runIds: [...new Set([...old.runIds, ...item.runIds])].slice(-MAX_RUNS),
      });
    }
  }
}
/**
 * Un index commun à toutes les fenêtres (`host` = état global). `legacy` est l'état de la fenêtre
 * (ancien index et anciennes clés) : fusionné une fois, puis laissé en lecture seule. Chaque lecture et
 * chaque mise à jour relit l'hôte : une écriture d'une autre fenêtre n'est jamais écrasée.
 */
export function createSharedHistoryIndex(
  host: SharedIndexHost,
  onError: (error: unknown) => void = () => {},
  legacy?: SharedIndexHost,
) {
  const keys = (legacy?.keys() ?? []).filter(
    (key) =>
      key === "warband.history" ||
      (key.startsWith(LEGACY_PREFIX) && CHAT.test(key.slice(LEGACY_PREFIX.length))),
  );
  const legacyChats = keys
    .filter((key) => key.startsWith(LEGACY_PREFIX))
    .map((key) => key.slice(LEGACY_PREFIX.length))
    .filter((id) => id !== "sidebar");
  const stored = host.get(GLOBAL_HISTORY_KEY);
  let rows: ConversationMeta[] =
    stored === undefined ? [] : parseIndex(stored, SHARED_HISTORY_MAX_ENTRIES);
  const migrating = legacy !== undefined && legacy.get(MIGRATED_KEY) !== true;
  if (migrating) {
    const merged = new Map(rows.map((item) => [item.id, item]));
    const workspace = legacy.get(WORKSPACE_HISTORY_KEY);
    if (workspace !== undefined)
      mergeRows(merged, parseIndex(workspace, SHARED_HISTORY_MAX_ENTRIES));
    else
      for (const key of keys) {
        const owner = key === "warband.history" ? "sidebar" : key.slice(LEGACY_PREFIX.length);
        mergeRows(merged, parseIndex(legacy.get(key)), owner);
      }
    rows = sortRecent([...merged.values()]);
  }
  const listeners = new Set<() => void>();
  let writing = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(rows);
    // L'écriture est lancée tout de suite (l'état hôte est à jour pour la lecture suivante) ; la file ne sert qu'à l'attente.
    const written = new Promise<void>((resolve) => {
      resolve(host.set(GLOBAL_HISTORY_KEY, snapshot) as void | PromiseLike<void>);
    });
    writing = writing.catch(() => undefined).then(() => written);
    void writing.catch(onError);
    return writing;
  };
  // Une liste vide est aussi une migration terminée : les suppressions ne doivent jamais ressusciter les anciens index.
  if (migrating || stored === undefined) {
    // Le marqueur n'est posé qu'une fois l'index global écrit ; un échec est déjà signalé par `persist`.
    void persist().then(
      async () => {
        try {
          await legacy?.set(MIGRATED_KEY, true);
        } catch (error) {
          onError(error);
        }
      },
      () => undefined,
    );
  }
  /** Relit l'hôte : une autre fenêtre a pu écrire entre-temps. */
  const reload = () => {
    const latest = host.get(GLOBAL_HISTORY_KEY);
    if (latest !== undefined) rows = parseIndex(latest, SHARED_HISTORY_MAX_ENTRIES);
  };
  const get = (_key: string) => {
    reload();
    return structuredClone(rows);
  };
  const update = (_key: string, change: (current: unknown) => unknown) => {
    reload();
    rows = parseIndex(change(structuredClone(rows)), SHARED_HISTORY_MAX_ENTRIES);
    // Écrire avant de notifier : les abonnés relisent l'hôte, qui doit déjà porter ce changement.
    const written = persist();
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        onError(error);
      }
    }
    return written;
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

/**
 * Les nouveaux journaux sont écrits dans `root` (dossier global) ; les anciens restent à leur place :
 * `legacyRoot` (ancien `storageUri/runs`) puis ses sous-dossiers de chats hérités.
 */
export function createSharedJournalFiles(
  root: string,
  legacyChats: readonly string[],
  legacyRoot?: string,
): JournalFiles {
  const primary = createJournalFiles(root);
  const old = legacyRoot ?? root;
  const sources = [
    primary,
    ...(old === root ? [] : [createJournalFiles(old)]),
    ...[...new Set(legacyChats.filter((id) => CHAT.test(id) && id !== "sidebar"))].map((id) =>
      createJournalFiles(join(old, id)),
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
