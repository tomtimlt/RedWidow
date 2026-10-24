import { isRememberable, type PendingApproval, stripControl } from "@warband/core";
import { formatReason } from "@warband/messages";
import { summarizeInput, toolLabel } from "./present.js";

/** Plafond du texte d'entrée d'outil affiché dans une carte (caractères). */
export const MAX_DETAIL_CHARS = 4000;

/** Choix de l'utilisateur sur une carte. Pas de « tout autoriser » : il n'existe pas. */
export type Choice = "once" | "deny" | "always";

/** Carte d'approbation affichée dans la webview : tout le texte est déjà neutralisé. */
export interface ApprovalCard {
  toolUseId: string;
  tool: string;
  /** Nom lisible de l'outil et résumé d'une ligne de l'action (pour la carte). */
  label: string;
  summary: string;
  detail: string;
  reason: string;
  /** « Toujours » est proposé seulement si le verdict est mémorisable (prédicat du cœur). */
  canRemember: boolean;
}

/** Texte non fiable destiné à l'affichage : contrôles et bidi retirés (`stripControl` du cœur), plafonné. */
export function cleanText(text: string, max = MAX_DETAIL_CHARS): string {
  const clean = stripControl(text);
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Entrée d'un outil sous forme affichable (commande Bash telle quelle, sinon JSON). */
export function describeInput(input: Record<string, unknown>, max = MAX_DETAIL_CHARS): string {
  const text = typeof input.command === "string" ? input.command : JSON.stringify(input);
  return cleanText(text, max);
}

export function toCard(pending: PendingApproval): ApprovalCard {
  const tool = cleanText(pending.tool, 200);
  return {
    toolUseId: pending.toolUseId,
    tool,
    label: toolLabel(tool),
    summary: summarizeInput(pending.input, 200),
    detail: describeInput(pending.input),
    reason: cleanText(formatReason(pending.verdict.reason), 1000),
    canRemember: pending.verdict.decision === "ask" && isRememberable(pending, pending.verdict),
  };
}

/** Réponse envoyée à la gate, comme la CLI : refuser, une fois, ou « toujours » (la gate reste juge). */
export function answerFor(choice: Choice): {
  decision: "allow" | "deny";
  remember?: "always";
} {
  if (choice === "deny") return { decision: "deny" };
  return choice === "always" ? { decision: "allow", remember: "always" } : { decision: "allow" };
}

/** Texte de la confirmation modale native (hors webview) exigée pour « Toujours ». */
export function alwaysConfirmText(card: ApprovalCard): string {
  return `Autoriser « ${card.tool} » sans redemander, pour la durée de cette conversation (la persistance sur disque n'est pas encore disponible) ?\n\n${card.detail.slice(0, 300)}`;
}

export const MAX_WEBVIEW_TEXT = 100_000;

export type WebviewMessage =
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "ready" }
  /** Chat grisé sans jeton : demande d'ouvrir « définir le jeton ». Aucun champ ; l'hôte seul agit. */
  | { type: "addProvider" }
  /** Valeurs non fiables : l'extension les revalide (liste de modèles, énumération des niveaux). */
  | { type: "setModel"; model: string | null }
  | { type: "setEffort"; effort: string | null }
  | { type: "historyOpen"; id: string }
  | { type: "historyResume" }
  | { type: "historyRename"; id: string; title: string }
  | { type: "historyDelete"; id: string }
  | { type: "historyClear" }
  | { type: "historyRefresh" }
  | { type: "refreshModels" }
  /** Menu `#` ouvert : l'hôte renvoie la liste des terminaux avec leur dernière commande. */
  | { type: "refreshTerminals" }
  /** Ouvre la sortie d'un exec en lecture seule. `toolUseId` est celui de la vue, pas une commande. */
  | { type: "watch"; toolUseId: string }
  | { type: "approve"; toolUseId: string; choice: Choice }
  /** Interrupteur du Bypass (ADR 0006) : seul champ, pas de durée (fixée par l'hôte). */
  | { type: "setBypass"; enabled: boolean }
  /** Mode apprentissage (ADR 0010) de ce chat : seul champ, appliqué au message suivant. */
  | { type: "setLearning"; enabled: boolean }
  /** Ouvre la Kill chain en vue plein écran. Aucun champ. */
  | { type: "openKillchain" }
  /** Ouvre le panneau Monitor. Aucun champ : l'hôte seul choisit la colonne. */
  | { type: "openMonitor" };

/** Valide un message venu de la webview (non fiable) : forme exacte, sinon `null`. */
export function parseWebviewMessage(raw: unknown): WebviewMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const only = (...allowed: string[]) => Object.keys(m).every((k) => allowed.includes(k));
  switch (m.type) {
    case "send":
      return only("type", "text") &&
        typeof m.text === "string" &&
        m.text.trim() !== "" &&
        m.text.length <= MAX_WEBVIEW_TEXT
        ? { type: "send", text: m.text }
        : null;
    case "setModel":
      return only("type", "model") &&
        (m.model === null || (typeof m.model === "string" && m.model.length <= 200))
        ? { type: "setModel", model: m.model }
        : null;
    case "setEffort":
      return only("type", "effort") &&
        (m.effort === null || (typeof m.effort === "string" && m.effort.length <= 20))
        ? { type: "setEffort", effort: m.effort }
        : null;
    case "historyOpen":
    case "historyDelete":
      return only("type", "id") && typeof m.id === "string" && m.id.length <= 64
        ? { type: m.type, id: m.id }
        : null;
    case "historyRename":
      return only("type", "id", "title") &&
        typeof m.id === "string" &&
        m.id.length <= 64 &&
        typeof m.title === "string" &&
        m.title.length <= 1000
        ? { type: "historyRename", id: m.id, title: m.title }
        : null;
    case "stop":
    case "reset":
    case "refreshModels":
    case "refreshTerminals":
    case "historyResume":
    case "historyClear":
    case "historyRefresh":
    case "addProvider":
    case "ready":
    case "openKillchain":
    case "openMonitor":
      return only("type") ? { type: m.type } : null;
    case "setBypass":
      return only("type", "enabled") && typeof m.enabled === "boolean"
        ? { type: "setBypass", enabled: m.enabled }
        : null;
    case "setLearning":
      return only("type", "enabled") && typeof m.enabled === "boolean"
        ? { type: "setLearning", enabled: m.enabled }
        : null;
    case "watch":
      return only("type", "toolUseId") &&
        typeof m.toolUseId === "string" &&
        m.toolUseId.length > 0 &&
        m.toolUseId.length <= 200
        ? { type: "watch", toolUseId: m.toolUseId }
        : null;
    case "approve":
      return only("type", "toolUseId", "choice") &&
        typeof m.toolUseId === "string" &&
        m.toolUseId !== "" &&
        (m.choice === "once" || m.choice === "deny" || m.choice === "always")
        ? { type: "approve", toolUseId: m.toolUseId, choice: m.choice }
        : null;
    default:
      return null;
  }
}
