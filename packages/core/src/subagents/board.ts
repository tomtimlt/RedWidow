import { randomUUID } from "node:crypto";
import { CodedError, type Reason, reason } from "../reason.js";
import type { Recorder } from "../recorder.js";
import {
  firstIssuePath,
  proposeSubagentsSchema,
  SUBAGENTS_MAX_RUNNING,
  SUBAGENTS_NOTE_MAX,
  type SubagentDraft,
  type SubagentItem,
  type SubagentPlace,
} from "./schema.js";

/**
 * Tableau des sous-agents d'une course (ADR 0054) : la proposition en attente, les places approuvées
 * par l'utilisateur mais non lancées, et les sous-agents en cours. Sans SDK ni texte d'affichage : des
 * codes (`Reason`) et des événements du cœur seulement. Une instance vit le temps d'une course ; le
 * moteur la partage entre la gate (règle structurelle sur `Task`) et l'outil `propose_subagents`.
 */

/** Nom canonique de l'outil de lancement d'un sous-agent (OpenCode `task` y est ramené par l'adaptateur). */
export const SUBAGENT_TASK_TOOL = "Task";

/** Nom que les SDK Claude récents donnent au même outil : la gate le traite comme `Task`. */
export const SUBAGENT_AGENT_TOOL = "Agent";

/**
 * Type du seul sous-agent que le moteur définit (`agents.redwidow` côté Claude, agent `redwidow` côté
 * OpenCode). Un appel Task qui en nomme un autre (agent natif du SDK, agent de l'utilisateur) est refusé.
 */
export const SUBAGENT_TYPE = "redwidow";

/** Vrai pour l'outil de lancement d'un sous-agent (`Task` ou `Agent`) : la gate lui applique la règle structurelle. */
export function isSubagentTool(tool: string): boolean {
  return tool === SUBAGENT_TASK_TOOL || tool === SUBAGENT_AGENT_TOOL;
}

/** Proposition en attente de la réponse de l'utilisateur. */
export interface PendingProposal {
  proposalId: string;
  items: SubagentItem[];
}

/** Réponse à une proposition : accord (places retenues, note éventuelle) ou refus (note éventuelle). */
export type SubagentsOutcome =
  | { decision: "accepted"; selected: SubagentPlace[]; note?: string }
  | { decision: "declined"; note?: string };

/** Appel `Task` soumis au tableau par la gate. */
export interface TaskCall {
  toolUseId: string;
  input: Record<string, unknown>;
  /** Présent : l'appel vient d'un sous-agent (pas d'imbrication). */
  agentId?: string | undefined;
}

/** Verdict structurel sur un appel `Task` ; `allow` a déjà fait passer la place à « en cours ». */
export interface TaskVerdict {
  decision: "allow" | "deny";
  reason: Reason;
}

export interface ProposeOptions {
  /** Événement de l'appel d'outil, parent causal des événements de la proposition. */
  parentId?: string | null | undefined;
  /** Annulation de l'appel d'outil : la proposition en attente est alors refusée. */
  signal?: AbortSignal | undefined;
}

export interface SubagentBoard {
  /** Proposition en attente de réponse, ou `null`. */
  pending(): PendingProposal | null;
  /** Places approuvées et pas encore lancées. */
  places(): SubagentPlace[];
  /** Nombre de sous-agents en cours. */
  running(): number;
  /**
   * Enregistre une proposition et attend la réponse. Refuse (`subagents.pendingProposal`) si une autre
   * attend déjà, (`subagents.invalidProposal`) si les éléments sont invalides, (`subagents.disabled`)
   * si la course est arrêtée. Une nouvelle proposition annule les places approuvées jamais lancées.
   */
  propose(items: readonly SubagentDraft[], options?: ProposeOptions): Promise<SubagentsOutcome>;
  /**
   * Réponse venue de l'interface : `selected` désigne des identifiants d'éléments (les inconnus sont
   * ignorés, aucun retenu = refus). `false` si `proposalId` n'est pas celui de la proposition en attente.
   */
  answer(proposalId: string, selected: readonly string[], note?: string): boolean;
  /** Texte libre de l'utilisateur pendant une proposition : refus avec ce texte pour note. `false` sans proposition. */
  declineWithText(text: string): boolean;
  /** Arrêt de la course : refuse la proposition en attente et ferme le tableau (plus aucun `Task` admis). */
  cancel(): void;
  /**
   * Règle structurelle sur un appel `Task` : mode inactif, imbrication, type de sous-agent, place non
   * approuvée, plafond. Sur `allow`, la place passe de « approuvée » à « en cours » (une place ne sert qu'une fois).
   */
  admitTask(call: TaskCall): TaskVerdict;
  /** Libère la place du `Task` terminé (résultat ou échec) ; `false` s'il n'était pas en cours. */
  finish(toolUseId: string): boolean;
}

export interface SubagentBoardOptions {
  recorder: Recorder;
  /** Appelé quand une proposition attend la réponse de l'utilisateur (le moteur la relaie à l'interface). */
  onProposal?: (proposal: PendingProposal) => void;
  /** Générateur d'identifiants de proposition (tests). */
  newId?: () => string;
}

/** Description citée dans un motif : bornée, elle vient du modèle. */
const cap = (value: string, max = 200): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/** Note de l'utilisateur : bornée, sans blancs de bord, absente si vide. */
function cleanNote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let note = value.trim();
  if (note.length > SUBAGENTS_NOTE_MAX) {
    note = note.slice(0, SUBAGENTS_NOTE_MAX);
    // Pas de moitié de paire de substitution en bout de coupe.
    if (/[\ud800-\udbff]$/.test(note)) note = note.slice(0, -1);
  }
  return note === "" ? undefined : note;
}

export function createSubagentBoard({
  recorder,
  onProposal,
  newId = randomUUID,
}: SubagentBoardOptions): SubagentBoard {
  interface Open {
    proposalId: string;
    items: SubagentItem[];
    parentId: string | null;
    settle(outcome: SubagentsOutcome): void;
  }
  let open: Open | null = null;
  let places: SubagentPlace[] = [];
  /** Sous-agents en cours, par `toolUseId` de l'appel Task. */
  const running = new Map<string, SubagentPlace>();
  let closed = false;

  // Une place se libère au premier des deux signaux : résultat de l'outil Task ou `task.updated` terminé.
  // Le premier plan est imposé par l'adaptateur (Claude : `run_in_background` forcé à faux ; OpenCode n'a
  // pas d'arrière-plan) : le résultat de l'outil marque donc la fin du sous-agent, sans exception.
  const unsubscribe = recorder.subscribe((event) => {
    if (event.kind === "tool.result") running.delete(event.toolUseId);
    else if (event.kind === "task.updated" && event.phase === "finished" && event.toolUseId)
      running.delete(event.toolUseId);
  });

  return {
    pending: () => (open === null ? null : { proposalId: open.proposalId, items: [...open.items] }),
    places: () => places.map((place) => ({ ...place })),
    running: () => running.size,

    async propose(drafts, options = {}) {
      if (closed) throw new CodedError("subagents.disabled");
      if (open !== null) throw new CodedError("subagents.pendingProposal");
      const parsed = proposeSubagentsSchema.safeParse({ items: drafts });
      if (!parsed.success) {
        const field = firstIssuePath(parsed.error);
        throw new CodedError(
          "subagents.invalidProposal",
          field === undefined ? undefined : { field },
        );
      }
      const { signal } = options;
      if (signal?.aborted === true) return { decision: "declined" };
      const parentId = options.parentId ?? null;
      const items: SubagentItem[] = parsed.data.items.map((item, index) => ({
        id: `s${index + 1}`,
        name: item.name,
        goal: item.goal,
      }));
      const proposalId = newId();
      // Une nouvelle proposition remplace l'accord précédent : une place jamais lancée ne survit pas.
      places = [];
      return new Promise<SubagentsOutcome>((resolve) => {
        const onAbort = () => entry.settle({ decision: "declined" });
        const entry: Open = {
          proposalId,
          items,
          parentId,
          settle(outcome) {
            if (open !== entry) return;
            open = null;
            signal?.removeEventListener("abort", onAbort);
            const note = cleanNote(outcome.note);
            const selected =
              outcome.decision === "accepted"
                ? outcome.selected.map((place) => ({ ...place }))
                : [];
            places = selected.map((place) => ({ ...place }));
            recorder.emit(
              {
                kind: "subagents.decided",
                proposalId,
                decision: outcome.decision,
                selected,
                ...(note !== undefined && { note }),
              },
              parentId,
            );
            resolve({ ...outcome, ...(note !== undefined && { note }) });
          },
        };
        open = entry;
        signal?.addEventListener("abort", onAbort, { once: true });
        recorder.emit(
          { kind: "subagents.proposed", proposalId, items: items.map((item) => ({ ...item })) },
          parentId,
        );
        onProposal?.({ proposalId, items: items.map((item) => ({ ...item })) });
      });
    },

    answer(proposalId, selectedIds, note) {
      if (open === null || open.proposalId !== proposalId) return false;
      const wanted = new Set(selectedIds);
      const selected: SubagentPlace[] = open.items
        .filter((item) => wanted.has(item.id))
        .map((item) => ({ id: item.id, description: item.name }));
      const cleaned = cleanNote(note);
      open.settle(
        selected.length === 0
          ? { decision: "declined", ...(cleaned !== undefined && { note: cleaned }) }
          : { decision: "accepted", selected, ...(cleaned !== undefined && { note: cleaned }) },
      );
      return true;
    },

    declineWithText(text) {
      if (open === null) return false;
      const note = cleanNote(text);
      open.settle({ decision: "declined", ...(note !== undefined && { note }) });
      return true;
    },

    cancel() {
      closed = true;
      open?.settle({ decision: "declined" });
      places = [];
      unsubscribe();
    },

    admitTask({ toolUseId, input, agentId }) {
      if (closed) return { decision: "deny", reason: reason("subagents.disabled") };
      // Défini = appel d'un sous-agent, même vide : en cas de doute on refuse (pas d'imbrication).
      if (agentId !== undefined) return { decision: "deny", reason: reason("subagents.nested") };
      const known = running.get(toolUseId);
      // Même appel soumis deux fois (adaptateur qui relaie deux fois) : même verdict, une seule place.
      if (known !== undefined) {
        return {
          decision: "allow",
          reason: reason("subagents.approved", { description: cap(known.description) }),
        };
      }
      // Seul l'agent `redwidow` du moteur est admis (type absent compris), avant toute place consommée :
      // un agent natif ou défini par l'utilisateur n'aurait ni le périmètre ni les outils prévus.
      const type = input.subagent_type;
      if (type !== SUBAGENT_TYPE) {
        return {
          decision: "deny",
          // `type` vide : champ absent ou non textuel (le catalogue le dit « aucun »).
          reason: reason("subagents.not_approved", {
            type: typeof type === "string" ? cap(type, 60) : "",
          }),
        };
      }
      const description = input.description;
      const index =
        typeof description === "string"
          ? places.findIndex((place) => place.description === description)
          : -1;
      if (index === -1) {
        return {
          decision: "deny",
          reason: reason(
            "subagents.not_approved",
            typeof description === "string" ? { description: cap(description) } : undefined,
          ),
        };
      }
      if (running.size >= SUBAGENTS_MAX_RUNNING) {
        return {
          decision: "deny",
          reason: reason("subagents.limit", { max: SUBAGENTS_MAX_RUNNING }),
        };
      }
      const [place] = places.splice(index, 1) as [SubagentPlace];
      running.set(toolUseId, place);
      return {
        decision: "allow",
        reason: reason("subagents.approved", { description: cap(place.description) }),
      };
    },

    finish: (toolUseId) => running.delete(toolUseId),
  };
}
