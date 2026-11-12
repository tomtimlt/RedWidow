import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CodedError } from "@warband/core";
import { writeFileAtomic } from "./paths.js";

/** Longueur minimale de `REDWIDOW_SECRET_KEY`. */
export const MIN_SECRET_KEY_LENGTH = 32;

const CHECK = "__check";
const CHECK_VALUE = "redwidow";
const KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
const IV_BYTES = 12;

interface Entry {
  iv: string;
  tag: string;
  data: string;
}

interface SecretsFile {
  v: 1;
  kdf: { alg: "scrypt"; N: number; r: number; p: number; salt: string };
  entries: Record<string, Entry>;
}

/** Coffre de secrets chiffré au repos (AES-256-GCM). */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Noms seulement, jamais les valeurs. */
  keys(): string[];
}

function deriveKey(masterKey: string, salt: Buffer, n: number, r: number, p: number) {
  const maxmem = 256 * n * r + 128 * r * p + 1024 * 1024;
  return new Promise<Buffer>((ok, ko) => {
    scrypt(masterKey, salt, 32, { N: n, r, p, maxmem }, (err, key) => (err ? ko(err) : ok(key)));
  });
}

function encrypt(key: Buffer, name: string, value: string): Entry {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return {
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** Déchiffre ; `undefined` si l'authentification échoue (mauvaise clé, entrée échangée ou altérée). */
function decrypt(key: Buffer, name: string, e: Entry): string | undefined {
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"), {
      authTagLength: 16,
    });
    d.setAAD(Buffer.from(name, "utf8"));
    d.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

function isEntry(e: unknown): e is Entry {
  if (e === null || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return typeof o.iv === "string" && typeof o.tag === "string" && typeof o.data === "string";
}

function parseFile(raw: string): SecretsFile {
  const bad = () => new CodedError("server.secretsCorrupt");
  let f: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    throw bad();
  }
  const o = f as Partial<SecretsFile> | null;
  const kdf = o?.kdf;
  if (
    !o ||
    o.v !== 1 ||
    !kdf ||
    kdf.alg !== "scrypt" ||
    typeof kdf.salt !== "string" ||
    !Number.isInteger(kdf.N) ||
    !Number.isInteger(kdf.r) ||
    !Number.isInteger(kdf.p) ||
    // Bornes contre un fichier piégé (coût mémoire démesuré).
    !Number.isInteger(Math.log2(kdf.N)) ||
    kdf.N < 2 ** 14 ||
    kdf.N > 2 ** 20 ||
    kdf.r < 1 ||
    kdf.r > 16 ||
    kdf.p < 1 ||
    kdf.p > 4 ||
    !o.entries ||
    typeof o.entries !== "object" ||
    !Object.values(o.entries).every(isEntry)
  ) {
    throw bad();
  }
  return o as SecretsFile;
}

/** Ouvre (ou crée) le coffre. Mauvaise clé maître : erreur codée `server.secretKeyWrong`. */
export async function createSecretStore(file: string, masterKey: string): Promise<SecretStore> {
  if (masterKey.length < MIN_SECRET_KEY_LENGTH) {
    throw new CodedError("server.secretKeyTooShort", { min: MIN_SECRET_KEY_LENGTH });
  }
  let raw: string | undefined;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  let doc: SecretsFile;
  let key: Buffer;
  let fresh = false;
  if (raw === undefined) {
    const salt = randomBytes(16);
    doc = { v: 1, kdf: { alg: "scrypt", ...KDF, salt: salt.toString("base64") }, entries: {} };
    key = await deriveKey(masterKey, salt, KDF.N, KDF.r, KDF.p);
    doc.entries[CHECK] = encrypt(key, CHECK, CHECK_VALUE);
    fresh = true;
  } else {
    doc = parseFile(raw);
    const { N, r, p, salt } = doc.kdf;
    key = await deriveKey(masterKey, Buffer.from(salt, "base64"), N, r, p);
    const check = doc.entries[CHECK];
    if (!check || decrypt(key, CHECK, check) !== CHECK_VALUE) {
      throw new CodedError("server.secretKeyWrong");
    }
  }

  // Écritures sérialisées : le fichier reflète toujours le dernier état complet.
  let queue: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    const run = queue.then(() => writeFileAtomic(file, JSON.stringify(doc)));
    queue = run.catch(() => undefined);
    return run;
  };
  if (fresh) await persist();

  const guard = (name: string) => {
    if (name === CHECK || name === "") throw new CodedError("server.secretNameInvalid");
  };

  return {
    async get(name) {
      guard(name);
      const e = doc.entries[name];
      if (!e) return undefined;
      const v = decrypt(key, name, e);
      if (v === undefined) throw new CodedError("server.secretEntryInvalid");
      return v;
    },
    async set(name, value) {
      guard(name);
      doc.entries[name] = encrypt(key, name, value);
      await persist();
    },
    async delete(name) {
      guard(name);
      if (!(name in doc.entries)) return;
      delete doc.entries[name];
      await persist();
    },
    keys: () => Object.keys(doc.entries).filter((k) => k !== CHECK),
  };
}

/** Lit `REDWIDOW_SECRET_KEY` : obligatoire, 32 caractères au minimum. Pure, ne journalise rien. */
export function readSecretKey(env: Readonly<Record<string, string | undefined>>): string {
  const k = env.REDWIDOW_SECRET_KEY;
  if (k === undefined || k.trim() === "") throw new CodedError("server.secretKeyMissing");
  if (k.length < MIN_SECRET_KEY_LENGTH) {
    throw new CodedError("server.secretKeyTooShort", { min: MIN_SECRET_KEY_LENGTH });
  }
  return k;
}
