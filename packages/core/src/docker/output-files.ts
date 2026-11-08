import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { LineSplitter } from "../process/lines.js";
import { CodedError } from "../reason.js";
import { CONTAINER_OUTPUTS, OUTPUT_MAX_BYTES } from "./output-capture.js";
import type { DockerToolSpec } from "./tool-specs.js";

/** Tranche maximale renvoyée (octets). */
export const READ_OUTPUT_MAX_BYTES = 32_768;
const CHUNK = 65_536;

const input = {
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe("Fichier sous le dossier outputs du projet (chemin /workspace/outputs/… accepté)"),
  offset: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0)
    .describe("Octet de départ (tranche par octets)"),
  length: z
    .number()
    .int()
    .min(1)
    .max(READ_OUTPUT_MAX_BYTES)
    .default(16_384)
    .describe("Octets lus, 32 Kio maximum"),
  startLine: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .describe("Première ligne (1 = début) : lit par lignes au lieu d'octets"),
  lineCount: z.number().int().min(1).max(400).default(200).describe("Lignes lues, 400 maximum"),
  pattern: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Recherche bornée : texte littéral (ou expression si regex est vrai)"),
  regex: z.boolean().default(false),
  ignoreCase: z.boolean().default(false),
  context: z.number().int().min(0).max(5).default(2).describe("Lignes de contexte par résultat"),
  maxMatches: z.number().int().min(1).max(50).default(20),
};

type Args = z.infer<z.ZodObject<typeof input>>;

/** Motifs à quantificateurs imbriqués : refusés (risque de retour arrière catastrophique). */
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*{]|\([^)]*\{\d*,\d*\}[^)]*\)[+*{]/;

/**
 * Chemin relatif à `root` : refus de `..`, des chemins absolus (hors préfixe conteneur), des
 * octets nuls ; `realpath` puis contrôle de non-sortie, comme `read_project_file`.
 */
async function bound(root: string, raw: string): Promise<string> {
  const path = raw.startsWith(`${CONTAINER_OUTPUTS}/`)
    ? raw.slice(CONTAINER_OUTPUTS.length + 1)
    : raw;
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.split(/[\\/]/).includes("..")
  )
    throw new CodedError("output.invalidPath");
  let base: string;
  let target: string;
  try {
    base = await realpath(root);
    target = await realpath(resolve(base, path));
  } catch {
    throw new CodedError("output.notFound");
  }
  const rel = relative(base, target);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new CodedError("output.invalidPath");
  return target;
}

/** Ouvre un fichier régulier sans suivre de lien final et relit son chemin après ouverture. */
async function withFile<T>(
  root: string,
  raw: string,
  use: (file: Awaited<ReturnType<typeof open>>, size: number) => Promise<T>,
): Promise<T> {
  const target = await bound(root, raw);
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new CodedError("output.notFound");
  }
  try {
    const st = await file.stat();
    if (!st.isFile() || (await bound(root, raw)) !== target)
      throw new CodedError("output.notFound");
    return await use(file, st.size);
  } finally {
    await file.close();
  }
}

/** Parcourt les lignes du fichier (bornées à 32 Mio lus) ; `onLine` renvoie vrai pour s'arrêter. */
async function scanLines(
  file: Awaited<ReturnType<typeof open>>,
  size: number,
  onLine: (line: string, number: number) => boolean,
): Promise<{ scanned: number; stopped: boolean }> {
  const buffer = Buffer.alloc(CHUNK);
  let position = 0;
  let number = 0;
  let stopped = false;
  const splitter = new LineSplitter((line) => {
    if (stopped) return;
    number++;
    if (onLine(line, number)) stopped = true;
  });
  const limit = Math.min(size, OUTPUT_MAX_BYTES);
  while (position < limit && !stopped) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(CHUNK, limit - position), position);
    if (bytesRead === 0) break;
    splitter.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (!stopped) splitter.end();
  return { scanned: position, stopped };
}

/** Longueur utilisable du tampon sans couper une séquence UTF-8 finale (recul d'au plus 3 octets). */
function completeUtf8(buffer: Buffer, length: number): number {
  for (let back = 1; back <= Math.min(3, length); back++) {
    const byte = buffer[length - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return need > back ? length - back : length;
  }
  return length;
}

async function readBytes(root: string, a: Args): Promise<string> {
  return withFile(root, a.path, async (file, size) => {
    const buffer = Buffer.alloc(a.length);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, a.offset);
    // Évite de couper un caractère UTF-8 en fin de tranche : la fin incomplète est rendue au suivant.
    const end = a.offset + bytesRead < size ? completeUtf8(buffer, bytesRead) : bytesRead;
    const text = buffer.subarray(0, end).toString("utf8");
    const next = a.offset + end;
    return JSON.stringify({
      text,
      offset: a.offset,
      nextOffset: next < size ? next : null,
      totalBytes: size,
    });
  });
}

async function readLines(root: string, a: Args & { startLine: number }): Promise<string> {
  return withFile(root, a.path, async (file, size) => {
    const lines: string[] = [];
    let bytes = 0;
    let nextLine: number | null = null;
    const { scanned, stopped } = await scanLines(file, size, (line, number) => {
      if (number < a.startLine) return false;
      if (
        lines.length >= a.lineCount ||
        bytes + Buffer.byteLength(line) + 1 > READ_OUTPUT_MAX_BYTES
      ) {
        nextLine = number;
        return true;
      }
      lines.push(line);
      bytes += Buffer.byteLength(line) + 1;
      return false;
    });
    const more = stopped || scanned < size;
    return JSON.stringify({
      lines: lines.join("\n"),
      startLine: a.startLine,
      lineCount: lines.length,
      nextLine: more ? (nextLine ?? a.startLine + lines.length) : null,
      totalBytes: size,
    });
  });
}

async function search(root: string, a: Args & { pattern: string }): Promise<string> {
  let test: (line: string) => boolean;
  if (a.regex) {
    if (NESTED_QUANTIFIER.test(a.pattern))
      throw new CodedError("output.patternInvalid", { reason: "nestedQuantifier" });
    let re: RegExp;
    try {
      re = new RegExp(a.pattern, a.ignoreCase ? "i" : "");
    } catch {
      throw new CodedError("output.patternInvalid", { reason: "syntax" });
    }
    test = (line) => re.test(line);
  } else if (a.ignoreCase) {
    const needle = a.pattern.toLowerCase();
    test = (line) => line.toLowerCase().includes(needle);
  } else {
    test = (line) => line.includes(a.pattern);
  }
  return withFile(root, a.path, async (file, size) => {
    interface Hit {
      line: number;
      text: string;
      before: string[];
      after: string[];
    }
    const hits: Hit[] = [];
    const pending: { hit: Hit; left: number }[] = [];
    let before: string[] = [];
    let truncated = false;
    let outputBytes = 0;
    const { scanned, stopped } = await scanLines(file, size, (line, number) => {
      for (const p of pending) {
        if (p.left > 0) {
          p.hit.after.push(line);
          p.left--;
        }
      }
      if (test(line)) {
        if (hits.length >= a.maxMatches || outputBytes > READ_OUTPUT_MAX_BYTES * 2) {
          truncated = true;
          return true;
        }
        const hit: Hit = { line: number, text: line, before: [...before], after: [] };
        outputBytes += Buffer.byteLength(line) * (1 + 2 * a.context);
        hits.push(hit);
        if (a.context > 0) pending.push({ hit, left: a.context });
      }
      if (a.context > 0) {
        before.push(line);
        if (before.length > a.context) before = before.slice(-a.context);
      }
      return false;
    });
    return JSON.stringify({
      matches: hits,
      matchCount: hits.length,
      truncated,
      scannedBytes: scanned,
      totalBytes: size,
      ...(scanned < size &&
        !stopped && { note: "recherche limitée aux 32 premiers Mio du fichier" }),
    });
  });
}

/**
 * Outil `read_output` : relit une sortie sauvegardée sous le dossier `outputs` du projet, sans
 * shell. Trois modes : tranche d'octets, plage de lignes, recherche bornée avec contexte.
 */
export function outputFileSpecs(root: () => string | undefined): DockerToolSpec[] {
  return [
    {
      name: "read_output",
      description:
        "Relit une sortie complète sauvegardée (chemin donné dans le marqueur « sortie complète : … », sous /workspace/outputs). " +
        "Trois modes sans shell : tranche par octets (offset, length ≤ 32 Kio, nextOffset renvoyé) ; plage de lignes (startLine, lineCount ≤ 400) ; recherche (pattern littéral ou regex, context ≤ 5, maxMatches ≤ 50). " +
        "À utiliser avant de conclure qu'une sortie tronquée ne contient rien. Lecture seule, dossier outputs uniquement.",
      input,
      readOnly: true,
      async run(raw) {
        const a = z.object(input).strict().parse(raw);
        const base = root();
        if (base === undefined) throw new CodedError("output.notFound");
        if (a.pattern !== undefined) return search(base, { ...a, pattern: a.pattern });
        if (a.startLine !== undefined) return readLines(base, { ...a, startLine: a.startLine });
        return readBytes(base, a);
      },
    },
  ];
}
