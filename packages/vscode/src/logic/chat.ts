import { type EngineEvent, EXEGOL_EXEC_TOOL } from "@warband/core";
import { formatError, formatReason } from "@warband/messages";
import { type ApprovalCard, cleanText, describeInput } from "./approval.js";
import type { ChatControls } from "./controls.js";
import { type Block, parseMarkdown } from "./markdown.js";
import { summarizeInput, toolLabel } from "./present.js";

export const MAX_ITEMS = 300;
export const MAX_OUTPUT_CHARS = 2000;
/** Fenêtre de sortie montrée pendant qu'un exec tourne encore (le résultat final reste plafonné). */
const LIVE_OUTPUT_CHARS = 12_000;

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

/** Ligne de la liste d'historique : chaînes déjà neutralisées. */
export interface HistoryEntry {
  id: string;
  title: string;
  updatedAt: string;
  tools: number;
  provider: string;
  model: string;
  /** C'est la conversation affichée en ce moment. */
  current: boolean;
}

/** Conversation ouverte en lecture seule (relue d'un journal non fiable). */
export interface ReadonlyInfo {
  id: string;
  title: string;
  /** Lignes du journal ignorées (invalides, hors limites). */
  invalid: number;
  truncated: boolean;
  /** La session peut être reprise (identifiant connu). */
  canResume: boolean;
}

/** Ce que la webview affiche : uniquement des chaînes déjà neutralisées, jamais de HTML. */
export interface ChatView {
  items: ChatItem[];
  approvals: ApprovalCard[];
  /** Un tour est en cours (saisie bloquée, bouton Stop actif). */
  busy: boolean;
  /** Image du bac à sable du run, si activé. */
  sandbox: string | null;
  /** Profil réseau du bac à sable (`none` ou `bridge`), ou absent si désactivé / inconnu. */
  sandboxNetwork: "none" | "bridge" | null;
  /** Sélecteurs de modèle et d'effort (absents tant que la session ne les a pas calculés). */
  controls: ChatControls | null;
  history: HistoryEntry[];
  /** Non nul : mode lecture (aucune carte d'approbation, saisie désactivée). */
  readonly: ReadonlyInfo | null;
  /** Aucun fournisseur (jeton) ajouté : saisie grisée, la webview propose d'en ajouter un. */
  noProvider: boolean;
}

/** État du chat : mutable, une instance par conversation ; `view()` donne la forme envoyée à la webview. */
export function createChatState() {
  const items: ChatItem[] = [];
  const approvals = new Map<string, ApprovalCard>();
  let busy = false;
  let sandbox: string | null = null;
  let sandboxNetwork: "none" | "bridge" | null = null;
  let controls: ChatControls | null = null;
  let history: HistoryEntry[] = [];
  let readonly: ReadonlyInfo | null = null;
  let noProvider = false;
  let nextId = 1;
  /** Événement `tool.requested` d'un exec → identifiant d'appel. */
  const execTools = new Map<string, string>();
  /** Événement `process.started` de cet exec → identifiant d'appel. */
  const execProcs = new Map<string, string>();

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
    setHistory(value: HistoryEntry[]) {
      history = value;
    },
    setReadonly(value: ReadonlyInfo | null) {
      readonly = value;
    },
    get readonly() {
      return readonly;
    },
    setNoProvider(value: boolean) {
      noProvider = value;
    },
    get noProvider() {
      return noProvider;
    },
    setSandbox(image: string | null) {
      sandbox = image === null ? null : cleanText(image, 300);
      if (image === null) sandboxNetwork = null;
    },
    setSandboxNetwork(network: "none" | "bridge" | null) {
      sandboxNetwork = network;
    },
    get sandboxNetwork() {
      return sandboxNetwork;
    },
    user: (text: string) => push({ kind: "user", text: cleanText(text, 100_000) }),
    notice,
    error: (error: unknown) => notice(formatError(error), "error"),
    clear() {
      items.length = 0;
      approvals.clear();
      execTools.clear();
      execProcs.clear();
      busy = false;
      readonly = null;
      sandboxNetwork = null;
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
          if (e.tool === EXEGOL_EXEC_TOOL) execTools.set(e.id, e.toolUseId);
          return;
        case "process.started": {
          const use = e.parentId === null ? undefined : execTools.get(e.parentId);
          if (use !== undefined) execProcs.set(e.id, use);
          return;
        }
        case "process.output": {
          const use = e.parentId === null ? undefined : execProcs.get(e.parentId);
          if (use === undefined) return;
          const live = findTool(use);
          if (!live || live.status !== "pending") return;
          const prev = live.output ?? "";
          const next = prev === "" ? e.line : `${prev}\n${e.line}`;
          live.output = cleanText(next, LIVE_OUTPUT_CHARS);
          live.truncated = next.length > LIVE_OUTPUT_CHARS || e.truncated === true;
          return;
        }
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
          sandbox = cleanText(e.image, 300);
          if (e.network === "none" || e.network === "bridge") sandboxNetwork = e.network;
          notice(`Bac à sable prêt : ${e.image}`);
          return;
        default:
          return;
      }
    },
    view(): ChatView {
      return {
        items: [...items],
        approvals: readonly ? [] : [...approvals.values()],
        busy,
        sandbox,
        sandboxNetwork,
        controls,
        history,
        readonly,
        noProvider,
      };
    },
  };
}

export type ChatState = ReturnType<typeof createChatState>;
