import { StringDecoder } from "node:string_decoder";

export interface LineSplitterOptions {
  /** Longueur maximale d'une ligne (caractères) ; le reste est jeté. Défaut : 16 384. */
  maxLineLength?: number;
}

export const DEFAULT_MAX_LINE_LENGTH = 16_384;

/**
 * Découpe un flux d'octets en lignes, indépendamment des frontières de
 * chunk (y compris au milieu d'un caractère UTF-8). Gère \n et \r\n ; un \r
 * isolé (barre de progression) remplace la ligne en cours. Une ligne plus
 * longue que `maxLineLength` est coupée (`truncated = true`) et son reste jeté
 * jusqu'au prochain saut de ligne, ce qui borne la mémoire.
 */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private readonly max: number;
  private buffer = "";
  /** Vrai tant qu'on jette le reste d'une ligne déjà coupée. */
  private skipping = false;

  constructor(
    private readonly onLine: (line: string, truncated: boolean) => void,
    { maxLineLength = DEFAULT_MAX_LINE_LENGTH }: LineSplitterOptions = {},
  ) {
    this.max = maxLineLength;
  }

  push(chunk: Buffer | string): void {
    let text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (this.skipping) {
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      this.skipping = false;
      text = text.slice(newline + 1);
    }
    this.buffer += text;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      this.emit(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > this.max) {
      this.emit(this.buffer.slice(0, this.max), true);
      this.buffer = "";
      this.skipping = true;
    }
  }

  /** Vide le reste (dernière ligne sans \n). */
  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer !== "" && !this.skipping) this.emit(this.buffer);
    this.buffer = "";
    this.skipping = false;
  }

  private emit(raw: string, cut = false): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const cr = line.lastIndexOf("\r");
    const last = cr === -1 ? line : line.slice(cr + 1);
    if (last.length > this.max) this.onLine(last.slice(0, this.max), true);
    else this.onLine(last, cut);
  }
}
