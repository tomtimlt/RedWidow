import { randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { LineSplitter } from "../process/lines.js";

/** Lignes de tête et de queue renvoyées au modèle quand la sortie est trop longue. */
export const OUTPUT_HEAD_LINES = 60;
export const OUTPUT_TAIL_LINES = 140;
/** Au-delà de ce nombre de lignes, un extrait est produit et le fichier complet conservé. */
export const OUTPUT_MAX_LINES = OUTPUT_HEAD_LINES + OUTPUT_TAIL_LINES;
/** Plafond de sécurité de chaque fichier sauvegardé (comme les tâches). */
export const OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
/** Préfixe des dossiers de sortie des commandes synchrones. */
export const OUTPUT_DIR_PREFIX = "warband-exec-";
/** Racine vue du conteneur (le dossier du projet y est monté quand le partage est vérifié). */
export const CONTAINER_OUTPUTS = "/workspace/outputs";

export type OutputStream = "stdout" | "stderr";

/** Bilan d'un flux : extrait, tailles et fichier éventuel. */
export interface StreamSummary {
  bytes: number;
  lines: number;
  head: string[];
  tail: string[];
  /** Lignes entre la tête et la queue, non renvoyées au modèle. */
  omitted: number;
  /** Une ligne a été coupée à la longueur maximale. */
  lineCut: boolean;
  /** Fichier complet conservé, vu du conteneur ; absent si la sortie tient dans l'extrait. */
  file?: string;
  /** Le fichier a atteint le plafond de sécurité et est incomplet. */
  capped: boolean;
  /** Une sauvegarde était nécessaire mais impossible (pas de dossier de projet). */
  unsaved: boolean;
}

export interface OutputCapture {
  write(stream: OutputStream, chunk: Buffer | string): void;
  /** Clôt les fichiers ; supprime ceux dont l'extrait contient toute la sortie. */
  finish(): Record<OutputStream, StreamSummary>;
  /** Chemin du dossier, vu du conteneur, ou `undefined` sans sauvegarde. */
  readonly directory: string | undefined;
}

interface StreamState {
  fd: number | null;
  bytes: number;
  written: number;
  capped: boolean;
  lines: number;
  lineCut: boolean;
  head: string[];
  tail: string[];
  splitter: LineSplitter;
}

/**
 * Capture une sortie de commande : lignes de tête et de queue en mémoire (bornées), octets bruts
 * dans un fichier sous `<racine>/warband-exec-<id>/`. Sans racine ou si le dossier est
 * inutilisable (lien symbolique, droits), l'extrait reste produit mais rien n'est sauvegardé.
 */
export function createOutputCapture(
  root: string | undefined,
  { maxBytes = OUTPUT_MAX_BYTES }: { maxBytes?: number } = {},
): OutputCapture {
  const id = randomUUID().replaceAll("-", "");
  const name = `${OUTPUT_DIR_PREFIX}${id}`;
  let directory: string | undefined;
  if (root !== undefined) {
    try {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!lstatSync(root).isDirectory()) throw Error("not a directory");
      const dir = join(root, name);
      mkdirSync(dir, { mode: 0o700 });
      directory = dir;
    } catch {
      directory = undefined;
    }
  }
  const open = (stream: OutputStream): number | null => {
    if (directory === undefined) return null;
    try {
      return openSync(
        join(directory, `${stream}.txt`),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    } catch {
      return null;
    }
  };
  const state = (stream: OutputStream): StreamState => {
    const s: StreamState = {
      fd: open(stream),
      bytes: 0,
      written: 0,
      capped: false,
      lines: 0,
      lineCut: false,
      head: [],
      tail: [],
      splitter: new LineSplitter((line, cut) => {
        s.lines++;
        if (cut) s.lineCut = true;
        if (s.head.length < OUTPUT_HEAD_LINES) s.head.push(line);
        else {
          s.tail.push(line);
          if (s.tail.length > OUTPUT_TAIL_LINES) s.tail.shift();
        }
      }),
    };
    return s;
  };
  const streams: Record<OutputStream, StreamState> = {
    stdout: state("stdout"),
    stderr: state("stderr"),
  };
  let finished = false;
  return {
    directory: directory === undefined ? undefined : `${CONTAINER_OUTPUTS}/${name}`,
    write(stream, chunk) {
      if (finished) return;
      const s = streams[stream];
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      s.bytes += buffer.length;
      s.splitter.push(buffer);
      if (s.fd !== null && !s.capped) {
        const room = maxBytes - s.written;
        const part = buffer.length > room ? buffer.subarray(0, room) : buffer;
        try {
          if (part.length > 0) writeSync(s.fd, part);
          s.written += part.length;
        } catch {
          s.capped = true;
        }
        if (buffer.length > room) s.capped = true;
      }
    },
    finish() {
      finished = true;
      const result = {} as Record<OutputStream, StreamSummary>;
      for (const stream of ["stdout", "stderr"] as const) {
        const s = streams[stream];
        s.splitter.end();
        if (s.fd !== null) closeSync(s.fd);
        const omitted = Math.max(0, s.lines - s.head.length - s.tail.length);
        const needed = omitted > 0 || s.lineCut || s.capped;
        const kept = s.fd !== null && needed;
        if (s.fd !== null && !needed && directory !== undefined) {
          rmSync(join(directory, `${stream}.txt`), { force: true });
        }
        result[stream] = {
          bytes: s.bytes,
          lines: s.lines,
          head: s.head,
          tail: s.tail,
          omitted,
          lineCut: s.lineCut,
          capped: s.capped,
          unsaved: needed && !kept,
          ...(kept && { file: `${CONTAINER_OUTPUTS}/${name}/${stream}.txt` }),
        };
      }
      // Dossier vide : rien n'est conservé pour une sortie courte.
      if (directory !== undefined && !result.stdout.file && !result.stderr.file) {
        rmSync(directory, { recursive: true, force: true });
      }
      return result;
    },
  };
}

/** Texte d'un flux : tête, marqueur explicite, queue. Une sortie complète est rendue telle quelle. */
export function streamText(s: StreamSummary): string {
  const lines = [...s.head];
  if (s.omitted > 0) {
    lines.push(
      s.file
        ? `… ${s.omitted} lignes omises ; sortie complète : ${s.file} (${s.bytes} octets${s.capped ? ", fichier limité à 32 Mio" : ""}) ; à relire avec read_output (tranche ou recherche)`
        : `… ${s.omitted} lignes omises ; sortie non sauvegardée (aucun dossier de projet disponible)`,
    );
  }
  lines.push(...s.tail);
  if (s.omitted === 0 && s.file)
    lines.push(
      s.capped
        ? `… sortie plus grande que le plafond : fichier limité à 32 Mio : ${s.file}`
        : `… une ligne a été coupée à 16 384 caractères dans cet extrait ; fichier : ${s.file}`,
    );
  return lines.join("\n");
}

/** Mention ajoutée une fois quand un chemin de fichier est cité au modèle. */
export const MOUNT_NOTE =
  "Les fichiers cités sont toujours lisibles avec read_output ; le chemin /workspace/outputs n'existe dans le conteneur que si le dossier du projet y est partagé.";

export interface CommandResult {
  code: number | null;
  signal?: string | null;
  termination?: "abort" | "timeout";
}

/**
 * Réponse d'outil pour une commande terminée. Cas courant inchangé (code 0, stderr vide, sortie
 * courte) : stdout seul. Sinon code de sortie, stdout et stderr distincts, extraits et tailles.
 */
export function renderCommandResult(
  result: CommandResult,
  out: Record<OutputStream, StreamSummary>,
): string {
  const plain =
    result.code === 0 &&
    result.termination === undefined &&
    out.stderr.bytes === 0 &&
    out.stdout.omitted === 0 &&
    !out.stdout.file &&
    !out.stdout.unsaved;
  if (plain) return streamText(out.stdout);
  const status =
    result.termination === "timeout"
      ? "délai dépassé, commande interrompue"
      : result.termination === "abort"
        ? "commande annulée"
        : result.signal
          ? `terminée par le signal ${result.signal}`
          : String(result.code);
  const parts = [`code de sortie : ${status}`];
  for (const stream of ["stdout", "stderr"] as const) {
    const s = out[stream];
    parts.push(
      `${stream} (${s.bytes} octets, ${s.lines} lignes)${s.bytes === 0 ? " : (vide)" : " :"}`,
    );
    if (s.bytes > 0) parts.push(streamText(s));
  }
  if (out.stdout.file || out.stderr.file) parts.push(MOUNT_NOTE);
  return parts.join("\n");
}
