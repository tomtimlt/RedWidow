// Mini-rendu Markdown SÛR : produit un arbre abstrait (jamais de HTML). La webview construit les nœuds
// DOM à partir de cet arbre avec une liste blanche de balises ; les liens et images restent du texte.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b" | "i"; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; items: Inline[][] };

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
