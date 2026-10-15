/**
 * Archives tar strictes pour l'échange de fichiers avec le bac à sable (ADR 0003, F).
 *
 * Module pur : aucun accès docker, aucun processus. `docker cp` n'extrait jamais rien sur l'hôte ;
 * c'est ce code qui produit (`packTar`) et lit (`unpackTar`) les archives, en validant TOUT avant
 * d'écrire quoi que ce soit. Seuls fichiers réguliers et répertoires sont admis ; tout le reste
 * (lien, périphérique, FIFO, chemin absolu ou `..`, noms réservés Windows, en-tête pax hostile)
 * refuse l'archive en bloc.
 */

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { checkPathAccess, type PathOptions, windowsRawForm } from "../approval/paths.js";
import { CodedError } from "../reason.js";

const BLOCK = 512;
const MAX_NAME = 255;
const MAX_SEGMENT = 255;
const MAX_PAX = 8192;
const MAX_PAX_RECORDS = 16;
/** Propriétaire côté conteneur (utilisateur du bac à sable). */
const OWNER = 65534;

export const DEFAULT_TAR_LIMITS = { maxBytes: 256 * 1024 * 1024, maxEntries: 10_000 } as const;

export interface TarLimits {
  /** Somme des tailles de contenu (octets). */
  maxBytes?: number;
  maxEntries?: number;
}

/** Entrée validée : chemin relatif POSIX, sans `/` final. */
export type TarEntry = { type: "dir"; path: string } | { type: "file"; path: string; data: Buffer };

export type TarRejection =
  | "symlink"
  | "hardlink"
  | "special"
  | "traversal"
  | "absolute"
  | "name"
  | "nameTooLong"
  | "winName"
  | "tooLarge"
  | "tooManyEntries"
  | "pax"
  | "malformed"
  | "checksum"
  | "truncated"
  | "multiRoot"
  | "duplicate"
  | "conflict"
  | "destExists"
  | "destDenied"
  | "sensitive"
  | "notRegular";

/** Caractère de contrôle C0, DEL ou C1 (dont `\0`). */
function isControl(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  return n <= 0x1f || (n >= 0x7f && n <= 0x9f);
}

/** Nom d'entrée borné et neutralisé pour les paramètres de raison (jamais recopié en entier). */
function shown(name: string): string {
  const cut = name.length > 60 ? `${name.slice(0, 60)}…` : name;
  return [...cut].map((c) => (isControl(c) ? "?" : c)).join("");
}

function reject(reason: TarRejection, entry?: string, extra?: Record<string, number>): never {
  throw new CodedError("sandbox.tarRejected", {
    reason,
    ...(entry !== undefined && { entry: shown(entry) }),
    ...extra,
  });
}

function limitsOf(l: TarLimits | undefined): Required<TarLimits> {
  return { ...DEFAULT_TAR_LIMITS, ...l };
}

/** Valide un nom d'entrée et le rend sans `/` final ; refuse tout ce qui sort de la racine ou n'est pas portable. */
function checkName(raw: string): string {
  if ([...raw].some((c) => isControl(c) || c === "\\")) return reject("name", raw);
  if (raw.startsWith("/")) return reject("absolute", raw);
  const name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (name === "" || name.length > MAX_NAME) return reject("nameTooLong", raw);
  for (const seg of name.split("/")) {
    if (seg === "..") return reject("traversal", raw);
    if (seg === "" || seg === ".") return reject("name", raw);
    if (seg.length > MAX_SEGMENT) return reject("nameTooLong", raw);
    // Même sur Linux : l'archive doit rester extractible sans surprise sous Windows.
    if (/^[A-Za-z]:/.test(seg) || windowsRawForm(seg) !== null) return reject("winName", raw);
  }
  return name;
}

// --- Écriture ---------------------------------------------------------------------------------

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0");
}

function header(name: string, type: "0" | "5", size: number): Buffer {
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    // Coupe sur un `/` pour que le reste tienne dans 100 octets et le préfixe dans 155.
    const at = name.indexOf("/", name.length - 100 - 1);
    if (at < 1 || Buffer.byteLength(name.slice(at + 1)) > 100 || at > 155) {
      return reject("nameTooLong", name);
    }
    prefix = name.slice(0, at);
    base = name.slice(at + 1);
  }
  const h = Buffer.alloc(BLOCK);
  h.write(base, 0, 100);
  h.write(`${octal(type === "5" ? 0o755 : 0o644, 8)}\0`, 100);
  h.write(`${octal(OWNER, 8)}\0`, 108);
  h.write(`${octal(OWNER, 8)}\0`, 116);
  h.write(`${octal(size, 12)}\0`, 124);
  h.write(`${octal(0, 12)}\0`, 136); // mtime fixe : archive reproductible
  h.fill(0x20, 148, 156);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155);
  const sum = h.reduce((s, b) => s + b, 0);
  h.write(`${octal(sum, 7)}\0`, 148);
  return h;
}

/** Sérialise des entrées validées en archive ustar. */
export function packTar(entries: readonly TarEntry[], limits?: TarLimits): Buffer {
  const lim = limitsOf(limits);
  if (entries.length > lim.maxEntries)
    reject("tooManyEntries", undefined, { limit: lim.maxEntries });
  const parts: Buffer[] = [];
  let total = 0;
  for (const e of entries) {
    const name = checkName(e.path);
    if (e.type === "dir") {
      parts.push(header(name, "5", 0));
      continue;
    }
    total += e.data.length;
    if (total > lim.maxBytes) reject("tooLarge", name, { limit: lim.maxBytes });
    parts.push(
      header(name, "0", e.data.length),
      e.data,
      Buffer.alloc((BLOCK - (e.data.length % BLOCK)) % BLOCK),
    );
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/**
 * Lit un fichier ou un répertoire de l'hôte en entrées, sous le nom `asName` (racine de l'archive).
 * Liens symboliques ignorés ; entrées sensibles ou non analysables, racine non régulière → refus.
 * `opts` est le contexte de chemins de la gate (`cwd`, `roots`…) ; « hors espace de travail » n'est
 * pas tranché ici (c'est un `ask` de la gate), seuls sensible/non analysable le sont.
 */
export function collectHostEntries(
  hostPath: string,
  asName: string,
  opts: PathOptions,
  limits?: TarLimits,
): TarEntry[] {
  const lim = limitsOf(limits);
  const root = checkName(asName);
  const out: TarEntry[] = [];
  let total = 0;
  const walk = (abs: string, name: string, top: boolean): void => {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      if (top) reject("symlink", name);
      return; // ignoré
    }
    const finding = checkPathAccess([abs], opts);
    if (finding !== null && finding.kind !== "outside") reject("sensitive", basename(abs));
    if (out.length >= lim.maxEntries) {
      reject("tooManyEntries", undefined, { limit: lim.maxEntries });
    }
    if (st.isDirectory()) {
      out.push({ type: "dir", path: checkName(name) });
      for (const child of readdirSync(abs).sort())
        walk(join(abs, child), `${name}/${child}`, false);
    } else if (st.isFile()) {
      total += st.size;
      if (total > lim.maxBytes) reject("tooLarge", name, { limit: lim.maxBytes });
      out.push({ type: "file", path: checkName(name), data: readFileSync(abs) });
    } else if (top) {
      reject("notRegular", name);
    }
  };
  walk(resolve(opts.cwd, hostPath), root, true);
  return out;
}

/** `put` : fichier ou répertoire de l'hôte → archive tar prête pour `docker cp -`. */
export function packHostPath(
  hostPath: string,
  asName: string,
  opts: PathOptions,
  limits?: TarLimits,
): Buffer {
  return packTar(collectHostEntries(hostPath, asName, opts, limits), limits);
}

// --- Lecture ----------------------------------------------------------------------------------

function field(h: Buffer, from: number, len: number): string {
  const raw = h.subarray(from, from + len);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul < 0 ? len : nul).toString("utf8");
}

function parseOctal(h: Buffer, from: number, len: number, what: string): number {
  if ((h[from] ?? 0) & 0x80) return reject("malformed", what); // base 256 : refusé
  const s = field(h, from, len).trim();
  if (s === "") return 0;
  return /^[0-7]+$/.test(s) ? Number.parseInt(s, 8) : reject("malformed", what);
}

/** Enregistrements pax : seul `path` est retenu ; `size`, `linkpath`, `GNU.sparse.*` → refus. */
function parsePax(data: Buffer): { path?: string } {
  let pos = 0;
  let count = 0;
  const out: { path?: string } = {};
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos);
    const lenText = sp < 0 ? "" : data.subarray(pos, sp).toString("latin1");
    if (!/^[1-9][0-9]{0,5}$/.test(lenText)) return reject("pax");
    const end = pos + Number(lenText);
    if (end > data.length || data[end - 1] !== 0x0a || ++count > MAX_PAX_RECORDS) {
      return reject("pax");
    }
    const rec = data.subarray(sp + 1, end - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq < 1) return reject("pax");
    const key = rec.slice(0, eq);
    if (key === "path") {
      if (out.path !== undefined) return reject("pax");
      out.path = rec.slice(eq + 1);
    } else if (key === "size" || key === "linkpath" || key.startsWith("GNU.sparse")) {
      return reject("pax", key);
    }
    pos = end;
  }
  return out;
}

/**
 * Lit une archive complète et la valide en bloc. Retourne les entrées (une seule racine) ou lève
 * `CodedError("sandbox.tarRejected")` sans effet de bord.
 */
export function unpackTar(buf: Buffer, limits?: TarLimits): TarEntry[] {
  const lim = limitsOf(limits);
  const entries: TarEntry[] = [];
  const seen = new Map<string, "dir" | "file">();
  let pos = 0;
  let total = 0;
  let pax: { path?: string } | null = null;
  let ended = false;
  while (pos < buf.length) {
    const h = buf.subarray(pos, pos + BLOCK);
    if (h.length < BLOCK) return reject("truncated");
    pos += BLOCK;
    if (h.every((b) => b === 0)) {
      ended = true;
      break;
    }
    const sum = parseOctal(h, 148, 8, "chksum");
    let calc = 0;
    for (let i = 0; i < BLOCK; i++) calc += i >= 148 && i < 156 ? 0x20 : (h[i] ?? 0);
    if (sum !== calc) return reject("checksum");
    if (!field(h, 257, 6).startsWith("ustar")) return reject("malformed", "magic");
    const type = String.fromCharCode(h[156] ?? 0);
    const size = parseOctal(h, 124, 12, "size");
    if (type === "x") {
      if (size > MAX_PAX || pax !== null) return reject("pax");
      if (pos + size > buf.length) return reject("truncated");
      pax = parsePax(buf.subarray(pos, pos + size));
      pos += Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    const prefix = field(h, 345, 155);
    const own = field(h, 0, 100);
    const raw = pax?.path ?? (prefix ? `${prefix}/${own}` : own);
    pax = null;
    if (type === "2") return reject("symlink", raw);
    if (type === "1") return reject("hardlink", raw);
    const isFile = type === "0" || type === "\0";
    if (!isFile && type !== "5") return reject(type === "g" ? "pax" : "special", raw);
    const path = checkName(raw);
    if (entries.length >= lim.maxEntries) {
      return reject("tooManyEntries", undefined, { limit: lim.maxEntries });
    }
    if (isFile) {
      total += size;
      if (total > lim.maxBytes) return reject("tooLarge", path, { limit: lim.maxBytes });
      if (pos + Math.ceil(size / BLOCK) * BLOCK > buf.length) return reject("truncated", path);
    } else if (size !== 0) {
      return reject("malformed", path);
    }
    const folded = path.toLowerCase();
    if (seen.has(folded)) return reject("duplicate", path);
    seen.set(folded, isFile ? "file" : "dir");
    if (isFile) {
      entries.push({ type: "file", path, data: Buffer.from(buf.subarray(pos, pos + size)) });
      pos += Math.ceil(size / BLOCK) * BLOCK;
    } else {
      entries.push({ type: "dir", path });
    }
  }
  if (pax !== null) return reject("pax");
  // Bloc de fin obligatoire : deux blocs de zéros (une archive coupée entre deux entrées est refusée).
  if (!ended || buf.length < pos + BLOCK) return reject("truncated");
  if (ended && !buf.subarray(pos).every((b) => b === 0)) return reject("malformed", "trailing");
  if (entries.length === 0) return reject("malformed", "empty");
  // Une seule racine ; aucun fichier ne sert de parent d'une autre entrée.
  const rootName = (entries[0]?.path ?? "").split("/")[0]?.toLowerCase();
  for (const e of entries) {
    const segs = e.path.toLowerCase().split("/");
    if (segs[0] !== rootName) return reject("multiRoot", e.path);
    for (let i = 1; i < segs.length; i++) {
      if (seen.get(segs.slice(0, i).join("/")) === "file") return reject("conflict", e.path);
    }
  }
  return entries;
}

/** Lit un flux en le bornant à `maxBytes` octets (mesure réelle, indépendante des tailles déclarées). */
export async function readBounded(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > maxBytes) return reject("tooLarge", undefined, { limit: maxBytes });
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

/** Borne de lecture d'un flux tar pour des plafonds donnés (contenu + en-têtes + blocs de remplissage et de fin). */
export function tarStreamLimit(limits?: TarLimits): number {
  const lim = limitsOf(limits);
  return lim.maxBytes + (lim.maxEntries * 4 + 2) * BLOCK;
}

/**
 * `get` : valide toute l'archive, vérifie la destination, écrit dans un répertoire temporaire voisin
 * puis `rename`. La destination ne doit pas exister, ne doit pas être sensible et doit rester dans
 * l'espace de travail (`opts.roots`, défaut `opts.cwd`). Retourne le chemin écrit.
 */
export function extractTar(
  buf: Buffer,
  destination: string,
  opts: PathOptions,
  limits?: TarLimits,
): string {
  const entries = unpackTar(buf, limits); // tout est validé avant la moindre écriture
  const dest = resolve(opts.cwd, destination);
  const finding = checkPathAccess([dest], opts);
  if (finding !== null) {
    return reject(finding.kind === "sensitive" ? "sensitive" : "destDenied", basename(dest));
  }
  let exists = true;
  try {
    lstatSync(dest);
  } catch {
    exists = false;
  }
  if (exists) return reject("destExists", basename(dest));
  const parent = dirname(dest);
  if (!lstatSync(parent).isDirectory()) return reject("destDenied", basename(dest));
  const tmp = mkdtempSync(join(parent, ".john-get-"));
  try {
    for (const e of entries) {
      const target = join(tmp, ...e.path.split("/"));
      if (e.type === "dir") {
        mkdirSync(target, { recursive: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, e.data, { flag: "wx", mode: 0o644 });
      }
    }
    renameSync(join(tmp, (entries[0]?.path ?? "").split("/")[0] ?? ""), dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return dest;
}
