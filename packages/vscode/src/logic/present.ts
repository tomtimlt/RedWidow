import { stripControl } from "@warband/core";
import { createUiTranslator, getUiLocale, type Locale } from "@warband/messages";

const SANDBOX_TOOL_PREFIX = "mcp__sandbox__";

const LABELS: Record<string, string> = {
  Read: "Lecture",
  Write: "Écriture",
  Edit: "Modification",
  MultiEdit: "Modification",
  NotebookEdit: "Modification de notebook",
  Glob: "Recherche de fichiers",
  Grep: "Recherche dans les fichiers",
  LS: "Liste du dossier",
  Bash: "Commande",
  WebFetch: "Page web",
  WebSearch: "Recherche web",
  mcp__web__search_web: "Recherche web",
  mcp__web__read_url: "Lire une page web",
  mcp__burp__list_tools: "Burp · catalogue des outils",
  mcp__burp__call_tool: "Burp · appel d’outil",
  Task: "Sous-agent",
  Agent: "Sous-agent",
  TodoWrite: "Liste de tâches",
};

/** Nom lisible d'un outil (texte déjà nettoyé en amont ; inconnu → nom tel quel). */
export function toolLabel(tool: string, locale: Locale = getUiLocale()): string {
  const t = createUiTranslator(() => locale);
  if (tool.startsWith(SANDBOX_TOOL_PREFIX)) {
    return t`Bac à sable · ${tool.slice(SANDBOX_TOOL_PREFIX.length)}`;
  }
  return LABELS[tool] === undefined ? tool : t(LABELS[tool]);
}

const KEYS = [
  "file_path",
  "path",
  "notebook_path",
  "pattern",
  "command",
  "url",
  "query",
  "prompt",
  "name",
];

/** Résumé court sur une ligne de l'entrée d'un outil : chemin, motif, commande… (jamais de JSON). */
export function summarizeInput(input: Record<string, unknown>, max = 120): string {
  const key = KEYS.find((k) => typeof input[k] === "string" && input[k] !== "");
  const value = key === undefined ? undefined : (input[key] as string);
  if (value === undefined) return "";
  const line = stripControl(value.slice(0, 4000)).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
