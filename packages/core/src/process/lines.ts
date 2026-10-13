import { StringDecoder } from "node:string_decoder";

/**
 * Découpe un flux d'octets en lignes, indépendamment des frontières de
 * chunk (y compris au milieu d'un caractère UTF-8). Gère \n et \r\n ; un \r
 * isolé (barre de progression) remplace la ligne en cours.
 */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      this.emit(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
    }
  }

  /** Vide le reste (dernière ligne sans \n). */
  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer !== "") this.emit(this.buffer);
    this.buffer = "";
  }

  private emit(raw: string): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const cr = line.lastIndexOf("\r");
    this.onLine(cr === -1 ? line : line.slice(cr + 1));
  }
}
