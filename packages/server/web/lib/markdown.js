// Rendu Markdown minimal et sûr, sur nœuds DOM (`createElement`, `textContent`) : jamais d'écriture de
// HTML, le HTML brut du document est affiché comme du texte. Pris en charge : titres, paragraphes, listes
// (à puces, numérotées), citations, blocs de code, filet, et en ligne code, gras, italique, liens `http(s)`
// (`rel="noopener noreferrer"`, nouvel onglet). Tout le reste (images, tableaux, HTML) reste du texte.

/** Au-delà, l'aperçu est tronqué (le fichier reste éditable). */
export const MAX_MARKDOWN_CHARS = 200000;
const LINK = /^https?:\/\/[^\s\p{Cc}<>"'`]+$/iu;

const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

/** URL d'un lien Markdown acceptée : `http(s)` seulement, sans espace ni caractère de contrôle. */
export const safeHref = (url) => {
  if (typeof url !== "string" || url.length > 2000 || !LINK.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
};

// Éléments en ligne, du plus prioritaire au moins : code, lien, gras, italique.
const INLINE = [
  { re: /`([^`\n]+)`/, make: (doc, m) => el(doc, "code", m[1]) },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    make(doc, m) {
      const href = safeHref(m[2]);
      if (href === null) return doc.createTextNode(m[0]);
      const a = el(doc, "a");
      a.href = href;
      a.rel = "noopener noreferrer";
      a.target = "_blank";
      appendInline(doc, a, m[1]);
      return a;
    },
  },
  {
    re: /(\*\*|__)(?=\S)([^\n]*?\S)\1/,
    make(doc, m) {
      const b = el(doc, "strong");
      appendInline(doc, b, m[2]);
      return b;
    },
  },
  {
    re: /(\*|_)(?=\S)([^\n*_]*?\S)\1/,
    make(doc, m) {
      const i = el(doc, "em");
      appendInline(doc, i, m[2]);
      return i;
    },
  },
];

/** Ajoute `text` à `parent` en y reconnaissant les éléments en ligne ; le reste est du texte. */
function appendInline(doc, parent, text, depth = 0) {
  if (depth > 4) {
    parent.append(doc.createTextNode(text));
    return;
  }
  let rest = text;
  while (rest !== "") {
    let best = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m !== null && (best === null || m.index < best.m.index)) best = { rule, m };
    }
    if (best === null) {
      parent.append(doc.createTextNode(rest));
      return;
    }
    if (best.m.index > 0) parent.append(doc.createTextNode(rest.slice(0, best.m.index)));
    parent.append(best.rule.make(doc, best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * Rend `source` dans un nouvel élément `div.md` (jamais inséré par l'appelant autrement qu'avec
 * `append`). `doc` : le document qui crée les nœuds.
 */
export function renderMarkdown(doc, source) {
  const root = el(doc, "div");
  root.className = "md";
  const text = typeof source === "string" ? source.slice(0, MAX_MARKDOWN_CHARS) : "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1];
      const code = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker ?? "```")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      const pre = el(doc, "pre");
      pre.append(el(doc, "code", code.join("\n")));
      root.append(pre);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const h = el(doc, `h${heading[1]?.length ?? 1}`);
      appendInline(doc, h, heading[2] ?? "");
      root.append(h);
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      root.append(el(doc, "hr"));
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quote = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        quote.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
        i += 1;
      }
      const bq = el(doc, "blockquote");
      appendInline(doc, bq, quote.join(" "));
      root.append(bq);
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : ORDERED.test(line) ? "ol" : null;
    if (kind !== null) {
      const re = kind === "ul" ? BULLET : ORDERED;
      const list = el(doc, kind);
      while (i < lines.length && re.test(lines[i] ?? "")) {
        const li = el(doc, "li");
        appendInline(doc, li, re.exec(lines[i] ?? "")?.[1] ?? "");
        list.append(li);
        i += 1;
      }
      root.append(list);
      continue;
    }
    // Paragraphe : lignes consécutives jusqu'au prochain bloc.
    const para = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !HEADING.test(lines[i] ?? "") &&
      !FENCE.test(lines[i] ?? "") &&
      !QUOTE.test(lines[i] ?? "") &&
      !RULE.test(lines[i] ?? "") &&
      !(para.length > 0 && (BULLET.test(lines[i] ?? "") || ORDERED.test(lines[i] ?? "")))
    ) {
      para.push((lines[i] ?? "").trim());
      i += 1;
    }
    const p = el(doc, "p");
    appendInline(doc, p, para.join(" "));
    root.append(p);
  }
  return root;
}
