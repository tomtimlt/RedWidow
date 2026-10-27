import { type Finding, stripControl } from "@warband/core";

const TYPES = {
  host: "Hôte",
  site: "Site / URL",
  credential: "Identifiant",
  step: "Étape",
  loot: "Loot",
};
const STATES = { confirmed: "Confirmé", hypothesis: "Hypothèse", failed: "Échec" };
const COLORS = { confirmed: "#196b48", hypothesis: "#8b6508", failed: "#ad3030" };
const xml = (value: string) =>
  stripControl(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? "",
  );

/** Noms complets, sans ellipse : coupe les mots trop longs, Unicode compris. */
function lines(text: string, width = 17): string[] {
  const out: string[] = [];
  let row = "";
  for (const word of stripControl(text).split(/\s+/u).filter(Boolean)) {
    if (row && Array.from(`${row} ${word}`).length > width) {
      out.push(row);
      row = "";
    }
    let chars = Array.from(row ? `${row} ${word}` : word);
    while (chars.length > width) {
      out.push(chars.slice(0, width).join(""));
      chars = chars.slice(width);
    }
    row = chars.join("");
  }
  if (row) out.push(row);
  return out.length ? out : [""];
}

/** Image autonome, sans scripts, HTML, liens externes ou données d'outil. Tout le graphe est exporté. */
export function killchainImage(project: { name: string }, findings: readonly Finding[]): string {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const parents = new Map<string, string[]>();
  const children = new Map(findings.map((finding) => [finding.id, [] as string[]]));
  for (const finding of findings) {
    const from = [...new Set(finding.from ?? [])].filter((id) => id !== finding.id && byId.has(id));
    parents.set(finding.id, from);
    for (const id of from) children.get(id)?.push(finding.id);
  }
  const degrees = new Map([...parents].map(([id, from]) => [id, from.length]));
  const layer = new Map(findings.map((finding) => [finding.id, 0]));
  const queue = findings
    .filter((finding) => degrees.get(finding.id) === 0)
    .map((finding) => finding.id);
  const placed = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string;
    placed.add(id);
    for (const child of children.get(id) ?? []) {
      layer.set(child, Math.max(layer.get(child) ?? 0, (layer.get(id) ?? 0) + 1));
      const degree = (degrees.get(child) ?? 1) - 1;
      degrees.set(child, degree);
      if (!degree) queue.push(child);
    }
  }
  // Même les cycles et nœuds isolés restent présents ; aucun arc ne disparaît.
  for (const finding of findings) {
    if (placed.has(finding.id)) continue;
    let rank = 0;
    for (const id of parents.get(finding.id) ?? [])
      if (placed.has(id)) rank = Math.max(rank, (layer.get(id) ?? 0) + 1);
    layer.set(finding.id, rank);
    placed.add(finding.id);
  }
  const columns = new Map<number, Finding[]>();
  for (const finding of findings) {
    const rank = layer.get(finding.id) ?? 0;
    const col = columns.get(rank) ?? [];
    col.push(finding);
    columns.set(rank, col);
  }
  const title = lines(`Kill Chain — ${project.name}`, 28);
  const top = 125 + title.length * 28;
  const positions = new Map<
    string,
    { x: number; y: number; height: number; label: string[]; meta: string[] }
  >();
  let height = top + 60;
  let width = 780;
  for (const [rank, column] of columns) {
    let y = top;
    for (const finding of column) {
      const label = lines(finding.label);
      const meta = lines(
        [TYPES[finding.kind], STATES[finding.state], finding.tactic, finding.technique]
          .filter(Boolean)
          .join(" · "),
        20,
      );
      const cardH = 34 + label.length * 22 + meta.length * 18;
      const x = 60 + rank * 440;
      positions.set(finding.id, { x, y, height: cardH, label, meta });
      y += cardH + 50;
      width = Math.max(width, x + 440);
    }
    height = Math.max(height, y + 40);
  }
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${xml(`Kill Chain — ${project.name}`)}</title>`,
    `<desc id="desc">${findings.length} éléments. Les liens verts indiquent le chemin retenu, sans déduire une réussite.</desc>`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#687887"/></marker><marker id="path" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#16804a"/></marker></defs>',
    '<g font-family="Arial, sans-serif" fill="#182533">',
    ...title.map(
      (row, i) =>
        `<text x="40" y="${38 + i * 28}" font-size="24" font-weight="bold">${xml(row)}</text>`,
    ),
    `<text x="40" y="${54 + title.length * 28}" font-size="15">${findings.length} éléments · Hôte / Site / Identifiant / Étape / Loot</text>`,
    `<text x="40" y="${78 + title.length * 28}" font-size="15">États : Confirmé / Hypothèse / Échec · Lien vert : chemin retenu</text>`,
  ];
  for (const finding of findings) {
    const to = positions.get(finding.id);
    if (!to) continue;
    for (const id of parents.get(finding.id) ?? []) {
      const from = positions.get(id);
      if (!from) continue;
      const x1 = from.x + 320;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const retained = finding.pathFrom?.includes(id) === true;
      // Les contrôles restent à l'intérieur du canevas, y compris pour les arcs arrière.
      const dx = x2 > x1 ? (x2 - x1) / 2 : 35;
      parts.push(
        `<path d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" fill="none" stroke="${retained ? "#16804a" : "#687887"}" stroke-width="${retained ? 3 : 2}" marker-end="url(#${retained ? "path" : "arrow"})"/>`,
      );
    }
  }
  for (const finding of findings) {
    const pos = positions.get(finding.id);
    if (!pos) continue;
    parts.push(
      `<g><rect x="${pos.x}" y="${pos.y}" width="320" height="${pos.height}" rx="10" fill="#f6f8fa" stroke="${COLORS[finding.state]}" stroke-width="2"/>`,
    );
    pos.label.forEach((row, i) => {
      parts.push(
        `<text x="${pos.x + 14}" y="${pos.y + 27 + i * 22}" font-size="17" font-weight="bold">${xml(row)}</text>`,
      );
    });
    pos.meta.forEach((row, i) => {
      parts.push(
        `<text x="${pos.x + 14}" y="${pos.y + 40 + pos.label.length * 22 + i * 18}" font-size="14">${xml(row)}</text>`,
      );
    });
    parts.push("</g>");
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}
