import { readFile, rename } from "node:fs/promises";
import { writeFileAtomic } from "./paths.js";

/** Valeur JSON (les fonctions et `undefined` ne sont pas stockables : ils suppriment la clé). */
export type JsonValue = unknown;

/** Stockage d'état persistant : lecture synchrone (cache), écriture asynchrone groupée. */
export interface StateStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  /** Alias de `set` (forme attendue par `CrossProjectResumeDeps`). */
  update(key: string, value: unknown): void;
  keys(prefix?: string): string[];
  /** Appelle `fn` à chaque changement de `key` ; renvoie la désinscription. */
  subscribe(key: string, fn: (value: unknown) => void): () => void;
  /** Attend l'écriture des changements en attente. */
  flush(): Promise<void>;
}

export interface StateStoreHandle extends StateStore {
  /** Charge le fichier (à appeler une fois avant usage). */
  open(): Promise<void>;
}

const WRITE_DELAY_MS = 25;

/** Normalise en JSON pur ; `undefined` si la valeur n'est pas stockable. */
function normalize(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
}

export function createStateStore(file: string): StateStoreHandle {
  const data = new Map<string, unknown>();
  const subs = new Map<string, Set<(value: unknown) => void>>();
  let timer: NodeJS.Timeout | undefined;
  let dirty = false;
  let writing: Promise<void> = Promise.resolve();
  let lastError: unknown;

  const write = (): Promise<void> => {
    writing = writing.then(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await writeFileAtomic(file, JSON.stringify(Object.fromEntries(data)));
        lastError = undefined;
      } catch (err) {
        dirty = true;
        lastError = err;
      }
    });
    return writing;
  };

  const schedule = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void write();
    }, WRITE_DELAY_MS);
    timer.unref();
  };

  const notify = (key: string, value: unknown) => {
    for (const fn of subs.get(key) ?? []) {
      try {
        fn(value);
      } catch {
        // Un abonné défaillant ne doit pas bloquer l'écriture.
      }
    }
  };

  const set = (key: string, value: unknown): void => {
    const v = normalize(value);
    if (v === undefined) {
      if (!data.delete(key)) return;
    } else {
      data.set(key, v);
    }
    schedule();
    notify(key, v);
  };

  return {
    async open() {
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("objet attendu");
        }
        for (const [k, v] of Object.entries(parsed)) data.set(k, v);
      } catch {
        // Fichier corrompu : on le met de côté et on repart d'un état vide.
        data.clear();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await rename(file, `${file}.corrompu-${stamp}`);
      }
    },
    get: (key) => data.get(key),
    set,
    update: set,
    keys: (prefix) => [...data.keys()].filter((k) => prefix === undefined || k.startsWith(prefix)),
    subscribe(key, fn) {
      const group = subs.get(key) ?? new Set<(value: unknown) => void>();
      subs.set(key, group);
      group.add(fn);
      return () => {
        group.delete(fn);
      };
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await write();
      if (lastError !== undefined) throw lastError;
    },
  };
}
