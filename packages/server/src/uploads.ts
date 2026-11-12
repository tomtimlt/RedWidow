/**
 * Téléversements web (ADR 0055) : le navigateur envoie un fichier pour un dialogue `file` en attente ;
 * le serveur le range sous `<données>/uploads/<identifiant>` (0600) et ne rend aux modules qu'un
 * identifiant `up_<aléa>`. Le nom client ne sert jamais de chemin : il est assaini et gardé comme libellé.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { extname, join } from "node:path";

/** Taille par défaut et plafond absolu d'un téléversement. */
export const DEFAULT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Durée de vie d'un fichier non pris, et d'un fichier pris mais non libéré. */
export const UPLOAD_TTL_MS = 15 * 60_000;

export const UPLOAD_ID = /^up_[0-9a-f]{32}$/;

/** Le flux a dépassé la taille permise : rien n'est conservé. */
export class UploadTooLargeError extends Error {
  constructor() {
    super("téléversement trop volumineux");
  }
}

/** Nom de fichier assaini : dernier segment, sans contrôle ni caractère réservé, ≤ 120 caractères. */
export function sanitizeFilename(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? "";
  let s = last
    // Contrôles C0/C1, marques bidirectionnelles : retirés.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: filtre volontaire des contrôles
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/["<>|:*?;%]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if ([...s].length > 120) {
    const ext = extname(s);
    const keep = ext.length <= 16 ? ext : "";
    s = [...s.slice(0, s.length - keep.length)].slice(0, 120 - keep.length).join("") + keep;
  }
  return s === "" ? "fichier" : s;
}

/** Extensions acceptées, normalisées (`.pdf`, minuscules) ; `null` si une entrée est invalide ou la liste vide. */
export function normalizeAccept(accept: readonly string[]): string[] | null {
  if (accept.length === 0 || accept.length > 50) return null;
  const out: string[] = [];
  for (const a of accept) {
    if (typeof a !== "string" || !/^\.?[A-Za-z0-9]{1,10}$/.test(a)) return null;
    out.push(`.${a.replace(/^\./, "").toLowerCase()}`);
  }
  return out;
}

export interface UploadInfo {
  id: string;
  name: string;
  size: number;
}

export interface TakenUpload extends UploadInfo {
  /** Chemin du fichier sous le dossier des téléversements (jamais un chemin client). */
  path: string;
  /** Supprime le fichier : l'appelant le fait dès qu'il a fini ; à défaut il expire après 15 min. */
  release(): Promise<void>;
}

export interface UploadStoreOptions {
  /** Dossier des téléversements (`<données>/uploads`). */
  dir: string;
  now?: () => number;
  /** Période du balayage (ms) ; 0 : aucun minuteur (tests). */
  sweepMs?: number;
}

interface Entry extends UploadInfo {
  dialog: string;
  path: string;
  expires: number;
}

export class UploadStore {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly taken = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: UploadStoreOptions) {
    this.dir = options.dir;
    this.now = options.now ?? Date.now;
    const period = options.sweepMs ?? 60_000;
    if (period > 0) {
      this.timer = setInterval(() => void this.sweep(), period);
      this.timer.unref?.();
    }
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700).catch(() => undefined);
  }

  /** Vide le dossier (démarrage : les fichiers d'un processus précédent n'ont plus de dialogue). */
  async purge(): Promise<void> {
    await this.ensureDir();
    for (const name of await readdir(this.dir).catch(() => [])) {
      await rm(join(this.dir, name), { force: true, recursive: true }).catch(() => undefined);
    }
    this.entries.clear();
    this.taken.clear();
  }

  /**
   * Reçoit le flux d'un téléversement pour `dialog`. Au-delà de `maxBytes` : le flux est interrompu,
   * le fichier partiel supprimé, `UploadTooLargeError` levée. Un nouvel envoi remplace le précédent du dialogue.
   */
  async receive(
    stream: AsyncIterable<Buffer | Uint8Array>,
    opts: { dialog: string; name: string; maxBytes: number },
  ): Promise<UploadInfo> {
    await this.ensureDir();
    const id = `up_${randomBytes(16).toString("hex")}`;
    const path = join(this.dir, id);
    const tmp = `${path}.part`;
    const fh = await open(tmp, "wx", 0o600);
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > opts.maxBytes) throw new UploadTooLargeError();
        await fh.write(chunk);
      }
      await fh.sync();
    } catch (err) {
      await fh.close().catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    await fh.close();
    try {
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    await this.discardDialog(opts.dialog);
    const name = sanitizeFilename(opts.name);
    this.entries.set(id, {
      id,
      name,
      size,
      dialog: opts.dialog,
      path,
      expires: this.now() + UPLOAD_TTL_MS,
    });
    return { id, name, size };
  }

  /** L'identifiant a été créé par ce serveur pour ce dialogue et n'est ni pris ni expiré. */
  owns(id: string, dialog: string): boolean {
    if (!UPLOAD_ID.test(id)) return false;
    void this.sweep();
    return this.entries.get(id)?.dialog === dialog;
  }

  /** Usage unique : retire l'identifiant et rend le fichier (à `release()` par l'appelant, sinon expiration). */
  take(id: string): TakenUpload | undefined {
    if (!UPLOAD_ID.test(id)) return undefined;
    void this.sweep();
    const e = this.entries.get(id);
    if (!e) return undefined;
    this.entries.delete(id);
    e.expires = this.now() + UPLOAD_TTL_MS;
    this.taken.set(id, e);
    return {
      id,
      name: e.name,
      size: e.size,
      path: e.path,
      release: async () => {
        this.taken.delete(id);
        await rm(e.path, { force: true }).catch(() => undefined);
      },
    };
  }

  /** Supprime les téléversements d'un dialogue (annulé, fermé, remplacé). */
  async discardDialog(dialog: string): Promise<void> {
    for (const e of [...this.entries.values()]) {
      if (e.dialog !== dialog) continue;
      this.entries.delete(e.id);
      await rm(e.path, { force: true }).catch(() => undefined);
    }
  }

  /** Supprime les fichiers expirés (non pris, ou pris et non libérés). */
  async sweep(): Promise<void> {
    const t = this.now();
    for (const map of [this.entries, this.taken]) {
      for (const e of [...map.values()]) {
        if (e.expires > t) continue;
        map.delete(e.id);
        await rm(e.path, { force: true }).catch(() => undefined);
      }
    }
  }

  /** Arrêt : minuteur coupé, fichiers restants supprimés. */
  async dispose(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    const all = [...this.entries.values(), ...this.taken.values()];
    this.entries.clear();
    this.taken.clear();
    for (const e of all) await rm(e.path, { force: true }).catch(() => undefined);
  }
}
