import { stripControl } from "@warband/core";

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
  Task: "Sous-agent",
  Agent: "Sous-agent",
  TodoWrite: "Liste de tâches",
};

/** Nom lisible d'un outil (texte déjà nettoyé en amont ; inconnu → nom tel quel). */
export function toolLabel(tool: string): string {
  if (tool.startsWith(SANDBOX_TOOL_PREFIX)) {
    return `Bac à sable · ${tool.slice(SANDBOX_TOOL_PREFIX.length)}`;
  }
  return LABELS[tool] ?? tool;
}

const KEYS = ["file_path", "path", "notebook_path", "pattern", "command", "url", "query", "prompt"];

/** Résumé court sur une ligne de l'entrée d'un outil : chemin, motif, commande… (jamais de JSON). */
export function summarizeInput(input: Record<string, unknown>, max = 120): string {
  const key = KEYS.find((k) => typeof input[k] === "string" && input[k] !== "");
  const value = key === undefined ? undefined : (input[key] as string);
  if (value === undefined) return "";
  const line = stripControl(value.slice(0, 4000)).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
