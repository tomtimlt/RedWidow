import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CodedError } from "@warband/core";

/** Paramètres scrypt retenus (ADR 0052) : N = 2^15, r = 8, p = 1, sel 16 octets, clé 32 octets. */
const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Longueur minimale d'un mot de passe. */
export const MIN_PASSWORD_LENGTH = 12;

/** Plafonds acceptés à la vérification : un hash forgé ne doit pas épuiser la mémoire. */
const MAX_LOG2_N = 20;
const B64URL = /^[A-Za-z0-9_-]+$/;

interface Parsed {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number) {
  // Mémoire scrypt ≈ 128·N·r ; on laisse le double comme marge.
  const maxmem = 256 * n * r + 128 * r * p + 1024 * 1024;
  return new Promise<Buffer>((ok, ko) => {
    scrypt(password.normalize("NFKC"), salt, len, { N: n, r, p, maxmem }, (err, key) =>
      err ? ko(err) : ok(key),
    );
  });
}

/** Hache un mot de passe : `scrypt$N$r$p$sel$hash` (sel et hash en base64url). */
export async function hashPassword(password: string): Promise<string> {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new CodedError("server.passwordTooShort", { min: MIN_PASSWORD_LENGTH });
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P, KEY_BYTES);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parse(stored: string): Parsed | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined;
  const [, ns, rs, ps, saltS, hashS] = parts as [string, string, string, string, string, string];
  if (![ns, rs, ps].every((x) => /^[1-9]\d{0,9}$/.test(x))) return undefined;
  const n = Number(ns);
  const r = Number(rs);
  const p = Number(ps);
  // N puissance de 2 entre 2^14 et 2^20 ; r et p bornés.
  if (!Number.isInteger(Math.log2(n)) || n < 2 ** 14 || n > 2 ** MAX_LOG2_N) return undefined;
  if (r < 1 || r > 16 || p < 1 || p > 4) return undefined;
  if (!B64URL.test(saltS) || !B64URL.test(hashS)) return undefined;
  const salt = Buffer.from(saltS, "base64url");
  const hash = Buffer.from(hashS, "base64url");
  if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 64) return undefined;
  return { n, r, p, salt, hash };
}

/** Vrai si la chaîne a la forme d'une empreinte produite par `hashPassword`. */
export function isValidPasswordHash(stored: string): boolean {
  return parse(stored) !== undefined;
}

/** Compare en temps constant ; faux pour un mauvais mot de passe ou un format inconnu. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const key = await derive(
      password,
      parsed.salt,
      parsed.n,
      parsed.r,
      parsed.p,
      parsed.hash.length,
    );
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
  } catch {
    return false;
  }
}

/** Nom du fichier d'authentification sous le dossier de données. */
export const AUTH_FILE = "auth.json";

/**
 * Empreinte du mot de passe : `REDWIDOW_PASSWORD_HASH`, sinon `<dataDir>/auth.json`.
 * Absente ou invalide → erreur codée (le serveur refuse de démarrer). Ne journalise rien.
 */
export async function loadPasswordHash(
  dataDir: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const fromEnv = env.REDWIDOW_PASSWORD_HASH?.trim();
  if (fromEnv) {
    if (!isValidPasswordHash(fromEnv)) throw new CodedError("server.passwordHashInvalid");
    return fromEnv;
  }
  let raw: string;
  try {
    raw = await readFile(join(dataDir, AUTH_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CodedError("server.passwordHashMissing");
    }
    throw new CodedError("server.passwordHashInvalid");
  }
  let hash: unknown;
  try {
    hash = (JSON.parse(raw) as { passwordHash?: unknown }).passwordHash;
  } catch {
    throw new CodedError("server.passwordHashInvalid");
  }
  if (typeof hash !== "string" || !isValidPasswordHash(hash)) {
    throw new CodedError("server.passwordHashInvalid");
  }
  return hash;
}
