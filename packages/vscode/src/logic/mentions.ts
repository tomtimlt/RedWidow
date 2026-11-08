import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { checkPathAccess, type Finding } from "@warband/core";
import { MAX_ATTACHMENT_BYTES, parseAttachments, type TextAttachment } from "./attachments.js";

/** Nombre maximal de fichiers proposés par le menu `@`. */
export const MENTION_MAX_RESULTS = 20;
export const MENTION_MAX_QUERY = 120;
/** Fichiers candidats demandés à `workspace.findFiles` avant filtrage par les règles de chemins. */
export const MENTION_MAX_CANDIDATES = 80;

export const MENTION_KINDS = ["file", "killchain", "sortie"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

/** Pourquoi une mention est refusée : la webview traduit le code, l'hôte ne fournit aucun texte. */
export type MentionRefusal = "path" | "missing" | "size" | "binary" | "empty" | "invalid";

export type MentionResolved =
  | { ok: true; attachment: TextAttachment }
  | { ok: false; reason: MentionRefusal };

export interface MentionFile {
  /** Chemin absolu : l'hôte le revalide à la lecture (jamais fait confiance à la webview). */
  path: string;
  /** Libellé affiché : chemin relatif au dossier de l'espace de travail. */
  label: string;
}

/** Disponibilité des entrées spéciales, sans texte : la webview libelle le grisé. */
export type MentionSpecial =
  | { available: true }
  | { available: false; why: "no-project" | "empty" };

/** Motif de `workspace.findFiles` : insensible à la casse, sans métacaractère de glob injecté. */
export function mentionGlob(query: string): string {
  const safe = query
    .slice(0, MENTION_MAX_QUERY)
    .replace(/\\/g, "/")
    .replace(/[^A-Za-z0-9_./ -]/g, "");
  const letters = [...safe]
    .map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c))
    .join("");
  return `**/*${letters}*`;
}

const optionsFor = (folders: readonly string[]) => ({
  cwd: folders[0] ?? ".",
  roots: folders,
});

/** Vrai si le chemin est autorisé : ni sensible, ni hors des dossiers de l'espace de travail. */
export function mentionPathAllowed(path: string, folders: readonly string[]): boolean {
  if (folders.length === 0 || path.includes("\0")) return false;
  try {
    return checkPathAccess([path], optionsFor(folders)) === null;
  } catch {
    return false;
  }
}

/** Filtre les candidats de `findFiles` : un chemin sensible ou hors espace de travail est absent. */
export function listMentionFiles(
  candidates: readonly string[],
  folders: readonly string[],
): MentionFile[] {
  const out: MentionFile[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (out.length >= MENTION_MAX_RESULTS) break;
    if (seen.has(candidate) || !isAbsolute(candidate) || !mentionPathAllowed(candidate, folders))
      continue;
    seen.add(candidate);
    const root = folders.find((folder) => !relative(folder, candidate).startsWith(".."));
    const rel = relative(root ?? folders[0] ?? "", candidate).replace(/\\/g, "/");
    out.push({
      path: candidate,
      label: folders.length > 1 && root ? `${basename(root)}/${rel}` : rel,
    });
  }
  return out;
}

/** Coupe sur un nombre d'octets sans couper un caractère. */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end--;
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
  return { text: text.slice(0, end), truncated: true };
}

/** Une pièce jointe doit passer le même contrôle que celles envoyées par la webview. */
function validated(name: string, text: string): MentionResolved {
  if (text.trim() === "") return { ok: false, reason: "empty" };
  if (parseAttachments([{ name, text }]) === null) return { ok: false, reason: "binary" };
  return { ok: true, attachment: { name, text } };
}

/**
 * Lit un fichier de l'espace de travail pour le joindre. Chemin relatif : résolu depuis le premier
 * dossier ; `..` et liens sortants sont refusés par `checkPathAccess`. Mêmes plafonds que les
 * pièces jointes manuelles (64 Kio) : plus gros, refusé.
 */
export async function resolveMentionFile(
  rawPath: string,
  folders: readonly string[],
): Promise<MentionResolved> {
  if (typeof rawPath !== "string" || rawPath === "" || rawPath.length > 1024)
    return { ok: false, reason: "invalid" };
  const path = isAbsolute(rawPath) ? rawPath : resolve(folders[0] ?? ".", rawPath);
  if (!mentionPathAllowed(path, folders)) return { ok: false, reason: "path" };
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!info.isFile()) return { ok: false, reason: "missing" };
  if (info.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "size" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
  } catch {
    return { ok: false, reason: "binary" };
  }
  return validated(basename(path), text);
}

const KIND_LABEL: Record<Finding["kind"], string> = {
  host: "hôte",
  credential: "identifiant",
  site: "site",
  step: "étape",
  loot: "butin",
};
const STATE_LABEL: Record<Finding["state"], string> = {
  confirmed: "confirmé",
  hypothesis: "hypothèse",
  failed: "échec",
};

/** Résumé texte des notes Kill Chain : kind, libellé, état, liens (libellés des parents). Plafonné. */
export function killchainSummary(findings: readonly Finding[]): MentionResolved {
  if (findings.length === 0) return { ok: false, reason: "empty" };
  const labels = new Map(findings.map((f) => [f.id, f.label]));
  const lines = findings.map((f) => {
    const parents = (f.from ?? []).map((id) => labels.get(id) ?? id);
    const links = parents.length ? ` ← ${parents.join(", ")}` : "";
    return `- [${KIND_LABEL[f.kind]}] ${f.label} (${STATE_LABEL[f.state]})${links}`;
  });
  const head = "Notes Kill Chain du projet actif :\n";
  const cut = truncateUtf8(`${head}${lines.join("\n")}`, MAX_ATTACHMENT_BYTES - 8);
  return validated("killchain.txt", cut.truncated ? `${cut.text}\n…` : cut.text);
}

/** Dernière sortie d'outil non vide de la session (déjà neutralisée par la vue), plafonnée. */
export function lastToolOutput(
  items: readonly { kind: string; label?: string; output?: string }[],
): MentionResolved {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "tool" || !item.output || item.output.trim() === "") continue;
    const cut = truncateUtf8(
      `${item.label ?? "Outil"} :\n${item.output}`,
      MAX_ATTACHMENT_BYTES - 8,
    );
    return validated("sortie.txt", cut.truncated ? `${cut.text}\n…` : cut.text);
  }
  return { ok: false, reason: "empty" };
}
