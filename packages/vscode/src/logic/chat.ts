import type { EngineEvent } from "@john-studio/core";
import { formatError, formatReason } from "@john-studio/messages";
import { type ApprovalCard, cleanText, describeInput } from "./approval.js";
import type { ChatControls } from "./controls.js";
import { type Block, parseMarkdown } from "./markdown.js";
import { summarizeInput, toolLabel } from "./present.js";

export const MAX_ITEMS = 300;
export const MAX_OUTPUT_CHARS = 2000;

export type ToolStatus = "pending" | "ok" | "error" | "denied";

export type ChatItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "agent"; text: string; blocks: Block[] }
  | {
      id: number;
      kind: "tool";
      toolUseId: string;
      tool: string;
      /** Nom lisible et résumé d'une ligne de l'entrée (le détail complet reste dans `input`). */
      label: string;
      summary: string;
      input: string;
      status: ToolStatus;
      /** Décision de la gate, une fois connue. */
      decision?: "allow" | "deny";
      output?: string;
      truncated?: boolean;
    }
  | { id: number; kind: "notice"; level: "info" | "error"; text: string };

type NewItem = ChatItem extends infer T
  ? T extends { id: number }
    ? Omit<T, "id">
    : never
  : never;

/** Ce que la webview affiche : uniquement des chaînes déjà neutralisées, jamais de HTML. */
export interface ChatView {
  items: ChatItem[];
  approvals: ApprovalCard[];
  /** Un tour est en cours (saisie bloquée, bouton Stop actif). */
  busy: boolean;
  /** Image du bac à sable du run, si activé. */
  sandbox: string | null;
  /** Sélecteurs de modèle et d'effort (absents tant que la session ne les a pas calculés). */
  controls: ChatControls | null;
}

/** État du chat : mutable, une instance par conversation ; `view()` donne la forme envoyée à la webview. */
export function createChatState() {
  const items: ChatItem[] = [];
  const approvals = new Map<string, ApprovalCard>();
  let busy = false;
  let sandbox: string | null = null;
  let controls: ChatControls | null = null;
  let nextId = 1;

  const push = (item: NewItem) => {
    items.push({ ...item, id: nextId++ } as ChatItem);
    if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
  };
  const findTool = (toolUseId: string) => {
    const found = items.find((i) => i.kind === "tool" && i.toolUseId === toolUseId);
    return found?.kind === "tool" ? found : undefined;
  };
  const notice = (text: string, level: "info" | "error" = "info") =>
    push({ kind: "notice", level, text: cleanText(text, 2000) });

  return {
    approvals,
    get busy() {
      return busy;
    },
    setBusy(value: boolean) {
      busy = value;
    },
    setControls(value: ChatControls) {
      controls = value;
    },
    setSandbox(image: string | null) {
      sandbox = image === null ? null : cleanText(image, 300);
    },
    user: (text: string) => push({ kind: "user", text: cleanText(text, 100_000) }),
    notice,
    error: (error: unknown) => notice(formatError(error), "error"),
    clear() {
      items.length = 0;
      approvals.clear();
      busy = false;
    },
    /** Traduit un événement du moteur en éléments de vue. */
    event(e: EngineEvent) {
      switch (e.kind) {
        case "agent.text":
          if (e.text.trim() !== "") {
            const text = cleanText(e.text, 100_000);
            push({ kind: "agent", text, blocks: parseMarkdown(text) });
          }
          return;
        case "tool.requested":
          push({
            kind: "tool",
            toolUseId: e.toolUseId,
            tool: cleanText(e.tool, 200),
            label: toolLabel(cleanText(e.tool, 200)),
            summary: summarizeInput(e.input),
            input: describeInput(e.input, 1000),
            status: "pending",
          });
          return;
        case "approval.decided": {
          approvals.delete(e.toolUseId);
          const t = findTool(e.toolUseId);
          if (t) t.decision = e.decision === "deny" ? "deny" : "allow";
          if (t && e.decision === "deny") {
            t.status = "denied";
            t.output = cleanText(formatReason(e.reason), 1000);
          }
          return;
        }
        case "tool.result": {
          const t = findTool(e.toolUseId);
          if (!t) return;
          if (t.status !== "denied") t.status = e.isError ? "error" : "ok";
          t.output = cleanText(e.output, MAX_OUTPUT_CHARS);
          t.truncated = e.truncated || e.output.length > MAX_OUTPUT_CHARS;
          return;
        }
        case "turn.finished":
          busy = false;
          return;
        case "error":
          notice(formatError(e), "error");
          return;
        case "sandbox.started":
          notice(`Bac à sable prêt : ${e.image}`);
          return;
        default:
          return;
      }
    },
    view(): ChatView {
      return { items: [...items], approvals: [...approvals.values()], busy, sandbox, controls };
    },
  };
}

export type ChatState = ReturnType<typeof createChatState>;
