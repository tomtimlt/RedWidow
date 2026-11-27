import {
  type EngineEvent,
  EXEGOL_EXEC_TOOL,
  isSubagentTool,
  KALI_TOOL_PREFIX,
  SUBAGENTS_MAX_RUNNING,
} from "@warband/core";
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
      /**
       * Nom du sous-agent (ADR 0054), pour un `Task` lancé par l'agent principal : `input.description`,
       * texte du modèle neutralisé et plafonné à 200 caractères. Absent sans description lisible.
       */
      agent?: string;
      /** `toolUseId` du `Task` qui a lancé le sous-agent, pour un appel venant de ce sous-agent. */
      parentToolUseId?: string;
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
  | {
      /**
       * Trace en lecture seule d'une proposition de sous-agents (ADR 0054) : construite depuis
       * `subagents.proposed` / `subagents.decided`, donc aussi présente en relecture. `selected` :
       * identifiants des éléments retenus (vide tant que `pending`, ou après un refus).
       */
      id: number;
      kind: "subagents";
      proposalId: string;
      items: { id: string; name: string; goal: string }[];
      status: "pending" | "accepted" | "declined";
      selected: string[];
      note?: string;
    }
);

type NewItem = ChatItem extends infer T
  ? T extends { id: number }
    ? Omit<T, "id">
    : never
  : never;

/**
 * Éléments d'une proposition de sous-agents : le texte vient du modèle (non fiable), donc neutralisé
 * (contrôles et bidi retirés) et plafonné. Les identifiants restent ceux du moteur : ils servent de
 * clés, jamais de texte affiché.
 */
function cleanSubagentItems(
  items: readonly SubagentsProposalView["items"][number][],
): SubagentsProposalView["items"] {
  return items.map((item) => ({
    id: item.id,
    name: cleanText(item.name, 200),
    goal: cleanText(item.goal, 4000),
  }));
}

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

/** Proposition de sous-agents telle que la vue la reçoit : un élément par volet, à cocher. */
export interface SubagentsProposalView {
  proposalId: string;
  items: { id: string; name: string; goal: string }[];
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
  /**
   * Proposition de sous-agents en attente de la réponse de l'utilisateur (ADR 0054) : textes déjà
   * neutralisés. Absente sans proposition et en lecture seule. La webview en fait une carte dans
   * `#approvals` ; la trace durable reste l'élément `subagents` du fil.
   */
  subagentsProposal?: SubagentsProposalView;
  /**
   * Sous-agents en cours (ADR 0054), pour le compteur de la puce : présent seulement quand le mode est
   * actif. `running` compte les éléments `Task` autorisés dont le résultat n'est pas arrivé.
   */
  subagents?: { running: number; max: typeof SUBAGENTS_MAX_RUNNING };
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
  let subagentsProposal: SubagentsProposalView | null = null;
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
  /** `toolUseId` d'un `Task` de l'agent principal → nom du sous-agent (`input.description`). */
  const taskNames = new Map<string, string>();
  /**
   * `agentId` d'un sous-agent → son nom et le `Task` qui l'a lancé (pour l'oublier avec lui). Alimentée
   * par les appels du sous-agent ; la vue y résout le nom d'une carte d'autorisation à chaque rendu,
   * donc l'ordre d'arrivée entre l'appel et la demande n'a pas d'importance.
   */
  const agentNames = new Map<string, { name: string; use: string }>();

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
          taskNames.delete(old.toolUseId);
          for (const [id, known] of agentNames)
            if (known.use === old.toolUseId) agentNames.delete(id);
        }
    }
  };
  const findTool = (toolUseId: string) => {
    const found = items.find((i) => i.kind === "tool" && i.toolUseId === toolUseId);
    return found?.kind === "tool" ? found : undefined;
  };
  const notice = (
    text: string,
    level: "info" | "error" = "info",
    maxChars = level === "error" ? 12_000 : 2000,
  ) => push({ kind: "notice", level, text: cleanText(text, maxChars) });

  return {
    approvals,
    /** Proposition de sous-agents en attente (textes neutralisés), ou `null`. */
    get subagentsProposal() {
      return subagentsProposal;
    },
    setSubagentsProposal(proposal: {
      proposalId: string;
      items: readonly SubagentsProposalView["items"][number][];
    }) {
      subagentsProposal = {
        proposalId: proposal.proposalId,
        items: cleanSubagentItems(proposal.items),
      };
    },
    /** Efface ce qui attend une réponse de l'utilisateur : demandes d'approbation et proposition de sous-agents. */
    clearPending() {
      approvals.clear();
      subagentsProposal = null;
    },
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
      subagentsProposal = null;
      execTools.clear();
      execProcs.clear();
      taskNames.clear();
      agentNames.clear();
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
          case "tool.requested": {
            if (reached) return;
            retry = undefined;
            // Sous-agents (ADR 0054) : un `Task` de l'agent principal porte le nom du sous-agent ; un
            // appel venu d'un sous-agent se rattache à ce `Task`.
            const launcher = isSubagentTool(e.tool) && e.agentToolUseId === undefined;
            const description =
              launcher && typeof e.input.description === "string"
                ? cleanText(e.input.description, 200)
                : "";
            const agent = description.trim() === "" ? undefined : description;
            push({
              kind: "tool",
              toolUseId: e.toolUseId,
              tool: cleanText(e.tool, 200),
              label: toolLabel(cleanText(e.tool, 200)),
              summary: summarizeInput(e.input),
              input: describeInput(e.input, 1000),
              status: "pending",
              ...(agent !== undefined && { agent }),
              ...(e.agentToolUseId !== undefined && { parentToolUseId: e.agentToolUseId }),
            });
            if (agent !== undefined) taskNames.set(e.toolUseId, agent);
            if (e.agentToolUseId !== undefined && e.agentId !== undefined) {
              const name = taskNames.get(e.agentToolUseId);
              if (name !== undefined) agentNames.set(e.agentId, { name, use: e.agentToolUseId });
            }
            if (e.tool === EXEGOL_EXEC_TOOL || e.tool.startsWith(KALI_TOOL_PREFIX)) {
              execTools.set(e.id, e.toolUseId);
            }
            return;
          }
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
          case "subagents.proposed":
            push({
              kind: "subagents",
              proposalId: e.proposalId,
              items: cleanSubagentItems(e.items),
              status: "pending",
              selected: [],
            });
            return;
          case "subagents.decided": {
            if (subagentsProposal?.proposalId === e.proposalId) subagentsProposal = null;
            // Seul l'élément de cette proposition est mis à jour ; une proposition inconnue ne change rien.
            const entry = items.findLast(
              (item) => item.kind === "subagents" && item.proposalId === e.proposalId,
            );
            if (entry?.kind !== "subagents") return;
            const known = new Set(entry.items.map((item) => item.id));
            entry.status = e.decision;
            entry.selected = e.selected.map((place) => place.id).filter((id) => known.has(id));
            const note = e.note === undefined ? "" : cleanText(e.note, 2000);
            if (note.trim() !== "") entry.note = note;
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
      // Une carte venue d'un sous-agent reçoit son nom à chaque vue (`""` si inconnu : affichage générique).
      const named = ({ agentId, ...card }: ApprovalCard): ApprovalCard =>
        agentId === undefined ? card : { ...card, agent: agentNames.get(agentId)?.name ?? "" };
      // Un sous-agent « en cours » est un `Task` de l'agent principal, autorisé, sans résultat.
      const running = items.filter(
        (item) =>
          item.kind === "tool" &&
          isSubagentTool(item.tool) &&
          item.parentToolUseId === undefined &&
          item.decision === "allow" &&
          item.status === "pending",
      ).length;
      return {
        items: [...items],
        ...(retry && { retry }),
        ...(context && { context: { ...context } }),
        approvals: readonly ? [] : [...approvals.values()].map(named),
        ...(!readonly && subagentsProposal && { subagentsProposal }),
        ...(!readonly &&
          controls?.subagents === true && {
            subagents: { running, max: SUBAGENTS_MAX_RUNNING },
          }),
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
