/**
 * Export du fil d'une conversation en Markdown (lot M4, décision 5), même contenu que l'extension
 * (`exportChat` de `logic/chat-export`). Les événements viennent des journaux déjà masqués par le recorder ;
 * ils sont en plus remasqués ici (valeurs du coffre et de l'environnement) avant d'être mis en forme :
 * aucune valeur de clé ou de compte ne figure dans le fichier offert en téléchargement.
 */
import {
  activeProject,
  createRedactor,
  type EngineEvent,
  readProjects,
  secretsFromEnv,
} from "@warband/core";
import type { ChatView } from "@warband/vscode/logic/chat";
import { exportChat } from "@warband/vscode/logic/chat-export";
import { isRunId, parseIndex } from "@warband/vscode/logic/history";
import { createJournalFiles } from "@warband/vscode/logic/historyStore";
import { SHARED_HISTORY_MAX_ENTRIES } from "@warband/vscode/logic/shared-history";

/** Événements relus au plus pour un export (au-delà, le fil est tronqué et le fichier le dit). */
export const MAX_EXPORT_EVENTS = 50_000;

/** Échec d'export : code sans détail (`project.absent` ou `view.failed`), jamais un message brut. */
export class ChatExportError extends Error {
  constructor(readonly code: "project.absent" | "view.failed") {
    super(code);
  }
}

export interface ChatExportDeps {
  configDir: string;
  /** Dossier des journaux de runs (`paths.runs`). */
  runsDir: string;
  /** Index de l'historique (non fiable : relu par `parseIndex`). */
  historyIndex(): unknown;
  /** Valeurs secrètes du coffre à masquer en plus de celles de l'environnement. */
  secretValues(): Promise<string[]>;
}

export interface ChatExportFile {
  filename: string;
  markdown: string;
}

/**
 * Fil de la conversation affichée (lecture seule ouverte, sinon conversation courante) du projet actif.
 * `project.absent` sans projet actif ; `view.failed` si aucun fil n'est exportable ou si un journal est
 * incomplet (jamais un export partiel silencieux).
 */
export async function buildChatExport(
  deps: ChatExportDeps,
  view: Pick<ChatView, "readonly" | "history">,
): Promise<ChatExportFile> {
  const file = await readProjects(deps.configDir);
  const project = file === null ? null : activeProject(file);
  if (project === null) throw new ChatExportError("project.absent");
  const conversation = view.readonly?.id ?? view.history.find((row) => row.current)?.id;
  if (conversation === undefined) throw new ChatExportError("view.failed");
  const rows = parseIndex(deps.historyIndex(), SHARED_HISTORY_MAX_ENTRIES).filter(
    (row) => row.projectId === project.id && row.id === conversation,
  );
  const files = createJournalFiles(deps.runsDir);
  const redact = createRedactor({
    values: [...secretsFromEnv(process.env), ...(await deps.secretValues())],
  });
  const events: EngineEvent[] = [];
  let truncated = false;
  for (const runId of new Set(rows.flatMap((row) => row.runIds))) {
    const result = await files.scan?.(runId, (event) => {
      if (events.length >= MAX_EXPORT_EVENTS) {
        truncated = true;
        return false;
      }
      events.push(redact(event));
      return true;
    });
    if (result === undefined || result.invalid > 0 || result.missing)
      throw new ChatExportError("view.failed");
    if (truncated) break;
  }
  const runId = events.at(-1)?.runId;
  if (runId === undefined || !isRunId(runId)) throw new ChatExportError("view.failed");
  const { markdown } = exportChat(events);
  return {
    filename: `fil-${runId}.md`,
    markdown: truncated ? `${markdown}\n[Export tronqué : fil trop long.]\n` : markdown,
  };
}
