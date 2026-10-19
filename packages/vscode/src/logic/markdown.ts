// Mini-rendu Markdown SÛR : produit un arbre abstrait (jamais de HTML). La webview construit les nœuds
// DOM à partir de cet arbre avec une liste blanche de balises ; les liens et images restent du texte.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b" | "i"; c: Inline[] };

export type Align = "left" | "center" | "right";

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "table"; headers: Inline[][]; align: Align[]; rows: Inline[][][] };

/** Plafonds d'un tableau : au-delà, les colonnes et les lignes en trop sont ignorées. */
const MAX_TABLE_COLS = 16;
const MAX_TABLE_ROWS = 50;

const MAX_DEPTH = 4;

/** Inline : `code`, **gras**, *italique*. Tout le reste (liens, HTML, images) est du texte littéral. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf !== "") out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "*" && depth < MAX_DEPTH) {
      const bold = src.startsWith("**", i);
      const mark = bold ? "**" : "*";
      const end = src.indexOf(mark, i + mark.length);
      if (end > i + mark.length && !/^\s/.test(src.slice(i + mark.length, i + mark.length + 1))) {
        flush();
        out.push({
          t: bold ? "b" : "i",
          c: parseInline(src.slice(i + mark.length, end), depth + 1),
        });
        i = end + mark.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^```\s*([\w+#.-]{0,20})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ALIGN_CELL = /^:?-{3,}:?$/;

/** Cellules d'une ligne de tableau (`|` échappé par `\`). `null` s'il n'y a pas de `|`. */
function splitCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "\\" && body[i + 1] === "|") {
      buf += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells.length > 0 ? cells : null;
}

function columnAlign(cell: string): Align | null {
  if (!ALIGN_CELL.test(cell)) return null;
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string;
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      n++;
      while (n < lines.length && !FENCE.test(lines[n] as string)) body.push(lines[n++] as string);
      blocks.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const headerCells = splitCells(line);
    const sepLine = lines[n + 1];
    const sepCells = sepLine === undefined ? null : splitCells(sepLine);
    if (
      headerCells &&
      sepCells &&
      headerCells.length === sepCells.length &&
      sepCells.length > 0 &&
      sepCells.every((cell) => columnAlign(cell) !== null)
    ) {
      flushPara();
      const cols = Math.min(headerCells.length, MAX_TABLE_COLS);
      const align = sepCells.slice(0, cols).map((cell) => columnAlign(cell) ?? "left");
      const headers = headerCells.slice(0, cols).map((cell) => parseInline(cell));
      const rows: Inline[][][] = [];
      n += 2;
      while (n < lines.length) {
        const rowLine = lines[n] as string;
        if (rowLine.trim() === "") break;
        const cells = splitCells(rowLine);
        if (!cells) break;
        if (rows.length < MAX_TABLE_ROWS) {
          rows.push(Array.from({ length: cols }, (_, i) => parseInline(cells[i] ?? "")));
        }
        n++;
      }
      n--;
      blocks.push({ t: "table", headers, align, rows });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1]?.length ?? 3, 3) as 1 | 2 | 3;
      blocks.push({ t: "h", level, c: parseInline(heading[2] ?? "") });
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : null;
    if (kind) {
      flushPara();
      const re = kind === "ul" ? BULLET : NUMBERED;
      const items: Inline[][] = [];
      while (n < lines.length && re.test(lines[n] as string)) {
        items.push(parseInline(re.exec(lines[n] as string)?.[1] ?? ""));
        n++;
      }
      n--;
      blocks.push({ t: kind, items });
      continue;
    }
    if (line.trim() === "") flushPara();
    else para.push(line);
  }
  flushPara();
  return blocks;
}
