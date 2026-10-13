/**
 * Correspondance entre les outils d'OpenCode et ceux de la politique : la
 * politique, les garde-fous de chemin et les motifs Bash s'appliquent à
 * l'identique quel que soit l'agent, il faut donc leur parler dans les mêmes
 * termes (`Read` + `file_path`, `Bash` + `command`…).
 */

type Obj = Record<string, unknown>;

/** Outils natifs d'OpenCode connus → nom utilisé par la politique. */
const NATIVE_TOOLS: Readonly<Record<string, string>> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "MultiEdit",
  patch: "Patch",
  apply_patch: "Patch",
  glob: "Glob",
  grep: "Grep",
  list: "Glob",
  bash: "Bash",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  codesearch: "CodeSearch",
  task: "Task",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  skill: "Skill",
  question: "AskUserQuestion",
  lsp: "Lsp",
  batch: "Batch",
};

/** Noms OpenCode des outils natifs connus : tout ce qui n'est pas explicitement activé est coupé. */
export const KNOWN_NATIVE_TOOLS: readonly string[] = Object.keys(NATIVE_TOOLS);

/** Outils natifs exposés par défaut : lecture seule. */
export const DEFAULT_NATIVE_TOOLS: readonly string[] = ["read", "glob", "grep"];

/**
 * Outils dont le chemin est indispensable pour appliquer les garde-fous (le
 * champ est lu par `evaluatePolicy`). Sans chemin lisible, l'appel est refusé.
 */
const PATH_REQUIRED = new Set(["Read", "Write", "Edit", "MultiEdit"]);

/** Outils dont on ne sait pas extraire les chemins (diff multi-fichiers) : toujours refusés. */
const UNRESOLVABLE = new Set(["Patch"]);

/**
 * Nom d'un outil vu par la politique. Un outil MCP de l'un de nos serveurs
 * (`<serveur>_<outil>` côté OpenCode) devient `mcp__<serveur>__<outil>` ; un
 * outil inconnu garde son nom brut (la politique le traitera par défaut).
 */
export function policyToolName(tool: string, servers: readonly string[] = []): string {
  const native = NATIVE_TOOLS[tool];
  if (native !== undefined) return native;
  for (const server of servers) {
    const prefix = `${server}_`;
    if (tool.startsWith(prefix) && tool.length > prefix.length) {
      return `mcp__${server}__${tool.slice(prefix.length)}`;
    }
  }
  return tool;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Copie `from[source]` dans `to[target]` si le champ existe. */
function copy(from: Obj, source: string, to: Obj, target: string) {
  if (from[source] !== undefined) to[target] = from[source];
}

/**
 * Entrée normalisée d'un appel : noms de champs de la politique (`file_path`,
 * `command`, `pattern`, `path`), autres champs conservés tels quels.
 * `metadata` sert de repli pour le chemin (`filepath`) quand l'entrée de
 * l'outil n'est pas connue.
 */
export function normalizeInput(
  policyTool: string,
  input: Obj,
  metadata: Obj = {},
): Record<string, unknown> {
  const out: Obj = {};
  const filePath = text(input.filePath) ?? text(input.file_path) ?? text(metadata.filepath);
  switch (policyTool) {
    case "Read":
      if (filePath !== undefined) out.file_path = filePath;
      copy(input, "offset", out, "offset");
      copy(input, "limit", out, "limit");
      return out;
    case "Write":
      if (filePath !== undefined) out.file_path = filePath;
      copy(input, "content", out, "content");
      return out;
    case "Edit":
      if (filePath !== undefined) out.file_path = filePath;
      copy(input, "oldString", out, "old_string");
      copy(input, "newString", out, "new_string");
      copy(input, "replaceAll", out, "replace_all");
      return out;
    case "MultiEdit":
      if (filePath !== undefined) out.file_path = filePath;
      copy(input, "edits", out, "edits");
      return out;
    case "Glob": {
      // `list` d'OpenCode n'a pas de motif : on lui donne `*` pour que le garde-fou de chemin s'applique.
      copy(input, "pattern", out, "pattern");
      if (out.pattern === undefined) out.pattern = "*";
      const path = text(input.path) ?? text(metadata.path);
      if (path !== undefined) out.path = path;
      return out;
    }
    case "Grep": {
      copy(input, "pattern", out, "pattern");
      const path = text(input.path) ?? text(metadata.path);
      if (path !== undefined) out.path = path;
      copy(input, "include", out, "include");
      return out;
    }
    case "Bash":
      copy(input, "command", out, "command");
      copy(input, "description", out, "description");
      copy(input, "timeout", out, "timeout");
      copy(input, "workdir", out, "workdir");
      return out;
    default:
      return { ...input };
  }
}

/** Vrai si l'appel ne peut pas être évalué faute de chemin lisible : il est alors refusé (fail-closed). */
export function isUnevaluable(policyTool: string, input: Obj): boolean {
  if (UNRESOLVABLE.has(policyTool)) return true;
  return PATH_REQUIRED.has(policyTool) && text(input.file_path) === undefined;
}
