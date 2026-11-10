import { type EngineEvent, EXEGOL_EXEC_TOOL, KALI_TOOL_PREFIX } from "@warband/core";
import { formatError, formatReason, getUiLocale, t } from "@warband/messages";
import { type ApprovalCard, cleanText, describeInput } from "./approval.js";
import type { ChatControls } from "./controls.js";
import { type Block, parseMarkdown } from "./markdown.js";
import { summarizeInput, toolLabel } from "./present.js";
import { displayToolOutput } from "./tool-output.js";

// Fenêtre de travail bornée ; les pages précédentes restent dans le journal.
export const MAX_ITEMS = 60;
export const MAX_OUTPUT_CHARS = 2000;

/** Textes bruts qu'un abandon (SDK, DOMException, signal de l'UI) laisse dans `error.unknown`. */
const ABORT_TEXTS = new Set([
  "operation aborted",
  "the operation was aborted",
  "this operation was aborted",
  "annulé par l'utilisateur",
]);

function abortText(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return undefined;
  const rec = error as { message?: unknown; params?: { message?: unknown } };
  if (typeof rec.message === "string") return rec.message;
  if (typeof rec.params?.message === "string") return rec.params.message;
  return undefined;
}

function matchesAbort(raw: string): boolean {
  let text = raw.trim().toLowerCase();
  if (text.endsWith(".")) text = text.slice(0, -1).trim();
  if (text.startsWith("error:")) text = text.slice("error:".length).trim();
  if (text.startsWith("aborterror:")) text = text.slice("aborterror:".length).trim();
  return ABORT_TEXTS.has(text);
}

/** Vrai pour un `AbortError` ou le texte qu'un abandon volontaire laisse dans le fil. */
export function isAbortError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  ) {
    return true;
  }
  const text = abortText(error);
  return text !== undefined && matchesAbort(text);
}

/** Fenêtre de sortie montrée pendant qu'un exec tourne encore (le résultat final reste plafonné). */
const LIVE_OUTPUT_CHARS = 12_000;

export type ToolStatus = "pending" | "ok" | "error" | "denied" | "interrupted";

export type ChatItem = { source?: string } & (
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
  | {
      id: number;
      kind: "report";
      title: string;
      description: string;
      projectId: string;
      findings: { label: string; detail: string; severity: "unrated" }[];
    }
  | { id: number; kind: "notice"; level: "info" | "error"; text: string }
);

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
  projectKey?: string;
  projectLabel?: string;
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
  capabilities?: {
    settings: import("./chat-capabilities.js").CapabilitySettings | undefined;
    selection: import("./chat-capabilities.js").ChatSelection;
    providers: { id: string; label: string }[];
    provider: string | null;
    skills: string[];
    integrations: string[];
    burp: boolean;
    /** Entrées proposables dans le chat ; en choisir une l'active (réglage écrit par l'hôte). */
    available: { skills: string[]; integrations: string[]; burp: boolean };
  };
  /** Identité de vue : invalide les caches lors d’une nouvelle conversation, sans donner un accès disque. */
  conversation?: string;
  /** Attente annoncée par le fournisseur, distincte de la réflexion du modèle. */
  retry?: { attempt: number; delayMs: number };
  items: ChatItem[];
  exchangeTarget?: { id: number; source?: string; revision: number };
  paging?: {
    earlier: boolean;
    archived: boolean;
    before?: string | null;
    loading: boolean;
    error?: string;
  };
  approvals: ApprovalCard[];
  /** Occupation du contexte au dernier appel modèle (absente tant que le moteur n'en a pas annoncé). */
  context?: { usedTokens: number; windowTokens?: number };
  /** Un tour est en cours. */
  busy: boolean;
  stopping?: boolean;
  turnStartedAt?: number | null;
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
  noContainer?: boolean;
}

/** État du chat : mutable, une instance par conversation ; `view()` donne la forme envoyée à la webview. */
export function createChatState(before?: string) {
  const items: ChatItem[] = [];
  const approvals = new Map<string, ApprovalCard>();
  let busy = false;
  let turnStartedAt: number | null = null;
  let retry: { attempt: number; delayMs: number } | undefined;
  let context: { usedTokens: number; windowTokens?: number } | undefined;
  let sandbox: string | null = null;
  let sandboxNetwork: "none" | "bridge" | null = null;
  let controls: ChatControls | null = null;
  let history: HistoryEntry[] = [];
  let readonly: ReadonlyInfo | null = null;
  let noProvider = false;
  let noContainer = false;
  let nextId = 1;
  let dropped = 0;
  let source: string | undefined;
  let reached = false;
  /** Événement `tool.requested` d'un exec → identifiant d'appel. */
  const execTools = new Map<string, string>();
  /** Événement `process.started` de cet exec → identifiant d'appel. */
  const execProcs = new Map<string, string>();

  const push = (item: NewItem) => {
    if (reached) return;
    items.push({ ...item, ...(source && { source }), id: nextId++ } as ChatItem);
    if (items.length > MAX_ITEMS) {
      dropped += items.length - MAX_ITEMS;
      const removed = items.splice(0, items.length - MAX_ITEMS);
      for (const old of removed)
        if (old.kind === "tool") {
          for (const [id, use] of execTools) if (use === old.toolUseId) execTools.delete(id);
          for (const [id, use] of execProcs) if (use === old.toolUseId) execProcs.delete(id);
        }
    }
  };
  const findTool = (toolUseId: string) => {
    const found = items.find((i) => i.kind === "tool" && i.toolUseId === toolUseId);
    return found?.kind === "tool" ? found : undefined;
  };
  const notice = (text: string, level: "info" | "error" = "info") =>
    push({ kind: "notice", level, text: cleanText(text, 2000) });

  return {
    approvals,
    get dropped() {
      return dropped;
    },
    get reached() {
      return reached;
    },
    interruptPending() {
      let count = 0;
      for (const item of items)
        if (item.kind === "tool" && item.status === "pending") {
          item.status = "interrupted";
          count++;
        }
      return count;
    },
    get busy() {
      return busy;
    },
    setBusy(value: boolean) {
      if (value && !busy) turnStartedAt = Date.now();
      if (!value) turnStartedAt = null;
      busy = value;
      retry = undefined;
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
    user: (text: string, eventSource?: string) => {
      source = eventSource;
      if (source !== undefined && source === before) reached = true;
      push({ kind: "user", text: cleanText(text, 100_000) });
      source = undefined;
    },
    notice,
    error: (error: unknown) => notice(formatError(error, getUiLocale()), "error"),
    clear() {
      retry = undefined;
      dropped = 0;
      reached = false;
      source = undefined;
      items.length = 0;
      approvals.clear();
      execTools.clear();
      execProcs.clear();
      busy = false;
      turnStartedAt = null;
      context = undefined;
      readonly = null;
      sandboxNetwork = null;
      noContainer = false;
    },
    /** Traduit un événement du moteur en éléments de vue. */
    event(e: EngineEvent) {
      try {
        source = `${e.runId}/${e.id}`;
        if (source === before) reached = true;
        switch (e.kind) {
          case "run.started":
            noContainer = false;
            return;
          case "mission.noContainer":
            noContainer = true;
            notice(t("Pas de conteneur attaché : outils shell indisponibles."));
            return;
          case "user.message": {
            // La saisie locale précède le journal du moteur ; on lui associe sa preuve, sans doublon.
            const user = items.findLast((item) => item.kind === "user" && !item.source);
            if (user) user.source = source;
            source = undefined;
            return;
          }
          case "process.exited":
            if (e.parentId !== null) execProcs.delete(e.parentId);
            return;
          case "api.retry":
            retry = { attempt: e.attempt, delayMs: e.delayMs };
            notice(
              t`Fournisseur temporairement indisponible${e.errorStatus === null ? "" : ` (HTTP ${e.errorStatus})`}. Nouvelle tentative dans ${Math.ceil(e.delayMs / 1000)} s.`,
            );
            return;
          case "context.usage":
            context = {
              usedTokens: e.usedTokens,
              ...(e.windowTokens !== undefined && { windowTokens: e.windowTokens }),
            };
            return;
          case "research.status":
            notice(
              e.status === "requested"
                ? t("Recherche demandée pour ce message.")
                : e.status === "completed"
                  ? t(
                      "Recherche et lecture demandées : réponses web reçues. Vérifiez leur pertinence.",
                    )
                  : e.status === "cancelled"
                    ? t("Recherche demandée interrompue : résultat inconnu.")
                    : t(
                        "Recherche demandée non aboutie : recherche et lecture de source non confirmées.",
                      ),
              e.status === "failed" || e.status === "cancelled" ? "error" : "info",
            );
            return;
          case "agent.thinking":
            retry = undefined;
            return;
          case "agent.text":
            retry = undefined;
            if (!reached && e.text.trim() !== "") {
              const text = cleanText(e.text, 100_000);
              push({ kind: "agent", text, blocks: parseMarkdown(text) });
            }
            return;
          case "tool.requested":
            if (reached) return;
            retry = undefined;
            push({
              kind: "tool",
              toolUseId: e.toolUseId,
              tool: cleanText(e.tool, 200),
              label: toolLabel(cleanText(e.tool, 200)),
              summary: summarizeInput(e.input),
              input: describeInput(e.input, 1000),
              status: "pending",
            });
            if (!reached && (e.tool === EXEGOL_EXEC_TOOL || e.tool.startsWith(KALI_TOOL_PREFIX))) {
              execTools.set(e.id, e.toolUseId);
            }
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
            if (live?.status !== "pending") return;
            const prev = live.output ?? "";
            const line = displayToolOutput(live.tool, e.line, LIVE_OUTPUT_CHARS, e.truncated);
            const next = prev === "" ? line.output : `${prev}\n${line.output}`;
            live.output = cleanText(next, LIVE_OUTPUT_CHARS);
            live.truncated =
              live.truncated === true || next.length > LIVE_OUTPUT_CHARS || line.truncated;
            return;
          }
          case "approval.decided": {
            approvals.delete(e.toolUseId);
            const t = findTool(e.toolUseId);
            if (t) t.decision = e.decision === "deny" ? "deny" : "allow";
            if (t && e.decision === "deny") {
              t.status = "denied";
              t.output = cleanText(formatReason(e.reason, getUiLocale()), 1000);
            }
            return;
          }
          case "tool.result": {
            for (const [id, use] of execTools) if (use === e.toolUseId) execTools.delete(id);
            for (const [id, use] of execProcs) if (use === e.toolUseId) execProcs.delete(id);
            const t = findTool(e.toolUseId);
            if (!t) return;
            const display = displayToolOutput(
              t.tool,
              e.output,
              t.tool.startsWith(KALI_TOOL_PREFIX) ? LIVE_OUTPUT_CHARS : MAX_OUTPUT_CHARS,
              e.truncated,
            );
            if (t.status !== "denied") t.status = e.isError || display.failed ? "error" : "ok";
            t.output = display.output;
            t.truncated = display.truncated;
            return;
          }
          case "run.finished":
          case "turn.finished":
            retry = undefined;
            busy = false;
            return;
          case "error":
            retry = undefined;
            notice(formatError(e, getUiLocale()), "error");
            return;
          case "sandbox.started":
            sandbox = cleanText(e.image, 300);
            if (e.network === "none" || e.network === "bridge") sandboxNetwork = e.network;
            notice(t`Bac à sable prêt : ${e.image}`);
            return;
          default:
            return;
        }
      } finally {
        source = undefined;
      }
    },
    view(): ChatView {
      return {
        items: [...items],
        ...(retry && { retry }),
        ...(context && { context: { ...context } }),
        approvals: readonly ? [] : [...approvals.values()],
        busy,
        turnStartedAt: busy ? turnStartedAt : null,
        sandbox,
        sandboxNetwork,
        controls,
        history,
        readonly,
        noProvider,
        noContainer,
      };
    },
  };
}

export type ChatState = ReturnType<typeof createChatState>;

/** Le Monitor n'a besoin ni des messages Markdown, ni de l'historique, ni du catalogue. */
export function monitorChatView(view: ChatView, toolUseId?: string): ChatView {
  return {
    ...view,
    items: view.items.filter(
      (item) => item.kind === "tool" && (toolUseId === undefined || item.toolUseId === toolUseId),
    ),
    controls: null,
    history: [],
  };
}
