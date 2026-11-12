/**
 * Téléchargements web (ADR 0055) : un module offre un fichier (exports, rapports) ; la coquille reçoit
 * `download {id, filename}` puis le navigateur lit `GET /api/download/<id>` une seule fois. Mémoire bornée.
 */
import { randomBytes } from "node:crypto";
import type { Sink } from "./bridge/hub.js";
import { sanitizeFilename } from "./uploads.js";

export const MAX_DOWNLOADS = 50;
export const MAX_DOWNLOAD_TOTAL = 64 * 1024 * 1024;
export const DOWNLOAD_TTL_MS = 5 * 60_000;
export const DOWNLOAD_ID = /^dl_[0-9a-f]{32}$/;

export interface DownloadOffer {
  filename: string;
  mime: string;
  body: Buffer | AsyncIterable<Buffer | Uint8Array>;
  /** Durée de validité (ms), plafonnée à 5 min. */
  maxAgeMs?: number;
  /** Socket émetteur du geste ; sinon toutes les coquilles reçoivent `download`. */
  to?: Sink;
}

export interface TakenDownload {
  filename: string;
  mime: string;
  body: Buffer;
}

interface Entry extends TakenDownload {
  expires: number;
}

const MIME = /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,100}$/i;

export class DownloadStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private used = 0;
  private inflight = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly options: {
      shell: () => Iterable<Sink>;
      now?: () => number;
      sweepMs?: number;
    },
  ) {
    this.now = options.now ?? Date.now;
    const period = options.sweepMs ?? 30_000;
    if (period > 0) {
      this.timer = setInterval(() => this.sweep(), period);
      this.timer.unref?.();
    }
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, e] of this.entries) {
      if (e.expires > t) continue;
      this.entries.delete(id);
      this.used -= e.body.length;
    }
  }

  /**
   * Offre un fichier : identifiant aléatoire (128 bits) ou `null` si les bornes (50 offres, 64 Mio en tout)
   * sont dépassées. Rien n'est écrit sur disque.
   */
  async offer(o: DownloadOffer): Promise<string | null> {
    this.sweep();
    if (this.entries.size + this.inflight >= MAX_DOWNLOADS) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    this.inflight++;
    try {
      const parts = Buffer.isBuffer(o.body) ? [o.body] : o.body;
      for await (const part of parts) {
        const b = Buffer.isBuffer(part) ? part : Buffer.from(part);
        // La réservation compte tout de suite : un flux ne dépasse jamais la borne globale.
        if (this.used + b.length > MAX_DOWNLOAD_TOTAL) {
          this.used -= size;
          return null;
        }
        this.used += b.length;
        size += b.length;
        chunks.push(b);
      }
    } catch {
      this.used -= size;
      return null;
    } finally {
      this.inflight--;
    }
    const id = `dl_${randomBytes(16).toString("hex")}`;
    const filename = sanitizeFilename(o.filename);
    const age = Math.min(Math.max(o.maxAgeMs ?? DOWNLOAD_TTL_MS, 1), DOWNLOAD_TTL_MS);
    this.entries.set(id, {
      filename,
      mime: MIME.test(o.mime) ? o.mime : "application/octet-stream",
      body: Buffer.concat(chunks),
      expires: this.now() + age,
    });
    for (const sink of o.to ? [o.to] : this.options.shell())
      sink.send("shell", "shell", { type: "download", id, filename });
    return id;
  }

  /** Usage unique : retire l'offre et la rend, `undefined` si inconnue, déjà prise ou expirée. */
  take(id: string): TakenDownload | undefined {
    if (!DOWNLOAD_ID.test(id)) return undefined;
    this.sweep();
    const e = this.entries.get(id);
    if (!e) return undefined;
    this.entries.delete(id);
    this.used -= e.body.length;
    return { filename: e.filename, mime: e.mime, body: e.body };
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.entries.clear();
    this.used = 0;
  }
}

/** En-tête `Content-Disposition` : repli ASCII et `filename*` (RFC 5987) du nom déjà assaini. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const star = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
